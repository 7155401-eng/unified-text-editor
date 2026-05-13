import { streamColorIndex } from "./schema.js";
import { applyStyleToElement } from "../style_registry.js";
import { applyMainTextStyleToElement } from "../document_style_settings.js";
import {
  getEffectiveStreamSettings,
  formatStreamNumber,
  shouldBoldStreamNumber,
  shouldBoldStreamLemma,
  noteTextPrefixForStream,
  noteTextSuffixForStream,
} from "../original_stream_columns.js";

function streamTitleForCode(code) {
  const labels = typeof window !== "undefined" ? window.__STREAM_LABELS__ : null;
  return (labels && labels[code]) || code;
}

function mainBlockTagFor(tup) {
  const idx = tup ? tup[0] : null;
  const globalMeta =
    typeof window !== "undefined" && idx !== null && window.__MAIN_BLOCK_META__
      ? window.__MAIN_BLOCK_META__[idx]
      : null;
  const meta = (tup && tup[4]) || globalMeta || {};
  if (meta.blockType !== "heading") return "p";
  const level = Math.max(1, Math.min(6, parseInt(meta.headingLevel || 1, 10)));
  return `h${level}`;
}

function appendTableRows(table, rows = []) {
  table.classList.add("ravtext-table");
  const tbody = document.createElement("tbody");
  for (const row of rows || []) {
    const tr = document.createElement("tr");
    for (const cell of row || []) {
      const td = document.createElement("td");
      const p = document.createElement("p");
      p.textContent = cell || "";
      td.appendChild(p);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

function createMainBlockElement(tup) {
  const meta = (tup && tup[4]) || {};
  if (meta.blockType === "table") {
    const table = document.createElement("table");
    appendTableRows(table, meta.tableRows || []);
    return table;
  }
  const p = document.createElement(mainBlockTagFor(tup));
  p.textContent = tup[1] || "";
  return p;
}

function applyBlockStyleMeta(el, meta = {}) {
  const style = meta.style || {};
  if (style.fontFamily) el.style.fontFamily = style.fontFamily;
  if (style.fontSize) el.style.fontSize = style.fontSize;
  if (style.color) el.style.color = style.color;
  if (style.backgroundColor) el.style.backgroundColor = style.backgroundColor;
  if (style.bold) el.style.fontWeight = "700";
  if (style.italic) el.style.fontStyle = "italic";
  if (style.underline) el.style.textDecoration = "underline";
  if (style.textAlign) el.style.textAlign = style.textAlign;
  if (style.lineHeight) el.style.lineHeight = String(style.lineHeight);
  if (style.indent) el.style.marginInlineStart = `${Number(style.indent) * 24}px`;
  if (style.textIndent != null) el.style.textIndent = `${style.textIndent}em`;
  if (style.marginTop != null) el.style.marginTop = `${style.marginTop}px`;
  if (style.marginBottom != null) el.style.marginBottom = `${style.marginBottom}px`;
}

function createStreamElement(streamCode, streamData, streamNumLastPage, pageIndex, options = {}) {
  const notesArr = (streamData && streamData.notes) || [];
  const hasNoteText = notesArr.some((tup) => {
    const text = (tup && tup[1]) || "";
    const children = Array.isArray(tup && tup[5]) ? tup[5] : [];
    return text.trim().length > 0 || children.some((child) => ((child && child.text) || "").trim().length > 0);
  });
  if (!hasNoteText) return null;

  const wrap = document.createElement("div");
  wrap.className = `stream stream-color-${streamColorIndex(streamCode)}`;
  wrap.setAttribute("data-stream", streamCode);

  const settings = getEffectiveStreamSettings(streamCode);
  applyStyleToElement(wrap, settings.styleId);
  const userCols = settings.cols || 1;
  // משה 2026-05-06: בחירת עמודות לפי הגדרת המשתמש בלבד, ללא הערכת שורות
  // לפי תווים (החישוב של 52 תווים/שורה לא תאם את המציאות).
  const cols = userCols;
  if (cols > 1) {
    wrap.style.columnCount = cols;
    wrap.style.columnGap = "var(--ravtext-stream-horizontal-gap, 8px)";
  }
  // Stream-level default for the last line of TRULY-ENDING notes — never
  // stretched, since the user said "don't justify both sides at a real end".
  if (settings.lastLineCenter) {
    wrap.style.textAlignLast = "center";
  } else {
    wrap.style.textAlignLast = "right";
  }

  const title = document.createElement("div");
  title.className = "stream-title";
  title.textContent = streamTitleForCode(streamCode);
  applyStyleToElement(title, settings.titleStyleId);
  wrap.appendChild(title);

  const notes = notesArr;
  // Default = inline (continuous notes); user can toggle off per-stream.
  const notesInline = typeof settings.inline === "boolean" ? settings.inline : true;
  const displayNum = (tup) =>
    typeof tup[3] === "number" && tup[3] > 0 ? tup[3] : tup[0];
  const isCont = (tup) => tup[4] === 1 || tup[4] === true;

  // Build a note's DOM content: "[N] " prefix + lemma (first word, bolded
  // via .note-lemma) + rest. For continuation halves, no prefix and no
  // lemma — the lemma sits with the leading half.
  //
  // Nested children (tup[5] = array of {stream, text, num, children}) are
  // inlined inside the parent's apparatus block at the end of the parent's
  // text. Each child renders as `[stream-num] lemma rest`, in a span whose
  // class identifies the child's stream so colors flow through.
  function appendNoteContent(parent, tup, leadingSpace) {
    const text = tup[1] || "";
    if (isCont(tup)) {
      parent.appendChild(document.createTextNode((leadingSpace ? " " : "") + text));
      return;
    }
    const prefix = (leadingSpace ? " " : "") + `[${displayNum(tup)}] `;
    parent.appendChild(document.createTextNode(prefix));
    const trimmed = text.replace(/^\s+/, "");
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx > 0) {
      const lemma = document.createElement("strong");
      lemma.className = "note-lemma";
      lemma.textContent = trimmed.substring(0, spaceIdx);
      parent.appendChild(lemma);
      parent.appendChild(document.createTextNode(trimmed.substring(spaceIdx)));
    } else if (trimmed.length > 0) {
      const lemma = document.createElement("strong");
      lemma.className = "note-lemma";
      lemma.textContent = trimmed;
      parent.appendChild(lemma);
    }
    appendChildNotes(parent, Array.isArray(tup[5]) ? tup[5] : []);
  }

  function appendChildNotes(parent, children) {
    for (const child of children) {
      const wrap = document.createElement("span");
      wrap.className = `note-child note-stream-${streamColorIndex(child.stream)}`;
      wrap.dataset.stream = child.stream;
      if (typeof child.num === "number") wrap.dataset.noteNum = String(child.num);
      appendNumberPrefix(wrap, child.stream, child.num || 0, "child", true);
      const childTrim = (child.text || "").replace(/^\s+/, "");
      const sp = childTrim.indexOf(" ");
      if (sp > 0) {
        const lem = document.createElement("strong");
        lem.className = "note-lemma";
        lem.textContent = childTrim.substring(0, sp);
        wrap.appendChild(lem);
        wrap.appendChild(document.createTextNode(childTrim.substring(sp)));
      } else if (childTrim.length > 0) {
        const lem = document.createElement("strong");
        lem.className = "note-lemma";
        lem.textContent = childTrim;
        wrap.appendChild(lem);
      }
      const grand = Array.isArray(child.children) ? child.children : [];
      if (grand.length > 0) appendChildNotes(wrap, grand);
      parent.appendChild(wrap);
    }
  }

  function appendNumberPrefix(parent, code, num, place, leadingSpace = false) {
    const formatted = formatStreamNumber(code, num, place);
    if (!formatted) {
      if (leadingSpace) parent.appendChild(document.createTextNode(" "));
      return;
    }
    const text = (leadingSpace ? " " : "") + formatted + " ";
    if (shouldBoldStreamNumber(code, place)) {
      const strong = document.createElement("strong");
      strong.className = "note-number";
      strong.textContent = text;
      parent.appendChild(strong);
    } else {
      parent.appendChild(document.createTextNode(text));
    }
  }

  const artificialLastLine = options.pageHasMain && !mishnaWrapActive()
    ? "justify"
    : "right";

  // A note's display end is "artificial" if there's another piece with the
  // same num on a later page — its last line should be JUSTIFIED so the cut
  // doesn't look like the note's natural end.
  const isArtificialEnd = (tup) => {
    if (!streamNumLastPage || pageIndex === undefined) return false;
    const num = tup[3];
    if (typeof num !== "number" || num <= 0) return false;
    const key = streamCode + ":" + num;
    return typeof streamNumLastPage[key] === "number" && streamNumLastPage[key] > pageIndex;
  };

  if (notesInline) {
    const noteAll = document.createElement("div");
    noteAll.className = "note note-inline";
    notes.forEach((tup, i) => {
      const part = document.createElement("span");
      part.className = "note-part";
      part.dataset.cont = isCont(tup) ? "1" : "0";
      const num = displayNum(tup);
      if (num !== undefined && num !== null) part.dataset.noteNum = String(num);
      appendNoteContent(part, tup, i > 0);
      noteAll.appendChild(part);
    });
    if (notes.length > 0 && isArtificialEnd(notes[notes.length - 1])) {
      noteAll.style.textAlignLast = artificialLastLine;
    }
    wrap.appendChild(noteAll);
  } else {
    for (const tup of notes) {
      const note = document.createElement("div");
      note.className = "note";
      appendNoteContent(note, tup, false);
      if (isArtificialEnd(tup)) {
        note.style.textAlignLast = artificialLastLine;
      }
      wrap.appendChild(note);
    }
  }

  return wrap;
}

function mishnaWrapActive() {
  try {
    return typeof window !== "undefined" &&
      window.localStorage &&
      window.localStorage.getItem("ravtext.mishnaWrap") === "1";
  } catch (_err) {
    return false;
  }
}

function createPageElement(pageData, paraIdxLastPage, pageIndex, streamNumLastPage, paraIdxFirstPage) {
  const page = document.createElement("div");
  page.className = "page";
  page.setAttribute("dir", "rtl");
  const pageHasMain = (pageData.main || []).length > 0;

  const main = document.createElement("div");
  main.className = "page-main";
  applyMainTextStyleToElement(main);
  let lastIdx = null;
  let lastP = null;
  for (const tup of pageData.main) {
    const idx = tup[0];
    const text = tup[1];
    if (idx === lastIdx && lastP) {
      lastP.textContent += " " + text;
    } else {
      const p = createMainBlockElement(tup);
      applyBlockStyleMeta(p, (tup && tup[4]) || {});
      // v33: mark this paragraph as a continuation FROM a previous page
      // (its idx already appeared on an earlier page). opening_word.js skips
      // these so we don't apply opening-word styling to mid-sentence text.
      if (paraIdxFirstPage && pageIndex !== undefined &&
          typeof paraIdxFirstPage[idx] === "number" &&
          paraIdxFirstPage[idx] < pageIndex) {
        p.dataset.continuedFromPrev = "1";
      }
      main.appendChild(p);
      lastP = p;
      lastIdx = idx;
    }
    // If this paragraph continues on a later page, force its last line to
    // justify so the cut doesn't look like a real paragraph end.
    if (paraIdxLastPage && pageIndex !== undefined &&
        typeof paraIdxLastPage[idx] === "number" &&
        paraIdxLastPage[idx] > pageIndex) {
      lastP.dataset.continues = "1";
      lastP.style.textAlignLast = "right";
    }
  }
  page.appendChild(main);

  const codes = Object.keys(pageData.streams || {})
    .filter((code) => {
      const sd = pageData.streams[code];
      return sd && sd.notes && sd.notes.length > 0;
    })
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (codes.length > 0) {
    const streamsWrap = document.createElement("div");
    streamsWrap.className = "page-streams";
    for (const code of codes) {
      const streamEl = createStreamElement(code, pageData.streams[code], streamNumLastPage, pageIndex, { pageHasMain });
      if (streamEl) streamsWrap.appendChild(streamEl);
    }
    if (streamsWrap.children.length > 0) page.appendChild(streamsWrap);
  }

  return page;
}

function computeLastPageByParaIdx(pages) {
  const last = {};
  for (let i = 0; i < pages.length; i++) {
    for (const seg of pages[i].main || []) {
      const idx = seg[0];
      if (!(idx in last) || last[idx] < i) last[idx] = i;
    }
  }
  return last;
}

// v33: paragraph-idx → first page on which it appears.
// Used to mark continuation paragraphs so opening_word doesn't apply to them.
function computeFirstPageByParaIdx(pages) {
  const first = {};
  for (let i = 0; i < pages.length; i++) {
    for (const seg of pages[i].main || []) {
      const idx = seg[0];
      if (!(idx in first)) first[idx] = i;
    }
  }
  return first;
}

function computeLastPageByStreamNum(pages) {
  const last = {};
  for (let i = 0; i < pages.length; i++) {
    for (const code of Object.keys(pages[i].streams || {})) {
      const arr = (pages[i].streams[code] && pages[i].streams[code].notes) || [];
      for (const tup of arr) {
        const num = tup[3];
        if (typeof num !== "number" || num <= 0) continue;
        const key = code + ":" + num;
        if (!(key in last) || last[key] < i) last[key] = i;
      }
    }
  }
  return last;
}

export function renderPages(packerOutput, container) {
  if (container.__pageObserver && typeof container.__pageObserver.disconnect === "function") {
    container.__pageObserver.disconnect();
  }
  container.__pageObserver = null;
  container.__processRealizedPage = null;
  container.__documentFeaturesHooked = false;
  container.innerHTML = "";
  const paraLastPage = computeLastPageByParaIdx(packerOutput);
  const paraFirstPage = computeFirstPageByParaIdx(packerOutput);
  const streamNumLastPage = computeLastPageByStreamNum(packerOutput);

  // Force-sync: skip the placeholder/progressive machinery entirely. Used by
  // verify-pages.mjs and other automated tests so all pages are in the DOM
  // by the time we measure them.
  if (typeof window !== "undefined" && window.__FORCE_SYNC_RENDER__) {
    const allFrag = document.createDocumentFragment();
    const realPages = [];
    for (let i = 0; i < packerOutput.length; i++) {
      const real = createPageElement(packerOutput[i], paraLastPage, i, streamNumLastPage, paraFirstPage);
      real.dataset.pageIndex = String(i);
      real.dataset.realized = "1";
      allFrag.appendChild(real);
      realPages.push(real);
    }
    container.appendChild(allFrag);
    container.__getPageElement = (i) => realPages[i] || null;
    container.__realizePage = () => {};
    container.__pageCount = packerOutput.length;
    return;
  }

  // True lazy rendering: every page is created as a same-sized placeholder
  // so scroll height and page navigation are correct from frame 1. Only the
  // first pages and near-viewport pages are realized; print/download/search
  // can still force all pages through __realizePage.
  const frag = document.createDocumentFragment();
  const PAGE_W = 380;
  const PAGE_H = 537;
  const placeholders = [];
  for (let i = 0; i < packerOutput.length; i++) {
    const ph = document.createElement("div");
    ph.className = "page page-placeholder";
    ph.style.width = PAGE_W + "px";
    ph.style.height = PAGE_H + "px";
    ph.dataset.pageIndex = String(i);
    const label = document.createElement("div");
    label.className = "page-placeholder-label";
    label.textContent = `עמוד ${i + 1}`;
    ph.appendChild(label);
    frag.appendChild(ph);
    placeholders.push(ph);
  }
  container.appendChild(frag);
  let observer = null;

  function realize(i) {
    const ph = placeholders[i];
    if (!ph || !ph.parentNode || ph.dataset.realized === "1") return;
    if (observer) observer.unobserve(ph);
    const real = createPageElement(packerOutput[i], paraLastPage, i, streamNumLastPage, paraFirstPage);
    real.dataset.pageIndex = String(i);
    real.dataset.realized = "1";
    if (ph.style.zoom) real.style.zoom = ph.style.zoom;
    ph.parentNode.replaceChild(real, ph);
    placeholders[i] = real;
    if (typeof container.__processRealizedPage === "function") {
      container.__processRealizedPage(real, i);
    }
  }

  realize(0);
  if (placeholders.length > 1) realize(1);

  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = parseInt(entry.target.dataset.pageIndex || "0", 10);
        realize(idx);
        if (idx + 1 < placeholders.length) realize(idx + 1);
      }
    }, { root: container, rootMargin: "900px 0px" });

    for (let i = 2; i < placeholders.length; i++) {
      observer.observe(placeholders[i]);
    }
    container.__pageObserver = observer;
  } else {
    for (let i = 2; i < Math.min(placeholders.length, 5); i++) realize(i);
  }

  container.__getPageElement = (i) => placeholders[i] || null;
  container.__realizePage = realize;
  container.__pageCount = packerOutput.length;
}
