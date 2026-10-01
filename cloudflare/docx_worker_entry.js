import JSZip from "jszip";
import { transformFootnotesToCurlyCore } from "./docx_footnotes_to_curly.js";
import { transformSplitFootnotesByTagCore } from "./docx_split_footnotes_by_tag.js";
import { transformFootnoteTrackedChangesCore } from "./docx_footnote_track_changes.js";

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
    "access-control-allow-headers": "content-type, x-file-name, x-docx-request-id, x-footnote-split-tags, x-footnote-track-action",
    "access-control-expose-headers": "x-docx-api, x-docx-version, x-docx-request-id, x-docx-filename, x-docx-report",
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

const INIT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS worker_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  data TEXT
)`;
let _dbReady = false;

async function dbLog(env, ctx, level, event, data) {
  if (!env?.DB) return;
  const run = async () => {
    try {
      if (!_dbReady) {
        await env.DB.prepare(INIT_TABLE_SQL).run();
        _dbReady = true;
      }
      const payload = JSON.stringify(data || {});
      await env.DB.prepare(
        'INSERT INTO worker_logs (ts, level, event, data) VALUES (?, ?, ?, ?)'
      ).bind(Date.now(), level, event, payload).run();
    } catch { _dbReady = false; }
  };
  if (ctx?.waitUntil) ctx.waitUntil(run());
  else run().catch(() => {});
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

async function handleStreamsScan(request, env, ctx) {
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
    dbLog(env, ctx, "info", "streams_scan_start", { requestId: id, bytes: arrayBuffer.byteLength });
    const result = await scanNoteSources(arrayBuffer, id);
    dbLog(env, ctx, "info", "streams_scan_success", { requestId: id, sources: result.sources?.length ?? 0 });
    return jsonResponse({ ...result, scannedAt: Date.now() }, 200, id);
  } catch (error) {
    log("error", "streams_scan_failed", { requestId: id, error: error?.message || String(error) });
    dbLog(env, ctx, "error", "streams_scan_failed", { requestId: id, error: error?.message || String(error) });
    return jsonResponse({ ok: false, serverSide: true, requestId: id, error: error?.message || String(error || "Server error") }, error?.status || 500, id);
  }
}


const DOCX_UPLOAD_PREFIX = "uploads/";
const DOCX_UPLOAD_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function isDocxUploadOnlyPath(path) {
  return path === "/api/word-chapters-upload" || path === "/api/word-chapters/upload";
}
function isDocxScanUploadedPath(path) {
  return path === "/api/word-chapters-scan-upload" || path === "/api/word-chapters/scan-upload";
}
function isDocxExtractUploadedPath(path) {
  return path === "/api/word-chapters-extract-upload" || path === "/api/word-chapters/extract-upload";
}
function isDocxFullUploadedPath(path) {
  return path === "/api/word-chapters-full-upload" || path === "/api/word-chapters/full-upload";
}
function isDocxDeleteUploadPath(path) {
  return path === "/api/word-chapters-delete-upload" || path === "/api/word-chapters/delete-upload";
}

function requireDocxUploads(env) {
  if (!env?.DOCX_UPLOADS) {
    throw Object.assign(new Error("DOCX_UPLOADS R2 binding is not configured."), {
      status: 503,
      code: "DOCX_UPLOADS_NOT_CONFIGURED",
    });
  }
  return env.DOCX_UPLOADS;
}

function normalizeUploadId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,220}$/.test(id)) {
    throw Object.assign(new Error("Invalid or missing uploadId."), {
      status: 400,
      code: "INVALID_UPLOAD_ID",
    });
  }
  return id;
}

function docxUploadKey(uploadId) {
  return DOCX_UPLOAD_PREFIX + normalizeUploadId(uploadId) + ".docx";
}

async function readJsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function uploadIdFrom(request, url, body = {}) {
  return url.searchParams.get("uploadId")
    || request.headers.get("x-docx-upload-id")
    || body?.uploadId
    || "";
}

async function readUploadedDocx(env, uploadId) {
  const bucket = requireDocxUploads(env);
  const id = normalizeUploadId(uploadId);
  const object = await bucket.get(docxUploadKey(id));
  if (!object) {
    throw Object.assign(new Error("Uploaded DOCX was not found or already expired."), {
      status: 404,
      code: "DOCX_UPLOAD_NOT_FOUND",
    });
  }
  return {
    uploadId: id,
    arrayBuffer: await object.arrayBuffer(),
    metadata: object.customMetadata || {},
  };
}

async function extractFullDocumentContent(arrayBuffer, id) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    throw Object.assign(new Error(`DOCX גדול מדי. מגבלה: ${MAX_DOCX_BYTES} bytes.`), {
      status: 413,
      code: "DOCX_TOO_LARGE",
    });
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve(""),
  ]);
  const styles = parseStyles(stylesXml || "");
  const { partsMeta } = bodyParts(documentBodyXml(docXml), styles);
  const mainHtml = partsMeta.map((part) => {
    const text = String(part.text || "").trim();
    if (!text) return "";
    if (part.level >= 1 && part.level <= 6) return `<h${part.level}>${escHtml(text)}</h${part.level}>`;
    return `<p>${escHtml(text)}</p>`;
  }).filter(Boolean).join("\n") || "<p></p>";

  return {
    ok: true,
    serverSide: true,
    requestId: id,
    title: "מסמך Word מלא",
    result: { mainHtml, streams: [], streamsHtml: [] },
  };
}

async function handleUploadOnly(request, env, ctx) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST") return jsonResponse({ ok: false, requestId: id, error: "Method not allowed" }, 405, id);

  try {
    const bucket = requireDocxUploads(env);
    const arrayBuffer = await request.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    if (!bytes) throw Object.assign(new Error("Empty DOCX."), { status: 400, code: "EMPTY_DOCX" });
    if (bytes > MAX_DOCX_BYTES) throw Object.assign(new Error("DOCX too large."), { status: 413, code: "DOCX_TOO_LARGE" });

    const fileHash = await sha256Hex(arrayBuffer);
    const createdAt = Date.now();
    const uploadId = `${fileHash}.${createdAt.toString(36)}.${requestId.replace(/[^A-Za-z0-9]/g, "").slice(-12)}`;
    let fileName = request.headers.get("x-file-name") || "";
    try { fileName = decodeURIComponent(fileName); } catch (_) {}

    await bucket.put(docxUploadKey(uploadId), arrayBuffer, {
      httpMetadata: {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      customMetadata: {
        fileHash,
        bytes: String(bytes),
        createdAt: String(createdAt),
        requestId: id,
        fileName,
      },
    });

    log("log", "docx_upload_only_success", { requestId: id, uploadId, fileHash, bytes });
    dbLog(env, ctx, "info", "docx_upload_only_success", { requestId: id, uploadId, fileHash, bytes });

    return jsonResponse({
      ok: true,
      serverSide: true,
      requestId: id,
      uploadId,
      fileHash,
      bytes,
      uploadedAt: createdAt,
      expiresAt: createdAt + DOCX_UPLOAD_TTL_MS,
    }, 200, id);
  } catch (error) {
    dbLog(env, ctx, "error", "docx_upload_only_failed", { requestId: id, error: error?.message || String(error) });
    return jsonResponse({
      ok: false,
      requestId: id,
      error: error?.message || String(error),
      code: error?.code || "DOCX_UPLOAD_FAILED",
    }, error?.status || 500, id);
  }
}

async function handleUploadedDocxAction(request, env, ctx, action) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST" && !(action === "delete" && request.method === "DELETE")) {
    return jsonResponse({ ok: false, requestId: id, error: "Method not allowed" }, 405, id);
  }

  try {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    const uploadId = normalizeUploadId(uploadIdFrom(request, url, body));

    if (action === "delete") {
      await requireDocxUploads(env).delete(docxUploadKey(uploadId));
      dbLog(env, ctx, "info", "docx_upload_deleted", { requestId: id, uploadId });
      return jsonResponse({ ok: true, requestId: id, uploadId, deletedAt: Date.now() }, 200, id);
    }

    const uploaded = await readUploadedDocx(env, uploadId);
    const arrayBuffer = uploaded.arrayBuffer;

    if (action === "scan") {
      const imported = await importDocx(arrayBuffer, id);
      return jsonResponse({
        ...imported,
        uploadId,
        fileHash: uploaded.metadata.fileHash || imported.fileHash,
        uploadedAt: Number(uploaded.metadata.createdAt) || null,
        scannedAt: Date.now(),
      }, 200, id);
    }

    if (action === "extract") {
      const level = body?.level ?? url.searchParams.get("level");
      const index = body?.index ?? url.searchParams.get("index");
      const extracted = await extractChapterContent(arrayBuffer, level, index, id);
      return jsonResponse({ ...extracted, uploadId, extractedAt: Date.now() }, 200, id);
    }

    if (action === "full") {
      const full = await extractFullDocumentContent(arrayBuffer, id);
      return jsonResponse({ ...full, uploadId, extractedAt: Date.now() }, 200, id);
    }

    throw Object.assign(new Error("Unknown uploaded DOCX action."), { status: 400 });
  } catch (error) {
    log("error", "uploaded_docx_action_failed", { requestId: id, action, error: error?.message || String(error) });
    dbLog(env, ctx, "error", "uploaded_docx_action_failed", { requestId: id, action, error: error?.message || String(error) });
    return jsonResponse({
      ok: false,
      requestId: id,
      error: error?.message || String(error),
      code: error?.code || "DOCX_UPLOAD_ACTION_FAILED",
    }, error?.status || 500, id);
  }
}

export async function cleanupExpiredDocxUploads(env, {
  now = Date.now(),
  ttlMs = DOCX_UPLOAD_TTL_MS,
  maxDeletes = 200,
} = {}) {
  if (!env?.DOCX_UPLOADS) return { scanned: 0, deleted: 0, skipped: true };

  let cursor;
  let scanned = 0;
  let deleted = 0;
  do {
    const page = await env.DOCX_UPLOADS.list({ prefix: DOCX_UPLOAD_PREFIX, cursor, limit: 1000 });
    for (const item of page.objects || []) {
      scanned += 1;
      const createdAt = Number(item.customMetadata?.createdAt || 0);
      if (createdAt > 0 && now - createdAt > ttlMs) {
        await env.DOCX_UPLOADS.delete(item.key);
        deleted += 1;
        if (deleted >= maxDeletes) return { scanned, deleted, capped: true };
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { scanned, deleted };
}

function isDocxImportPath(path) {
  return path === "/api/ravtext-docx-import" ||
    path === "/api/word-chapters-import" ||
    path === "/api/word-chapters/import" ||
    path === "/api/word-chapters-scan" ||
    path === "/api/word-chapters/scan" ||
    isDocxUploadOnlyPath(path) ||
    isDocxScanUploadedPath(path) ||
    isDocxFullUploadedPath(path) ||
    isDocxDeleteUploadPath(path);
}

function isDocxExtractPath(path) {
  return path === "/api/word-chapters-extract" ||
    path === "/api/word-chapters/extract" ||
    isDocxExtractUploadedPath(path);
}

function isDocxFootnotesToCurlyPath(path) {
  return path === "/api/word-footnotes-to-curly";
}

function isDocxSplitFootnotesByTagPath(path) {
  return path === "/api/word-split-footnotes-by-tag";
}

function isDocxFootnoteTrackChangesPath(path) {
  return path === "/api/word-footnote-track-changes";
}

function isClientLogPath(path) {
  return path === "/api/client-log";
}

async function handleClientLog(request, env, ctx) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405, id);
  }
  try {
    const body = await request.json().catch(() => ({}));
    const payload = { source: "browser", requestId: id, ...body };
    log("log", "client_log", payload);
    dbLog(env, ctx, "info", body.event || "client_log", payload);
  } catch {}
  return jsonResponse({ ok: true }, 200, id);
}

async function handleDocxApi(request, env, ctx) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  const url = new URL(request.url);

  log("log", "request_received", {
    requestId: id,
    method: request.method,
    path: url.pathname,
    contentLength: request.headers.get("content-length") || "",
    contentType: request.headers.get("content-type") || "",
  });

  if (isDocxUploadOnlyPath(url.pathname)) return handleUploadOnly(request, env, ctx);
  if (isDocxScanUploadedPath(url.pathname)) return handleUploadedDocxAction(request, env, ctx, "scan");
  if (isDocxExtractUploadedPath(url.pathname)) return handleUploadedDocxAction(request, env, ctx, "extract");
  if (isDocxFullUploadedPath(url.pathname)) return handleUploadedDocxAction(request, env, ctx, "full");
  if (isDocxDeleteUploadPath(url.pathname)) return handleUploadedDocxAction(request, env, ctx, "delete");

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
    dbLog(env, ctx, "info", "docx_request_start", { requestId: id, path: url.pathname, bytes: arrayBuffer.byteLength });

    if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
      throw Object.assign(
        new Error(`DOCX גדול מדי. מגבלה: ${MAX_DOCX_BYTES} bytes.`),
        { status: 413, code: "DOCX_TOO_LARGE" }
      );
    }

    if (isDocxFootnotesToCurlyPath(url.pathname)) {
      let sourceName = request.headers.get("x-file-name") || "document.docx";
      try { sourceName = decodeURIComponent(sourceName); } catch (_) {}

      const transformed = await transformFootnotesToCurlyCore(arrayBuffer, {
        filename: sourceName,
      });
      const report = transformed.report || {};

      dbLog(env, ctx, "info", "docx_footnotes_to_curly_success", {
        requestId: id,
        referencesConverted: report.referencesConverted || 0,
        uniqueFootnotesConverted: report.uniqueFootnotesConverted || 0,
      });

      return new Response(transformed.bytes, {
        status: 200,
        headers: {
          ...corsHeaders(id),
          "cache-control": "no-store",
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(transformed.filename)}`,
          "x-docx-filename": encodeURIComponent(transformed.filename),
          "x-docx-report": encodeURIComponent(JSON.stringify(report)),
        },
      });
    }

    if (isDocxSplitFootnotesByTagPath(url.pathname)) {
      let sourceName = request.headers.get("x-file-name") || "document.docx";
      try { sourceName = decodeURIComponent(sourceName); } catch (_) {}

      let tags = [];
      const rawTags = request.headers.get("x-footnote-split-tags") || "";
      if (rawTags) {
        try {
          tags = JSON.parse(decodeURIComponent(rawTags));
        } catch {
          throw Object.assign(new Error("כותרת התגים אינה JSON תקין."), {
            status: 400,
            code: "INVALID_SPLIT_TAGS_HEADER",
          });
        }
      }

      const transformed = await transformSplitFootnotesByTagCore(arrayBuffer, {
        filename: sourceName,
        tags,
      });
      const report = transformed.report || {};

      dbLog(env, ctx, "info", "docx_split_footnotes_by_tag_success", {
        requestId: id,
        footnotesSplit: report.footnotesSplit || 0,
        newFootnotesCreated: report.newFootnotesCreated || 0,
        referencesExpanded: report.referencesExpanded || 0,
        tags: report.tags || [],
      });

      return new Response(transformed.bytes, {
        status: 200,
        headers: {
          ...corsHeaders(id),
          "cache-control": "no-store",
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(transformed.filename)}`,
          "x-docx-filename": encodeURIComponent(transformed.filename),
          "x-docx-report": encodeURIComponent(JSON.stringify(report)),
        },
      });
    }

    if (isDocxFootnoteTrackChangesPath(url.pathname)) {
      let sourceName = request.headers.get("x-file-name") || "document.docx";
      try { sourceName = decodeURIComponent(sourceName); } catch (_) {}

      const action = request.headers.get("x-footnote-track-action") || "";
      const transformed = await transformFootnoteTrackedChangesCore(arrayBuffer, {
        filename: sourceName,
        action,
      });
      const report = transformed.report || {};

      dbLog(env, ctx, "info", "docx_footnote_track_changes_success", {
        requestId: id,
        action: report.action || action,
        contentRevisionsFound: report.contentRevisionsFound || 0,
        propertyChangesFound: report.propertyChangesFound || 0,
        bodyRevisionNodesUntouched: report.bodyRevisionNodesUntouched || 0,
      });

      return new Response(transformed.bytes, {
        status: 200,
        headers: {
          ...corsHeaders(id),
          "cache-control": "no-store",
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(transformed.filename)}`,
          "x-docx-filename": encodeURIComponent(transformed.filename),
          "x-docx-report": encodeURIComponent(JSON.stringify(report)),
        },
      });
    }

    if (isDocxExtractPath(url.pathname)) {
      const level = url.searchParams.get("level");
      const index = url.searchParams.get("index");
      const extracted = await extractChapterContent(arrayBuffer, level, index, id);
      dbLog(env, ctx, "info", "docx_extract_success", { requestId: id, title: extracted?.title });
      return jsonResponse({ ...extracted, extractedAt: Date.now() }, 200, id);
    }

    const imported = await importDocx(arrayBuffer, id);
    dbLog(env, ctx, "info", "docx_import_success", { requestId: id, heads1: imported?.heads?.[1]?.length, heads2: imported?.heads?.[2]?.length, chars: imported?.chars });
    return jsonResponse({ ...imported, importedAt: Date.now() }, 200, id);
  } catch (error) {
    log("error", "request_failed", {
      requestId: id,
      path: url.pathname,
      error: error?.message || String(error),
      stack: error?.stack || "",
    });
    dbLog(env, ctx, "error", "docx_request_failed", { requestId: id, path: url.pathname, error: error?.message || String(error) });
    return jsonResponse({
      ok: false,
      serverSide: true,
      requestId: id,
      error: error?.message || String(error || "Server error"),
      message: error?.message || String(error || "Server error"),
      code: error?.code || "DOCX_REQUEST_FAILED",
      missingIds: error?.missingIds || undefined,
      orphanIds: error?.orphanIds || undefined,
      items: error?.items || undefined,
    }, error?.status || 500, id);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isClientLogPath(url.pathname)) {
      return handleClientLog(request, env, ctx);
    }

    if (isStreamsScanPath(url.pathname)) {
      return handleStreamsScan(request, env, ctx);
    }

    if (isDocxImportPath(url.pathname) || isDocxExtractPath(url.pathname) || isDocxFootnotesToCurlyPath(url.pathname) || isDocxSplitFootnotesByTagPath(url.pathname) || isDocxFootnoteTrackChangesPath(url.pathname)) {
      return handleDocxApi(request, env, ctx);
    }

    if (env?.ASSETS?.fetch) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Asset binding not available.", { status: 500 });
  },
};

export { handleDocxApi, isDocxImportPath, isDocxExtractPath, isDocxFootnotesToCurlyPath, isDocxSplitFootnotesByTagPath, isDocxFootnoteTrackChangesPath, handleClientLog, isClientLogPath, handleStreamsScan, isStreamsScanPath };
