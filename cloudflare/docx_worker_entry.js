import JSZip from "jszip";

const SERVICE = "ravtext-cloudflare-docx-advanced-worker";
const VERSION = "2026-05-25-worker-syntax-fix";
const MAX_DOCX_BYTES = 100 * 1024 * 1024;

function requestId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {}
  return `cf-docx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function log(level, event, data = {}) {
  try {
    const payload = JSON.stringify({ service: SERVICE, version: VERSION, event, ...data });
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(payload);
  } catch {}
}

function corsHeaders(id = "") {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-file-name, x-docx-request-id",
    "access-control-expose-headers": "x-docx-api, x-docx-version, x-docx-request-id",
    "access-control-max-age": "86400",
    "x-docx-api": SERVICE,
    "x-docx-version": VERSION,
  };
  if (id) headers["x-docx-request-id"] = id;
  return headers;
}

function jsonResponse(body, status = 200, id = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(id),
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function optionsResponse(id = "") {
  return new Response(null, { status: 204, headers: corsHeaders(id) });
}

const HEBREW_MARKS_RE = /[\u0591-\u05C7]/g;

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

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(HEBREW_MARKS_RE, "")
    .trim()
    .toLowerCase();
}

function attr(xml, name) {
  const match = String(xml || "").match(new RegExp(`(?:\\bw:|\\b)${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : "";
}

function firstTag(xml, localName) {
  const match = String(xml || "").match(new RegExp(`<w:${localName}\\b[\\s\\S]*?(?:</w:${localName}>|/>)`));
  return match ? match[0] : "";
}

function parseStyles(stylesXml) {
  const styles = {};
  const blocks = String(stylesXml || "").match(/<w:style\b[\s\S]*?<\/w:style>/g) || [];
  for (const block of blocks) {
    const id = attr(block, "styleId");
    if (!id) continue;
    styles[id] = {
      name: attr(firstTag(block, "name"), "val"),
      outline: attr(firstTag(block, "outlineLvl"), "val"),
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
  if (style.outline !== "" && style.outline != null && Number.isFinite(+style.outline)) return +style.outline + 1;

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

function documentBodyXml(xml) {
  const open = String(xml || "").match(/<w:body\b[^>]*>/);
  const close = String(xml || "").lastIndexOf("</w:body>");
  if (!open || close < 0) throw new Error("לא נמצא גוף מסמך Word תקין.");
  return String(xml).slice(open.index + open[0].length, close);
}

function bodyParts(bodyXml, styles) {
  const parts = [];
  const partsMeta = [];
  const allText = [];
  const re = /<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>|<w:sectPr\b[\s\S]*?<\/w:sectPr>/g;
  let match;
  while ((match = re.exec(String(bodyXml || "")))) {
    const xml = match[0];
    const isParagraph = /^<w:p\b/.test(xml);
    const text = isParagraph ? paragraphText(xml) : "";
    const level = isParagraph ? levelOfParagraph(xml, styles) : 0;
    if (text) allText.push(text);
    parts.push({ text, level });
    partsMeta.push({ text, level });
  }
  return { parts, partsMeta, allText };
}

async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer.slice(0));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function importDocx(arrayBuffer, id) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const error = new Error(`DOCX גדול מדי לעיבוד. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    error.status = 413;
    throw error;
  }

  const started = Date.now();
  log("log", "docx_zip_load_start", { requestId: id, bytes: arrayBuffer.byteLength });

  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);

  const styles = parseStyles(stylesXml || "");
  const bodyXml = documentBodyXml(docXml);
  const { parts, partsMeta, allText } = bodyParts(bodyXml, styles);

  const h = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const heads = { 1: [], 2: [] };

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part.text?.trim() || part.level < 1 || part.level > 6) continue;
    h[part.level] += 1;
    if (part.level === 1 || part.level === 2) {
      heads[part.level].push({ title: part.text.trim(), start: index });
    }
  }

  const full = allText.join("\n");
  const fileHash = await sha256Hex(arrayBuffer);

  const diagnostics = {
    service: SERVICE,
    version: VERSION,
    bytes: arrayBuffer.byteLength,
    partCount: parts.length,
    elapsedMs: Date.now() - started,
  };

  log("log", "docx_import_success", {
    requestId: id,
    bytes: arrayBuffer.byteLength,
    partCount: parts.length,
    headingCounts: h,
    chars: full.length,
    words: countWords(full),
    elapsedMs: diagnostics.elapsedMs,
  });

  return {
    ok: true,
    serverSide: true,
    requestId: id,
    serverDocumentId: fileHash,
    fileHash,
    h,
    heads,
    total: Object.values(h).reduce((a, b) => a + b, 0),
    chars: full.length,
    words: countWords(full),
    partsMeta,
    diagnostics,
  };
}

function isDocxImportPath(path) {
  return path === "/api/ravtext-docx-import" ||
    path === "/api/word-chapters-import" ||
    path === "/api/word-chapters/import" ||
    path === "/api/word-chapters-scan" ||
    path === "/api/word-chapters/scan";
}

function isDocxExtractPath(path) {
  return path === "/api/word-chapters-extract" || path === "/api/word-chapters/extract";
}

async function handleDocxApi(request) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  const url = new URL(request.url);

  log("log", "request_received", {
    requestId: id,
    method: request.method,
    path: url.pathname,
    contentLength: request.headers.get("content-length") || "",
    contentType: request.headers.get("content-type") || "",
  });

  if (request.method === "OPTIONS") return optionsResponse(id);

  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      serverSide: true,
      service: SERVICE,
      version: VERSION,
      requestId: id,
      path: url.pathname,
      message: "Cloudflare advanced _worker.js is handling this DOCX API route.",
    }, 200, id);
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, serverSide: true, requestId: id, error: "Method not allowed" }, 405, id);
  }

  if (isDocxExtractPath(url.pathname)) {
    return jsonResponse({
      ok: false,
      serverSide: true,
      requestId: id,
      error: "Cloudflare DOCX extract endpoint is reachable, but extract is not implemented in the advanced worker yet.",
    }, 501, id);
  }

  try {
    const arrayBuffer = await request.arrayBuffer();
    log("log", "request_body_loaded", { requestId: id, path: url.pathname, bytes: arrayBuffer.byteLength });
    const imported = await importDocx(arrayBuffer, id);
    return jsonResponse({ ...imported, importedAt: Date.now() }, 200, id);
  } catch (error) {
    log("error", "request_failed", {
      requestId: id,
      path: url.pathname,
      error: error?.message || String(error),
      stack: error?.stack || "",
    });
    return jsonResponse({
      ok: false,
      serverSide: true,
      requestId: id,
      error: error?.message || String(error || "Server error"),
    }, error?.status || 500, id);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Intercept all DOCX API paths
    if (isDocxImportPath(pathname) || isDocxExtractPath(pathname)) {
      return handleDocxApi(request);
    }

    // For any other /api/* path, return JSON (prevents SPA caching)
    if (pathname.startsWith("/api/")) {
      return jsonResponse({ ok: false, error: "Unknown API path", path: pathname }, 404);
    }

    if (env?.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset binding not available.", { status: 500 });
  },
};

export { handleDocxApi, isDocxImportPath, isDocxExtractPath };
