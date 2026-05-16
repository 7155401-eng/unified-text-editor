import { streamColorIndex } from "./schema.js";
import { applyStyleToElement, applyTextStyleObjectToElement } from "../style_registry.js";
import { applyMainTextStyleToElement } from "../document_style_settings.js";
import {
  getEffectiveStreamSettings,
  formatStreamNumber,
  shouldBoldStreamNumber,
  applyBarStyleToElement,
  styleIdForStreamNumber,
  boldOverrideStyleIdForStream,
  _streamBoolSetting,
} from "../original_stream_columns.js";
import { resolveTextStyle, normalizeTextStyle } from "../style_registry.js";
import { appendTextWithRuns, applyMarksToSpan } from "./runs_dom.js";
import { buildNoteContentNodes } from "./note_content_builder.js";

// משה 2026-05-15: מנגנון יחיד לבניית תוכן ההערה — buildNoteContentNodes
// ב-note_content_builder.js. הפונקציה הזו ממירה את ה-nodes ל-DOM (עם
// classes כמו .note-number / .note-lemma / .note-child) — V9 משטח את אותם
// nodes לטקסט+runs. החלטות עיצוב (מספור, הבלטה, סוגרי גוף) ממקום יחיד.
function appendNoteNodesToDom(parent, nodes, streamColorIndexFn) {
  for (const n of nodes) {
    if (n.kind === "space") {
      parent.appendChild(document.createTextNode(" "));
      continue;
    }
    if (n.kind === "number") {
      // משה 2026-05-15: אם נבחר סגנון מותאם (n.styleId), עוטפים תמיד ב-span/strong
      // עם applyStyleToElement כדי שהצבע/פונט יחולו, גם כשהמשתמש לא ביקש בולד.
      // boldOverrideMarks: סגנון פר-זרם שמחליף font-weight:700 — כשהוא קיים,
      // המספר נכנס ל-span עם המארקים האלה (לא ב-<strong>).
      if (n.bold || n.styleId || n.boldOverrideMarks) {
        const el = document.createElement(n.bold ? "strong" : "span");
        el.className = "note-number";
        el.textContent = n.text;
        if (n.styleId) applyStyleToElement(el, n.styleId);
        if (n.boldOverrideMarks) applyMarksToSpan(el, n.boldOverrideMarks);
        parent.appendChild(el);
      } else {
        parent.appendChild(document.createTextNode(n.text));
      }
      continue;
    }
    if (n.kind === "prefix" || n.kind === "suffix") {
      parent.appendChild(document.createTextNode(n.text));
      continue;
    }
    if (n.kind === "lemma" || n.kind === "body") {
      if (n.bold) {
        const lemma = document.createElement("strong");
        lemma.className = "note-lemma";
        appendTextWithRuns(lemma, n.text, n.runs);
        parent.appendChild(lemma);
      } else if (n.boldOverrideMarks) {
        // משה 2026-05-15: דריסת בולד — דיבור-המתחיל מקבל את הסגנון הנבחר
        // במקום font-weight:700, ועדיין שומר על marks פר-ריצה ב-n.runs.
        const lemma = document.createElement("span");
        lemma.className = "note-lemma";
        applyMarksToSpan(lemma, n.boldOverrideMarks);
        appendTextWithRuns(lemma, n.text, n.runs);
        parent.appendChild(lemma);
      } else {
        appendTextWithRuns(parent, n.text, n.runs);
      }
      continue;
    }
    if (n.kind === "rest" || n.kind === "cont") {
      appendTextWithRuns(parent, n.text, n.runs);
      continue;
    }
    if (n.kind === "child") {
      const wrap = document.createElement("span");
      wrap.className = `note-child note-stream-${streamColorIndexFn(n.stream)}`;
      wrap.dataset.stream = n.stream;
      if (typeof n.num === "number") wrap.dataset.noteNum = String(n.num);
      appendNoteNodesToDom(wrap, n.nodes, streamColorIndexFn);
      parent.appendChild(wrap);
    }
  }
}

function streamTitleForCode(code) {
  const labels = typeof window !== "undefined" ? window.__STREAM_LABELS__ : null;
  return (labels && labels[code]) || code;
}

// Builds a per-paragraph index of all notes across all streams, so
// createMainBlockElement can insert reference numbers (mainRefEnabled) at the
// correct anchor positions within each paragraph's text.
function buildParaNotesIndex(pageData) {
  const index = {};
  const streams = pageData.streams || {};
  for (const code of Object.keys(streams)) {
    const notes = (streams[code].notes || []);
    for (const tup of notes) {
      const paraIdx = tup[0];
      const anchor = typeof tup[2] === "number" ? tup[2] : 0;
      const num = typeof tup[3] === "number" && tup[3] > 0 ? tup[3] : tup[0];
      if (!index[paraIdx]) index[paraIdx] = [];
      index[paraIdx].push({ code, anchor, num });
    }
  }
  for (const key of Object.keys(index)) {
    index[key].sort((a, b) => a.anchor - b.anchor);
  }
  return index;
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

function sliceLocalRuns(runs, start, end) {
  if (!Array.isArray(runs) || start >= end) return [];
  const out = [];
  for (const r of runs) {
    if (!r || r.end <= start || r.start >= end) continue;
    const ls = Math.max(0, r.start - start);
    const le = Math.min(end - start, r.end - start);
    if (ls < le) out.push({ start: ls, end: le, marks: r.marks || {} });
  }
  return out;
}

function mainRefKey(ref) {
  return `${ref.code || ""}:${ref.num || ""}:${ref.anchor || 0}`;
}

function localMainRefPos(ref, segText, segStart, segEnd) {
  const anchor = typeof ref.anchor === "number" ? ref.anchor : 0;
  const textLen = String(segText || "").length;

  // Normal/full-paragraph path: anchors are absolute offsets in the original
  // paragraph, while segStart/segEnd describe the piece shown on this page.
  if (anchor >= segStart && anchor <= segEnd) {
    return Math.max(0, Math.min(textLen, anchor - segStart));
  }

  // dom_packer subtracts `prefix` from note anchors when a paragraph is split
  // across pages. In that case the renderer receives an anchor that is already
  // local to the current segment. The old renderer still treated it as absolute,
  // so refs drifted, disappeared, or collected as a separate line.
  if (segStart > 0 && anchor >= 0 && anchor <= textLen) {
    return anchor;
  }

  return null;
}

function refsForMainSegment(segText, segStart, segEnd, paraRefs, usedRefs = null) {
  const refs = [];
  for (const ref of paraRefs || []) {
    const s = getEffectiveStreamSettings(ref.code);
    if (!_streamBoolSetting(s.mainRefEnabled, false)) continue;
    const localPos = localMainRefPos(ref, segText, segStart, segEnd);
    if (localPos === null) continue;
    const key = mainRefKey(ref);
    if (usedRefs && usedRefs.has(key)) continue;
    refs.push({ ...ref, localPos, key });
  }
  refs.sort((a, b) =>
    (a.localPos - b.localPos) ||
    (String(a.code).localeCompare(String(b.code))) ||
    ((a.num || 0) - (b.num || 0))
  );
  return refs;
}

function appendMainRefElement(parent, ref) {
  const formatted = formatStreamNumber(ref.code, ref.num, "main");
  if (!formatted) return false;
  const rawBold = shouldBoldStreamNumber(ref.code, "main");
  // משה 2026-05-15: דריסת בולד פר-זרם — אם מסומן, ה-[N] בראשי מקבל את
  // הסגנון הנבחר במקום font-weight:700 (אותו מנגנון כמו בהערה).
  const overrideStyleId = rawBold ? boldOverrideStyleIdForStream(ref.code) : "";
  const useStrong = rawBold && !overrideStyleId;
  const el = document.createElement(useStrong ? "strong" : "span");
  el.className = "stream-ref";
  el.textContent = formatted;
  el.setAttribute("dir", "ltr");
  if (overrideStyleId) applyStyleToElement(el, overrideStyleId);
  // משה 2026-05-15: סגנון נבחר מתוך רשימת סגנונות המסמך עבור "[N]" בראשי.
  const refStyleId = styleIdForStreamNumber(ref.code, "main");
  if (refStyleId) applyStyleToElement(el, refStyleId);
  parent.appendChild(el);
  return true;
}

function appendMainSegmentContent(p, segText, segStart, segEnd, paraRefs, paragraphRuns, usedRefs = null) {
  const text = String(segText || "");
  const slicedRuns = [];
  for (const r of Array.isArray(paragraphRuns) ? paragraphRuns : []) {
    if (r.end <= segStart || r.start >= segEnd) continue;
    slicedRuns.push({
      start: Math.max(0, r.start - segStart),
      end: Math.min(text.length, r.end - segStart),
      marks: r.marks || {},
    });
  }

  const segRefs = refsForMainSegment(text, segStart, segEnd, paraRefs, usedRefs);
  if (segRefs.length === 0) {
    appendTextWithRuns(p, text, slicedRuns);
    return;
  }

  let lastPos = 0;
  for (const ref of segRefs) {
    const localPos = Math.max(0, Math.min(text.length, ref.localPos));
    if (localPos > lastPos) {
      const sliceText = text.substring(lastPos, localPos);
      appendTextWithRuns(p, sliceText, sliceLocalRuns(slicedRuns, lastPos, localPos));
    }
    if (appendMainRefElement(p, ref) && usedRefs) {
      usedRefs.add(ref.key);
    }
    lastPos = Math.max(lastPos, localPos);
  }
  if (lastPos < text.length) {
    const sliceText = text.substring(lastPos);
    appendTextWithRuns(p, sliceText, sliceLocalRuns(slicedRuns, lastPos, text.length));
  }
}

function insertMainSegmentRefs(p, segText, segStart, segEnd, paraRefs, usedRefs = null) {
  appendMainSegmentContent(p, segText, segStart, segEnd, paraRefs, [], usedRefs);
}

function createMainBlockElement(tup, paraRefs = [], usedRefs = null) {
  const meta = (tup && tup[4]) || {};
  if (meta.blockType === "table") {
    const table = document.createElement("table");
    appendTableRows(table, meta.tableRows || []);
    return table;
  }
  const p = document.createElement(mainBlockTagFor(tup));
  const segText = tup[1] || "";
  const segStart = typeof tup[2] === "number" ? tup[2] : 0;
  const segEnd = typeof tup[3] === "number" ? tup[3] : segStart + segText.length;
  const paragraphRuns = Array.isArray(meta.mainRuns) ? meta.mainRuns : [];

  // Render inline styling and main reference markers in a single ordered pass.
  // The old path returned early when `mainRuns` existed, so formatted text
  // silently lost or misplaced its main refs.
  appendMainSegmentContent(p, segText, segStart, segEnd, paraRefs, paragraphRuns, usedRefs);
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
  // משה 2026-05-15: inlineStyle מ-styleMetaForPane (engine_bridge.js) — סגנון
  // שמשתמש החיל בעורך באופן אחיד על כל הזרם (פונט/גודל/צבע). V9 כבר השתמש
  // בו (composeStreamTextStyle); ה-renderer הרגיל פספס אותו ולכן פונט שהוגדר
  // בעורך לא הופיע בפלט אם הזרם לא הוגדר ידנית עם styleId.
  if (settings.inlineStyle && typeof settings.inlineStyle === "object") {
    applyTextStyleObjectToElement(wrap, settings.inlineStyle);
  }
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
  // משה 2026-05-13: שליטת "פס מעל המפרש" — לוגיקה מאוחדת בין V9 לרגיל.
  // לוקח barShow/barPreset/barColor/barThickness מההגדרות.
  applyBarStyleToElement(title, settings);
  wrap.appendChild(title);

  const notes = notesArr;
  // Default = inline (continuous notes); user can toggle off per-stream.
  const notesInline = typeof settings.inline === "boolean" ? settings.inline : true;
  const displayNum = (tup) =>
    typeof tup[3] === "number" && tup[3] > 0 ? tup[3] : tup[0];
  const isCont = (tup) => tup[4] === 1 || tup[4] === true;

  // משה 2026-05-15: מנגנון יחיד — buildNoteContentNodes. ההחלטות (מספור,
  // הבלטה, סוגרים, ילדים מקוננים) ממקום יחיד; כאן רק ממירים ל-DOM.
  function appendNoteContent(parent, tup, leadingSpace) {
    const text = tup[1] || "";
    const runs = Array.isArray(tup[6]) ? tup[6] : [];
    const children = Array.isArray(tup[5]) ? tup[5] : [];
    const nodes = buildNoteContentNodes(streamCode, displayNum(tup), text, runs, {
      isCont: isCont(tup),
      place: "note",
      leadingSpace,
      children,
    });
    appendNoteNodesToDom(parent, nodes, streamColorIndex);
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

  const paraRefsIndex = buildParaNotesIndex(pageData);
  const usedMainRefsByPara = {};
  const usedRefsForPara = (idx) => {
    if (!usedMainRefsByPara[idx]) usedMainRefsByPara[idx] = new Set();
    return usedMainRefsByPara[idx];
  };

  const main = document.createElement("div");
  main.className = "page-main";
  applyMainTextStyleToElement(main);
  let lastIdx = null;
  let lastP = null;
  for (const tup of pageData.main) {
    const idx = tup[0];
    const text = tup[1];
    if (idx === lastIdx && lastP) {
      const segStart = typeof tup[2] === "number" ? tup[2] : 0;
      const segEnd = typeof tup[3] === "number" ? tup[3] : segStart + text.length;
      lastP.appendChild(document.createTextNode(" "));
      insertMainSegmentRefs(lastP, text, segStart, segEnd, paraRefsIndex[idx] || [], usedRefsForPara(idx));
    } else {
      const p = createMainBlockElement(tup, paraRefsIndex[idx] || [], usedRefsForPara(idx));
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
    // משה 2026-05-14: פס בין הראשי לכל המפרשים — שליטה גלובלית.
    // קוראים מ-loadGlobalStreamOverrides דרך getEffectiveStreamSettings של זרם
    // הראשון, כי הגלובלים זהים לכולם.
    if (codes.length > 0 && pageHasMain) {
      const firstSettings = getEffectiveStreamSettings(codes[0]);
      if (firstSettings.mainSepShow) {
        const px = Math.max(0, Math.min(6, Number(firstSettings.mainSepThickness) || 1));
        const color = String(firstSettings.mainSepColor || "#888").trim() || "#888";
        if (px > 0) {
          streamsWrap.style.borderTop = `${px}px solid ${color}`;
          streamsWrap.style.paddingTop = "4px";
        }
      }
    }
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

function textContentOfMainSeg(seg) {
  if (!seg) return "";
  return String(seg[1] || "").trim();
}

function noteTupleHasRealContent(tup) {
  if (!tup) return false;
  const text = String(tup[1] || "").trim();
  if (text.length > 0) return true;

  const children = Array.isArray(tup[5]) ? tup[5] : [];
  return children.some((child) => String((child && child.text) || "").trim().length > 0);
}

function pageDataHasRealContent(pageData) {
  if (!pageData) return false;

  if (Array.isArray(pageData.main) && pageData.main.some((seg) => textContentOfMainSeg(seg).length > 0)) {
    return true;
  }

  const streams = pageData.streams || {};
  return Object.keys(streams).some((code) => {
    const notes = streams[code] && streams[code].notes;
    return Array.isArray(notes) && notes.some(noteTupleHasRealContent);
  });
}
export function renderPages(packerOutput, container) {
  packerOutput = (packerOutput || []).filter(pageDataHasRealContent);
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
