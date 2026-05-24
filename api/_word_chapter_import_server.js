import { createHash } from "node:crypto";
import JSZip from "jszip";

const MAX_DOCX_BYTES = 64 * 1024 * 1024;

export async function readRequestBuffer(req, { maxBytes = MAX_DOCX_BYTES } = {}) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const err = new Error("DOCX גדול מדי לעיבוד בצד שרת.");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

export function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

export function sendError(res, error) {
  const status = error?.statusCode || 500;
  sendJson(res, status, {
    ok: false,
    error: error?.message || String(error || "Server error"),
  });
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

export async function importDocxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("text"),
    zip.file("word/styles.xml")?.async("text") || Promise.resolve(""),
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
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  return {
    prefix,
    suffix,
    parts,
    manifest: {
      serverDocumentId: fileHash,
      fileHash,
      h,
      heads,
      total: Object.values(h).reduce((a, b) => a + b, 0),
      chars: full.length,
      words: countWords(full),
      partsMeta,
    },
  };
}
