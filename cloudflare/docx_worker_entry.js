import JSZip from "jszip";

const SERVICE = "ravtext-cloudflare-docx-advanced-worker";
const VERSION = "2026-05-26-server-extract";
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

const HEBREW_MARKS_RE = /[֑-ׇ]/g;

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
    return (value.match(/[\p{L}\p{N}]+(?:['׳״-][\p{L}\p{N}]+)*/gu) || []).length;
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
  const allText = [];
  const xml = String(bodyXml || "");
  let pos = 0;

  while (pos < xml.length) {
    // Find next <w:p> or <w:p  (not <w:pPr etc.)
    let start = -1;
    let sp = pos;
    while (sp < xml.length) {
      const idx = xml.indexOf("<w:p", sp);
      if (idx < 0) { sp = xml.length; break; }
      const ch = xml.charCodeAt(idx + 4);
      if (ch === 32 || ch === 62) { start = idx; break; } // ' ' or '>'
      sp = idx + 4;
    }
    if (start < 0) break;

    const end = xml.indexOf("</w:p>", start);
    if (end < 0) break;

    const pXml = xml.slice(start, end + 6);
    const text = paragraphText(pXml);
    const level = levelOfParagraph(pXml, styles);
    if (text) allText.push(text);
    parts.push({ text, level });
    pos = end + 6;
  }

  return { parts, partsMeta: parts, allText };
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
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);

  const styles = parseStyles(stylesXml || "");
  const bodyXml = documentBodyXml(docXml);

  // Heading-only scan: skip full parsing for non-heading paragraphs
  const h = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const heads = { 1: [], 2: [] };
  let pos = 0;
  let partIndex = 0;

  while (pos < bodyXml.length) {
    let start = -1, sp = pos;
    while (sp < bodyXml.length) {
      const idx = bodyXml.indexOf("<w:p", sp);
      if (idx < 0) { sp = bodyXml.length; break; }
      const ch = bodyXml.charCodeAt(idx + 4);
      if (ch === 32 || ch === 62) { start = idx; break; }
      sp = idx + 4;
    }
    if (start < 0) break;

    const end = bodyXml.indexOf("</w:p>", start);
    if (end < 0) break;

    // Only fully parse paragraphs that have a style or outline hint
    const hasStyle = bodyXml.indexOf("<w:pStyle", start) >= start && bodyXml.indexOf("<w:pStyle", start) < end;
    const hasOutline = bodyXml.indexOf("<w:outlineLvl", start) >= start && bodyXml.indexOf("<w:outlineLvl", start) < end;

    if (hasStyle || hasOutline) {
      const pXml = bodyXml.slice(start, end + 6);
      const level = levelOfParagraph(pXml, styles);
      if (level >= 1 && level <= 6) {
        h[level] = (h[level] || 0) + 1;
        if (level === 1 || level === 2) {
          const text = paragraphText(pXml);
          if (text.trim()) heads[level].push({ title: text.trim(), start: partIndex });
        }
      }
    }

    partIndex++;
    pos = end + 6;
  }

  // Fast char count: single regex pass over all <w:t> text nodes
  let chars = 0;
  const textRe = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = textRe.exec(bodyXml))) chars += xmlDecode(m[1]).length;

  const fileHash = await sha256Hex(arrayBuffer);
  const elapsedMs = Date.now() - started;

  log("log", "docx_import_success", {
    requestId: id, bytes: arrayBuffer.byteLength,
    heads1: heads[1].length, heads2: heads[2].length,
    chars, elapsedMs,
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
    chars,
    words: Math.round(chars / 5),
    diagnostics: { service: SERVICE, version: VERSION, bytes: arrayBuffer.byteLength, elapsedMs },
  };
}

function escHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function extractChapterContent(arrayBuffer, level, index, id) {
  level = Number(level) || 1;
  index = Number(index) || 0;

  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const err = new Error(`DOCX גדול מדי. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    err.status = 413;
    throw err;
  }

  const started = Date.now();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);

  const styles = parseStyles(stylesXml || "");
  const bodyXml = documentBodyXml(docXml);
  const { partsMeta } = bodyParts(bodyXml, styles);

  const levelHeads = [];
  for (let i = 0; i < partsMeta.length; i++) {
    const part = partsMeta[i];
    if (part.text?.trim() && part.level === level) {
      levelHeads.push({ title: part.text.trim(), start: i });
    }
  }

  if (index < 0 || index >= levelHeads.length) {
    const err = new Error(`לא נמצא פרק מספר ${index + 1} ברמה ${level}. סה"כ פרקים: ${levelHeads.length}.`);
    err.status = 404;
    throw err;
  }

  const head = levelHeads[index];
  const nextHead = levelHeads[index + 1];
  const end = nextHead ? nextHead.start : partsMeta.length;
  const chapterParts = partsMeta.slice(head.start, end);

  const mainHtml = chapterParts
    .map(p => {
      const text = String(p.text || "").trim();
      if (!text) return "";
      if (p.level >= 1 && p.level <= 6) return `<h${p.level}>${escHtml(text)}</h${p.level}>`;
      return `<p>${escHtml(text)}</p>`;
    })
    .filter(Boolean)
    .join("\n");

  log("log", "chapter_extract_success", { requestId: id, level, index, title: head.title, parts: chapterParts.length, elapsedMs: Date.now() - started });

  return {
    ok: true,
    serverSide: true,
    requestId: id,
    title: head.title,
    result: {
      mainHtml: mainHtml || "<p></p>",
      streams: [],
      streamsHtml: [],
    },
  };
}

const ICON_MAP = {
  footnote: '\u{1F4DD} שוליים',
  endnote: '\u{1F4CB} סיום',
  comment: '\u{1F4AC} בלון',
};

async function scanNoteSources(arrayBuffer, id) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const err = new Error(`DOCX גדול מדי. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    err.status = 413;
    throw err;
  }

  const started = Date.now();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const sources = [];

  function noteText(innerXml) {
    const out = [];
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while ((m = re.exec(String(innerXml || "")))) out.push(xmlDecode(m[1]));
    return out.join('');
  }

  async function scanNoteFile(xmlFileName, noteTag, srcType, heb, positiveOnly) {
    const local = [];
    try {
      const zf = zip.file(xmlFileName);
      if (!zf) return local;
      const xml = await zf.async("string");
      const markers = {};
      let unmarked = 0;
      const noteRe = new RegExp(`<w:${noteTag}\\b([^>]*)>([\\s\\S]*?)<\\/w:${noteTag}>`, 'g');
      let match;
      while ((match = noteRe.exec(xml)) !== null) {
        const attrs = match[1];
        const inner = match[2];
        const idM = attrs.match(/\bw:id="([^"]*)"/);
        if (!idM) continue;
        const idVal = parseInt(idM[1], 10);
        if (Number.isNaN(idVal)) continue;
        if (positiveOnly ? idVal <= 0 : idVal < 0) continue;
        if (/\bw:type="(?:separator|continuationSeparator)"/.test(attrs)) continue;
        const text = noteText(inner);
        const m2 = text.match(/@(\d+)/);
        if (m2) markers[m2[1]] = (markers[m2[1]] || 0) + 1;
        else unmarked++;
      }
      for (const m of Object.keys(markers).sort((a, b) => +a - +b)) {
        local.push({ id: `${srcType}_@${m}`, source_type: srcType, marker: m, has_at: true, label: `${heb} @${m}`, count: markers[m], icon: ICON_MAP[srcType] || '' });
      }
      if (unmarked > 0) {
        local.push({ id: `${srcType}_none`, source_type: srcType, marker: null, has_at: false, label: `${heb} ללא סימון (${unmarked})`, count: unmarked, icon: ICON_MAP[srcType] || '' });
      }
    } catch (e) { /* skip */ }
    return local;
  }

  const [fnSrc, enSrc, cmSrc] = await Promise.all([
    scanNoteFile('word/footnotes.xml', 'footnote', 'footnote', 'שוליים', true),
    scanNoteFile('word/endnotes.xml', 'endnote', 'endnote', 'סיום', true),
    scanNoteFile('word/comments.xml', 'comment', 'comment', 'בלון', false),
  ]);
  sources.push(...fnSrc, ...enSrc, ...cmSrc);

  try {
    const docFile = zip.file('word/document.xml');
    if (docFile) {
      const docXml = await docFile.async("string");
      const docMarkers = new Set();
      const reAll = /@(\d+)/g;
      let mm;
      while ((mm = reAll.exec(docXml)) !== null) docMarkers.add(mm[1]);
      const exist = new Set(sources.filter(s => s.marker).map(s => s.marker));
      for (const m of Array.from(docMarkers).filter(x => !exist.has(x)).sort((a, b) => +a - +b)) {
        const c = (docXml.match(new RegExp('@' + m, 'g')) || []).length;
        sources.push({ id: `inline_@${m}`, source_type: 'footnote', marker: m, has_at: true, label: `inline @${m}`, count: c, icon: ICON_MAP.footnote });
      }
    }
  } catch (e) { /* */ }

  log("log", "streams_scan_success", { requestId: id, bytes: arrayBuffer.byteLength, sources: sources.length, elapsedMs: Date.now() - started });
  return { ok: true, serverSide: true, requestId: id, sources };
}

function isStreamsScanPath(path) {
  return path === '/api/word-streams-scan';
}

async function handleStreamsScan(request) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405, id);
  try {
    let arrayBuffer;
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const json = await request.json();
      if (!json?.docx) throw Object.assign(new Error("JSON body missing 'docx' field."), { status: 400 });
      const raw = atob(json.docx);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      arrayBuffer = await request.arrayBuffer();
    }
    log("log", "streams_scan_body_loaded", { requestId: id, bytes: arrayBuffer.byteLength });
    const result = await scanNoteSources(arrayBuffer, id);
    return jsonResponse({ ...result, scannedAt: Date.now() }, 200, id);
  } catch (error) {
    log("error", "streams_scan_failed", { requestId: id, error: error?.message || String(error) });
    return jsonResponse({ ok: false, serverSide: true, requestId: id, error: error?.message || String(error || "Server error") }, error?.status || 500, id);
  }
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

function isClientLogPath(path) {
  return path === "/api/client-log";
}

async function handleClientLog(request) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405, id);
  }
  try {
    const body = await request.json().catch(() => ({}));
    log("log", "client_log", { source: "browser", requestId: id, ...body });
  } catch {}
  return jsonResponse({ ok: true }, 200, id);
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

  try {
    let arrayBuffer;
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const json = await request.json();
      if (!json?.docx) throw Object.assign(new Error("JSON body missing 'docx' field."), { status: 400 });
      const raw = atob(json.docx);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      arrayBuffer = await request.arrayBuffer();
    }
    log("log", "request_body_loaded", { requestId: id, path: url.pathname, bytes: arrayBuffer.byteLength });

    if (isDocxExtractPath(url.pathname)) {
      const level = url.searchParams.get("level");
      const index = url.searchParams.get("index");
      const extracted = await extractChapterContent(arrayBuffer, level, index, id);
      return jsonResponse({ ...extracted, extractedAt: Date.now() }, 200, id);
    }

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

    if (isClientLogPath(url.pathname)) {
      return handleClientLog(request);
    }

    if (isStreamsScanPath(url.pathname)) {
      return handleStreamsScan(request);
    }

    if (isDocxImportPath(url.pathname) || isDocxExtractPath(url.pathname)) {
      return handleDocxApi(request);
    }

    if (env?.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset binding not available.", { status: 500 });
  },
};

export { handleDocxApi, isDocxImportPath, isDocxExtractPath, handleClientLog, isClientLogPath, handleStreamsScan, isStreamsScanPath };
