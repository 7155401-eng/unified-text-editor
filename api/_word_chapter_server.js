import JSZip from "jszip";
import { JSDOM } from "jsdom";

const domWindow = new JSDOM("").window;
const DOMParser = globalThis.DOMParser || domWindow.DOMParser;
const XMLSerializer = globalThis.XMLSerializer || domWindow.XMLSerializer;

globalThis.DOMParser = globalThis.DOMParser || DOMParser;
globalThis.XMLSerializer = globalThis.XMLSerializer || XMLSerializer;

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAX_DOCX_BYTES = 64 * 1024 * 1024;

function asArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

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

function localName(node) {
  return node?.localName || node?.nodeName?.split(":").pop() || "";
}

function childElements(node) {
  return Array.from(node?.childNodes || []).filter(n => n.nodeType === 1);
}

function childrenByLocal(node, local) {
  return childElements(node).filter(n => localName(n) === local);
}

function allByLocal(node, local) {
  if (!node) return [];
  return Array.from(node.getElementsByTagNameNS?.("*", local) || [])
    .concat(Array.from(node.getElementsByTagName?.(`w:${local}`) || []))
    .filter((x, i, arr) => arr.indexOf(x) === i);
}

function firstByLocal(node, local) {
  return childrenByLocal(node, local)[0] || allByLocal(node, local)[0] || null;
}

function attr(node, name) {
  if (!node) return "";
  return node.getAttribute(`w:${name}`)
    || node.getAttribute(name)
    || node.getAttributeNS?.(WORD_NS, name)
    || "";
}

const HEBREW_MARKS_RE = /[\u0591-\u05C7]/g;

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(HEBREW_MARKS_RE, "")
    .trim()
    .toLowerCase();
}

function paragraphText(p) {
  return allByLocal(p, "t").map(t => t.textContent || "").join("");
}

function parseStyles(xml) {
  const out = {};
  if (!xml) return out;
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    for (const style of allByLocal(doc, "style")) {
      const id = attr(style, "styleId");
      if (!id) continue;
      out[id] = {
        name: attr(firstByLocal(style, "name"), "val"),
        outline: attr(firstByLocal(style, "outlineLvl"), "val"),
      };
    }
  } catch {}
  return out;
}

function levelOf(paragraph, styles) {
  const pPr = firstByLocal(paragraph, "pPr");
  const pStyle = firstByLocal(pPr, "pStyle");
  const outline = firstByLocal(pPr, "outlineLvl");

  let value = attr(outline, "val");
  if (value !== "" && Number.isFinite(+value)) return +value + 1;

  const id = attr(pStyle, "val");
  const style = styles[id] || {};
  value = style.outline;
  if (value !== "" && value != null && Number.isFinite(+value)) return +value + 1;

  const marker = `${norm(id)} ${norm(style.name)}`;
  for (let i = 1; i <= 6; i += 1) {
    if (
      norm(id) === String(i) ||
      marker.includes(`heading ${i}`) ||
      marker.includes(`heading${i}`) ||
      marker.includes(`כותרת ${i}`) ||
      marker.includes(`כותרת${i}`)
    ) return i;
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
  const open = xml.match(/<w:body\b[^>]*>/);
  const closeIndex = xml.lastIndexOf("</w:body>");
  if (!open || closeIndex < 0) throw new Error("לא נמצא גוף מסמך Word תקין.");
  return {
    prefix: xml.slice(0, open.index + open[0].length),
    suffix: xml.slice(closeIndex),
  };
}

function buildSelectedSources(sources) {
  const streams = buildDefaultStreamMapping(sources || []).filter(s => s.included !== false);
  const selected = [];
  const seriesToCode = {};
  let nextCode = 1;

  for (const s of streams) {
    const series = s.series || `${s.source_type || s.sourceType || s.source || ""}:${s.marker || ""}`;
    if (!seriesToCode[series]) seriesToCode[series] = String(nextCode++).padStart(2, "0");
    selected.push({
      source: s.source_type || s.sourceType || s.source,
      marker: s.marker || null,
      symbol: "@" + seriesToCode[series],
    });
  }
  return selected;
}

async function loadExtractorModules() {
  const [engine, mammothHelpers, streamHelpers] = await Promise.all([
    import("../src/word_extractor/word_extractor_engine.js"),
    import("../src/word_extractor/word_extractor_mammoth.js"),
    import("../src/word_extractor/word_extractor_streams.js"),
  ]);
  return {
    ...engine,
    ...mammothHelpers,
    buildDefaultStreamMapping: streamHelpers.buildDefaultStreamMapping,
  };
}

let buildDefaultStreamMapping = null;
async function ensureStreamMapping() {
  if (!buildDefaultStreamMapping) {
    ({ buildDefaultStreamMapping } = await loadExtractorModules());
  }
  return buildDefaultStreamMapping;
}

async function buildNotesHtmlMapForChapter(arrayBuffer) {
  const { find_all_styles_full, extractNotesHtmlMap, buildDynamicStyleMap } = await loadExtractorModules();
  try {
    const stylesFull = await find_all_styles_full(arrayBuffer.slice(0));
    const styleMap = buildDynamicStyleMap(stylesFull || {});
    return await extractNotesHtmlMap(arrayBuffer.slice(0), { styleMap });
  } catch (error) {
    console.warn("[word-chapters/server] notesHtmlMap fallback:", error);
    return {};
  }
}

export async function scanDocxBuffer(buffer) {
  await ensureStreamMapping();
  const zip = await JSZip.loadAsync(buffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");

  const [docXml, stylesXml] = await Promise.all([
    docFile.async("text"),
    zip.file("word/styles.xml")?.async("text") || Promise.resolve(""),
  ]);

  const { prefix, suffix } = splitDocumentXml(docXml);
  const doc = new DOMParser().parseFromString(docXml, "application/xml");
  const body = firstByLocal(doc, "body");
  if (!body) throw new Error("לא נמצא גוף מסמך Word.");

  const serializer = new XMLSerializer();
  const styles = parseStyles(stylesXml || "");
  const h = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const heads = { 1: [], 2: [] };
  const parts = [];
  const partsMeta = [];
  const allText = [];
  let sect = "";

  const direct = childElements(body);
  for (let i = 0; i < direct.length; i += 1) {
    const node = direct[i];
    const name = localName(node);

    if (name === "sectPr") {
      sect = serializer.serializeToString(node);
      continue;
    }

    const index = parts.length;
    let text = "";
    let level = 0;

    if (name === "p") {
      text = paragraphText(node);
      level = levelOf(node, styles);
      allText.push(text);

      if (text.trim() && level >= 1 && level <= 6) {
        h[level] += 1;
        if (level === 1 || level === 2) {
          heads[level].push({ title: text.trim(), start: index });
        }
      }
    }

    const xml = serializer.serializeToString(node);
    parts.push({ xml, text, level });
    partsMeta.push({ text, level });
  }

  const full = allText.join("\n");
  return {
    prefix,
    suffix,
    sect,
    parts,
    manifest: {
      h,
      heads,
      total: Object.values(h).reduce((a, b) => a + b, 0),
      chars: full.length,
      words: countWords(full),
      partsMeta,
    },
  };
}

async function buildChapterDocxBuffer(originalBuffer, scan, level, chapterIndex) {
  const heads = scan.manifest.heads[level] || [];
  const head = heads[chapterIndex];
  if (!head) throw new Error("לא נמצא פרק לייבוא.");

  const nextHead = heads[chapterIndex + 1];
  const end = nextHead ? nextHead.start : scan.parts.length;
  const bodyXml = scan.parts
    .slice(head.start, end)
    .map(p => p.xml)
    .join("") + (scan.sect || "");

  const sourceZip = await JSZip.loadAsync(originalBuffer);
  const outZip = new JSZip();

  for (const name of Object.keys(sourceZip.files || {})) {
    const entry = sourceZip.files[name];
    if (!entry || entry.dir || name === "word/document.xml") continue;
    outZip.file(name, await entry.async("uint8array"));
  }

  outZip.file("word/document.xml", scan.prefix + bodyXml + scan.suffix);
  const chapterBuffer = await outZip.generateAsync({ type: "nodebuffer" });
  return {
    title: head.title || `פרק ${chapterIndex + 1}`,
    buffer: chapterBuffer,
  };
}

export async function extractChapterBuffer(buffer, { level = 1, chapterIndex = 0 } = {}) {
  await ensureStreamMapping();
  const { docx_extract_simple, find_all_note_sources } = await loadExtractorModules();
  const scan = await scanDocxBuffer(buffer);
  const chapter = await buildChapterDocxBuffer(buffer, scan, Number(level) || 1, Number(chapterIndex) || 0);
  const chapterArrayBuffer = asArrayBuffer(chapter.buffer);

  const [sources, notesHtmlMap] = await Promise.all([
    find_all_note_sources(chapterArrayBuffer.slice(0)),
    buildNotesHtmlMapForChapter(chapterArrayBuffer.slice(0)),
  ]);

  const selected = buildSelectedSources(sources);
  const result = await docx_extract_simple(
    chapterArrayBuffer.slice(0),
    selected,
    {
      notesHtmlMap,
      skipEmptyNotes: true,
      markerMatchMode: "starts",
    }
  );

  return {
    title: chapter.title,
    result,
  };
}
