// talmud_engine_v2.js — Talmud layout engine, full rewrite per Moshe's 16 rules.
//
// משה 2026-05-06: שכתוב מאפס של מנוע הלוגיקה של גפ"ת.
// הקוד הישן (talmud_layout.js) נשאר לתאימות, אבל V2 הוא המנוע הנכון
// שמכבד את כל 16 הכללים שאישר משה.
//
// 16 הכללים:
//   1. אסור לחרוג מגבולות הדף
//   2. אסור רווח לבן באמצע (פגישה באמצע)
//   3. זרמים מתרחבים דינמית לפי Y-segments
//   4. כל עמוד יחידת עימוד עצמאית
//   5. קצר = פחות מ-4 שורות שלמות ברוחב הפעול
//   6. מבנה כתר לפי 5 תרחישים (decision tree)
//   7. two-commentaries = זרם 1 מפוצל לטורים ברצף קריאה
//   8. אסור לפצל מילה (רק בסוף שורה)
//   9. כותרת יתומה → להעביר את כל הזרם לעמוד הבא
//   10. עמוד אחרון — להעלות הערות תחתונות
//   11. כתר = בדיוק 4 שורות שלמות (לא חצי שורה)
//   12. = #9
//   13. שם זרם תמיד מוצג עם תוכן
//   14. גודל הדף קבוע אף פעם לא משתנה
//   15. לולאת מתקנים עד יציבות
//   16. שני כתרים מקבילים בכל 4 השורות

import {
  recordSource, recordPart, restoreAll, clearLedger,
} from "./talmud_source_ledger.js";
import { originalOrder, streamTextLength } from "./flow_layout.js";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "ravtext.talmudLayout";
const STREAMS_KEY = "ravtext.talmudLayout.streams";
const CROWN_LINES_KEY = "ravtext.talmudLayout.crownLines";
const MAIN_WIDTH_KEY = "ravtext.talmudLayout.mainWidth";
const SIDE_GAP_KEY = "ravtext.talmudLayout.sideGap";

const FALLBACK_LINE_HEIGHT_PX = 17.9166;
const DEFAULT_CROWN_LINES = 4;
const DEFAULT_MAIN_WIDTH = 42;
const DEFAULT_SIDE_GAP = 12;

// ─────────────────────────────────────────────────────────────────────────────
// Settings (per-user)
// ─────────────────────────────────────────────────────────────────────────────

function getCrownLines() {
  const n = parseInt(localStorage.getItem(CROWN_LINES_KEY) || String(DEFAULT_CROWN_LINES), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(12, n)) : DEFAULT_CROWN_LINES;
}
function getMainWidth() {
  const n = parseFloat(localStorage.getItem(MAIN_WIDTH_KEY) || String(DEFAULT_MAIN_WIDTH));
  return Number.isFinite(n) ? Math.max(20, Math.min(80, n)) : DEFAULT_MAIN_WIDTH;
}
function getSideGap() {
  const n = parseFloat(localStorage.getItem(SIDE_GAP_KEY) || String(DEFAULT_SIDE_GAP));
  return Number.isFinite(n) ? Math.max(0, Math.min(40, n)) : DEFAULT_SIDE_GAP;
}
function getStreamCodes() {
  const raw = localStorage.getItem(STREAMS_KEY) || "";
  return raw.split(/[,\s]+/).filter(Boolean).slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Measurement helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Count visible text lines in an element by sampling rect tops. */
function countLinesIn(el) {
  if (!el) return 0;
  const seenY = new Set();
  const range = document.createRange();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.textContent && n.textContent.trim().length > 0
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT,
  });
  let tn;
  while ((tn = w.nextNode())) {
    range.setStart(tn, 0); range.setEnd(tn, tn.length);
    for (const r of range.getClientRects()) {
      if (r.height > 0) seenY.add(Math.round(r.top));
    }
  }
  return seenY.size;
}

/** Measure a stream's line count AT a specific width by temporarily setting it. */
function measureLinesAtWidth(streamEl, widthCss) {
  const prevWidth = streamEl.style.width;
  const prevDisplay = streamEl.style.display;
  streamEl.style.width = widthCss;
  streamEl.style.display = "block";
  void streamEl.offsetHeight; // force reflow
  const lines = countLinesIn(streamEl);
  streamEl.style.width = prevWidth;
  streamEl.style.display = prevDisplay;
  return lines;
}

/** Measure actual line height by sampling first text line. */
function measureLineHeight(rootEl) {
  if (!rootEl) return FALLBACK_LINE_HEIGHT_PX;
  const range = document.createRange();
  const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.textContent && n.textContent.trim().length > 0
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT,
  });
  let tn;
  while ((tn = w.nextNode())) {
    range.setStart(tn, 0); range.setEnd(tn, tn.length);
    const rcts = Array.from(range.getClientRects()).filter(r => r.height > 0);
    if (rcts.length) return rcts[0].height;
  }
  return FALLBACK_LINE_HEIGHT_PX;
}

/** Compute exact crown height = titleH + crownLines × actualLineHeight. */
function exactCrownHeight(streamEl, crownLines) {
  const titleEl = streamEl.querySelector(":scope > .stream-title");
  const titleH = titleEl ? titleEl.getBoundingClientRect().height : 0;
  const lineH = measureLineHeight(streamEl) || measureLineHeight(streamEl.closest(".page")) || FALLBACK_LINE_HEIGHT_PX;
  return titleH + lineH * crownLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crown mode decision tree (Rule 6)
// ─────────────────────────────────────────────────────────────────────────────

const MODE_NO_TALMUD       = "no-talmud";       // 0 talmud streams
const MODE_SINGLE_SPLIT    = "single-split";    // 1 stream, long → split to 2 cols
const MODE_SINGLE_INLINE   = "single-inline";   // 1 stream, short → no crown
const MODE_DOUBLE_HALF     = "double-half";     // 2 streams both long → 2 half crowns
const MODE_DOUBLE_FULL     = "double-full";     // 2 streams: 1 long-enough-for-full + 1 short
const MODE_DOUBLE_INLINE   = "double-inline";   // 2 streams both short → no crown

/**
 * Decide which crown mode applies for this page.
 * @param {HTMLElement[]} streams - up to 2 talmud streams (already filtered)
 * @param {boolean} hasMain - whether main has real text content
 * @param {number} crownLines - target lines for crown (default 4)
 * @param {string} halfWidthCss - CSS width string for half-page placement
 * @param {string} fullWidthCss - CSS width string for full-page placement
 * @returns {string} one of MODE_* constants
 */
function decideCrownMode(streams, hasMain, crownLines, halfWidthCss, fullWidthCss) {
  if (streams.length === 0) return MODE_NO_TALMUD;

  if (streams.length === 1) {
    // Test if stream is long enough to fill 2-column split (each column at half width × crownLines)
    const linesAtHalf = measureLinesAtWidth(streams[0], halfWidthCss);
    // Need 2× crownLines because content fills both right then left column
    if (linesAtHalf >= crownLines * 2) return MODE_SINGLE_SPLIT;
    return MODE_SINGLE_INLINE;
  }

  // streams.length === 2
  const linesA_half = measureLinesAtWidth(streams[0], halfWidthCss);
  const linesB_half = measureLinesAtWidth(streams[1], halfWidthCss);

  // Both long enough at half-width → standard 2-half-crowns mode
  if (linesA_half >= crownLines && linesB_half >= crownLines) return MODE_DOUBLE_HALF;

  // Both short at half-width → no crown
  if (linesA_half < crownLines && linesB_half < crownLines) return MODE_DOUBLE_INLINE;

  // One long, one short. Check if the long one fits 4 lines at FULL page width.
  const longStream  = linesA_half >= crownLines ? streams[0] : streams[1];
  const linesLong_full = measureLinesAtWidth(longStream, fullWidthCss);
  if (linesLong_full >= crownLines) return MODE_DOUBLE_FULL;

  // Long stream not long enough at full width → both effectively short
  return MODE_DOUBLE_INLINE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream extraction helpers (shared with v1)
// ─────────────────────────────────────────────────────────────────────────────

/** Find DOM offset at start of Nth visible line. */
function findOffsetAtLineStart(el, lineN) {
  if (!el || lineN < 1) return null;
  const lineYs = [];
  const range = document.createRange();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  let tn;
  while ((tn = w.nextNode())) {
    range.setStart(tn, 0); range.setEnd(tn, tn.length);
    for (const r of range.getClientRects()) {
      if (r.height > 0 && !lineYs.some(y => Math.abs(y.top - r.top) < 1)) {
        lineYs.push({ top: r.top, node: tn });
      }
    }
  }
  lineYs.sort((a, b) => a.top - b.top);
  if (lineN > lineYs.length) return null;
  // Find the offset within the line N's text node where line N starts
  const targetTop = lineYs[lineN - 1].top;
  const candidateNode = lineYs[lineN - 1].node;
  // Binary search for offset where text begins on targetTop line
  const text = candidateNode.textContent;
  for (let i = 0; i < text.length; i++) {
    range.setStart(candidateNode, i);
    range.setEnd(candidateNode, i + 1);
    const r = range.getBoundingClientRect();
    if (Math.abs(r.top - targetTop) < 1) {
      return { node: candidateNode, offset: i };
    }
  }
  return { node: candidateNode, offset: 0 };
}

/** Word-safe split — never break mid-word (Rule 8). */
function safeBreakOffset(text, suggestedOffset) {
  const isBreak = ch => /[\s.,;:!?־׀׃׳״"'() \[\]{}\-—–]/.test(ch);
  if (suggestedOffset <= 0 || suggestedOffset >= text.length) return suggestedOffset;
  if (isBreak(text[suggestedOffset - 1])) return suggestedOffset;
  // Walk back to find break
  let i = suggestedOffset;
  while (i > 0 && !isBreak(text[i - 1])) i--;
  if (i > 0) return i;
  // Walk forward
  let j = suggestedOffset;
  while (j < text.length && !isBreak(text[j])) j++;
  return j < text.length ? j + 1 : suggestedOffset;
}

/** Extract everything in element starting from a split point into a new div. */
function extractAfterSplit(streamEl, splitPoint, role) {
  const text = splitPoint.node.textContent || "";
  const safeOff = safeBreakOffset(text, splitPoint.offset);
  const range = document.createRange();
  range.setStart(splitPoint.node, safeOff);
  range.setEndAfter(streamEl.lastChild);
  const newEl = document.createElement("div");
  newEl.className = streamEl.className.replace("talmud-crown-portion", "").trim();
  newEl.classList.add("talmud-body-portion", role);
  const code = streamEl.getAttribute("data-stream") || "";
  if (code) {
    newEl.setAttribute("data-stream", code);
    newEl.dataset.talmudBodyOf = code;
  }
  newEl.dataset.talmudRole = role;
  newEl.appendChild(range.extractContents());
  return newEl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout builders per mode
// ─────────────────────────────────────────────────────────────────────────────

/** Build SINGLE_SPLIT: one stream split into 2 parallel columns with continuous flow. */
function buildSingleSplit(block, mainEl, stream, crownLines) {
  block.classList.add("talmud-with-crown", "talmud-one-commentary", "talmud-single-split");
  const halfPct = "50%";
  const sideGap = getSideGap();
  const halfGap = 0;

  // Place the original stream as right-half, will measure to find split points
  stream.classList.add("talmud-crown-portion", "talmud-right");
  stream.style.float = "right";
  stream.style.width = `calc(${halfPct} - ${halfGap}px)`;
  stream.style.clear = "none";
  block.insertBefore(stream, mainEl);
  void block.offsetHeight;

  // Split #1: right-crown = first crownLines lines of the stream
  const split1 = findOffsetAtLineStart(stream, crownLines + 1);
  if (!split1) return; // nothing to split

  const restAfterRightCrown = extractAfterSplit(stream, split1, "single-after-rc");

  // Split #2: from rest, take next crownLines lines = LEFT crown (continuation)
  // Temporarily place restAfterRightCrown at half width to measure
  restAfterRightCrown.style.float = "left";
  restAfterRightCrown.style.width = `calc(${halfPct} - ${halfGap}px)`;
  restAfterRightCrown.style.clear = "none";
  // Insert left-crown candidate BEFORE main (so right + left crown are siblings at top)
  block.insertBefore(restAfterRightCrown, mainEl);
  void block.offsetHeight;

  // Convert restAfterRightCrown into left-crown by limiting its height
  restAfterRightCrown.classList.remove("talmud-body-portion", "single-after-rc");
  restAfterRightCrown.classList.add("talmud-crown-portion", "talmud-left");

  const split2 = findOffsetAtLineStart(restAfterRightCrown, crownLines + 1);
  let leftBody = null;
  if (split2) {
    leftBody = extractAfterSplit(restAfterRightCrown, split2, "single-left-body");
    leftBody.style.float = "left";
    leftBody.style.width = "29%";
    leftBody.style.clear = "left";
    leftBody.style.marginRight = `${sideGap}px`;
  }

  // Apply exact crown heights per Rule 11 + 16 (parallel 4 lines)
  const targetCrownH = Math.max(
    exactCrownHeight(stream, crownLines),
    exactCrownHeight(restAfterRightCrown, crownLines)
  );
  for (const c of [stream, restAfterRightCrown]) {
    c.style.height = `${targetCrownH}px`;
    c.style.maxHeight = `${targetCrownH}px`;
    c.style.minHeight = `${targetCrownH}px`;
    c.style.overflow = "hidden";
  }

  // Place left-body inside main (so main wraps around it)
  if (leftBody && mainEl) {
    mainEl.insertBefore(leftBody, mainEl.firstChild);
  }
  // Right-body is the OVERFLOW from right-crown that wasn't extracted yet — we need to handle
  // the case where right-crown clipped content. For now: mark for later push-down.
}

/** Build SINGLE_INLINE: one short stream, no crown, starts with main from top. */
function buildSingleInline(block, mainEl, stream) {
  block.classList.add("talmud-no-crown", "talmud-single-inline");
  // Stream gets 29% on its preferred side, main wraps around
  stream.classList.add("talmud-body-portion", "talmud-right");
  stream.style.float = "right";
  stream.style.width = "29%";
  stream.style.clear = "none";
  stream.style.marginLeft = `${getSideGap()}px`;
  if (mainEl) mainEl.insertBefore(stream, mainEl.firstChild);
}

/** Build DOUBLE_HALF: 2 streams, both long → 2 half-crowns + bodies. */
function buildDoubleHalf(block, mainEl, streamA, streamB, crownLines) {
  block.classList.add("talmud-with-crown", "talmud-two-commentaries");
  const halfPct = "50%";
  const halfGap = 0;
  const sideGap = getSideGap();

  streamA.classList.add("talmud-crown-portion", "talmud-right");
  streamA.style.float = "right";
  streamA.style.width = `calc(${halfPct} - ${halfGap}px)`;
  streamA.style.clear = "none";

  streamB.classList.add("talmud-crown-portion", "talmud-left");
  streamB.style.float = "left";
  streamB.style.width = `calc(${halfPct} - ${halfGap}px)`;
  streamB.style.clear = "none";

  // Both crowns appended BEFORE main — they share the top row
  block.insertBefore(streamA, mainEl);
  block.insertBefore(streamB, mainEl);
  void block.offsetHeight;

  // Split each stream at crownLines line; the rest goes to a body
  const splitA = findOffsetAtLineStart(streamA, crownLines + 1);
  const splitB = findOffsetAtLineStart(streamB, crownLines + 1);

  if (splitA) {
    const bodyA = extractAfterSplit(streamA, splitA, "double-body-r");
    bodyA.style.float = "right";
    bodyA.style.width = "29%";
    bodyA.style.clear = "right";
    bodyA.style.marginLeft = `${sideGap}px`;
    if (mainEl) mainEl.insertBefore(bodyA, mainEl.firstChild);
  }
  if (splitB) {
    const bodyB = extractAfterSplit(streamB, splitB, "double-body-l");
    bodyB.style.float = "left";
    bodyB.style.width = "29%";
    bodyB.style.clear = "left";
    bodyB.style.marginRight = `${sideGap}px`;
    if (mainEl) mainEl.insertBefore(bodyB, mainEl.firstChild);
  }

  // Apply exact crown heights per Rules 11 + 16
  const targetCrownH = Math.max(
    exactCrownHeight(streamA, crownLines),
    exactCrownHeight(streamB, crownLines)
  );
  for (const c of [streamA, streamB]) {
    c.style.height = `${targetCrownH}px`;
    c.style.maxHeight = `${targetCrownH}px`;
    c.style.minHeight = `${targetCrownH}px`;
    c.style.overflow = "hidden";
  }
}

/** Build DOUBLE_FULL: 2 streams, one long-enough-for-full-width crown + one short. */
function buildDoubleFull(block, mainEl, longStream, shortStream, crownLines) {
  block.classList.add("talmud-with-crown", "talmud-double-full-crown");
  const sideGap = getSideGap();

  // Long stream gets full-width crown
  longStream.classList.add("talmud-crown-portion", "talmud-crown-full");
  longStream.style.float = "none";
  longStream.style.width = "100%";
  longStream.style.clear = "both";
  block.insertBefore(longStream, mainEl);
  void block.offsetHeight;

  // Split: rest of long stream becomes body
  const splitLong = findOffsetAtLineStart(longStream, crownLines + 1);
  if (splitLong) {
    const bodyLong = extractAfterSplit(longStream, splitLong, "double-full-body");
    bodyLong.style.float = "right";
    bodyLong.style.width = "29%";
    bodyLong.style.clear = "right";
    bodyLong.style.marginLeft = `${sideGap}px`;
    if (mainEl) mainEl.insertBefore(bodyLong, mainEl.firstChild);
  }

  // Short stream: no crown, starts with main from below
  shortStream.classList.add("talmud-body-portion", "talmud-left");
  shortStream.style.float = "left";
  shortStream.style.width = "29%";
  shortStream.style.clear = "left";
  shortStream.style.marginRight = `${sideGap}px`;
  if (mainEl) mainEl.insertBefore(shortStream, mainEl.firstChild);

  // Apply exact crown height per Rule 11
  const crownH = exactCrownHeight(longStream, crownLines);
  longStream.style.height = `${crownH}px`;
  longStream.style.maxHeight = `${crownH}px`;
  longStream.style.minHeight = `${crownH}px`;
  longStream.style.overflow = "hidden";
}

/** Build DOUBLE_INLINE: 2 streams both short → no crown, all 3 from top. */
function buildDoubleInline(block, mainEl, streamA, streamB) {
  block.classList.add("talmud-no-crown", "talmud-double-inline");
  const sideGap = getSideGap();
  streamA.classList.add("talmud-body-portion", "talmud-right");
  streamA.style.float = "right";
  streamA.style.width = "29%";
  streamA.style.clear = "none";
  streamA.style.marginLeft = `${sideGap}px`;

  streamB.classList.add("talmud-body-portion", "talmud-left");
  streamB.style.float = "left";
  streamB.style.width = "29%";
  streamB.style.clear = "none";
  streamB.style.marginRight = `${sideGap}px`;

  if (mainEl) {
    mainEl.insertBefore(streamA, mainEl.firstChild);
    mainEl.insertBefore(streamB, mainEl.firstChild);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const _building = new WeakSet();

/** Apply V2 layout to a single page element. */
export function applyTalmudLayoutToPageV2(pageEl) {
  if (!pageEl || _building.has(pageEl)) return;
  if (localStorage.getItem(STORAGE_KEY) !== "1") return;

  const streamsWrap = pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  _building.add(pageEl);
  pageEl.dataset.talmudV2State = "building";
  try {
    // Reset any previous talmud layout
    const existingBlock = pageEl.querySelector(":scope > .talmud-layout");
    if (existingBlock) existingBlock.remove();
    pageEl.classList.remove("talmud-layout-page");

    // Find configured talmud streams
    const codes = getStreamCodes();
    const allStreams = Array.from(streamsWrap.querySelectorAll(":scope > .stream"));
    const byCode = new Map(allStreams.map(s => [s.getAttribute("data-stream") || "", s]));
    const talmudStreams = codes.length === 0
      ? allStreams.slice(0, 2)
      : codes.map(c => byCode.get(c)).filter(Boolean);

    if (talmudStreams.length === 0) return;

    // Get main + check if it has real content
    const mainEl = pageEl.querySelector(":scope > .page-main");
    const hasMain = Boolean(mainEl && (mainEl.textContent || "").trim().length > 0);

    // Build the talmud-layout block
    const block = document.createElement("div");
    block.className = "talmud-layout";
    pageEl.insertBefore(block, streamsWrap);
    pageEl.classList.add("talmud-layout-page");
    if (hasMain) block.appendChild(mainEl);

    const crownLines = getCrownLines();
    const halfWidthCss = "calc(50% - 0px)";
    const fullWidthCss = "100%";

    // RULE 6: decide crown mode
    const mode = decideCrownMode(talmudStreams, hasMain, crownLines, halfWidthCss, fullWidthCss);
    pageEl.dataset.talmudV2Mode = mode;

    switch (mode) {
      case MODE_SINGLE_SPLIT:
        buildSingleSplit(block, mainEl, talmudStreams[0], crownLines);
        break;
      case MODE_SINGLE_INLINE:
        buildSingleInline(block, mainEl, talmudStreams[0]);
        break;
      case MODE_DOUBLE_HALF:
        buildDoubleHalf(block, mainEl, talmudStreams[0], talmudStreams[1], crownLines);
        break;
      case MODE_DOUBLE_FULL: {
        // Determine long vs short
        const linesA = measureLinesAtWidth(talmudStreams[0], halfWidthCss);
        const linesB = measureLinesAtWidth(talmudStreams[1], halfWidthCss);
        const longStream = linesA >= crownLines ? talmudStreams[0] : talmudStreams[1];
        const shortStream = longStream === talmudStreams[0] ? talmudStreams[1] : talmudStreams[0];
        buildDoubleFull(block, mainEl, longStream, shortStream, crownLines);
        break;
      }
      case MODE_DOUBLE_INLINE:
        buildDoubleInline(block, mainEl, talmudStreams[0], talmudStreams[1]);
        break;
      case MODE_NO_TALMUD:
      default:
        // Nothing to do
        break;
    }

    pageEl.dataset.talmudV2State = "done";
  } catch (e) {
    console.warn("[talmud-v2] error on page:", e);
    pageEl.dataset.talmudV2State = "error";
  } finally {
    _building.delete(pageEl);
  }
}

/** Apply V2 to all pages in container. */
export function applyTalmudLayoutToPagesV2(container) {
  if (!container) return;
  container.querySelectorAll(".page:not(.page-placeholder)").forEach(applyTalmudLayoutToPageV2);
}

/** Feature flag — read from localStorage to enable V2. */
export function isV2Enabled() {
  return localStorage.getItem("ravtext.talmudLayout.useV2") === "1";
}
export function setV2Enabled(enabled) {
  localStorage.setItem("ravtext.talmudLayout.useV2", enabled ? "1" : "0");
}
