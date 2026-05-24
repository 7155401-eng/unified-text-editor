
import JSZip from "jszip";

const MAX_DOCX_BYTES = 100 * 1024 * 1024;

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-file-name",
    "access-control-max-age": "86400",
  };
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

export function methodNotAllowed() {
  return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
}

export function routeNotImplemented(kind = "extract") {
  return jsonResponse({
    ok: false,
    serverSide: true,
    error: `Cloudflare DOCX ${kind} endpoint is reachable, but this operation is not implemented in the lightweight Cloudflare scanner yet.`,
  }, 501);
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

const HEBREW_MARKS_RE = /[\u0591-\u05C7]/g;

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(HEBREW_MARKS_RE, "")
    .trim()
    .toLowerCase();
}

function attr(xml, name) {
  const re = new RegExp(`(?:\\bw:|\\b)${name}="([^"]*)"`);
  const match = String(xml || "").match(re);
  return match ? xmlDecode(match[1]) : "";
}

function firstTag(xml, localName) {
  const re = new RegExp(`<w:${localName}\\b[\\s\\S]*?(?:</w:${localName}>|/>)`);
  const match = String(xml || "").match(re);
  return match ? match[0] : "";
}

function parseStyles(stylesXml) {
  const styles = {};
  const re = /<w:style\b[\s\S]*?<\/w:style>/g;
  for (const block of String(stylesXml || "").match(re) || []) {
    const id = attr(block, "styleId");
    if (!id) continue;

    const nameTag = firstTag(block, "name");
    const outlineTag = firstTag(block, "outlineLvl");
    styles[id] = {
      name: attr(nameTag, "val"),
      outline: attr(outlineTag, "val"),
    };
  }
  return styles;
}

function paragraphText(pXml) {
  const out = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while ((match = re.exec(String(pXml || "")))) {
    out.push(xmlDecode(match[1]));
  }
  return out.join("");
}

function levelOfParagraph(pXml, styles) {
  const pPr = firstTag(pXml, "pPr");
  const outline = attr(firstTag(pPr, "outlineLvl"), "val");
  if (outline !== "" && Number.isFinite(+outline)) return +outline + 1;

  const styleId = attr(firstTag(pPr, "pStyle"), "val");
  const style = styles[styleId] || {};
  if (style.outline !== "" && style.outline != null && Number.isFinite(+style.outline)) {
    return +style.outline + 1;
  }

  const marker = `${norm(styleId)} ${norm(style.name)}`;
  for (let i = 1; i <= 6; i += 1) {
    if (
      norm(styleId) === String(i) ||
      marker.includes(`heading ${i}`) ||
      marker.includes(`heading${i}`) ||
      marker.includes(`כותרת ${i}`) ||
      marker.includes(`כותרת${i}`)
    ) {
      return i;
    }
  }

  return 0;
}

function countWords(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  try {
    return (value.match(/[\p{L}\p{N}]+(?:['\u05F3\u05F4-][\p{L}\p{N}]+)*/gu) || []).length;
  } catch {
    return value.split(/\s+/).filter(Boolean).length;
  }
}

function splitDocumentXml(xml) {
  const open = String(xml || "").match(/<w:body\b[^>]*>/);
  const closeIndex = String(xml || "").lastIndexOf("</w:body>");
  if (!open || closeIndex < 0) throw new Error("לא נמצא גוף מסמך Word תקין.");

  const bodyXml = String(xml).slice(open.index + open[0].length, closeIndex);
  return {
    prefix: String(xml).slice(0, open.index + open[0].length),
    bodyXml,
    suffix: String(xml).slice(closeIndex),
  };
}

function bodyParts(bodyXml, styles) {
  const parts = [];
  const partsMeta = [];
  const allText = [];

  const re = /<w:(p|tbl)\b[\s\S]*?<\/w:\1>|<w:sectPr\b[\s\S]*?<\/w:sectPr>/g;
  let match;
  while ((match = re.exec(String(bodyXml || "")))) {
    const xml = match[0];
    const isParagraph = /^<w:p\b/.test(xml);
    const text = isParagraph ? paragraphText(xml) : "";
    const level = isParagraph ? levelOfParagraph(xml, styles) : 0;

    if (text) allText.push(text);
    parts.push({ xml, text, level });
    partsMeta.push({ text, level });
  }

  return { parts, partsMeta, allText };
}

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer.slice(0));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function importDocxArrayBuffer(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error("לא התקבל קובץ DOCX.");
  }
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const error = new Error(`DOCX גדול מדי לעיבוד. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    error.status = 413;
    throw error;
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);

  const styles = parseStyles(stylesXml || "");
  const { prefix, bodyXml, suffix } = splitDocumentXml(docXml);
  const { parts, partsMeta, allText } = bodyParts(bodyXml, styles);

  const h = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const heads = { 1: [], 2: [] };

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.text?.trim() || part.level < 1 || part.level > 6) continue;

    h[part.level] += 1;
    if (part.level === 1 || part.level === 2) {
      heads[part.level].push({
        title: part.text.trim(),
        start: index,
      });
    }
  }

  const full = allText.join("\n");
  const fileHash = await sha256Hex(arrayBuffer);

  return {
    ok: true,
    serverSide: true,
    serverDocumentId: fileHash,
    fileHash,
    h,
    heads,
    total: Object.values(h).reduce((a, b) => a + b, 0),
    chars: full.length,
    words: countWords(full),
    partsMeta,
    // Keep these off the response for size safety. They are reconstructable from the original DOCX on extract.
    _internal: {
      prefix,
      suffix,
      partCount: parts.length,
    },
  };
}

export async function handleImportRequest(request) {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      service: "ravtext-cloudflare-docx-api",
      routes: [
        "/api/word-chapters-import",
        "/api/word-chapters/import",
        "/api/word-chapters-scan",
        "/api/word-chapters/scan",
      ],
    });
  }
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const arrayBuffer = await request.arrayBuffer();
    const imported = await importDocxArrayBuffer(arrayBuffer);
    return jsonResponse({
      ...imported,
      importedAt: Date.now(),
    });
  } catch (error) {
    return jsonResponse(
      {
        ok: false,
        error: error?.message || String(error || "Server error"),
      },
      error?.status || 500,
    );
  }
}
