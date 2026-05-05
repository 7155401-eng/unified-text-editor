// Real-time DOM-measurement page packer with paragraph splitting.
// Mimics word-processor pagination: each page is filled to the bottom margin,
// paragraphs are split at word boundaries when needed, and each note
// is placed on the same page as the spot in the body where it anchors.

import { streamColorIndex } from "./schema.js";
import { applyMishnaWrapToPage, isMishnaWrapEnabled } from "../mishna_wrap_layout.js";
import { applyTalmudLayoutToPage, isTalmudLayoutEnabled } from "../talmud_layout.js";

// Pack to ~15px below the rendered page height to leave a safety buffer for
// sub-pixel rounding / margin-collapse / font-metric drift between the
// measurement DOM and the final rendered page. Without this buffer we get
// frequent 5-15px overflows on dense pages.
export const DOM_PAGE_GEOM = {
  pageWidth: 380, // must match CSS .page width
  pageHeight: 537,
  maxPageHeight: 531,
};

let _measureRoot = null;
let _measureCache = null;
let _pageMeasureCache = null;
let _measureStats = null;
let _activeContentMeta = [];
const MAX_MEASURE_CACHE_ENTRIES = 2500;
const MAX_MEASURE_CACHE_TEXT_LENGTH = 12000;
const MIN_CONTINUED_MAIN_CHARS = 44;
const MIN_CONTINUED_MAIN_WORDS = 4;
const MIN_FORWARD_LAST_LINE_FILL = 0.72;
const MIN_NOTE_SPLIT_LINE_FILL = 0.72;
const MAX_SPLIT_REFINE_STEPS = 32;
const MAX_NOTE_SPLIT_REFINE_STEPS = 14;
const MISHNA_WRAP_HEIGHT_SAFETY = 10;
// במצב תלמוד, התבנית מוסיפה משוקלל גובה לכתר ומבנה (שורות עליונות 50%
// במקום 29%, רווחים נוספים, body+expanded וכד'). מורידים מ-maxPageHeight
// כדי שהמנוע יזרוק פחות תוכן לעמוד הזה ויעבור פחות חריגות בפועל.
// ערך גבוה = יותר עמודים, פחות חריגות, אבל גם יותר רווחים מיותרים.
// 100 = איזון: גבוה מדי = רווחים מיותרים, נמוך מדי = חריגות. ערך זה נבחר
// כפשרה. בעתיד נעבור למדידה דינמית פר-עמוד.
const TALMUD_LAYOUT_HEIGHT_SAFETY = 100;
const MAIN_LINE_PROBE_EXTRA_CHARS = 260;
const LINE_RECT_TOLERANCE = 2;

function cssPxVar(name, fallback) {
  if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getDomPageGeom() {
  const pageWidth = cssPxVar("--ravtext-page-width", DOM_PAGE_GEOM.pageWidth);
  const pageHeight = cssPxVar("--ravtext-page-height", DOM_PAGE_GEOM.pageHeight);
  const safety = cssPxVar("--ravtext-page-pack-safety", 6);
  return {
    pageWidth,
    pageHeight,
    maxPageHeight: Math.max(360, pageHeight - Math.max(0, safety)),
  };
}

function hashAppend(hash, value) {
  const s = String(value ?? "");
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function blockMetaFor(idx) {
  return _activeContentMeta[idx] || {};
}

function mainBlockTagFor(idx) {
  const meta = blockMetaFor(idx);
  if (meta.blockType !== "heading") return "p";
  const level = Math.max(1, Math.min(6, parseInt(meta.headingLevel || 1, 10)));
  return `h${level}`;
}

function streamTitleForCode(code) {
  const labels = typeof window !== "undefined" ? window.__STREAM_LABELS__ : null;
  return (labels && labels[code]) || code;
}

function shouldMeasureMishnaWrap() {
  try {
    return typeof window !== "undefined" && isMishnaWrapEnabled();
  } catch (_err) {
    return false;
  }
}

function shouldMeasureTalmudLayout() {
  try {
    return typeof window !== "undefined" && isTalmudLayoutEnabled();
  } catch (_err) {
    return false;
  }
}

function getMeasureRoot() {
  if (!_measureRoot) {
    _measureRoot = document.createElement("div");
    _measureRoot.id = "__measure_root";
    _measureRoot.style.position = "absolute";
    _measureRoot.style.visibility = "hidden";
    _measureRoot.style.left = "-99999px";
    _measureRoot.style.top = "0";
    _measureRoot.style.width = "1000px";
    _measureRoot.style.contain = "layout style";
    document.body.appendChild(_measureRoot);
  }
  return _measureRoot;
}

function makeMeasureKey(mainSegments, streams) {
  let parts = 0;
  let textLen = 0;
  for (const seg of mainSegments || []) {
    parts++;
    textLen += (seg.text || "").length;
    if (textLen > MAX_MEASURE_CACHE_TEXT_LENGTH) return null;
  }
  const codes = Object.keys(streams || {}).sort();
  for (const code of codes) {
    for (const tup of streams[code] || []) {
      parts++;
      textLen += (tup[1] || "").length;
      if (textLen > MAX_MEASURE_CACHE_TEXT_LENGTH) return null;
    }
  }

  let hash = 2166136261;
  hash = hashAppend(hash, shouldMeasureTalmudLayout() ? "talmud:1" : "talmud:0");
  hash = hashAppend(hash, shouldMeasureMishnaWrap() ? "mishna:1" : "mishna:0");
  for (const seg of mainSegments || []) {
    const text = seg.text || "";
    hash = hashAppend(hash, seg.idx);
    hash = hashAppend(hash, text.length);
    hash = hashAppend(hash, text);
  }
  for (const code of codes) {
    hash = hashAppend(hash, code);
    for (const tup of streams[code] || []) {
      const text = tup[1] || "";
      hash = hashAppend(hash, tup[0]);
      hash = hashAppend(hash, tup[2]);
      hash = hashAppend(hash, tup[3]);
      hash = hashAppend(hash, tup[4]);
      hash = hashAppend(hash, text.length);
      hash = hashAppend(hash, text);
    }
  }
  return `${parts}:${textLen}:${hash.toString(36)}`;
}

// Estimate how many rendered lines a list of notes would occupy in a single
// column. Used to decide whether multi-column should kick in for this page.
// Approximation only: assumes ~52 Hebrew chars fit per line at the current
// stream width, plus 1 line for the title.
function estimateStreamLines(notes, charsPerLine = 52) {
  let lines = 1; // stream title
  for (const tup of notes || []) {
    const text = tup[1] || "";
    const noteLines = Math.max(1, Math.ceil(text.length / charsPerLine));
    lines += noteLines;
  }
  return lines;
}

function buildMeasurePage(mainSegments, streams) {
  const page = document.createElement("div");
  page.className = "page measure-page";
  page.setAttribute("dir", "rtl");
  // Override overflow so scrollHeight reflects natural content height.
  page.style.overflow = "visible";

  const main = document.createElement("div");
  main.className = "page-main";
  let lastIdx = null;
  let lastP = null;
  for (const seg of mainSegments) {
    if (seg.idx === lastIdx && lastP) {
      lastP.textContent += " " + seg.text;
    } else {
      const p = document.createElement(mainBlockTagFor(seg.idx));
      p.textContent = seg.text;
      main.appendChild(p);
      lastP = p;
      lastIdx = seg.idx;
    }
  }
  page.appendChild(main);

  const codes = Object.keys(streams)
    .filter((c) => streams[c].length > 0)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  if (codes.length > 0) {
    const streamsWrap = document.createElement("div");
    streamsWrap.className = "page-streams";
    for (const code of codes) {
      const s = document.createElement("div");
      s.className = `stream stream-color-${streamColorIndex(code)}`;
      s.dataset.stream = code;

      const settings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__ && window.__STREAM_SETTINGS__[code]) || {};
      const userCols = settings.cols || 1;
      const minLines = typeof settings.minLinesForCols === "number" ? settings.minLinesForCols : 3;
      const estLines = estimateStreamLines(streams[code]);
      const cols = estLines >= minLines ? userCols : 1;
      if (cols > 1) {
        s.style.columnCount = cols;
        s.style.columnGap = "8px";
      }
      // Default = center last line (matches CSS default). User can opt out
      // per-stream → fall back to plain right-align (no stretching).
      const lastLineCenter = typeof settings.lastLineCenter === "boolean"
        ? settings.lastLineCenter
        : true;
      s.style.textAlignLast = lastLineCenter ? "center" : "right";

      const title = document.createElement("div");
      title.className = "stream-title";
      title.textContent = streamTitleForCode(code);
      s.appendChild(title);

      // Default = inline (continuous notes); user can toggle off per-stream.
      const notesInline = typeof settings.inline === "boolean" ? settings.inline : true;
      const displayNum = (tup) =>
        typeof tup[3] === "number" && tup[3] > 0 ? tup[3] : tup[0];
      const isCont = (tup) => tup[4] === 1 || tup[4] === true;
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
      }
      if (notesInline) {
        const noteAll = document.createElement("div");
        noteAll.className = "note note-inline";
        streams[code].forEach((tup, i) => appendNoteContent(noteAll, tup, i > 0));
        s.appendChild(noteAll);
      } else {
        for (const tup of streams[code]) {
          const note = document.createElement("div");
          note.className = "note";
          appendNoteContent(note, tup, false);
          s.appendChild(note);
        }
      }
      streamsWrap.appendChild(s);
    }
    page.appendChild(streamsWrap);
  }
  if (shouldMeasureTalmudLayout()) applyTalmudLayoutToPage(page);
  if (shouldMeasureMishnaWrap()) applyMishnaWrapToPage(page);
  return page;
}

function measureHeight(mainSegments, streams, opts = {}) {
  let cacheKey = null;
  if (_measureCache) {
    cacheKey = makeMeasureKey(mainSegments, streams);
    if (!opts.forceRender && cacheKey) {
      const cached = _measureCache.get(cacheKey);
      if (cached !== undefined) {
        if (_measureStats) _measureStats.hits++;
        return cached;
      }
    }
  }
  if (_measureStats) _measureStats.misses++;

  const root = getMeasureRoot();
  root.replaceChildren();
  const dom = buildMeasurePage(mainSegments, streams);
  root.appendChild(dom);
  // Use scrollHeight to capture the FULL natural content height, including
  // any sub-pixel rounding or margin collapse that getBoundingClientRect may
  // truncate when the page has overflow:hidden.
  const height = Math.max(dom.scrollHeight, dom.getBoundingClientRect().height);
  if (
    _measureCache &&
    cacheKey &&
    _measureCache.size < MAX_MEASURE_CACHE_ENTRIES
  ) {
    _measureCache.set(cacheKey, height);
  }
  return height;
}

// Returns the last-line fill ratio (0..1) for the LAST <p> in page-main
// inside the current measure DOM. After calling measureHeight, this reads the
// already-rendered DOM. Used to reject splits whose cur portion would end
// with an awkwardly-short last line (which would stretch ugly when justified).
function lastMainLineFillRatio() {
  const root = _measureRoot;
  if (!root) return 1;
  const main = root.querySelector(".page-main");
  if (!main) return 1;
  const ps = main.querySelectorAll("p");
  if (ps.length === 0) return 1;
  const lastP = ps[ps.length - 1];
  const rects = lastP.getClientRects();
  if (rects.length <= 1) return 1;
  let maxWidth = 0;
  for (const r of rects) if (r.width > maxWidth) maxWidth = r.width;
  if (maxWidth <= 0) return 1;
  const lastRect = rects[rects.length - 1];
  return lastRect.width / maxWidth;
}

function lineFillRatioForElement(el) {
  if (!el) return 1;
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter((r) => r.width > 1 && r.height > 1);
  range.detach();
  if (rects.length <= 1) return 1;
  let maxWidth = 0;
  for (const r of rects) if (r.width > maxWidth) maxWidth = r.width;
  if (maxWidth <= 0) return 1;
  return rects[rects.length - 1].width / maxWidth;
}

function lastStreamLineFillRatio(streamCode = null) {
  const root = _measureRoot;
  if (!root) return 1;
  let scope = root;
  if (streamCode !== null && streamCode !== undefined) {
    const wanted = String(streamCode);
    scope = Array.from(root.querySelectorAll(".stream"))
      .find((stream) => stream.getAttribute("data-stream") === wanted) || root;
  }
  const notes = scope.querySelectorAll(".stream .note-inline, .stream .note, .note-inline, .note");
  if (notes.length === 0) return 1;
  return lineFillRatioForElement(notes[notes.length - 1]);
}

function cloneStreams(streams) {
  const out = {};
  for (const code of Object.keys(streams)) out[code] = streams[code].slice();
  return out;
}

function addNotesToStreams(streams, paraIdx, notes) {
  const out = cloneStreams(streams);
  for (const note of notes) {
    if (!out[note.stream]) out[note.stream] = [];
    const anchor = typeof note.anchor === "number" ? note.anchor : 0;
    const num = typeof note.num === "number" ? note.num : 0;
    const cont = note.isContinuation ? 1 : 0;
    out[note.stream].push([paraIdx, note.text, anchor, num, cont]);
  }
  return out;
}

function adjustToWordBoundary(text, end) {
  if (end <= 0) return 0;
  if (end >= text.length) return text.length;
  // If we're already at whitespace, that's a clean cut.
  if (/\s/.test(text[end])) return end;
  // Otherwise back up to the last whitespace before `end`.
  let i = end;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  // No whitespace found at all → DON'T split mid-word; signal "no valid cut"
  // by returning 0 so callers reject the split.
  return i;
}

function wordCount(text) {
  return (String(text || "").match(/\S+/g) || []).length;
}

function previousWordBoundaryBefore(text, end) {
  let i = Math.max(0, Math.min(end, text.length));
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  while (i > 0 && !/\s/.test(text[i - 1])) i--;
  return i;
}

function nextWordBoundaryAfter(text, start) {
  let i = Math.max(0, Math.min(start, text.length));
  while (i < text.length && /\s/.test(text[i])) i++;
  while (i < text.length && !/\s/.test(text[i])) i++;
  return i;
}

function hasEnoughTextBeforeContinuation(text, end) {
  if (end >= text.length) return true;
  const part = text.substring(0, end).trim();
  return part.length >= MIN_CONTINUED_MAIN_CHARS &&
    wordCount(part) >= MIN_CONTINUED_MAIN_WORDS;
}

function hasAnchoredNoteBefore(notes, prefixOffset, end) {
  const limit = prefixOffset + end;
  return notes.some((n) => typeof n.anchor === "number" && n.anchor < limit);
}

function lastAnchorBefore(notes, end) {
  let anchor = null;
  for (const n of notes || []) {
    if (typeof n.anchor !== "number" || n.anchor >= end) continue;
    if (anchor === null || n.anchor > anchor) anchor = n.anchor;
  }
  return anchor;
}

function firstAnchorAtOrAfter(notes, end) {
  let anchor = null;
  for (const n of notes || []) {
    if (typeof n.anchor !== "number" || n.anchor < end) continue;
    if (anchor === null || n.anchor < anchor) anchor = n.anchor;
  }
  return anchor;
}

function firstTextNode(el) {
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode();
}

function rectForChar(textNode, offset) {
  const len = textNode?.textContent?.length || 0;
  if (!len) return null;
  const starts = [];
  const base = Math.max(0, Math.min(offset, len - 1));
  starts.push(base);
  if (base > 0) starts.push(base - 1);
  if (base + 1 < len) starts.push(base + 1);
  for (const start of starts) {
    const end = Math.min(start + 1, len);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, end);
    const rect = Array.from(range.getClientRects())
      .find((r) => r.width > 0.5 && r.height > 0.5);
    range.detach();
    if (rect) return rect;
  }
  return null;
}

function sameRenderedLine(a, b) {
  if (!a || !b) return true;
  const aMid = (a.top + a.bottom) / 2;
  const bMid = (b.top + b.bottom) / 2;
  return Math.abs(aMid - bMid) <= Math.max(LINE_RECT_TOLERANCE, Math.min(a.height, b.height) / 2);
}

function renderedMainLineEndAfterOffset(prevSegments, prevStreams, paraIdx, text, offset) {
  if (offset >= text.length) return text.length;
  const probeEnd = Math.min(
    text.length,
    Math.max(offset + 1, offset + MAIN_LINE_PROBE_EXTRA_CHARS)
  );
  const probeText = text.substring(0, probeEnd);
  measureHeight(
    prevSegments.concat([{ idx: paraIdx, text: probeText }]),
    prevStreams,
    { forceRender: true }
  );
  const main = _measureRoot?.querySelector(".page-main");
  if (!main) return nextWordBoundaryAfter(text, offset + 1);
  const blocks = main.querySelectorAll("p,h1,h2,h3,h4,h5,h6");
  const block = blocks[blocks.length - 1];
  const textNode = firstTextNode(block);
  if (!textNode) return nextWordBoundaryAfter(text, offset + 1);
  const len = textNode.textContent.length;
  const anchorOffset = Math.max(0, Math.min(offset, len - 1));
  const anchorRect = rectForChar(textNode, anchorOffset);
  if (!anchorRect) return nextWordBoundaryAfter(text, offset + 1);

  let lineEnd = probeEnd;
  for (let pos = anchorOffset + 1; pos < len; pos++) {
    const rect = rectForChar(textNode, pos);
    if (!rect) continue;
    if (!sameRenderedLine(anchorRect, rect)) {
      lineEnd = pos;
      break;
    }
  }

  const clean = adjustToWordBoundary(text, lineEnd);
  if (clean > offset) return clean;
  return nextWordBoundaryAfter(text, offset + 1);
}

function clampPrefixToSatisfiedAnchorLine(prevSegments, prevStreams, paraIdx, text, notes, end) {
  if (end <= 0 || end >= text.length) return end;
  const lastSatisfied = lastAnchorBefore(notes, end);
  if (lastSatisfied === null) return end;
  const nextUnsatisfied = firstAnchorAtOrAfter(notes, end);
  if (nextUnsatisfied === null) return end;

  const lineEnd = renderedMainLineEndAfterOffset(
    prevSegments,
    prevStreams,
    paraIdx,
    text,
    lastSatisfied
  );
  if (lineEnd <= 0 || lineEnd >= end) return end;
  return Math.max(lineEnd, nextWordBoundaryAfter(text, lastSatisfied + 1));
}

function clampPrefixToFirstAnchorLine(prevSegments, prevStreams, paraIdx, text, notes, end) {
  if (end <= 0 || !notes?.length) return end;
  let first = null;
  for (const note of notes) {
    if (typeof note.anchor !== "number") continue;
    if (first === null || note.anchor < first) first = note.anchor;
  }
  if (first === null || first >= end) return end;
  const lineEnd = renderedMainLineEndAfterOffset(prevSegments, prevStreams, paraIdx, text, first);
  if (lineEnd <= 0 || lineEnd >= end) return end;
  return Math.max(lineEnd, nextWordBoundaryAfter(text, first + 1));
}

function refineFittingPrefix(prevSegments, prevStreams, paraIdx, text, notes, prefixOffset, maxHeight, maxChars, opts = {}) {
  if (!opts.avoidAwkwardBreaks || maxChars <= 0 || maxChars >= text.length) {
    return maxChars;
  }

  let end = adjustToWordBoundary(text, maxChars);
  if (end <= 0) end = Math.min(maxChars, text.length);

  let steps = 0;
  while (end > 0 && steps++ < MAX_SPLIT_REFINE_STEPS) {
    const tryText = text.substring(0, end).trimEnd();
    if (!tryText) return 0;
    const shortAnchoredPrefix =
      opts.allowShortAnchoredPrefix && hasAnchoredNoteBefore(notes, prefixOffset, end);
    if (shortAnchoredPrefix || opts.allowShortMainPrefix || hasEnoughTextBeforeContinuation(text, end)) {
      const tryNotes = notes.filter((n) => n.anchor < prefixOffset + end);
      const tryAll = prevSegments.concat([{ idx: paraIdx, text: tryText }]);
      const tryStreams = addNotesToStreams(prevStreams, paraIdx, tryNotes);
      const h = measureHeight(tryAll, tryStreams);
      if (h <= maxHeight && lastMainLineFillRatio() >= MIN_FORWARD_LAST_LINE_FILL) {
        return end;
      }
    }
    end = previousWordBoundaryBefore(text, end - 1);
  }

  return 0;
}

function findMaxFittingPrefix(prevSegments, prevStreams, paraIdx, text, notes, prefixOffset, maxHeight, opts = {}) {
  // Binary search for max char count of `text` that fits along with prevSegments.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const tryText = text.substring(0, mid);
    const tryNotes = notes.filter((n) => n.anchor < prefixOffset + mid);
    const tryAll = prevSegments.concat([{ idx: paraIdx, text: tryText }]);
    const tryStreams = addNotesToStreams(prevStreams, paraIdx, tryNotes);
    const h = measureHeight(tryAll, tryStreams);
    if (h <= maxHeight) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return refineFittingPrefix(
    prevSegments,
    prevStreams,
    paraIdx,
    text,
    notes,
    prefixOffset,
    maxHeight,
    lo,
    opts
  );
}

function refineNoteSplitPrefix(mainSegments, baseStreams, paraIdx, note, maxHeight, maxChars) {
  if (maxChars <= 0 || maxChars >= note.text.length) return maxChars;
  let end = adjustToWordBoundary(note.text, maxChars);
  if (end <= 0) return 0;

  let steps = 0;
  while (end > 0 && steps++ < MAX_NOTE_SPLIT_REFINE_STEPS) {
    const prefixText = note.text.substring(0, end).trimEnd();
    const suffixText = note.text.substring(end).trimStart();
    if (!prefixText || !suffixText) return 0;

    const tryNote = {
      ...note,
      text: prefixText,
    };
    const tryStreams = addNotesToStreams(baseStreams, paraIdx, [tryNote]);
    const h = measureHeight(mainSegments, tryStreams, { forceRender: true });
    if (h <= maxHeight && lastStreamLineFillRatio(note.stream) >= MIN_NOTE_SPLIT_LINE_FILL) {
      return end;
    }
    end = previousWordBoundaryBefore(note.text, end - 1);
  }
  return 0;
}

// Helper used by domPack(): take an array of notes belonging to paragraph idx
// and split them across one or more notes-only pages. The current page state
// (pageMain/pageStreams/pageHeight) of the caller is reset by this function
// via finalizePage; on return, pageStreams holds whatever notes still fit on
// the new (possibly partially-filled) current page so that the caller's outer
// loop can continue placing later content on it.
//
// Implemented as a closure inside domPack since it needs access to those
// variables. See domPack body.

function buildPageObject(mainSegments, streamsMap, totalH) {
  const streams = {};
  for (const code of Object.keys(streamsMap)) {
    streams[code] = { h: 0, notes: streamsMap[code].slice() };
  }
  return {
    main: mainSegments.map((s) => [
      s.idx,
      s.text,
      typeof s.start === "number" ? s.start : 0,
      typeof s.end === "number" ? s.end : (s.text || "").length,
      blockMetaFor(s.idx),
    ]),
    streams,
    main_h: 0,
    total: totalH,
  };
}

/**
 * Pack content into pages by real DOM measurement, splitting paragraphs at word
 * boundaries when needed so every page is filled.
 *
 * @param {Array<{mainText: string, notes: Array<{stream:string, text:string, anchor:number}>}>} content
 * @param {Object} [geom] — { pageWidth, maxPageHeight }
 * @returns {Array<Object>} pages
 */
function forwardPack(content, geom = DOM_PAGE_GEOM) {
  const packGeom = shouldMeasureTalmudLayout()
    ? { ...geom, maxPageHeight: Math.max(360, geom.maxPageHeight - TALMUD_LAYOUT_HEIGHT_SAFETY) }
    : geom;
  geom = packGeom;
  const pages = [];
  let pageMain = []; // [{idx, text}]
  let pageStreams = {}; // code: [[idx, text]]
  let pageHeight = 0;
  const LONG_NOTE_CHUNK_CHARS = 900;
  const longNoteSplitCache = new Map();

  function finalizePage() {
    const hasMain = pageMain.length > 0;
    const hasStreams = Object.values(pageStreams).some((arr) => arr.length > 0);
    if (!hasMain && !hasStreams) return;
    pages.push(buildPageObject(pageMain, pageStreams, pageHeight));
    pageMain = [];
    pageStreams = {};
    pageHeight = 0;
  }

  // Find max number of CHARS of a single note's text that fit on a fresh page.
  function fitNoteCharPrefix(stream, anchor, text, maxHeight) {
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const tryNote = { stream, anchor, text: text.substring(0, mid) };
      const ts = addNotesToStreams({}, 0, [tryNote]);
      const h = measureHeight([], ts);
      if (h <= maxHeight) lo = mid;
      else hi = mid - 1;
    }
    return refineNoteSplitPrefix([], {}, 0, { stream, anchor, text }, maxHeight, lo);
  }

  // Split a note's text at a word boundary so it can flow across pages.
  // Returns [part1, part2] where part1 is what fits and part2 is the rest.
  // Adds "…" markers to indicate continuation.
  function splitNote(note, maxHeight) {
    const charsThatFit = fitNoteCharPrefix(note.stream, note.anchor, note.text, maxHeight);
    if (charsThatFit <= 0) {
      // Can't fit even a single char — force the whole note (overflow).
      return [note, null];
    }
    const wordEnd = adjustToWordBoundary(note.text, charsThatFit);
    if (wordEnd <= 0) return [note, null];
    if (wordEnd >= note.text.length) return [note, null];
    const part1 = {
      stream: note.stream,
      anchor: note.anchor,
      num: note.num,
      isContinuation: !!note.isContinuation,
      text: note.text.substring(0, wordEnd).trimEnd(),
    };
    const part2 = {
      stream: note.stream,
      anchor: note.anchor,
      num: note.num,
      isContinuation: true,
      text: note.text.substring(wordEnd).trimStart(),
    };
    return [part1, part2];
  }

  function preSplitLongNote(note) {
    const text = note.text || "";
    if (text.length <= LONG_NOTE_CHUNK_CHARS) return [note];
    const key = [
      note.stream,
      note.anchor,
      note.num,
      note.isContinuation ? 1 : 0,
      text,
    ].join("\u0001");
    const cached = longNoteSplitCache.get(key);
    if (cached) return cached.map((part) => ({ ...part }));

    const parts = [];
    let remainingNote = { ...note, text, isContinuation: !!note.isContinuation };
    let safety = 80;
    while (remainingNote.text.length > LONG_NOTE_CHUNK_CHARS && safety-- > 0) {
      const fit = fitNoteCharPrefix(
        remainingNote.stream,
        remainingNote.anchor,
        remainingNote.text,
        packGeom.maxPageHeight
      );
      let end = adjustToWordBoundary(remainingNote.text, fit);
      if (end <= 0 || end >= remainingNote.text.length) {
        end = adjustToWordBoundary(remainingNote.text, LONG_NOTE_CHUNK_CHARS);
      }
      if (end <= 0 || end >= remainingNote.text.length) break;
      parts.push({
        ...remainingNote,
        text: remainingNote.text.substring(0, end).trimEnd(),
      });
      remainingNote = {
        ...remainingNote,
        text: remainingNote.text.substring(end).trimStart(),
        isContinuation: true,
      };
    }
    if (remainingNote.text) {
      parts.push(remainingNote);
    }
    longNoteSplitCache.set(key, parts.map((part) => ({ ...part })));
    return parts;
  }

  // Find max chars of a single additional note that fit alongside an
  // existing notes-only page state (notesAlready: array of {stream, anchor, text}).
  function fitNoteCharPrefixAlongside(
    notesAlready,
    paraIdx,
    candidate,
    maxHeight,
    mainSegments = [],
    baseStreams = null
  ) {
    const existingStreams = baseStreams || addNotesToStreams({}, paraIdx, notesAlready);
    let lo = 0;
    let hi = candidate.text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const tryNote = {
        stream: candidate.stream,
        anchor: candidate.anchor,
        text: candidate.text.substring(0, mid),
      };
      const ts = addNotesToStreams(existingStreams, paraIdx, [tryNote]);
      const h = measureHeight(mainSegments, ts);
      if (h <= maxHeight) lo = mid;
      else hi = mid - 1;
    }
    return refineNoteSplitPrefix(
      mainSegments,
      existingStreams,
      paraIdx,
      candidate,
      maxHeight,
      lo
    );
  }

  // Distribute a list of notes (all from paragraph paraIdx) across one or more
  // notes-only pages. After this returns, the current page may still hold the
  // last batch of notes that fit, so the caller can keep packing more content
  // onto it. Always finalizes when the batch overflows to a new page.
  // Notes that are too tall to fit (alone OR as the next item that doesn't
  // fit alongside what's already on the page) get split at word boundaries.
  function distributeNotesAcrossPages(paraIdx, notes, geomLocal) {
    let toPlace = notes.flatMap(preSplitLongNote);
    while (toPlace.length > 0) {
      let lo = 0;
      let hi = toPlace.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const ts = addNotesToStreams({}, paraIdx, toPlace.slice(0, mid));
        const h = measureHeight([], ts);
        if (h <= geomLocal.maxPageHeight) lo = mid;
        else hi = mid - 1;
      }

      if (lo === 0) {
        // Even one note alone doesn't fit. Split it.
        const [part1, part2] = splitNote(toPlace[0], geomLocal.maxPageHeight);
        pageStreams = addNotesToStreams({}, paraIdx, [part1]);
        pageHeight = measureHeight([], pageStreams);
        if (part2) {
          toPlace = [part2, ...toPlace.slice(1)];
          finalizePage();
        } else {
          toPlace = toPlace.slice(1);
          if (toPlace.length > 0) finalizePage();
        }
        continue;
      }

      // We can fit `lo` notes whole. Before finalizing, try to split the
      // (lo+1)th note so its prefix fills the remaining space on this page.
      const placed = toPlace.slice(0, lo);
      if (lo < toPlace.length) {
        const next = toPlace[lo];
        const fitChars = fitNoteCharPrefixAlongside(
          placed,
          paraIdx,
          next,
          geomLocal.maxPageHeight
        );
        if (fitChars > 0) {
          const wordEnd = adjustToWordBoundary(next.text, fitChars);
          if (wordEnd > 0 && wordEnd < next.text.length) {
            const part1 = {
              stream: next.stream,
              anchor: next.anchor,
              num: next.num,
              isContinuation: !!next.isContinuation,
              text: next.text.substring(0, wordEnd).trimEnd(),
            };
            const part2 = {
              stream: next.stream,
              anchor: next.anchor,
              num: next.num,
              isContinuation: true,
              text: next.text.substring(wordEnd).trimStart(),
            };
            pageStreams = addNotesToStreams({}, paraIdx, placed.concat([part1]));
            pageHeight = measureHeight([], pageStreams);
            toPlace = [part2, ...toPlace.slice(lo + 1)];
            finalizePage();
            continue;
          }
        }
      }

      pageStreams = addNotesToStreams({}, paraIdx, placed);
      pageHeight = measureHeight([], pageStreams);
      toPlace = toPlace.slice(lo);
      if (toPlace.length > 0) finalizePage();
    }
  }

  for (let i = 0; i < content.length; i++) {
    const para = content[i];
    let prefix = 0;

    while (true) {
      const remaining = para.mainText.substring(prefix);
      const remainingNotes = para.notes
        .filter((n) => n.anchor >= prefix)
        .map((n) => ({ ...n, anchor: n.anchor - prefix }))
        .flatMap(preSplitLongNote);

      if (remaining.length === 0 && remainingNotes.length === 0) break;

      // Try fitting all remaining content of this paragraph onto current page.
      const remainingSeg = {
        idx: i,
        text: remaining,
        start: prefix,
        end: para.mainText.length,
      };
      const tryAll = pageMain.concat([remainingSeg]);
      const tryStreams = addNotesToStreams(pageStreams, i, remainingNotes);
      const fullH = measureHeight(tryAll, tryStreams);

      if (fullH <= packGeom.maxPageHeight) {
        pageMain = tryAll;
        pageStreams = tryStreams;
        pageHeight = fullH;
        break; // done with paragraph
      }

      // Doesn't fit. Find the maximum char prefix that fits.
      const fitChars = findMaxFittingPrefix(
        pageMain,
        pageStreams,
        i,
        remaining,
        remainingNotes,
        0,
        geom.maxPageHeight,
        { avoidAwkwardBreaks: true, allowShortAnchoredPrefix: true }
      );

      if (fitChars === 0) {
        // Nothing fits with its anchored notes attached. Two sub-cases:
        // (A) There's main text remaining → commit main-only, defer notes.
        // (B) No main text remaining (notes-only situation) → distribute notes.
        if (remaining.length > 0) {
          const fitMainOnly = findMaxFittingPrefix(
            pageMain,
            pageStreams,
            i,
            remaining,
            [],
            0,
            geom.maxPageHeight,
            { avoidAwkwardBreaks: true, allowShortMainPrefix: remainingNotes.length > 0 }
          );

          if (fitMainOnly > 0) {
            const cleanEnd2 = adjustToWordBoundary(remaining, fitMainOnly);
            let wordEnd2 = cleanEnd2 > 0 ? cleanEnd2 : Math.min(fitMainOnly, remaining.length);
            wordEnd2 = clampPrefixToFirstAnchorLine(
              pageMain,
              pageStreams,
              i,
              remaining,
              remainingNotes,
              wordEnd2
            );
            const fitText2 = remaining.substring(0, wordEnd2).trimEnd();
            const candidates = remainingNotes.filter((n) => n.anchor < wordEnd2);

            if (fitText2.length > 0) {
              pageMain.push({
                idx: i,
                text: fitText2,
                start: prefix,
                end: prefix + wordEnd2,
              });
            }
            pageHeight = measureHeight(pageMain, pageStreams);

            // Try each anchored note individually: if it fits alongside
            // current page state, place it; otherwise try to SPLIT it and
            // place a prefix here, rest deferred. Notes that can't even be
            // split are deferred whole.
            const skipped = [];
            for (const note of candidates) {
              const tryStreams = addNotesToStreams(pageStreams, i, [note]);
              const h = measureHeight(pageMain, tryStreams);
              if (h <= geom.maxPageHeight) {
                pageStreams = tryStreams;
                pageHeight = h;
                continue;
              }
              // Try splitting this note to fit a prefix.
              const fitC = fitNoteCharPrefixAlongside(
                [],
                i,
                note,
                geom.maxPageHeight,
                pageMain,
                pageStreams
              );
              if (fitC > 0) {
                const splitEnd = adjustToWordBoundary(note.text, fitC);
                if (splitEnd > 0 && splitEnd < note.text.length) {
                  const part1 = {
                    stream: note.stream,
                    anchor: note.anchor,
                    num: note.num,
                    isContinuation: !!note.isContinuation,
                    text: note.text.substring(0, splitEnd).trimEnd(),
                  };
                  const part2 = {
                    stream: note.stream,
                    anchor: note.anchor,
                    num: note.num,
                    isContinuation: true,
                    text: note.text.substring(splitEnd).trimStart(),
                  };
                  const tryStreams2 = addNotesToStreams(pageStreams, i, [part1]);
                  const h2 = measureHeight(pageMain, tryStreams2);
                  if (h2 <= geom.maxPageHeight) {
                    pageStreams = tryStreams2;
                    pageHeight = h2;
                    skipped.push(part2);
                    continue;
                  }
                }
              }
              skipped.push(note);
            }

            finalizePage();
            distributeNotesAcrossPages(i, skipped, geom);

            prefix += wordEnd2;
            while (prefix < para.mainText.length && /\s/.test(para.mainText[prefix])) {
              if (para.notes.some((n) => n.anchor === prefix)) break;
              prefix++;
            }
            continue;
          }

          if (pageMain.length === 0) {
            // No main fits at all on an empty page (single chunk too big).
            // Accept overflow.
            pageMain = tryAll;
            pageStreams = tryStreams;
            pageHeight = fullH;
            finalizePage();
            break;
          }
          finalizePage();
          continue;
        }

        // No main text left, but notes remain. Distribute notes across pages.
        if (pageMain.length > 0 || Object.keys(pageStreams).length > 0) {
          // Try fitting all remaining notes on the current page first
          const tryStreamsOnly = addNotesToStreams(pageStreams, i, remainingNotes);
          const tryH = measureHeight(pageMain, tryStreamsOnly);
          if (tryH <= geom.maxPageHeight) {
            pageStreams = tryStreamsOnly;
            pageHeight = tryH;
            break;
          }
          // Fit some notes on current page, rest on subsequent pages.
          let lo = 0;
          let hi = remainingNotes.length;
          while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            const ts = addNotesToStreams(pageStreams, i, remainingNotes.slice(0, mid));
            const h = measureHeight(pageMain, ts);
            if (h <= geom.maxPageHeight) lo = mid;
            else hi = mid - 1;
          }
          if (lo > 0) {
            pageStreams = addNotesToStreams(pageStreams, i, remainingNotes.slice(0, lo));
            pageHeight = measureHeight(pageMain, pageStreams);
            finalizePage();
            distributeNotesAcrossPages(i, remainingNotes.slice(lo), geom);
            break;
          }
          // Even one note doesn't fit alongside current page content.
          finalizePage();
          distributeNotesAcrossPages(i, remainingNotes, geom);
          break;
        }

        distributeNotesAcrossPages(i, remainingNotes, geom);
        break;
      }

      // fitChars is the most main we can take WITH all of its anchored notes
      // fitting on the same page.
      const cleanEnd = adjustToWordBoundary(remaining, fitChars);
      let wordEnd = cleanEnd > 0 ? cleanEnd : Math.min(fitChars, remaining.length);
      wordEnd = clampPrefixToSatisfiedAnchorLine(
        pageMain,
        pageStreams,
        i,
        remaining,
        remainingNotes,
        wordEnd
      );
      const fitText = remaining.substring(0, wordEnd).trimEnd();
      const fitNotes = remainingNotes.filter((n) => n.anchor < wordEnd);

      if (fitText.length > 0) {
        pageMain.push({
          idx: i,
          text: fitText,
          start: prefix,
          end: prefix + wordEnd,
        });
      }
      pageStreams = addNotesToStreams(pageStreams, i, fitNotes);
      pageHeight = measureHeight(pageMain, pageStreams);

      // Gap-fill: try to bring in the next note (anchored past wordEnd),
      // extending main to its anchor and splitting the note if needed so
      // its prefix fits in the remaining space.
      const room = geom.maxPageHeight - pageHeight;
      if (room > 20 && wordEnd < remaining.length) {
        const sortedFurther = remainingNotes
          .filter((n) => n.anchor >= wordEnd)
          .sort((a, b) => a.anchor - b.anchor);
        if (sortedFurther.length > 0) {
          const next = sortedFurther[0];
          const targetEnd = adjustToWordBoundary(
            remaining,
            Math.min(next.anchor + 1, remaining.length)
          );
          if (targetEnd > wordEnd) {
            const newMain = pageMain.slice();
            // Replace the just-pushed segment with extended text
            if (
              newMain.length > 0 &&
              newMain[newMain.length - 1].idx === i &&
              fitText.length > 0
            ) {
              newMain[newMain.length - 1] = {
                idx: i,
                text: remaining.substring(0, targetEnd).trimEnd(),
                start: prefix,
                end: prefix + targetEnd,
              };
            } else {
              newMain.push({
                idx: i,
                text: remaining.substring(0, targetEnd).trimEnd(),
                start: prefix,
                end: prefix + targetEnd,
              });
            }
            // Try whole next note
            const tryStreams = addNotesToStreams(pageStreams, i, [next]);
            const h = measureHeight(newMain, tryStreams);
            if (h <= geom.maxPageHeight) {
              pageMain = newMain;
              pageStreams = tryStreams;
              pageHeight = h;
              prefix += targetEnd;
              while (
                prefix < para.mainText.length &&
                /\s/.test(para.mainText[prefix])
              ) {
                if (para.notes.some((n) => n.anchor === prefix)) break;
                prefix++;
              }
              if (prefix < para.mainText.length || sortedFurther.length > 1) {
                finalizePage();
              }
              continue;
            }
            // Try splitting next note
            const fitC = fitNoteCharPrefixAlongside(
              [],
              i,
              next,
              geom.maxPageHeight,
              newMain,
              pageStreams
            );
            if (fitC > 0) {
              const splitEnd = adjustToWordBoundary(next.text, fitC);
              if (splitEnd > 0 && splitEnd < next.text.length) {
                const part1 = {
                  stream: next.stream,
                  anchor: next.anchor,
                  num: next.num,
                  isContinuation: !!next.isContinuation,
                  text: next.text.substring(0, splitEnd).trimEnd(),
                };
                const part2 = {
                  stream: next.stream,
                  anchor: next.anchor,
                  num: next.num,
                  isContinuation: true,
                  text: next.text.substring(splitEnd).trimStart(),
                };
                const tryStreams2 = addNotesToStreams(pageStreams, i, [part1]);
                const h2 = measureHeight(newMain, tryStreams2);
                if (h2 <= geom.maxPageHeight) {
                  pageMain = newMain;
                  pageStreams = tryStreams2;
                  pageHeight = h2;
                  finalizePage();
                  // Place part2 (and any remaining notes from this anchor)
                  // on the next page via distribute.
                  distributeNotesAcrossPages(i, [part2], geom);
                  prefix += targetEnd;
                  while (
                    prefix < para.mainText.length &&
                    /\s/.test(para.mainText[prefix])
                  ) {
                    if (para.notes.some((n) => n.anchor === prefix)) break;
                    prefix++;
                  }
                  continue;
                }
              }
            }
          }
        }
      }

      const consumedAllMain = wordEnd >= remaining.length;
      if (!consumedAllMain) {
        finalizePage();
      }

      prefix += wordEnd;
      while (prefix < para.mainText.length && /\s/.test(para.mainText[prefix])) {
        if (para.notes.some((n) => n.anchor === prefix)) break;
        prefix++;
      }
    }
  }

  finalizePage();
  return pages;
}

export async function domPack(content, geom = DOM_PAGE_GEOM, opts = {}) {
  const prevCache = _measureCache;
  const prevPageCache = _pageMeasureCache;
  const prevStats = _measureStats;
  const prevContentMeta = _activeContentMeta;
  const debug = typeof window !== "undefined" && window.__DOM_PACK_DEBUG__;
  _measureCache = new Map();
  _pageMeasureCache = new WeakMap();
  _measureStats = { hits: 0, misses: 0, pageHits: 0 };
  _activeContentMeta = (content || []).map((item) => ({
    blockType: item?.blockType === "heading" ? "heading" : "paragraph",
    headingLevel: item?.blockType === "heading" ? Math.max(1, Math.min(6, parseInt(item.headingLevel || 1, 10))) : null,
  }));
  if (typeof window !== "undefined") window.__MAIN_BLOCK_META__ = _activeContentMeta;
  try {
    const effectiveGeom = shouldMeasureMishnaWrap()
      ? { ...geom, maxPageHeight: Math.max(360, geom.maxPageHeight - MISHNA_WRAP_HEIGHT_SAFETY) }
      : geom;
    const pages = forwardPack(content, effectiveGeom);
    const rebalanceOpts = { ...opts };
    if (typeof rebalanceOpts.maxPasses !== "number") {
      rebalanceOpts.maxPasses = pages.length > 8 ? 1 : 3;
    }
    if (rebalanceOpts.skipCompact === undefined && pages.length > 8) {
      rebalanceOpts.skipCompact = true;
    }
    await rebalancePages(pages, effectiveGeom, rebalanceOpts);
    mergeAdjacentNotesOnlyPages(pages, effectiveGeom);
    if (typeof opts.isCurrent === "function" && !opts.isCurrent()) return pages;
    sortStreamNotes(pages);
    if (debug) {
      console.log(`[domPack] measure cache hits=${_measureStats.hits} pageHits=${_measureStats.pageHits} misses=${_measureStats.misses}`);
    }
    return pages;
  } finally {
    _measureCache = prevCache;
    _pageMeasureCache = prevPageCache;
    _measureStats = prevStats;
    _activeContentMeta = prevContentMeta;
  }
}

// ─── Post-pass: backward rebalance ────────────────────────────────────────
// After the forward packer commits pages, scan adjacent pairs (n, n+1).
// If page n has a sizeable gap below its content, try pulling the FIRST main
// segment (whole or a word-boundary prefix) from page n+1 back onto page n,
// together with any complete (non-split) notes anchored within the moved range.
// Iterate until no pair improves or maxPasses is reached.

function pageDataIsEmpty(p) {
  const hasMain = (p.main || []).length > 0;
  const hasNotes = Object.values(p.streams || {}).some(
    (s) => s && s.notes && s.notes.length > 0
  );
  return !hasMain && !hasNotes;
}

function knownPageHeight(p) {
  return Number.isFinite(p?.total) ? p.total : measurePageData(p);
}

function measurePageData(p, opts = {}) {
  if (!opts.forceRender && _pageMeasureCache && p && typeof p === "object") {
    const sig = pageDataMeasureKey(p);
    const cached = _pageMeasureCache.get(p);
    if (cached && cached.sig === sig) {
      if (_measureStats) _measureStats.pageHits++;
      return cached.height;
    }
    const height = measurePageDataUncached(p, opts);
    _pageMeasureCache.set(p, { sig, height });
    return height;
  }
  return measurePageDataUncached(p, opts);
}

function pageDataMeasureKey(p) {
  let hash = 2166136261;
  let parts = 0;
  let textLen = 0;
  for (const seg of p.main || []) {
    parts++;
    const text = seg[1] || "";
    textLen += text.length;
    hash = hashAppend(hash, seg[0]);
    hash = hashAppend(hash, seg[2]);
    hash = hashAppend(hash, seg[3]);
    hash = hashAppend(hash, text.length);
    hash = hashAppend(hash, text);
  }
  const codes = Object.keys(p.streams || {}).sort();
  for (const code of codes) {
    hash = hashAppend(hash, code);
    const notes = (p.streams[code] && p.streams[code].notes) || [];
    for (const note of notes) {
      parts++;
      const text = note[1] || "";
      textLen += text.length;
      hash = hashAppend(hash, note[0]);
      hash = hashAppend(hash, note[2]);
      hash = hashAppend(hash, note[3]);
      hash = hashAppend(hash, note[4]);
      hash = hashAppend(hash, text.length);
      hash = hashAppend(hash, text);
    }
  }
  return `${parts}:${textLen}:${hash.toString(36)}`;
}

function measurePageDataUncached(p, opts = {}) {
  const mainSegs = (p.main || []).map(([idx, text]) => ({ idx, text }));
  const streamsMap = {};
  for (const code of Object.keys(p.streams || {})) {
    const notes = (p.streams[code] && p.streams[code].notes) || [];
    streamsMap[code] = notes.slice();
  }
  return measureHeight(mainSegs, streamsMap, opts);
}

function hasPageNotes(p) {
  return Object.values(p.streams || {}).some((stream) => (stream?.notes || []).length > 0);
}

function mergeAdjacentNotesOnlyPages(pages, geom) {
  if (!Array.isArray(pages) || pages.length < 2) return;
  let i = 0;
  let safety = pages.length * 2;
  while (i < pages.length - 1 && safety-- > 0) {
    const cur = pages[i];
    const nxt = pages[i + 1];
    if ((cur.main || []).length > 0 || (nxt.main || []).length > 0 || !hasPageNotes(cur) || !hasPageNotes(nxt)) {
      i++;
      continue;
    }

    const trial = clonePageData(cur);
    for (const code of Object.keys(nxt.streams || {})) {
      if (!trial.streams[code]) trial.streams[code] = { h: 0, notes: [] };
      trial.streams[code].notes = trial.streams[code].notes.concat(
        ((nxt.streams[code] && nxt.streams[code].notes) || []).map((note) => note.slice())
      );
    }
    const h = measurePageData(trial);
    if (h <= geom.maxPageHeight) {
      trial.total = h;
      pages[i] = trial;
      pages.splice(i + 1, 1);
      continue;
    }
    i++;
  }
}

function clonePageData(p) {
  const streams = {};
  for (const code of Object.keys(p.streams || {})) {
    streams[code] = {
      ...p.streams[code],
      notes: ((p.streams[code] && p.streams[code].notes) || []).map((n) => n.slice()),
    };
  }
  return {
    ...p,
    main: (p.main || []).map((s) => s.slice()),
    streams,
  };
}

// Find indices of complete (non-continuation) notes in nxt that match a
// given paraIdx and have anchor in [charStart, charEnd).
function findMovableNoteIndices(nxt, paraIdx, charStart, charEnd) {
  const result = {};
  for (const code of Object.keys(nxt.streams || {})) {
    const notes = (nxt.streams[code] && nxt.streams[code].notes) || [];
    for (let i = 0; i < notes.length; i++) {
      const tup = notes[i];
      const pidx = tup[0];
      const text = tup[1];
      const anchor = typeof tup[2] === "number" ? tup[2] : -1;
      if (pidx !== paraIdx) continue;
      if (anchor < charStart || anchor >= charEnd) continue;
      if (!result[code]) result[code] = [];
      result[code].push(i);
    }
  }
  return result;
}

// Same as findMovableNoteIndices but only keep the EARLIEST `keepCount` notes
// (sorted by anchor). Used to pull main with a limited subset of notes when
// the full set is too tall.
function findMovableNoteIndicesLimited(nxt, paraIdx, charStart, charEnd, keepCount) {
  const all = [];
  for (const code of Object.keys(nxt.streams || {})) {
    const notes = (nxt.streams[code] && nxt.streams[code].notes) || [];
    for (let i = 0; i < notes.length; i++) {
      const tup = notes[i];
      const pidx = tup[0];
      const text = tup[1];
      const anchor = typeof tup[2] === "number" ? tup[2] : -1;
      if (pidx !== paraIdx) continue;
      if (anchor < charStart || anchor >= charEnd) continue;
      all.push({ code, i, anchor });
    }
  }
  all.sort((a, b) => a.anchor - b.anchor);
  const kept = all.slice(0, keepCount);
  const result = {};
  for (const { code, i } of kept) {
    if (!result[code]) result[code] = [];
    result[code].push(i);
  }
  return result;
}

// Build trial cur+nxt with a main segment (whole or prefix) moved from nxt to cur,
// along with any movable notes anchored in the moved range. Returns the trials
// or null if the move isn't possible (e.g., empty result).
function buildMoveTrial(cur, nxt, paraIdx, segText, segStart, segEnd, useFullSegment) {
  let movedText, movedEnd, remainingText;
  if (useFullSegment) {
    movedText = segText;
    movedEnd = segEnd;
    remainingText = "";
  } else {
    return null; // caller handles prefix case via buildPrefixTrial
  }

  const trialCur = clonePageData(cur);
  const trialNxt = clonePageData(nxt);

  trialCur.main.push([paraIdx, movedText, segStart, movedEnd]);
  trialNxt.main.shift();

  const movable = findMovableNoteIndices(trialNxt, paraIdx, segStart, movedEnd);
  for (const code of Object.keys(movable)) {
    const notes = trialNxt.streams[code].notes;
    const indices = movable[code].slice().sort((a, b) => a - b);
    const moving = [];
    for (let j = indices.length - 1; j >= 0; j--) {
      moving.unshift(notes[indices[j]]);
      notes.splice(indices[j], 1);
    }
    if (!trialCur.streams[code]) trialCur.streams[code] = { h: 0, notes: [] };
    trialCur.streams[code].notes = trialCur.streams[code].notes.concat(moving);
  }
  for (const code of Object.keys(trialNxt.streams)) {
    if (!trialNxt.streams[code].notes || trialNxt.streams[code].notes.length === 0) {
      delete trialNxt.streams[code];
    }
  }
  return { trialCur, trialNxt };
}

function buildPrefixTrial(cur, nxt, paraIdx, segText, segStart, segEnd, prefixLen, keepCount) {
  const wordEnd = adjustToWordBoundary(segText, prefixLen);
  if (wordEnd <= 0 || wordEnd >= segText.length) return null;
  const movedText = segText.substring(0, wordEnd).trimEnd();
  if (movedText.length === 0) return null;
  const movedEnd = segStart + wordEnd;

  let remainingRaw = segText.substring(wordEnd);
  const trimmedStart = remainingRaw.trimStart();
  const trimmedCount = remainingRaw.length - trimmedStart.length;
  const remainingText = trimmedStart;
  const remainingStart = movedEnd + trimmedCount;

  const trialCur = clonePageData(cur);
  const trialNxt = clonePageData(nxt);

  trialCur.main.push([paraIdx, movedText, segStart, movedEnd]);

  const movable = typeof keepCount === "number"
    ? findMovableNoteIndicesLimited(trialNxt, paraIdx, segStart, movedEnd, keepCount)
    : findMovableNoteIndices(trialNxt, paraIdx, segStart, movedEnd);
  for (const code of Object.keys(movable)) {
    const notes = trialNxt.streams[code].notes;
    const indices = movable[code].slice().sort((a, b) => a - b);
    const moving = [];
    for (let j = indices.length - 1; j >= 0; j--) {
      moving.unshift(notes[indices[j]]);
      notes.splice(indices[j], 1);
    }
    if (!trialCur.streams[code]) trialCur.streams[code] = { h: 0, notes: [] };
    trialCur.streams[code].notes = trialCur.streams[code].notes.concat(moving);
  }
  for (const code of Object.keys(trialNxt.streams)) {
    if (!trialNxt.streams[code].notes || trialNxt.streams[code].notes.length === 0) {
      delete trialNxt.streams[code];
    }
  }

  if (remainingText.length === 0) {
    trialNxt.main.shift();
  } else {
    trialNxt.main[0] = [paraIdx, remainingText, remainingStart, segEnd];
  }
  return { trialCur, trialNxt };
}

function tryPullMainBack(cur, nxt, geom) {
  if (!nxt.main || nxt.main.length === 0) return false;
  const firstSeg = nxt.main[0];
  const paraIdx = firstSeg[0];
  const segText = firstSeg[1];
  const segStart = typeof firstSeg[2] === "number" ? firstSeg[2] : 0;
  const segEnd = typeof firstSeg[3] === "number" ? firstSeg[3] : segText.length;

  // 1) Try whole-segment move WITH anchored notes.
  const wholeTrial = buildMoveTrial(cur, nxt, paraIdx, segText, segStart, segEnd, true);
  if (wholeTrial) {
    const newCurH = measurePageData(wholeTrial.trialCur);
    if (newCurH <= geom.maxPageHeight) {
      cur.main = wholeTrial.trialCur.main;
      cur.streams = wholeTrial.trialCur.streams;
      cur.total = newCurH;
      nxt.main = wholeTrial.trialNxt.main;
      nxt.streams = wholeTrial.trialNxt.streams;
      nxt.total = measurePageData(wholeTrial.trialNxt);
      return true;
    }
  }

  // 2) Binary-search the largest prefix that fits, WITH all anchored notes.
  if (segText.length < 2) return false;
  let best = binarySearchPrefix(cur, nxt, paraIdx, segText, segStart, segEnd, undefined, geom);
  if (best) {
    cur.main = best.trialCur.main;
    cur.streams = best.trialCur.streams;
    cur.total = measurePageData(best.trialCur);
    nxt.main = best.trialNxt.main;
    nxt.streams = best.trialNxt.streams;
    nxt.total = measurePageData(best.trialNxt);
    return true;
  }

  // 3) Fallback: even 1 char of prefix with all anchored notes is too tall.
  // Drop one anchored note at a time (latest-anchor first, so the kept ones
  // stay near the start of the moved range) and retry the binary search.
  let anyMovement = false;
  const allAnchored = findMovableNoteIndices(nxt, paraIdx, segStart, segEnd);
  let totalAnchored = 0;
  for (const code of Object.keys(allAnchored)) totalAnchored += allAnchored[code].length;
  if (totalAnchored > 0) {
    for (let k = totalAnchored - 1; k >= 1; k--) {
      best = binarySearchPrefix(cur, nxt, paraIdx, segText, segStart, segEnd, k, geom);
      if (best) {
        cur.main = best.trialCur.main;
        cur.streams = best.trialCur.streams;
        cur.total = measurePageData(best.trialCur);
        nxt.main = best.trialNxt.main;
        nxt.streams = best.trialNxt.streams;
        nxt.total = measurePageData(best.trialNxt);
        return true;
      }
    }

    // 4) Final fallback: pull main only up to just before the first anchored
    // note (k=0), and additionally split that first anchored note so its
    // prefix fits in the remaining gap on cur.
    const earliest = findEarliestAnchoredNote(nxt, paraIdx, segStart, segEnd);
    if (earliest && earliest.anchor > segStart) {
      const preAnchorPrefix = earliest.anchor - segStart;
      best = binarySearchPrefix(cur, nxt, paraIdx, segText, segStart, segEnd, 0, geom, preAnchorPrefix);
      if (best) {
        cur.main = best.trialCur.main;
        cur.streams = best.trialCur.streams;
        cur.total = measurePageData(best.trialCur);
        nxt.main = best.trialNxt.main;
        nxt.streams = best.trialNxt.streams;
        nxt.total = measurePageData(best.trialNxt);
        trySplitFirstAnchoredNoteOntoCur(cur, nxt, paraIdx, geom);
        anyMovement = true;
      }
    }
  }

  // 5) Last-resort: pull main with NO notes at all (re-fetched first segment
  // since steps 1-4 may have already moved chars). Runs even after step 4
  // succeeded, to keep pulling more main if room remains.
  if (nxt.main && nxt.main.length > 0) {
    const f = nxt.main[0];
    const fpara = f[0];
    const ftext = f[1];
    const fstart = typeof f[2] === "number" ? f[2] : 0;
    const fend = typeof f[3] === "number" ? f[3] : ftext.length;
    if (ftext && ftext.length >= 2) {
      const earliestPlainStop = findEarliestAnchoredNote(nxt, fpara, fstart, fend);
      const plainPrefixLimit = earliestPlainStop
        ? Math.max(0, earliestPlainStop.anchor - fstart)
        : undefined;
      best = plainPrefixLimit === 0
        ? null
        : binarySearchPrefix(cur, nxt, fpara, ftext, fstart, fend, 0, geom, plainPrefixLimit);
      if (best) {
        cur.main = best.trialCur.main;
        cur.streams = best.trialCur.streams;
        cur.total = measurePageData(best.trialCur);
        nxt.main = best.trialNxt.main;
        nxt.streams = best.trialNxt.streams;
        nxt.total = measurePageData(best.trialNxt);
        anyMovement = true;
      }
    }
  }
  return anyMovement;
}

// After backward rebalance converges, run an unconstrained pass on the LAST
// few pairs only, ignoring the gap threshold. If the last page can be
// emptied by cascade-pulling, pop it. Capped so it stays cheap on big docs.
function compactTrailingPages(pages, geom) {
  let changed = false;
  const TAIL_PAIRS = 5;
  let outerSafety = 3;
  while (outerSafety-- > 0 && pages.length >= 2) {
    let movedThisRound = false;
    const startN = Math.max(0, pages.length - 1 - TAIL_PAIRS);
    let passes = 3;
    while (passes-- > 0) {
      let didPass = false;
      for (let n = startN; n < pages.length - 1; n++) {
        const cur = pages[n];
        const nxt = pages[n + 1];
        if (pullAllAnchoredNotes(cur, nxt, geom, pages, n)) didPass = true;
        let safety = 6;
        while (safety-- > 0) {
          if (!tryPushTailToFitAnchoredNote(cur, nxt, geom, pages, n)) break;
          didPass = true;
          pullAllAnchoredNotes(cur, nxt, geom, pages, n);
        }
        if (tryPullMainBack(cur, nxt, geom)) didPass = true;
        if (pullOneAnchoredNote(cur, nxt, geom, pages, n)) didPass = true;
        if (pageDataIsEmpty(nxt)) {
          pages.splice(n + 1, 1);
          n--;
          changed = true;
          didPass = true;
        }
      }
      if (!didPass) break;
      movedThisRound = true;
    }
    if (!movedThisRound) break;
  }
  return changed;
}

function findEarliestAnchoredNote(nxt, paraIdx, segStart, segEnd) {
  let earliest = null;
  for (const code of Object.keys(nxt.streams || {})) {
    const notes = (nxt.streams[code] && nxt.streams[code].notes) || [];
    for (let i = 0; i < notes.length; i++) {
      const tup = notes[i];
      const pidx = tup[0];
      const anchor = typeof tup[2] === "number" ? tup[2] : -1;
      if (pidx !== paraIdx) continue;
      if (anchor < segStart || anchor >= segEnd) continue;
      if (earliest === null || anchor < earliest.anchor) {
        earliest = { code, idx: i, anchor };
      }
    }
  }
  return earliest;
}

// After main has been pulled to cur, try to split the now-first anchored note
// on nxt and place its prefix on cur to absorb whatever gap is left.
function trySplitFirstAnchoredNoteOntoCur(cur, nxt, paraIdx, geom) {
  const curHeight = knownPageHeight(cur);
  if (geom.maxPageHeight - curHeight < 30) return false; // not worth it

  // Look at all streams; find the note whose anchor is the smallest among those
  // anchored within cur's last segment of paraIdx (if any).
  const lastCurSeg = (cur.main || []).slice().reverse().find((s) => s[0] === paraIdx);
  if (!lastCurSeg) return false;
  const curSegStart = typeof lastCurSeg[2] === "number" ? lastCurSeg[2] : 0;
  const curSegEnd = typeof lastCurSeg[3] === "number" ? lastCurSeg[3] : 0;

  const target = findEarliestAnchoredNote(nxt, paraIdx, 0, curSegEnd);
  if (!target) return false;

  const noteList = nxt.streams[target.code].notes;
  const tup = noteList[target.idx];
  const text = tup[1];
  const tupNum = typeof tup[3] === "number" ? tup[3] : 0;
  const tupCont = tup[4] === 1 || tup[4] === true ? 1 : 0;
  if (!text || text.length < 4) return false;

  let lo = 1;
  let hi = text.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const wordEnd = adjustToWordBoundary(text, mid);
    if (wordEnd <= 0 || wordEnd >= text.length) {
      hi = mid - 1;
      continue;
    }
    const prefixText = text.substring(0, wordEnd).trimEnd();
    if (prefixText.length === 0) {
      lo = mid + 1;
      continue;
    }
    const part1 = prefixText;
    const part2 = text.substring(wordEnd).trimStart();

    const trialCur = clonePageData(cur);
    const trialNxt = clonePageData(nxt);
    if (!trialCur.streams[target.code]) trialCur.streams[target.code] = { h: 0, notes: [] };
    trialCur.streams[target.code].notes.push([paraIdx, part1, target.anchor, tupNum, tupCont]);
    trialNxt.streams[target.code].notes[target.idx] = [paraIdx, part2, target.anchor, tupNum, 1];

    const h = measurePageData(trialCur, { forceRender: true });
    if (
      h <= geom.maxPageHeight &&
      lastStreamLineFillRatio(target.code) >= MIN_NOTE_SPLIT_LINE_FILL
    ) {
      best = { trialCur, trialNxt };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) return false;

  cur.main = best.trialCur.main;
  cur.streams = best.trialCur.streams;
  cur.total = measurePageData(best.trialCur);
  nxt.main = best.trialNxt.main;
  nxt.streams = best.trialNxt.streams;
  nxt.total = measurePageData(best.trialNxt);
  return true;
}

// Acceptable last-line fill ratio: the cur's final paragraph (which is a
// continuation, since its tail moved to nxt) should leave a last line that's
// at least this fraction of the widest line. Below this, justifying the line
// would produce ugly stretching.
const MIN_LAST_LINE_FILL = 0.55;

function binarySearchPrefix(cur, nxt, paraIdx, segText, segStart, segEnd, keepCount, geom, maxPrefixLen) {
  let lo = 1;
  let hi = typeof maxPrefixLen === "number"
    ? Math.min(maxPrefixLen, segText.length - 1)
    : segText.length - 1;
  let best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const trial = buildPrefixTrial(cur, nxt, paraIdx, segText, segStart, segEnd, mid, keepCount);
    if (!trial) {
      hi = mid - 1;
      continue;
    }
    const h = measurePageData(trial.trialCur);
    if (h <= geom.maxPageHeight) {
      // Also reject splits that produce an awkwardly short last line on cur,
      // which would stretch unnaturally when justified at the page break.
      const fill = lastMainLineFillRatio();
      if (fill >= MIN_LAST_LINE_FILL) {
        best = trial;
        lo = mid + 1;
      } else {
        // Last line too short — try a smaller prefix to land elsewhere.
        hi = mid - 1;
      }
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

// Check whether paragraph paraIdx's character at `anchor` has been laid out by
// some main segment on pages [0..curIndex]. Used to gate moving a note back to
// page curIndex: anchor must already be on an earlier page (or this one).
function isAnchorSatisfiedByPriorPages(allPages, curIndex, paraIdx, anchor) {
  for (let k = 0; k <= curIndex; k++) {
    const p = allPages[k];
    for (const seg of p.main || []) {
      const segIdx = seg[0];
      const segText = seg[1] || "";
      const segStart = typeof seg[2] === "number" ? seg[2] : 0;
      const segEnd = typeof seg[3] === "number" ? seg[3] : segStart + segText.length;
      if (segIdx === paraIdx && anchor >= segStart && anchor < segEnd) return true;
    }
  }
  return false;
}

// Minimum character count for the leading half of a note split — prevents
// "widow under lemma" where only the lemma + a couple of words sit before
// the page break. Below this we'd rather defer the whole note forward.
const MIN_NOTE_SPLIT_PREFIX = 20;

// Pull a single note from nxt back to cur. Picks the EARLIEST-anchored note
// (across all streams) whose anchor is satisfied by pages [0..curIndex] —
// this is a "type-A" note that semantically belongs to cur but overflowed.
// Tries whole, then split at a word boundary. Returns true if moved.
function pullOneAnchoredNote(cur, nxt, geom, allPages, curIndex) {
  let earliest = null;
  for (const code of Object.keys(nxt.streams || {})) {
    const notes = (nxt.streams[code] && nxt.streams[code].notes) || [];
    for (let i = 0; i < notes.length; i++) {
      const tup = notes[i];
      const paraIdx = tup[0];
      const text = tup[1];
      const anchor = typeof tup[2] === "number" ? tup[2] : -1;
      if (!text) continue;
      if (!isAnchorSatisfiedByPriorPages(allPages, curIndex, paraIdx, anchor)) continue;
      if (earliest === null || anchor < earliest.anchor) {
        const num = typeof tup[3] === "number" ? tup[3] : 0;
        const cont = tup[4] === 1 || tup[4] === true ? 1 : 0;
        earliest = { code, idx: i, paraIdx, text, anchor, num, cont };
      }
    }
  }
  if (!earliest) return false;

  // 1) Try whole-note move.
  {
    const trialCur = clonePageData(cur);
    const trialNxt = clonePageData(nxt);
    if (!trialCur.streams[earliest.code]) trialCur.streams[earliest.code] = { h: 0, notes: [] };
    trialCur.streams[earliest.code].notes.push([earliest.paraIdx, earliest.text, earliest.anchor, earliest.num, earliest.cont]);
    trialNxt.streams[earliest.code].notes.splice(earliest.idx, 1);
    if (trialNxt.streams[earliest.code].notes.length === 0) delete trialNxt.streams[earliest.code];
    const h = measurePageData(trialCur);
    if (h <= geom.maxPageHeight) {
      cur.main = trialCur.main;
      cur.streams = trialCur.streams;
      cur.total = h;
      nxt.main = trialNxt.main;
      nxt.streams = trialNxt.streams;
      nxt.total = measurePageData(trialNxt);
      return true;
    }
  }

  // 2) Try splitting the note: prefix on cur, suffix stays on nxt.
  // Skip if the note is too short to split meaningfully — leaving just the
  // lemma + a couple of words on cur (widow) is worse than leaving the
  // whole note on nxt.
  if (earliest.text.length < MIN_NOTE_SPLIT_PREFIX * 2) return false;
  let lo = MIN_NOTE_SPLIT_PREFIX;
  let hi = earliest.text.length - MIN_NOTE_SPLIT_PREFIX;
  let best = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const wordEnd = adjustToWordBoundary(earliest.text, mid);
    if (wordEnd < MIN_NOTE_SPLIT_PREFIX || wordEnd >= earliest.text.length - MIN_NOTE_SPLIT_PREFIX) {
      hi = mid - 1;
      continue;
    }
    const prefixText = earliest.text.substring(0, wordEnd).trimEnd();
    if (prefixText.length < MIN_NOTE_SPLIT_PREFIX) {
      lo = mid + 1;
      continue;
    }
    const part1 = prefixText;
    const part2 = earliest.text.substring(wordEnd).trimStart();
    const trialCur = clonePageData(cur);
    const trialNxt = clonePageData(nxt);
    if (!trialCur.streams[earliest.code]) trialCur.streams[earliest.code] = { h: 0, notes: [] };
    trialCur.streams[earliest.code].notes.push([earliest.paraIdx, part1, earliest.anchor, earliest.num, earliest.cont]);
    trialNxt.streams[earliest.code].notes[earliest.idx] = [earliest.paraIdx, part2, earliest.anchor, earliest.num, 1];
    const h = measurePageData(trialCur, { forceRender: true });
    if (
      h <= geom.maxPageHeight &&
      lastStreamLineFillRatio(earliest.code) >= MIN_NOTE_SPLIT_LINE_FILL
    ) {
      best = { trialCur, trialNxt };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) return false;
  cur.main = best.trialCur.main;
  cur.streams = best.trialCur.streams;
  cur.total = measurePageData(best.trialCur);
  nxt.main = best.trialNxt.main;
  nxt.streams = best.trialNxt.streams;
  nxt.total = measurePageData(best.trialNxt);
  return true;
}

// Loop pullOneAnchoredNote until no more notes can be pulled.
function pullAllAnchoredNotes(cur, nxt, geom, allPages, curIndex) {
  let anyMoved = false;
  let safety = 200;
  while (safety-- > 0) {
    if (!pullOneAnchoredNote(cur, nxt, geom, allPages, curIndex)) break;
    anyMoved = true;
  }
  return anyMoved;
}

// When a type-A note can't fit on cur, try pushing some of cur's tail main
// FORWARD to nxt to make room. After the push, retry pulling the note.
// Only commit the push if a note was actually pulled — and only if cur stays
// at least as full as it was (no net loss). Returns true if any move happened.
function tryPushTailToFitAnchoredNote(cur, nxt, geom, allPages, curIndex) {
  // Identify the earliest type-A note that didn't fit.
  let target = null;
  for (const code of Object.keys(nxt.streams || {})) {
    const notes = (nxt.streams[code] && nxt.streams[code].notes) || [];
    for (let i = 0; i < notes.length; i++) {
      const tup = notes[i];
      const paraIdx = tup[0];
      const text = tup[1];
      const anchor = typeof tup[2] === "number" ? tup[2] : -1;
      if (!text) continue;
      if (!isAnchorSatisfiedByPriorPages(allPages, curIndex, paraIdx, anchor)) continue;
      if (target === null || anchor < target.anchor) {
        const num = typeof tup[3] === "number" ? tup[3] : 0;
        const cont = tup[4] === 1 || tup[4] === true ? 1 : 0;
        target = { code, idx: i, paraIdx, text, anchor, num, cont };
      }
    }
  }
  if (!target) return false;
  if (!cur.main || cur.main.length === 0) return false;

  const beforeCurH = knownPageHeight(cur);

  // Pick cur's last main segment as the push source.
  const lastIdx = cur.main.length - 1;
  const lastSeg = cur.main[lastIdx];
  const lastParaIdx = lastSeg[0];
  const lastText = lastSeg[1];
  const lastStart = typeof lastSeg[2] === "number" ? lastSeg[2] : 0;
  const lastEnd = typeof lastSeg[3] === "number" ? lastSeg[3] : lastStart + lastText.length;
  if (lastText.length < 2) return false;

  // Binary-search the LARGEST keep-length such that:
  //  - cur with shortened tail + the type-A note (whole or split) ≤ maxH
  //  - nxt with the pushed tail prepended ≤ maxH
  //  - resulting cur height ≥ original cur height (no shrinkage net)
  let lo = 0;
  let hi = lastText.length - 1;
  let best = null;

  function buildTrial(keepLen) {
    const wordKeep = keepLen === 0 ? 0 : adjustToWordBoundary(lastText, keepLen);
    const keptText = wordKeep === 0 ? "" : lastText.substring(0, wordKeep).trimEnd();
    const remainderRaw = lastText.substring(wordKeep);
    const trimmed = remainderRaw.trimStart();
    const remainderText = trimmed;
    const remainderStart = lastStart + wordKeep + (remainderRaw.length - trimmed.length);
    if (remainderText.length === 0 && wordKeep < lastText.length) return null;

    const trialCur = clonePageData(cur);
    if (keptText.length === 0) {
      trialCur.main.splice(lastIdx, 1);
    } else {
      trialCur.main[lastIdx] = [lastParaIdx, keptText, lastStart, lastStart + wordKeep];
    }
    // Move notes anchored in (lastStart+wordKeep .. lastEnd] from cur to nxt
    // to keep anchor ordering valid.
    const trialNxt = clonePageData(nxt);
    let targetIdxAdjusted = target.idx;
    if (remainderText.length > 0) {
      trialNxt.main.unshift([lastParaIdx, remainderText, remainderStart, lastEnd]);
      const noteCutoff = lastStart + wordKeep;
      for (const c of Object.keys(trialCur.streams || {})) {
        const arr = trialCur.streams[c].notes || [];
        const moveIdxs = [];
        for (let j = 0; j < arr.length; j++) {
          const t = arr[j];
          if (t[0] === lastParaIdx && typeof t[2] === "number" && t[2] >= noteCutoff) {
            moveIdxs.push(j);
          }
        }
        if (moveIdxs.length > 0) {
          if (!trialNxt.streams[c]) trialNxt.streams[c] = { h: 0, notes: [] };
          for (let k = moveIdxs.length - 1; k >= 0; k--) {
            const j = moveIdxs[k];
            trialNxt.streams[c].notes.unshift(arr[j]);
            arr.splice(j, 1);
          }
          if (arr.length === 0) delete trialCur.streams[c];
          // unshifting into target.code shifts target's index forward.
          if (c === target.code) targetIdxAdjusted += moveIdxs.length;
        }
      }
    }

    // Now try fitting target note on trialCur (whole, then split).
    if (!trialCur.streams[target.code]) trialCur.streams[target.code] = { h: 0, notes: [] };
    trialCur.streams[target.code].notes.push([target.paraIdx, target.text, target.anchor, target.num, target.cont]);
    let curH = measurePageData(trialCur);
    if (curH > geom.maxPageHeight) {
      // Try split.
      trialCur.streams[target.code].notes.pop();
      if (target.text.length < 4) return null;
      let s_lo = 1, s_hi = target.text.length - 1, s_best = null;
      while (s_lo <= s_hi) {
        const s_mid = Math.floor((s_lo + s_hi) / 2);
        const we = adjustToWordBoundary(target.text, s_mid);
        if (we <= 0 || we >= target.text.length) {
          s_hi = s_mid - 1;
          continue;
        }
        const pt = target.text.substring(0, we).trimEnd();
        if (pt.length === 0) {
          s_lo = s_mid + 1;
          continue;
        }
        const t2 = clonePageData(trialCur);
        t2.streams[target.code].notes.push([target.paraIdx, pt, target.anchor, target.num, target.cont]);
        const h2 = measurePageData(t2, { forceRender: true });
        if (
          h2 <= geom.maxPageHeight &&
          lastStreamLineFillRatio(target.code) >= MIN_NOTE_SPLIT_LINE_FILL
        ) {
          s_best = { tc: t2, we };
          s_lo = s_mid + 1;
        } else {
          s_hi = s_mid - 1;
        }
      }
      if (!s_best) return null;
      // Replace the split target's nxt-side text.
      const part2 = target.text.substring(s_best.we).trimStart();
      trialNxt.streams[target.code].notes[targetIdxAdjusted] = [target.paraIdx, part2, target.anchor, target.num, 1];
      Object.assign(trialCur, s_best.tc);
      curH = measurePageData(trialCur);
    } else {
      // Whole note moved — remove from trialNxt.
      trialNxt.streams[target.code].notes.splice(targetIdxAdjusted, 1);
      if (trialNxt.streams[target.code].notes.length === 0) delete trialNxt.streams[target.code];
    }
    const nxtH = measurePageData(trialNxt);
    if (nxtH > geom.maxPageHeight) return null;
    return { trialCur, trialNxt, curH, nxtH };
  }

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const r = buildTrial(mid);
    if (!r) {
      // Either remainder didn't form, or trial doesn't fit — try smaller keep (more tail pushed).
      hi = mid - 1;
      continue;
    }
    // Need cur's new height ≥ original (no shrinkage).
    if (r.curH < beforeCurH) {
      // Too aggressive — keep more.
      lo = mid + 1;
      continue;
    }
    best = r;
    // Try keeping more (less pushed) for minimal disruption.
    lo = mid + 1;
  }
  if (!best) return false;

  cur.main = best.trialCur.main;
  cur.streams = best.trialCur.streams;
  cur.total = best.curH;
  nxt.main = best.trialNxt.main;
  nxt.streams = best.trialNxt.streams;
  nxt.total = best.nxtH;
  return true;
}

export async function rebalancePages(pages, geom = DOM_PAGE_GEOM, opts = {}) {
  const gapThreshold = typeof opts.gapThreshold === "number" ? opts.gapThreshold : 10;
  const maxPasses = typeof opts.maxPasses === "number" ? opts.maxPasses : 4;
  const isCurrent = typeof opts.isCurrent === "function" ? opts.isCurrent : () => true;
  const debug = typeof window !== "undefined" && (window.__REBAL_DEBUG__ || window.__DOM_PACK_DEBUG__);
  // Track per-page dirty state. A pair (n, n+1) is processed only if either
  // page is dirty since the last visit.
  let dirty = new Array(pages.length).fill(true);
  for (let pass = 0; pass < maxPasses; pass++) {
    if (!isCurrent()) return pages;
    // Yield to the event loop between passes so the UI can repaint and
    // process input events while a long pack is running.
    if (pass > 0) await new Promise((r) => setTimeout(r, 0));
    let changed = false;
    const nextDirty = new Array(pages.length).fill(false);
    for (let n = 0; n < pages.length - 1; n++) {
      if (!dirty[n] && !dirty[n + 1]) continue;
      const cur = pages[n];
      const nxt = pages[n + 1];
      const curH = knownPageHeight(cur);
      const gap = geom.maxPageHeight - curH;
      if (gap < gapThreshold) continue;
      let moved = false;

      // PHASE 0: if cur ends with a SHORT tail paragraph (e.g., a section
      // header) and nxt can absorb it, push it forward — this lets pair (n, n+1)
      // pull MORE from nxt's current first segment afterwards.
      if (tryPushShortTailForward(cur, nxt, geom)) moved = true;

      // PHASE 1: pull every "type-A" note (anchor on cur or earlier) from nxt
      // back to cur. These notes semantically BELONG on cur — they only spilled
      // forward because cur was too full at forward-pack time.
      if (pullAllAnchoredNotes(cur, nxt, geom, pages, n)) moved = true;

      // PHASE 2: if a type-A note still couldn't fit, push some of cur's tail
      // main FORWARD to nxt to make room for the note. Repeat until none fit.
      let safety = 50;
      while (safety-- > 0) {
        if (!tryPushTailToFitAnchoredNote(cur, nxt, geom, pages, n)) break;
        moved = true;
        if (pullAllAnchoredNotes(cur, nxt, geom, pages, n)) {
          // Continue the push-then-pull dance.
        }
      }

      // PHASE 3: if cur still has gap, pull main + anchored-in-moved-range
      // notes from nxt forward to cur (the original behavior).
      const gapAfter12 = geom.maxPageHeight - knownPageHeight(cur);
      if (gapAfter12 >= gapThreshold) {
        if (tryPullMainBack(cur, nxt, geom)) moved = true;
      }

      // PHASE 4: a final note-pull (split if needed) for any residual gap.
      const gapAfter3 = geom.maxPageHeight - knownPageHeight(cur);
      if (gapAfter3 >= gapThreshold) {
        if (pullOneAnchoredNote(cur, nxt, geom, pages, n)) moved = true;
      }

      if (debug) {
        const finalH = knownPageHeight(cur);
        const nxtH = knownPageHeight(nxt);
        console.log(`[rebal] pass=${pass} n=${n} gap=${gap.toFixed(0)}→${(geom.maxPageHeight - finalH).toFixed(0)} moved=${moved} nxtH=${nxtH.toFixed(0)}`);
      }
      if (moved) {
        changed = true;
        nextDirty[n] = true;
        if (n + 1 < nextDirty.length) nextDirty[n + 1] = true;
        if (pageDataIsEmpty(nxt)) {
          pages.splice(n + 1, 1);
          dirty.splice(n + 1, 1);
          nextDirty.splice(n + 1, 1);
          n--;
        }
      }
    }
    if (!changed) break;
    dirty = nextDirty;
  }
  // Final compaction pass: remove the last page if its content can be
  // squeezed back into earlier pages. Large documents skip this by default;
  // the pass is high quality but disproportionately expensive.
  if (!opts.skipCompact) compactTrailingPages(pages, geom);
  sortStreamNotes(pages);
  return pages;
}

// Push a SHORT trailing main paragraph from cur forward to nxt — typical use:
// a section header like "סעיף ה" left at the bottom of cur while its body sits
// on nxt. Moving the header to nxt keeps the section together and frees space
// on cur to absorb earlier content.
function tryPushShortTailForward(cur, nxt, geom) {
  if (!cur.main || cur.main.length < 2) return false;
  const lastIdx = cur.main.length - 1;
  const lastSeg = cur.main[lastIdx];
  const lastText = lastSeg[1] || "";
  const lastParaIdx = lastSeg[0];
  if (lastText.length === 0 || lastText.length > 40) return false;
  const segStart = typeof lastSeg[2] === "number" ? lastSeg[2] : 0;
  const segEnd = typeof lastSeg[3] === "number" ? lastSeg[3] : segStart + lastText.length;

  const trialCur = clonePageData(cur);
  trialCur.main.pop();
  const trialNxt = clonePageData(nxt);
  trialNxt.main.unshift(lastSeg.slice());
  // Move any cur notes anchored within this segment to nxt as well.
  for (const c of Object.keys(trialCur.streams || {})) {
    const arr = trialCur.streams[c].notes || [];
    const moveIdxs = [];
    for (let j = 0; j < arr.length; j++) {
      const t = arr[j];
      if (t[0] === lastParaIdx && typeof t[2] === "number" && t[2] >= segStart && t[2] < segEnd) {
        moveIdxs.push(j);
      }
    }
    if (moveIdxs.length > 0) {
      if (!trialNxt.streams[c]) trialNxt.streams[c] = { h: 0, notes: [] };
      for (let k = moveIdxs.length - 1; k >= 0; k--) {
        const j = moveIdxs[k];
        trialNxt.streams[c].notes.unshift(arr[j]);
        arr.splice(j, 1);
      }
      if (arr.length === 0) delete trialCur.streams[c];
    }
  }
  const nxtH = measurePageData(trialNxt);
  if (nxtH > geom.maxPageHeight) return false;
  cur.main = trialCur.main;
  cur.streams = trialCur.streams;
  cur.total = measurePageData(trialCur);
  nxt.main = trialNxt.main;
  nxt.streams = trialNxt.streams;
  nxt.total = nxtH;
  return true;
}

// Within each page+stream, keep notes ordered by their sequential num so that
// the displayed [N] prefixes increase monotonically on the page. Continuation
// halves (cont=1) sort right after their leading half (same num) so they read
// continuously even though the prefix is hidden.
function sortStreamNotes(pages) {
  for (const p of pages) {
    for (const code of Object.keys(p.streams || {})) {
      const arr = (p.streams[code] && p.streams[code].notes) || [];
      arr.sort((a, b) => {
        const numA = typeof a[3] === "number" ? a[3] : 0;
        const numB = typeof b[3] === "number" ? b[3] : 0;
        if (numA !== numB) return numA - numB;
        const contA = a[4] ? 1 : 0;
        const contB = b[4] ? 1 : 0;
        return contA - contB;
      });
    }
  }
}
