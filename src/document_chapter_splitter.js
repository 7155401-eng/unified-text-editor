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

const CARD_ID = "we-static-connection-probe";
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

const $ = (root, selector) => root?.querySelector?.(selector) || null;
const $$ = (root, selector) => Array.from(root?.querySelectorAll?.(selector) || []);
const fmt = (value) => Number(value || 0).toLocaleString("he-IL");
const esc = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const norm = (value) => String(value || "")
  .normalize("NFD")
  .replace(HEBREW_MARKS_RE, "")
  .trim()
  .toLowerCase();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

function getModal() {
  return document.getElementById(MODAL_ID);
}

function removeCard() {
  document.getElementById(CARD_ID)?.remove();
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
    "margin:12px 0",
    "padding:12px",
    "border:1px solid #7c3aed",
    "border-radius:10px",
    "background:#faf5ff",
    "color:#111827",
    "box-sizing:border-box",
  ].join(";");

  const streamsWrap = $(".we-streams-wrap", modal);
  const meta = $(".we-meta", modal);
  if (streamsWrap?.parentElement) streamsWrap.parentElement.insertBefore(card, streamsWrap);
  else if (meta?.parentElement) meta.parentElement.insertBefore(card, meta.nextSibling);
  else ($(".we-modal", modal) || modal).appendChild(card);

  return card;
}

function loading(message) {
  const card = ensureCard();
  if (!card) return;
  card.innerHTML = `
    <b style="color:#312e81">כותרות / פרקים במסמך</b>
    <div style="font-size:12px;color:#64748b">מונה קל + אינדקס כותרות. ייבוא פרק עובר דרך מנוע ההערות המלא.</div>
    <div style="margin-top:8px;color:#475569">${esc(message)}</div>
  `;
}

function errorCard(message) {
  const card = ensureCard();
  if (!card) return;
  card.innerHTML = `
    <b style="color:#312e81">כותרות / פרקים במסמך</b>
    <button type="button" data-wh-refresh style="float:left;border:1px solid #cbd5e1;border-radius:8px;background:white;padding:5px 9px;cursor:pointer">רענן</button>
    <div style="clear:both;margin-top:8px;color:#b91c1c">לא הצלחתי לסרוק: ${esc(message)}</div>
  `;
}

const statBox = (value, label) => `
  <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:8px;padding:8px;text-align:center">
    <b style="display:block;font-size:18px">${fmt(value)}</b>
    <span>${label}</span>
  </div>
`;

function renderCard() {
  const card = ensureCard();
  if (!card || !state) return;

  const heads = state.heads[selectedLevel] || [];
  const rows = chaptersOpen ? renderChapterIndex(heads) : `
    <div style="font-size:12px;color:#475569;margin-top:8px">
      הרשימה לא נבנית אוטומטית. לחץ על <b>הצג פרקים</b>.
      תוכן הפרק נבנה רק בלחיצה על <b>ייבא פרק זה</b>.
    </div>
  `;

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
      <div>
        <b style="color:#312e81">כותרות / פרקים במסמך</b>
        <div style="font-size:12px;color:#64748b">מונה קל + אינדקס כותרות. ייבוא פרק עובר דרך מנוע ההערות המלא.</div>
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
      <span style="font-size:12px;color:#475569">${fmt(heads.length)} פרקים לפי H${selectedLevel}</span>
    </div>

    ${rows}
  `;
}

function renderChapterIndex(heads) {
  if (!heads.length) {
    return `<div style="border:1px dashed #cbd5e1;border-radius:8px;background:white;color:#64748b;padding:10px;margin-top:8px">אין פרקים לפי H${selectedLevel}.</div>`;
  }
  return `
    <div style="font-size:12px;color:#475569;margin-top:8px">אינדקס כותרות בלבד. תוכן הפרק נבנה רק בלחיצה.</div>
    <div style="max-height:260px;overflow:auto;margin-top:6px">
      ${heads.map((head, index) => `
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;border:1px solid #e2e8f0;border-radius:9px;background:white;padding:8px;margin-top:7px">
          <div>
            <b style="font-size:13px">${esc(head.title || `פרק ${index + 1}`)}</b>
            <div style="font-size:12px;color:#64748b">מתחיל בפסקה ${fmt(head.start + 1)}</div>
          </div>
          <button type="button" data-wh-load="${index}" style="border:1px solid #cbd5e1;border-radius:8px;background:white;padding:7px 10px;font-weight:700;cursor:pointer">
            ${busyChapter ? "מכין..." : "ייבא פרק זה"}
          </button>
        </div>
      `).join("")}
    </div>
  `;
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
    for (const s of allByLocal(doc, "style")) {
      const id = attr(s, "styleId");
      if (!id) continue;
      out[id] = {
        name: attr(firstByLocal(s, "name"), "val"),
        outline: attr(firstByLocal(s, "outlineLvl"), "val"),
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

  const mark = `${norm(id)} ${norm(style.name)}`;
  for (let i = 1; i <= 6; i += 1) {
    if (
      norm(id) === String(i) ||
      mark.includes(`heading ${i}`) ||
      mark.includes(`heading${i}`) ||
      mark.includes(`כותרת ${i}`) ||
      mark.includes(`כותרת${i}`)
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
    const busy = status && status.hidden === false && /סורק|Scanning|scan/i.test(status.textContent || "");
    if (ok && !busy) return;
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
  if (!open || closeIndex < 0) {
    throw new Error("לא נמצא גוף מסמך Word תקין.");
  }
  return {
    prefix: xml.slice(0, open.index + open[0].length),
    suffix: xml.slice(closeIndex),
  };
}

async function scanFile(fileObj, thisToken) {
  if (!fileObj || thisToken !== token) return;
  loading("הקובץ נקלט. ממתין לסיום הסריקה הרגילה...");
  await waitForNativeScan(thisToken);
  await nextFrame();
  if (thisToken !== token) return;

  loading("סופר תווים, מילים וכותרות בצורה קלה...");
  try {
    const JSZip = await loadJsZip();
    await nextFrame();

    const zip = await JSZip.loadAsync(await fileObj.arrayBuffer());
    const docFile = zip.file("word/document.xml");
    if (!docFile) throw new Error("לא נמצא word/document.xml");

    const [docXml, stylesXml] = await Promise.all([
      docFile.async("text"),
      zip.file("word/styles.xml")?.async("text") || Promise.resolve(""),
    ]);
    if (thisToken !== token) return;

    const { prefix, suffix } = splitDocumentXml(docXml);
    const doc = new DOMParser().parseFromString(docXml, "application/xml");
    const body = firstByLocal(doc, "body");
    if (!body) throw new Error("לא נמצא גוף מסמך Word.");

    const serializer = new XMLSerializer();
    const styles = parseStyles(stylesXml || "");
    const h = { 1:0, 2:0, 3:0, 4:0, 5:0, 6:0 };
    const heads = { 1:[], 2:[] };
    const parts = [];
    const allText = [];
    let sect = "";

    const direct = Array.from(body.childNodes || []).filter(n => n.nodeType === 1);
    for (let i = 0; i < direct.length; i += 1) {
      const node = direct[i];
      const name = localName(node);
      if (name === "sectPr") {
        sect = serializer.serializeToString(node);
        continue;
      }
      if (name !== "p") continue;

      const text = paragraphText(node);
      const level = levelOf(node, styles);
      const index = parts.length;

      parts.push({ xml: serializer.serializeToString(node), text, level });
      allText.push(text);

      if (text.trim() && level >= 1 && level <= 6) {
        h[level] += 1;
        if (level === 1 || level === 2) {
          heads[level].push({ title: text.trim(), start: index });
        }
      }

      if (i % 250 === 0) await nextFrame();
      if (thisToken !== token) return;
    }

    const full = allText.join("\n");
    state = {
      JSZip,
      zip,
      prefix,
      suffix,
      sect,
      parts,
      heads,
      h,
      total: Object.values(h).reduce((a, b) => a + b, 0),
      chars: full.length,
      words: countWords(full),
    };

    selectedLevel = !heads[1].length && heads[2].length ? 2 : 1;
    chaptersOpen = false;
    renderCard();
  } catch (e) {
    errorCard(e?.message || String(e));
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

function loadResult(title, result) {
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
  editor.commands.setContent(plainToHtml(result?.main || ""));
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
      pane.editor.commands.setContent(htmlBySym[sym] || plainToHtml(text || ""));
    }
  }

  window.__ravtextRenderer?.();
  getModal()?.classList.remove("active");
}

async function importChapter(chapterIndex) {
  if (busyChapter) return;
  busyChapter = true;
  renderCard();

  try {
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

    loadResult(chapter.title, result);
  } catch (e) {
    errorCard(e?.message || String(e));
  } finally {
    busyChapter = false;
    renderCard();
  }
}

function onFileChange(ev) {
  const input = ev.target?.closest?.(`#${MODAL_ID} .we-file-input`);
  if (!input) return;

  const file = input.files?.[0];
  if (!file) {
    selectedFile = null;
    state = null;
    removeCard();
    return;
  }

  selectedFile = file;
  state = null;
  selectedLevel = 1;
  chaptersOpen = false;

  const thisToken = ++token;
  loading("הקובץ נקלט. הספירה תתחיל אחרי הסריקה הרגילה...");
  setTimeout(() => scanFile(file, thisToken), 800);
}

function onCardClick(ev) {
  const cardEl = ev.target?.closest?.(`#${CARD_ID}`);
  if (!cardEl) return;

  const refresh = ev.target.closest("[data-wh-refresh]");
  const toggle = ev.target.closest("[data-wh-toggle]");
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
    if (!modalEl?.classList.contains("active")) return;
    if (!selectedFile) removeCard();
    else if (state && !document.getElementById(CARD_ID)) renderCard();
    else if (!state) ensureCard();
  };

  document.addEventListener("change", onFileChange, false);
  document.addEventListener("change", onCardChange, true);
  document.addEventListener("click", onCardClick, true);

  [0, 100, 300, 800, 1500].forEach(ms => setTimeout(keep, ms));
  new MutationObserver(keep).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });

  window.ravtextRefreshWordDocumentDiagnostics = () => {
    if (selectedFile) scanFile(selectedFile, ++token);
  };
  window.ravtextRefreshWordHeadingMap = window.ravtextRefreshWordDocumentDiagnostics;
}
