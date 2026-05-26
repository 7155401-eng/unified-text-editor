import {
  docx_extract_simple,
  find_all_note_sources,
  find_all_styles_full,
} from "./word_extractor/word_extractor_engine.js";
import {
  extractNotesHtmlMap,
  buildDynamicStyleMap,
} from "./word_extractor/word_extractor_mammoth.js";
import { buildDefaultStreamMapping } from "./word_extractor/word_extractor_streams.js";
import {
  extractWordChapterOnServer,
  importWordChaptersOnServer,
  normalizeServerScanState,
  serverLog,
} from "./chapter_cache/chapter_server_api.js";
import {
  computeChapterDocId,
  saveChapterExtraction,
  getChapterExtraction,
} from "./chapter_cache/chapter_cache_db.js";


const CARD_ID = "we-static-connection-probe";
const LAUNCHER_ID = "word-chapter-manager-launcher";
const FILE_BUTTON_ID = "word-chapter-manager-file-button";
const MODAL_ID = "word-extractor-modal";
const HEBREW_MARKS_RE = /[\u0591-\u05C7]/g;

let paneManagerRef = null;
let wired = false;
let token = 0;
let selectedFile = null;
let state = null;
let selectedLevel = 1;
let chaptersOpen = false;
let busyChapter = false;
let lastImported = null;
let importedKeys = new Set();
let docId = null;
let cachedIds = new Set();
let importAllBusy = false;
let importAllCancel = false;

const $ = (root, selector) => root?.querySelector?.(selector) || null;
const $$ = (root, selector) => Array.from(root?.querySelectorAll?.(selector) || []);
const fmt = (value) => Number(value || 0).toLocaleString("he-IL");
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function norm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(HEBREW_MARKS_RE, "")
    .trim()
    .toLowerCase();
}

// String-based XML helpers — no DOMParser, safe for large documents
function sXmlDec(v) {
  return String(v || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function sAttr(xml, name) {
  const m = String(xml || "").match(new RegExp(`(?:\\bw:|\\b)${name}="([^"]*)"`));
  return m ? sXmlDec(m[1]) : "";
}
function sTag(xml, ln) {
  const m = String(xml || "").match(new RegExp(`<w:${ln}\\b[\\s\\S]*?(?:<\\/w:${ln}>|\\/>)`));
  return m ? m[0] : "";
}
function sPText(pXml) {
  const out = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = re.exec(String(pXml || "")))) out.push(sXmlDec(m[1]));
  return out.join("");
}
function sParseStyles(xml) {
  const styles = {};
  for (const block of (String(xml || "").match(/<w:style\b[\s\S]*?<\/w:style>/g) || [])) {
    const id = sAttr(block, "styleId");
    if (!id) continue;
    styles[id] = { name: sAttr(sTag(block, "name"), "val"), outline: sAttr(sTag(block, "outlineLvl"), "val") };
  }
  return styles;
}
function sLevelOf(pXml, styles) {
  const pPr = sTag(pXml, "pPr");
  const outline = sAttr(sTag(pPr, "outlineLvl"), "val");
  if (outline !== "" && Number.isFinite(+outline)) return +outline + 1;
  const styleId = sAttr(sTag(pPr, "pStyle"), "val");
  const style = styles[styleId] || {};
  if (style.outline !== "" && style.outline != null && Number.isFinite(+style.outline)) return +style.outline + 1;
  const marker = `${norm(styleId)} ${norm(style.name)}`;
  for (let i = 1; i <= 6; i++) {
    if (norm(styleId) === String(i) || marker.includes(`heading ${i}`) || marker.includes(`heading${i}`) ||
        marker.includes(`כותרת ${i}`) || marker.includes(`כותרת${i}`)) return i;
  }
  return 0;
}

function getModal() {
  return document.getElementById(MODAL_ID);
}

function removeCard() {
  document.getElementById(CARD_ID)?.remove();
}

function chapterKey(level, index) {
  return `${level}:${index}`;
}

function currentHeads() {
  return state?.heads?.[selectedLevel] || [];
}

function ensureCard() {
  const modal = getModal();
  if (!modal?.classList.contains("active") || !selectedFile) {
    removeCard();
    return null;
  }

  let card = document.getElementById(CARD_ID);
  if (card) return card;

  card = document.createElement("section");
  card.id = CARD_ID;
  card.dir = "rtl";
  card.style.cssText = [
    "margin:12px auto",
    "padding:14px",
    "border:1px solid #7c3aed",
    "border-radius:12px",
    "background:#faf5ff",
    "color:#111827",
    "box-sizing:border-box",
    "max-width:min(920px,100%)",
    "width:100%",
  ].join(";");

  const streamsWrap = $(".we-streams-wrap", modal);
  const meta = $(".we-meta", modal);
  if (streamsWrap?.parentElement) {
    streamsWrap.parentElement.insertBefore(card, streamsWrap);
  } else if (meta?.parentElement) {
    meta.parentElement.insertBefore(card, meta.nextSibling);
  } else {
    ($(".we-modal", modal) || modal).appendChild(card);
  }

  return card;
}

function loading(message, { pct = null, detail = "" } = {}) {
  const card = ensureCard();
  if (!card) return;
  const bar = pct != null ? `
    <div style="margin-top:8px;background:#e2e8f0;border-radius:4px;height:8px">
      <div style="width:${pct}%;background:#7c3aed;border-radius:4px;height:8px;transition:width .4s"></div>
    </div>
    <div style="font-size:11px;color:#7c3aed;margin-top:3px;text-align:start">${pct}%</div>
  ` : "";
  const detailHtml = detail ? `<div style="font-size:11px;color:#64748b;margin-top:4px;white-space:pre-line">${esc(detail)}</div>` : "";
  card.innerHTML = `
    <b style="color:#312e81">פרקי הספר</b>
    <div style="font-size:12px;color:#64748b">מנהל פרקים בתוך חלון ייבוא Word.</div>
    <div style="margin-top:8px;color:#475569">${esc(message)}</div>
    ${bar}${detailHtml}
  `;
}

function errorCard(message) {
  const card = ensureCard();
  if (!card) return;
  card.innerHTML = `
    <b style="color:#312e81">פרקי הספר</b>
    <button type="button" data-wh-refresh style="float:left;border:1px solid #cbd5e1;border-radius:8px;background:white;padding:5px 9px;cursor:pointer">רענן</button>
    <div style="clear:both;margin-top:8px;color:#b91c1c">שגיאה: ${esc(message)}</div>
  `;
}

const statBox = (value, label) => `
  <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px;text-align:center">
    <b style="display:block;font-size:18px">${fmt(value)}</b>
    <span>${label}</span>
  </div>
`;

function nextChapterIndex() {
  const heads = currentHeads();
  if (!heads.length) return -1;

  const start = lastImported?.level === selectedLevel ? lastImported.index + 1 : 0;
  for (let i = start; i < heads.length; i += 1) {
    if (!importedKeys.has(chapterKey(selectedLevel, i))) return i;
  }
  for (let i = 0; i < heads.length; i += 1) {
    if (!importedKeys.has(chapterKey(selectedLevel, i))) return i;
  }
  return Math.min(start, heads.length - 1);
}

function renderCard() {
  const card = ensureCard();
  if (!card || !state) return;

  const heads = currentHeads();
  const nextIndex = nextChapterIndex();
  const importedCount = heads.filter((_, index) => importedKeys.has(chapterKey(selectedLevel, index))).length;
  const rows = chaptersOpen ? renderChapterIndex(heads, nextIndex) : `
    <div style="font-size:12px;color:#475569;margin-top:8px">
      הרשימה לא נבנית אוטומטית. לחץ על <b>הצג פרקים</b>. תוכן פרק נבנה רק בלחיצה על <b>ייבא פרק זה</b>.
    </div>
  `;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div>
        <b style="color:#312e81">פרקי הספר</b>
        <div style="font-size:12px;color:#64748b">
          נשמר בזיכרון הדפדפן: ${esc(state.fileName || selectedFile?.name || "מסמך Word")}.
          אפשר להמשיך בלי להעלות מחדש.
        </div>
      </div>
      <button type="button" data-wh-refresh style="border:1px solid #cbd5e1;border-radius:8px;background:white;padding:6px 10px;cursor:pointer">רענן</button>
    </div>

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:10px 0">
      ${statBox(state.chars, "תווים")}
      ${statBox(state.words, "מילים")}
      ${statBox(state.total, "כותרות")}
      ${statBox(state.h[1] || 0, "H1")}
      ${statBox(state.h[2] || 0, "H2")}
    </div>

    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">
      <label style="font-size:12px;color:#475569">חלוקה לפי:</label>
      <select data-wh-level style="border:1px solid #cbd5e1;border-radius:8px;background:white;padding:6px 8px">
        <option value="1" ${selectedLevel === 1 ? "selected" : ""}>H1</option>
        <option value="2" ${selectedLevel === 2 ? "selected" : ""}>H2</option>
      </select>
      <button type="button" data-wh-toggle style="border:1px solid #cbd5e1;border-radius:8px;background:white;padding:6px 10px;font-weight:700;cursor:pointer">
        ${chaptersOpen ? "הסתר פרקים" : "הצג פרקים"}
      </button>
      <button type="button" data-wh-next ${nextIndex < 0 ? "disabled" : ""} style="border:1px solid #7c3aed;border-radius:8px;background:white;padding:6px 10px;font-weight:700;cursor:pointer">
        ייבא הפרק הבא
      </button>
      <button type="button" data-wh-import-all ${importAllBusy || !heads.length ? "disabled" : ""} style="border:1px solid #16a34a;border-radius:8px;background:white;padding:6px 10px;font-weight:700;cursor:pointer;color:#15803d">
        ${importAllBusy ? "שומר ל-cache..." : "שמור הכל ל-cache"}
      </button>
      ${importAllBusy ? `<button type="button" data-wh-cancel-import-all style="border:1px solid #dc2626;border-radius:8px;background:white;padding:6px 10px;cursor:pointer;color:#dc2626">ביטול</button>` : ""}
      ${cachedIds.size > 0 ? `<button type="button" data-wh-clear-cache style="border:1px solid #94a3b8;border-radius:8px;background:white;padding:6px 8px;font-size:12px;cursor:pointer;color:#64748b">נקה cache (${cachedIds.size})</button>` : ""}
      <span style="font-size:12px;color:#475569">
        ${fmt(heads.length)} פרקים לפי H${selectedLevel} · ${fmt(importedCount)} יובאו${cachedIds.size > 0 ? ` · ${cachedIds.size} ב-cache` : ""}
      </span>
    </div>

    ${lastImported ? `
      <div style="font-size:12px;color:#166534;background:#ecfdf5;border:1px solid #bbf7d0;border-radius:8px;padding:8px;margin-top:10px">
        יובא לאחרונה: ${esc(lastImported.title || "פרק")}. אפשר להמשיך עם “ייבא הפרק הבא”.
      </div>
    ` : ""}

    ${rows}
  `;
}

function renderChapterIndex(heads, nextIndex) {
  if (!heads.length) {
    return `<div style="border:1px dashed #cbd5e1;border-radius:8px;background:white;color:#64748b;padding:10px;margin-top:8px">אין פרקים לפי H${selectedLevel}.</div>`;
  }

  return `
    <div style="font-size:12px;color:#475569;margin-top:8px">אינדקס כותרות בלבד. הפרק נבנה רק בלחיצה.</div>
    <div style="max-height:300px;overflow:auto;margin-top:6px">
      ${heads.map((head, index) => {
        const imported = importedKeys.has(chapterKey(selectedLevel, index));
        const isNext = index === nextIndex;
        return `
          <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border:1px solid ${isNext ? "#7c3aed" : "#e2e8f0"};border-radius:9px;background:white;padding:8px;margin-top:7px">
            <div>
              <b style="font-size:13px">${esc(head.title || `פרק ${index + 1}`)}</b>
              <div style="font-size:12px;color:#64748b">
                מתחיל בפסקה ${fmt(head.start + 1)}${imported ? " · יובא" : ""}${isNext ? " · הבא בתור" : ""}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
            <button type="button" data-wh-load="${index}" style="border:1px solid #cbd5e1;border-radius:8px;background:white;padding:7px 10px;font-weight:700;cursor:pointer">
              ${busyChapter ? "מכין..." : cachedIds.has(chapterKey(selectedLevel, index)) ? "פתח מ-cache" : imported ? "ייבא שוב" : "ייבא פרק זה"}
            </button>
              ${cachedIds.has(chapterKey(selectedLevel, index)) ? `<span style="font-size:10px;color:#15803d;background:#dcfce7;border-radius:4px;padding:1px 5px">cache ✓</span>` : ""}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function ensureLauncher() {
  if (!state || !selectedFile) {
    document.getElementById(LAUNCHER_ID)?.remove();
    document.getElementById(FILE_BUTTON_ID)?.remove();
    return;
  }

  let button = document.getElementById(LAUNCHER_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = LAUNCHER_ID;
    button.type = "button";
    button.dir = "rtl";
    button.style.cssText = [
      "position:fixed",
      "left:18px",
      "bottom:18px",
      "z-index:2147483000",
      "border:1px solid #7c3aed",
      "border-radius:999px",
      "background:#faf5ff",
      "color:#312e81",
      "box-shadow:0 8px 24px rgba(15,23,42,.18)",
      "padding:10px 14px",
      "font-weight:800",
      "cursor:pointer",
    ].join(";");
    document.body.appendChild(button);
  }

  const nextIndex = nextChapterIndex();
  const heads = currentHeads();
  button.textContent = nextIndex >= 0
    ? `פרקי הספר · המשך לפרק ${fmt(nextIndex + 1)} מתוך ${fmt(heads.length)}`
    : "פרקי הספר";

  ensureFileTabButton();
}

function ensureFileTabButton() {
  if (!state || !selectedFile) return;
  const host = $(".source-bottom-toolbar", document);
  if (!host) return;

  let button = document.getElementById(FILE_BUTTON_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = FILE_BUTTON_ID;
    button.type = "button";
    button.dir = "rtl";
    button.dataset.wordChapterManager = "1";
    button.style.cssText = [
      "margin-inline-start:6px",
      "border:1px solid #7c3aed",
      "border-radius:8px",
      "background:#faf5ff",
      "color:#312e81",
      "padding:7px 10px",
      "font-weight:800",
      "cursor:pointer",
    ].join(";");
    host.appendChild(button);
  }

  const nextIndex = nextChapterIndex();
  button.textContent = nextIndex >= 0
    ? `פרקי הספר · פרק ${fmt(nextIndex + 1)}`
    : "פרקי הספר";
}

function openChapterManager() {
  const modal = getModal();
  if (!modal || !state || !selectedFile) return;
  modal.classList.add("active");
  modal.hidden = false;
  modal.removeAttribute("aria-hidden");
  chaptersOpen = true;
  renderCard();
  setTimeout(() => document.getElementById(CARD_ID)?.scrollIntoView?.({ block: "center", behavior: "smooth" }), 80);
}

function localName(node) {
  return node?.localName || node?.nodeName?.split(":").pop() || "";
}

function allByLocal(node, local) {
  if (!node) return [];
  return Array.from(node.getElementsByTagNameNS?.("*", local) || [])
    .concat(Array.from(node.getElementsByTagName?.(`w:${local}`) || []))
    .filter((x, i, arr) => arr.indexOf(x) === i);
}

function childrenByLocal(node, local) {
  if (!node) return [];
  return Array.from(node.childNodes || []).filter(n => n.nodeType === 1 && localName(n) === local);
}

const firstByLocal = (node, local) => childrenByLocal(node, local)[0] || allByLocal(node, local)[0] || null;

function attr(node, name) {
  if (!node) return "";
  return node.getAttribute(`w:${name}`)
    || node.getAttribute(name)
    || node.getAttributeNS?.("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name)
    || "";
}

const paragraphText = (p) => allByLocal(p, "t").map(t => t.textContent || "").join("");

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
  } catch (_) {}
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


async function waitForNativeScan(thisToken) {
  const start = Date.now();
  while (thisToken === token && Date.now() - start < 15000) {
    const modalEl = getModal();
    const meta = $(".we-meta", modalEl);
    const streams = $(".we-streams-wrap", modalEl);
    const status = $(".we-status", modalEl);
    const ok = (meta && meta.hidden === false) || (streams && streams.hidden === false);
    const nativeBusy = status && status.hidden === false && /סורק|Scanning|scan/i.test(status.textContent || "");
    if (ok && !nativeBusy) return;
    await sleep(300);
  }
}

async function loadJsZip() {
  if (window.JSZip) return window.JSZip;
  const mod = await import("jszip");
  return mod.default || mod;
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

async function scanFile(fileObj, thisToken) {
  if (!fileObj || thisToken !== token) return;
  const sizeMB = ((fileObj.size || 0) / 1048576).toFixed(1);
  const startedAt = Date.now();
  let elapsedTimer = null;
  let lastPct = null;
  function elapsed() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    return s < 60 ? `${s} שנ'` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function stopTicker() { clearInterval(elapsedTimer); elapsedTimer = null; }
  try {
    loading(`מעלה קובץ לשרת (${sizeMB} MB)...`);
    elapsedTimer = setInterval(() => {
      if (thisToken !== token) { stopTicker(); return; }
      loading(
        lastPct != null ? `מעלה לשרת: ${lastPct}%` : `מעלה לשרת (${sizeMB} MB)...`,
        { pct: lastPct, detail: `זמן: ${elapsed()}` }
      );
    }, 1500);
    const serverImport = await importWordChaptersOnServer(fileObj, (progress) => {
      if (thisToken !== token) return;
      if (progress.stage === "upload") {
        lastPct = progress.pct;
        const loadedMB = (progress.loaded / 1048576).toFixed(1);
        const kbps = Math.round(progress.loaded / 1024 / Math.max(1, (Date.now() - startedAt) / 1000));
        loading(`מעלה לשרת: ${progress.pct}%`, { pct: progress.pct, detail: `${loadedMB}/${sizeMB} MB · ${kbps} KB/s · זמן: ${elapsed()}` });
      } else if (progress.stage === "processing") {
        lastPct = 100;
        loading("השרת מוצא כותרות...", { pct: 100, detail: `הקובץ הגיע · זמן: ${elapsed()}` });
      }
    });
    stopTicker();
    if (thisToken !== token) return;
    serverLog("normalize_start", { fileName: fileObj?.name, size: fileObj?.size });
    const serverState = normalizeServerScanState(serverImport, fileObj);
    serverLog("normalize_done", {
      ok: !!serverState,
      heads1: serverState?.heads?.[1]?.length ?? 0,
      heads2: serverState?.heads?.[2]?.length ?? 0,
      total: serverState?.total ?? 0,
    });
    if (!serverState) throw new Error("השרת לא החזיר רשימת כותרות תקינה.");
    state = serverState;
    selectedLevel = !serverState.heads?.[1]?.length && serverState.heads?.[2]?.length ? 2 : 1;
    chaptersOpen = false;
    serverLog("render_card_start", { selectedLevel, heads: serverState?.heads?.[selectedLevel]?.length ?? 0 });
    renderCard();
    serverLog("render_card_done");
    ensureLauncher();
  } catch (e) {
    stopTicker();
    if (thisToken !== token) return;
    errorCard(`${e?.message || String(e)} · לאחר ${elapsed()}`);
  }
}

function buildSelectedSources(sources) {
  const streams = buildDefaultStreamMapping(sources || []).filter(s => s.included !== false);
  const selected = [];
  const seriesToCode = {};
  let nextCode = 1;

  for (const s of streams) {
    const series = s.series || `${s.source_type || s.sourceType || s.source || ""}:${s.marker || ""}`;
    if (!seriesToCode[series]) {
      seriesToCode[series] = String(nextCode++).padStart(2, "0");
    }
    selected.push({
      source: s.source_type || s.sourceType || s.source,
      marker: s.marker || null,
      symbol: "@" + seriesToCode[series],
    });
  }
  return selected;
}

async function buildNotesHtmlMapForChapter(buffer) {
  try {
    const stylesFull = await find_all_styles_full(buffer.slice(0));
    const styleMap = buildDynamicStyleMap(stylesFull || {});
    return await extractNotesHtmlMap(buffer.slice(0), { styleMap });
  } catch (e) {
    console.warn("[document_chapter_splitter] notesHtmlMap fallback:", e);
    return {};
  }
}

async function buildChapterDocx(chapterIndex) {
  if (!state) return null;
  const heads = state.heads[selectedLevel] || [];
  const head = heads[chapterIndex];
  if (!head) return null;

  const nextHead = heads[chapterIndex + 1];
  const end = nextHead ? nextHead.start : state.parts.length;
  const bodyXml = state.parts
    .slice(head.start, end)
    .map(p => p.xml)
    .join("") + (state.sect || "");

  const outZip = new state.JSZip();
  for (const name of Object.keys(state.zip.files || {})) {
    const entry = state.zip.files[name];
    if (!entry || entry.dir || name === "word/document.xml") continue;
    outZip.file(name, await entry.async("uint8array"));
  }

  outZip.file("word/document.xml", state.prefix + bodyXml + state.suffix);
  return {
    title: head.title || `פרק ${chapterIndex + 1}`,
    buffer: await outZip.generateAsync({ type: "arraybuffer" }),
  };
}

function plainToHtml(text) {
  const lines = String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return "<p></p>";
  return lines.map(line => `<p>${esc(line)}</p>`).join("");
}

function streamHtmlMap(result) {
  const out = {};
  if (Array.isArray(result?.streamsHtml)) {
    for (const [sym, html] of result.streamsHtml) out[sym] = html;
  }
  return out;
}

function mainEditor() {
  return paneManagerRef?.getMainPane?.()?.editor
    || paneManagerRef?.getActiveEditor?.()
    || paneManagerRef?.getActivePane?.()?.editor
    || null;
}

function loadExtractedChapter(title, result) {
  if (paneManagerRef?.load) {
    paneManagerRef.load({
      version: 1,
      activeId: "word-chapter-main",
      panes: [{
        id: "word-chapter-main",
        streamCode: null,
        symbol: "",
        label: title || "פרק",
        content: { type: "doc", content: [{ type: "paragraph" }] },
      }],
    });
  }

  const editor = mainEditor();
  if (!editor?.commands?.setContent) throw new Error("לא נמצא עורך פעיל.");
  editor.commands.setContent(result?.mainHtml || plainToHtml(result?.main || ""));
  editor.commands.focus?.();

  const htmlBySym = streamHtmlMap(result);
  for (const [sym, text] of result?.streams || []) {
    const code = String(sym || "").replace(/^@/, "");
    let pane = (paneManagerRef?.panes || []).find(p => p.symbol === sym || p.streamCode === code);
    if (!pane && paneManagerRef?.addPane) {
      pane = paneManagerRef.addPane({ streamCode: code, symbol: sym, label: `זרם ${sym}` });
    }
    if (pane?.editor) {
      pane.symbol = sym;
      if (pane.editor.storage?.streamMark) pane.editor.storage.streamMark.symbol = sym;
      const html = htmlBySym[sym] || plainToHtml(text || "");
      pane.editor.commands.setContent(html);
    }
  }

  window.__ravtextRerender?.();
  getModal()?.classList.remove("active");
}

async function importChapter(chapterIndex) {
  if (busyChapter) return;
  busyChapter = true;
  renderCard();

  const chapKey = chapterKey(selectedLevel, chapterIndex);

  // Serve from IndexedDB cache when available
  if (docId && cachedIds.has(chapKey)) {
    try {
      const cached = await getChapterExtraction(docId, chapKey);
      if (cached) {
        const title = cached.title || state?.heads?.[selectedLevel]?.[chapterIndex]?.title || `פרק ${chapterIndex + 1}`;
        importedKeys.add(chapKey);
        lastImported = { level: selectedLevel, index: chapterIndex, title, at: Date.now() };
        loadExtractedChapter(title, cached.result);
        ensureLauncher();
        busyChapter = false;
        renderCard();
        return;
      }
    } catch (_) {}
  }

  try {
    if (state?.serverSide) {
      loading(`מחלץ את הפרק בצד שרת: ${chapterIndex + 1}...`);
      const serverChapter = await extractWordChapterOnServer(selectedFile, {
        level: selectedLevel,
        index: chapterIndex,
      });

      if (!serverChapter?.result) {
        throw new Error("השרת לא החזיר תוכן פרק תקין.");
      }

      const title = serverChapter.title || currentHeads()[chapterIndex]?.title || `פרק ${chapterIndex + 1}`;
      importedKeys.add(chapterKey(selectedLevel, chapterIndex));
      lastImported = {
        level: selectedLevel,
        index: chapterIndex,
        title,
        at: Date.now(),
      };

      loadExtractedChapter(title, serverChapter.result);
      ensureLauncher();
      return;
    }

    const chapter = await buildChapterDocx(chapterIndex);
    if (!chapter) throw new Error("לא נמצא פרק לייבוא.");

    loading(`מחלץ את "${chapter.title}" דרך מנוע הייבוא המלא, כולל הערות שוליים...`);
    const buffer = chapter.buffer.slice(0);

    const [sources, notesHtmlMap] = await Promise.all([
      find_all_note_sources(buffer.slice(0)),
      buildNotesHtmlMapForChapter(buffer.slice(0)),
    ]);

    const selected = buildSelectedSources(sources);
    const result = await docx_extract_simple(
      buffer.slice(0),
      selected,
      {
        notesHtmlMap,
        skipEmptyNotes: true,
        markerMatchMode: "starts",
      }
    );

    // Save to IndexedDB cache
    if (docId) {
      saveChapterExtraction(docId, chapKey, { title: chapter.title, result }).then(() => {
        cachedIds.add(chapKey);
        localStorage.setItem("ravtext-cc-" + docId, JSON.stringify([...cachedIds]));
      }).catch(() => {});
    }

    importedKeys.add(chapKey);
    lastImported = {
      level: selectedLevel,
      index: chapterIndex,
      title: chapter.title,
      at: Date.now(),
    };

    loadExtractedChapter(chapter.title, result);
    ensureLauncher();
  } catch (e) {
    errorCard(e?.message || String(e));
  } finally {
    busyChapter = false;
    renderCard();
  }
}

async function importAllChapters() {
  if (importAllBusy || busyChapter) return;
  importAllBusy = true;
  importAllCancel = false;
  renderCard();

  const heads = currentHeads();
  for (let i = 0; i < heads.length; i++) {
    if (importAllCancel) break;
    const chapKey = chapterKey(selectedLevel, i);
    if (cachedIds.has(chapKey)) continue;

    try {
      const chapter = await buildChapterDocx(i);
      if (!chapter) continue;

      loading(`שומר ל-cache: "${chapter.title}" (${i + 1}/${heads.length})...`);
      const buffer = chapter.buffer.slice(0);

      const [sources, notesHtmlMap] = await Promise.all([
        find_all_note_sources(buffer.slice(0)),
        buildNotesHtmlMapForChapter(buffer.slice(0)),
      ]);

      const selected = buildSelectedSources(sources);
      const result = await docx_extract_simple(
        buffer.slice(0),
        selected,
        { notesHtmlMap, skipEmptyNotes: true, markerMatchMode: "starts" }
      );

      if (docId) {
        await saveChapterExtraction(docId, chapKey, { title: chapter.title, result });
        cachedIds.add(chapKey);
        localStorage.setItem("ravtext-cc-" + docId, JSON.stringify([...cachedIds]));
      }
      renderCard();
      await nextFrame();
    } catch (_) {}
  }

  importAllBusy = false;
  renderCard();
}

function onFileChange(ev) {
  const input = ev.target?.closest?.(`#${MODAL_ID} .we-file-input`);
  if (!input) return;

  const nextFile = input.files?.[0];
  if (!nextFile) {
    selectedFile = null;
    state = null;
    importedKeys = new Set();
    lastImported = null;
    removeCard();
    ensureLauncher();
    return;
  }

  selectedFile = nextFile;
  state = null;
  selectedLevel = 1;
  chaptersOpen = false;
  importedKeys = new Set();
  lastImported = null;
  docId = null;
  cachedIds = new Set();
  importAllBusy = false;
  importAllCancel = false;

  computeChapterDocId(nextFile).then(id => {
    docId = id;
    const raw = id ? localStorage.getItem("ravtext-cc-" + id) : null;
    cachedIds = raw ? new Set(JSON.parse(raw)) : new Set();
    renderCard();
  }).catch(() => {});

  const thisToken = ++token;
  loading("הקובץ נקלט. הספירה תתחיל אחרי הסריקה הרגילה...");
  setTimeout(() => scanFile(nextFile, thisToken), 800);
}

function onCardClick(ev) {
  const cardEl = ev.target?.closest?.(`#${CARD_ID}`);
  if (!cardEl) return;

  const refresh = ev.target.closest("[data-wh-refresh]");
  const toggle = ev.target.closest("[data-wh-toggle]");
  const next = ev.target.closest("[data-wh-next]");
  const loadButton = ev.target.closest("[data-wh-load]");

  if (refresh) {
    ev.preventDefault();
    if (selectedFile) scanFile(selectedFile, ++token);
    return;
  }

  if (toggle) {
    ev.preventDefault();
    chaptersOpen = !chaptersOpen;
    renderCard();
    return;
  }

  if (next) {
    ev.preventDefault();
    const index = nextChapterIndex();
    if (index >= 0) importChapter(index);
    return;
  }

  const importAll = ev.target.closest("[data-wh-import-all]");
  const cancelAll = ev.target.closest("[data-wh-cancel-import-all]");
  const clearCache = ev.target.closest("[data-wh-clear-cache]");

  if (importAll) {
    ev.preventDefault();
    importAllChapters();
    return;
  }

  if (cancelAll) {
    ev.preventDefault();
    importAllCancel = true;
    return;
  }

  if (clearCache) {
    ev.preventDefault();
    if (docId) localStorage.removeItem("ravtext-cc-" + docId);
    cachedIds = new Set();
    renderCard();
    return;
  }

  if (loadButton) {
    ev.preventDefault();
    importChapter(Number(loadButton.dataset.whLoad));
  }
}

function onCardChange(ev) {
  const select = ev.target?.closest?.(`#${CARD_ID} [data-wh-level]`);
  if (!select) return;
  selectedLevel = Number(select.value) === 2 ? 2 : 1;
  chaptersOpen = false;
  renderCard();
}

function onGlobalClick(ev) {
  if (ev.target?.closest?.(`#${LAUNCHER_ID}, #${FILE_BUTTON_ID}, [data-word-chapter-manager]`)) {
    ev.preventDefault();
    openChapterManager();
  }
}

export function wireChapterSplitter(paneManager) {
  paneManagerRef = paneManager;
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    wired
  ) return;

  wired = true;

  const keep = () => {
    const modalEl = getModal();
    if (modalEl?.classList.contains("active")) {
      if (!selectedFile) removeCard();
      else if (state && !document.getElementById(CARD_ID)) renderCard();
      else if (!state) ensureCard();
    }
    ensureLauncher();
  };

  document.addEventListener("change", onFileChange, false);
  document.addEventListener("change", onCardChange, true);
  document.addEventListener("click", onCardClick, true);
  document.addEventListener("click", onGlobalClick, true);

  [0, 100, 300, 800, 1500].forEach(ms => setTimeout(keep, ms));
  new MutationObserver(keep).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  window.ravtextOpenWordChapterManager = openChapterManager;
  window.ravtextRefreshWordDocumentDiagnostics = () => {
    if (selectedFile) scanFile(selectedFile, ++token);
  };
  window.ravtextRefreshWordHeadingMap = window.ravtextRefreshWordDocumentDiagnostics;
}
