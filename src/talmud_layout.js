// talmud_layout.js — Talmud page layout (v2, CSS-float based)
// Built on the same pattern as mishna_wrap_layout.js + flow_layout.js.
// No pixel measurements, no DOM clones — pure CSS float logic.

const STORAGE_KEY       = "ravtext.talmudLayout";
const STREAMS_KEY       = "ravtext.talmudLayout.streams";
const CROWN_LINES_KEY   = "ravtext.talmudLayout.crownLines";
const MAIN_WIDTH_KEY    = "ravtext.talmudLayout.mainWidth";
const SIDE_MODE_KEY     = "ravtext.talmudLayout.sideMode";
const SIDE_GAP_KEY      = "ravtext.talmudLayout.sideGap";
const DEFAULT_SIDE_GAP  = 12; // px — רווח בין ראשי לפרשנים שבצדדים (ברירת מחדל מקובלת לתלמוד)
// סף לקיום כתר: כל פרשן צריך להכיל לפחות (crownLines + EXTRA) שורות תוכן
// במידה ב-50% רוחב, אחרת אין כתר וכל ה-3 הזרמים מתחילים משורה ראשונה.
const CROWN_EXTRA_LINES = 2;

import {
  originalOrder,
  streamTextLength,
  widthForFlowFloat,
  applyFloatFlowLevel,
} from "./flow_layout.js";

// ─────────────────────────────────────────────
//  Persistence helpers
// ─────────────────────────────────────────────

export function isTalmudLayoutEnabled() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}
export function setTalmudLayoutEnabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

export function getTalmudStreamsText() {
  return localStorage.getItem(STREAMS_KEY) || "";
}
export function setTalmudStreamsText(value) {
  localStorage.setItem(STREAMS_KEY, value || "");
}

export function getTalmudCrownLines() {
  const n = parseInt(localStorage.getItem(CROWN_LINES_KEY) || "4", 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(12, n)) : 4;
}
export function setTalmudCrownLines(value) {
  localStorage.setItem(CROWN_LINES_KEY, String(Math.max(0, Math.min(12, parseInt(value, 10) || 4))));
}

export function getTalmudMainWidth() {
  const n = parseFloat(localStorage.getItem(MAIN_WIDTH_KEY) || "42");
  return Number.isFinite(n) ? Math.max(20, Math.min(80, n)) : 42;
}
export function setTalmudMainWidth(value) {
  localStorage.setItem(MAIN_WIDTH_KEY, String(Math.max(20, Math.min(80, parseFloat(value) || 42))));
}

export function getTalmudSideMode() {
  const v = localStorage.getItem(SIDE_MODE_KEY) || "auto";
  return ["auto", "right-left", "inner-outer"].includes(v) ? v : "auto";
}
export function setTalmudSideMode(value) {
  localStorage.setItem(SIDE_MODE_KEY, value || "auto");
}

export function getTalmudSideGap() {
  const n = parseFloat(localStorage.getItem(SIDE_GAP_KEY) || String(DEFAULT_SIDE_GAP));
  return Number.isFinite(n) ? Math.max(0, Math.min(60, n)) : DEFAULT_SIDE_GAP;
}
export function setTalmudSideGap(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0 || n > 60) {
    localStorage.removeItem(SIDE_GAP_KEY);
    return;
  }
  localStorage.setItem(SIDE_GAP_KEY, String(n));
}

// ─────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────

function normalizeCode(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(n).padStart(2, "0");
}

function parseTalmudStreamCodes() {
  const codes = (getTalmudStreamsText().match(/\d{1,3}/g) || [])
    .map(normalizeCode)
    .filter(Boolean);
  return Array.from(new Set(codes)).slice(0, 2); // max 2 commentaries
}

function codeForStream(el) {
  return el.getAttribute("data-stream") || "";
}

function pageNumberFor(streamsWrap) {
  const pageEl = streamsWrap.closest(".page");
  const idx = parseInt(pageEl?.dataset.pageIndex || "0", 10);
  return Number.isFinite(idx) ? idx + 1 : 1;
}

/** Returns ["right","left"] or ["left","right"] depending on page parity + setting. */
function orderedSides(streamsWrap) {
  const mode = getTalmudSideMode();
  if (mode === "right-left") return ["right", "left"];
  const pageNo = pageNumberFor(streamsWrap);
  if (mode === "inner-outer") {
    // odd page → inner=right, outer=left  |  even page → inner=left, outer=right
    return pageNo % 2 === 1 ? ["right", "left"] : ["left", "right"];
  }
  // "auto" → same as right-left
  return ["right", "left"];
}

// ─────────────────────────────────────────────
//  Reset / unwrap
// ─────────────────────────────────────────────

function resetStream(el) {
  el.classList.remove(
    "talmud-commentary", "talmud-right", "talmud-left",
    "talmud-commentary-float", "talmud-commentary-flow",
    "talmud-crown-portion", "talmud-fits-in-crown"
  );
  el.removeAttribute("data-talmud-role");
  el.style.float = "";
  el.style.width = "";
  el.style.clear = "";
}

function resetMain(mainEl) {
  if (!mainEl) return;
  mainEl.classList.remove("talmud-main");
  mainEl.removeAttribute("data-talmud-role");
  mainEl.style.cssText = "";
}

function unwrapTalmudLayout(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return;

  const streamsWrap = pageEl.querySelector(".page-streams");

  // לפני כל דבר: ממזגים body-portions ו-body-expanded בחזרה לזרם המקורי.
  // קודם expanded (החלק הרחב מתחת לראשי), אחר כך body (החלק הצר ליד הראשי).
  // הסדר חשוב: expanded הוא ההמשך של body, אז קודם נדחוף את expanded לתוך body,
  // ואחר כך body יידחף לתוך הזרם המקורי.
  Array.from(block.querySelectorAll(":scope > .talmud-body-expanded[data-talmud-body-of]")).forEach((expEl) => {
    const code = expEl.dataset.talmudBodyOf;
    const body = block.querySelector(
      `:scope > .talmud-body-portion[data-talmud-body-of="${code}"]:not(.talmud-body-expanded)`
    );
    if (body) {
      while (expEl.firstChild) body.appendChild(expEl.firstChild);
    }
    expEl.remove();
  });
  Array.from(block.querySelectorAll(":scope > .talmud-body-portion[data-talmud-body-of]")).forEach((bodyEl) => {
    const code = bodyEl.dataset.talmudBodyOf;
    const parent = block.querySelector(`:scope > .stream[data-stream="${code}"]:not([data-talmud-body-of])`);
    if (parent) {
      while (bodyEl.firstChild) parent.appendChild(bodyEl.firstChild);
    }
    bodyEl.remove();
  });
  // תרחיש פרשן יחיד שפוצל לשני הצדדים — מאחד את החצי הנגדי בחזרה
  Array.from(block.querySelectorAll(":scope > .talmud-other-side[data-talmud-body-of]")).forEach((otherEl) => {
    const code = otherEl.dataset.talmudBodyOf;
    const parent = block.querySelector(`:scope > .stream[data-stream="${code}"]:not([data-talmud-body-of])`);
    if (parent) {
      while (otherEl.firstChild) parent.appendChild(otherEl.firstChild);
    }
    otherEl.remove();
  });

  // Move .page-main back to page level (before streamsWrap)
  const main = block.querySelector(":scope > .page-main");
  if (main) {
    resetMain(main);
    pageEl.insertBefore(main, streamsWrap);
  }
  // Move streams back into streamsWrap
  Array.from(block.querySelectorAll(":scope > .stream")).forEach((s) => {
    resetStream(s);
    streamsWrap?.appendChild(s);
  });
  block.remove();
}

// ─────────────────────────────────────────────
//  Crown content split (the heart of Talmud crown)
// ─────────────────────────────────────────────

/**
 * מוצא את הנקודה המדויקת בתוך streamEl (כשהוא מוצג בפועל ב-50% רוחב)
 * שבה הטקסט עובר את גובה היעד.  משתמש ב-Range API כדי לחתוך גם באמצע מילה.
 * מחזיר { node, offset } או null אם הכל נכנס.
 *
 * חשוב: streamEl חייב להיות כבר ב-DOM עם רוחב 50% מוגדר.
 */
function findCrownSplitByLineCount(streamEl, targetLines) {
  if (targetLines <= 0) return null;
  const titleEl = streamEl.querySelector(":scope > .stream-title");

  let linesRemaining = targetLines;
  const range = document.createRange();
  const walker = document.createTreeWalker(streamEl, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (titleEl && titleEl.contains(node)) return NodeFilter.FILTER_REJECT;
      return node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  const visualRects = (rangeObj) =>
    Array.from(rangeObj.getClientRects()).filter((r) => r.width > 0 || r.height > 0);

  let textNode;
  while ((textNode = walker.nextNode())) {
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.length);
    const rects = visualRects(range);
    if (rects.length === 0) continue;

    if (rects.length <= linesRemaining) {
      linesRemaining -= rects.length;
      if (linesRemaining === 0) {
        // התמלא בדיוק — חותכים אחרי הצומת הזה
        return { node: textNode, offset: textNode.length };
      }
      continue;
    }

    // צריך לחתוך בתוך הצומת הזה: מחפשים אות שמספר השורות עד אליה > linesRemaining
    let lo = 1, hi = textNode.length, splitOffset = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      range.setStart(textNode, 0);
      range.setEnd(textNode, mid);
      const subRects = visualRects(range);
      if (subRects.length > linesRemaining) {
        splitOffset = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    if (splitOffset > 0) {
      // אחורה לרווח כדי לא לחתוך באמצע מילה
      const text = textNode.textContent;
      let adjusted = splitOffset;
      while (adjusted > 0 && text[adjusted - 1] !== " " && text[adjusted - 1] !== " ") adjusted--;
      if (adjusted === 0) adjusted = splitOffset; // אין רווח — חיתוך באות
      return { node: textNode, offset: adjusted };
    }
  }
  return null;
}

/**
 * חותך את streamEl בנקודה הנתונה: מחלץ את כל מה שמהנקודה ועד הסוף לתוך
 * אלמנט body חדש, ומחזיר את ה-body. ה-streamEl נשאר עם החלק העליון בלבד.
 */
function extractBodyAfterSplit(streamEl, splitPoint, sideClass, side, narrowWidthPct) {
  const range = document.createRange();
  range.setStart(splitPoint.node, splitPoint.offset);
  range.setEndAfter(streamEl.lastChild);
  const fragment = range.extractContents();

  const bodyEl = document.createElement("div");
  bodyEl.className = `stream talmud-commentary talmud-body-portion ${sideClass}`;
  bodyEl.dataset.talmudBodyOf = streamEl.getAttribute("data-stream") || "";
  bodyEl.dataset.talmudRole = "commentary-body";
  bodyEl.appendChild(fragment);

  bodyEl.style.float = side;
  bodyEl.style.width = `${narrowWidthPct}%`;
  bodyEl.style.clear = side;
  return bodyEl;
}

/**
 * בודק האם הפרשן (כשמוצג ב-50% רוחב) ארוך מספיק לכתר אמיתי.
 * הפרשן חייב להיות כבר במסמך עם הרוחב הנכון.
 */
function commentaryFillsCrownPlusExtraLive(streamEl, crownLines) {
  if (crownLines <= 0) return false;
  const titleEl = streamEl.querySelector(":scope > .stream-title");
  const titleH = titleEl ? titleEl.getBoundingClientRect().height : 0;
  const styleObj = getComputedStyle(streamEl);
  const lineH = parseFloat(styleObj.lineHeight) || (parseFloat(styleObj.fontSize) * 1.4) || 14;
  const requiredH = titleH + (crownLines + CROWN_EXTRA_LINES) * lineH;
  const totalH = streamEl.getBoundingClientRect().height;
  return totalH >= requiredH;
}

// ─────────────────────────────────────────────
//  Crown offset: pure CSS var, measured lazily
// ─────────────────────────────────────────────

/**
 * Computes --talmud-crown-offset (px) so the main text starts
 * below the crown lines.  Called after the DOM is painted.
 */
function computeCrownOffset(block) {
  const crownLines = getTalmudCrownLines();
  if (crownLines <= 0) {
    block.style.setProperty("--talmud-crown-offset", "0px");
    return;
  }
  // Use the first commentary stream to measure line-height
  const firstStream = block.querySelector(".stream.talmud-commentary");
  if (!firstStream) {
    block.style.setProperty("--talmud-crown-offset", "0px");
    return;
  }
  const style = getComputedStyle(firstStream);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4 || 14;
  const titleEl = firstStream.querySelector(".stream-title");
  const titleHeight = titleEl ? titleEl.getBoundingClientRect().height : 0;
  const offset = Math.ceil(titleHeight + crownLines * lineHeight);
  block.style.setProperty("--talmud-crown-offset", `${offset}px`);
}

function scheduleCrownOffset(block) {
  // Multiple rAF passes ensure fonts/layout are stable
  computeCrownOffset(block);
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => computeCrownOffset(block));
    requestAnimationFrame(() => requestAnimationFrame(() => computeCrownOffset(block)));
  }
  setTimeout(() => computeCrownOffset(block), 100);
}

// ─────────────────────────────────────────────
//  Layout scenarios
// ─────────────────────────────────────────────

/**
 * SCENARIO A — No main text on this page.
 * Two commentaries split 50/50 (or one takes 100%).
 * Reuse the existing applyFloatFlowLevel from flow_layout.js,
 * exactly like mishna_wrap_layout.js does.
 */
function layoutNoMain(block, streamsWrap, commentaryStreams) {
  block.classList.add("talmud-no-main");

  if (commentaryStreams.length === 1) {
    // Single commentary — full width, no float
    block.classList.add("talmud-one-commentary");
    const s = commentaryStreams[0];
    s.classList.add("talmud-commentary");
    s.dataset.talmudRole = "commentary";
    s.style.float = "none";
    s.style.width = "100%";
    block.appendChild(s);
    return;
  }

  // Two commentaries — use applyFloatFlowLevel (same as mishna)
  applyFloatFlowLevel({
    container: block,
    streams: commentaryStreams,
    streamsWrap,
    sideForStream: (_s, idx) => orderedSides(streamsWrap)[idx] || (idx % 2 === 0 ? "right" : "left"),
    floatClass: "talmud-commentary-float",
    flowClass:  "talmud-commentary-flow",
    rightClass: "talmud-right",
    leftClass:  "talmud-left",
    roleDataset: "talmudRole",
    floatRole:  "commentary-float",
    flowRole:   "commentary-flow",
  });
  commentaryStreams.forEach((s) => s.classList.add("talmud-commentary"));
}

/**
 * SCENARIO B — One commentary + main text.
 * Commentary floats on the inner/right side; main fills the rest.
 */
function layoutOneCommentaryWithMain(block, streamsWrap, mainEl, commentary) {
  block.classList.add("talmud-has-main", "talmud-one-commentary");

  const mainWidth = getTalmudMainWidth();
  const sideHalf  = ((100 - mainWidth) / 2).toFixed(4); // 29% כברירת מחדל
  const sides     = orderedSides(streamsWrap);
  const sideGap   = getTalmudSideGap();
  const halfGap   = sideGap / 2;
  const [sideRight, sideLeft] = sides;
  const sideRightClass = sideRight === "right" ? "talmud-right" : "talmud-left";
  const sideLeftClass  = sideLeft  === "right" ? "talmud-right" : "talmud-left";

  commentary.classList.add("talmud-commentary", sideRightClass);
  commentary.dataset.talmudRole = "commentary";
  commentary.style.float = sideRight;
  commentary.style.width = `calc(${sideHalf}% - ${halfGap}px)`;

  block.appendChild(commentary);
  mainEl.classList.add("talmud-main");
  mainEl.dataset.talmudRole = "main";
  block.appendChild(mainEl);

  // נכניס את הבלוק ל-DOM זמנית למדידה
  const tempParent = streamsWrap.parentElement;
  tempParent.insertBefore(block, streamsWrap);

  // ספירת שורות התוכן (לא כולל כותרת) ב-29% רוחב
  const titleEl = commentary.querySelector(":scope > .stream-title");
  let totalLines = 0;
  const range = document.createRange();
  const walker = document.createTreeWalker(commentary, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (titleEl && titleEl.contains(node)) return NodeFilter.FILTER_REJECT;
      return node.textContent && node.textContent.length > 0
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  let textNode;
  while ((textNode = walker.nextNode())) {
    range.setStart(textNode, 0);
    range.setEnd(textNode, textNode.length);
    totalLines += Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0).length;
  }

  // אם יש מספיק תוכן, חוצים בחצי ושמים חצי שני בצד הנגדי
  if (totalLines >= 2) {
    const midLines = Math.ceil(totalLines / 2);
    const splitPoint = findCrownSplitByLineCount(commentary, midLines);
    if (splitPoint) {
      const otherHalf = extractBodyAfterSplit(commentary, splitPoint, sideLeftClass, sideLeft, parseFloat(sideHalf));
      otherHalf.classList.remove("talmud-body-portion");
      otherHalf.classList.add("talmud-other-side");
      otherHalf.dataset.talmudRole = "commentary-other-side";
      otherHalf.style.float = sideLeft;
      otherHalf.style.width = `calc(${sideHalf}% - ${halfGap}px)`;
      otherHalf.style.clear = "none";
      block.appendChild(otherHalf);
    }
  }
}

/**
 * SCENARIO C — Two commentaries + main text.  The classic Talmud page.
 *
 * Crown (first N lines):
 *   [commentary-A 50%] [commentary-B 50%]
 *
 * Body (rest):
 *   commentary-A floats right at sideWidth%
 *   commentary-B floats left  at sideWidth%
 *   main text flows in the center (mainWidth%)
 *
 * We achieve the crown entirely with CSS:
 *   --talmud-crown-offset is set (in px) on the block, and
 *   .talmud-main has margin-top: var(--talmud-crown-offset)
 *   The commentaries themselves start at the top and the
 *   main text is pushed down, so the first N lines of the
 *   commentaries are visible above the main text — that IS the crown.
 *
 * Edge cases (handled via CSS classes):
 *   .talmud-a-only / .talmud-b-only — one commentary finished first
 *   When the main ends, the taller commentary expands via CSS.
 */
function layoutTwoCommentariesWithMain(block, streamsWrap, mainEl, commentaryA, commentaryB) {
  block.classList.add("talmud-has-main", "talmud-two-commentaries");

  const mainWidth = getTalmudMainWidth();
  const sideWidth = ((100 - mainWidth) / 2).toFixed(4);
  const sides     = orderedSides(streamsWrap);
  const sideGap   = getTalmudSideGap();
  const crownLines = getTalmudCrownLines();

  block.style.setProperty("--talmud-main-width",      `${mainWidth}%`);
  block.style.setProperty("--talmud-side-width",      `${sideWidth}%`);
  block.style.setProperty("--talmud-crown-lines",     String(crownLines));
  block.style.setProperty("--talmud-side-gap",        `${sideGap}px`);

  // Sort by original DOM order so A is always the first-defined stream
  const sorted = [commentaryA, commentaryB].sort(
    (a, b) => originalOrder(a, 0) - originalOrder(b, 0)
  );
  const [streamA, streamB] = sorted;
  const [sideA, sideB]     = sides;
  const sideAClass = sideA === "right" ? "talmud-right" : "talmud-left";
  const sideBClass = sideB === "right" ? "talmud-right" : "talmud-left";

  streamA.classList.add("talmud-commentary", sideAClass);
  streamA.dataset.talmudRole = "commentary-a";
  streamB.classList.add("talmud-commentary", sideBClass);
  streamB.dataset.talmudRole = "commentary-b";

  // שלב 1: מציבים את הזרמים והבלוק זמנית בעץ ה-DOM ב-50% רוחב פחות חצי הפער,
  // כדי שיישאר פער ויזואלי בין שני הכתרים.
  const halfGap = sideGap / 2;
  streamA.style.float = sideA;
  streamA.style.width = `calc(50% - ${halfGap}px)`;
  streamB.style.float = sideB;
  streamB.style.width = `calc(50% - ${halfGap}px)`;

  block.appendChild(streamA);
  block.appendChild(streamB);
  block.appendChild(mainEl);

  const tempParent = streamsWrap.parentElement;
  tempParent.insertBefore(block, streamsWrap);

  // שלב 2: בדיקה דינמית — האם שני הפרשנים ארוכים מספיק לכתר?
  const aFitsCrown = commentaryFillsCrownPlusExtraLive(streamA, crownLines);
  const bFitsCrown = commentaryFillsCrownPlusExtraLive(streamB, crownLines);
  const doCrown    = aFitsCrown && bFitsCrown && crownLines > 0;

  if (!doCrown) {
    // אין כתר — מחזירים לרוחב 29% וכל ה-3 מתחילים יחד מלמעלה
    block.classList.add("talmud-no-crown");
    streamA.style.width = `${sideWidth}%`;
    streamB.style.width = `${sideWidth}%`;
    mainEl.classList.add("talmud-main");
    mainEl.dataset.talmudRole = "main";
  } else {
    // יש כתר — מחלקים כל פרשן בנקודה המדויקת של שורה N+1
    block.classList.add("talmud-with-crown");

    // ספירת שורות מדויקת — כל פרשן בכתר יקבל בדיוק crownLines שורות תוכן
    const splitPointA = findCrownSplitByLineCount(streamA, crownLines);
    const splitPointB = findCrownSplitByLineCount(streamB, crownLines);

    // streamA + streamB נשארים כ-crown_portion ב-50% רוחב
    streamA.classList.add("talmud-crown-portion");
    streamB.classList.add("talmud-crown-portion");

    // יוצרים body_portion רק אם יש מה לחתוך
    let bodyA = null, bodyB = null;
    if (splitPointA) {
      bodyA = extractBodyAfterSplit(streamA, splitPointA, sideAClass, sideA, sideWidth);
    }
    if (splitPointB) {
      bodyB = extractBodyAfterSplit(streamB, splitPointB, sideBClass, sideB, sideWidth);
    }
    if (bodyA) block.appendChild(bodyA);
    if (bodyB) block.appendChild(bodyB);

    // ביטחון: גובה כתר זהה לשני הפרשנים (במקרה שספירת שורות בכל זאת מחזירה הבדל קטן)
    const styleA = getComputedStyle(streamA);
    const styleB = getComputedStyle(streamB);
    const lineHA = parseFloat(styleA.lineHeight) || (parseFloat(styleA.fontSize) * 1.4) || 14;
    const lineHB = parseFloat(styleB.lineHeight) || (parseFloat(styleB.fontSize) * 1.4) || 14;
    const titleAH = (streamA.querySelector(":scope > .stream-title")?.getBoundingClientRect().height) || 0;
    const titleBH = (streamB.querySelector(":scope > .stream-title")?.getBoundingClientRect().height) || 0;
    const minCrownH = Math.max(titleAH + crownLines * lineHA, titleBH + crownLines * lineHB);
    streamA.style.minHeight = `${minCrownH}px`;
    streamB.style.minHeight = `${minCrownH}px`;

    // באג 1: התרחבות הפרשנים מתחת לראשי כשהראשי קצר
    // אם הגוף ממשיך מתחת לראשי, חותכים אותו שוב בנקודת תחתית הראשי
    // ויוצרים אלמנט "מורחב" ברוחב 50% שזורם לרוחב המלא של הצד.
    const blockRect = block.getBoundingClientRect();
    const mainBottomY = mainEl.getBoundingClientRect().bottom - blockRect.top;

    const expandBelowMain = (bodyEl, side, sideClass) => {
      if (!bodyEl) return;
      const bodyRect = bodyEl.getBoundingClientRect();
      const bodyTopY = bodyRect.top - blockRect.top;
      const bodyBottomY = bodyRect.bottom - blockRect.top;
      if (bodyBottomY <= mainBottomY + 1) return;
      const linesAlongsideMain = Math.floor((mainBottomY - bodyTopY) / lineHA);
      if (linesAlongsideMain <= 0) return;
      const splitPoint = findCrownSplitByLineCount(bodyEl, linesAlongsideMain);
      if (!splitPoint) return;
      const expandedEl = extractBodyAfterSplit(bodyEl, splitPoint, sideClass, side, 50);
      expandedEl.classList.remove("talmud-body-portion");
      expandedEl.classList.add("talmud-body-expanded");
      expandedEl.dataset.talmudRole = "commentary-expanded";
      expandedEl.style.clear = "both";
      expandedEl.style.width = `calc(50% - ${halfGap}px)`;
      block.appendChild(expandedEl);
    };
    expandBelowMain(bodyA, sideA, sideAClass);
    expandBelowMain(bodyB, sideB, sideBClass);

    mainEl.classList.add("talmud-main");
    mainEl.dataset.talmudRole = "main";
    block.appendChild(mainEl); // moves to end (dom move)
  }

  // קלאסים מידע (לטיפול עתידי בהתרחבות צד כשהראשי קצר)
  const lenA = streamTextLength(streamA);
  const lenB = streamTextLength(streamB);
  const lenM = mainEl ? (mainEl.textContent || "").trim().length : 0;
  if (lenA < lenB && lenA < lenM) block.classList.add("talmud-a-short");
  if (lenB < lenA && lenB < lenM) block.classList.add("talmud-b-short");
  if (lenM < lenA && lenM < lenB) block.classList.add("talmud-main-short");
}

// ─────────────────────────────────────────────
//  Main entry per page
// ─────────────────────────────────────────────

export function applyTalmudLayoutToPage(pageEl) {
  if (!pageEl) return;
  const streamsWrap = pageEl.querySelector(".page-streams");
  if (!streamsWrap) return;

  // 1. Undo any previous talmud layout on this page
  unwrapTalmudLayout(pageEl);
  pageEl.classList.remove("talmud-layout-page");

  // 2. Reset all stream elements
  const allStreams = Array.from(streamsWrap.querySelectorAll(":scope > .stream"));
  allStreams.forEach((s, i) => { originalOrder(s, i); resetStream(s); });
  resetMain(pageEl.querySelector(":scope > .page-main"));

  // 3. If disabled, just restore natural order and exit
  if (!isTalmudLayoutEnabled()) {
    allStreams
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .forEach((s) => streamsWrap.appendChild(s));
    return;
  }

  // 4. Resolve which streams are talmud commentaries.
  //    אם המשתמש הפעיל את התלמוד אבל לא מילא את שדה הזרמים,
  //    מזהים אוטומטית: שני הזרמים הראשונים בעמוד (לפי סדר DOM מקורי).
  const codes = parseTalmudStreamCodes();
  let talmudStreams;
  if (codes.length === 0) {
    talmudStreams = allStreams
      .slice()
      .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
      .slice(0, 2);
  } else {
    const byCode = new Map(allStreams.map((s) => [codeForStream(s), s]));
    talmudStreams = codes.map((c) => byCode.get(c)).filter(Boolean);
  }
  if (talmudStreams.length === 0) return;

  pageEl.classList.add("talmud-layout-page");

  // 5. Build the talmud-layout block
  const mainEl    = pageEl.querySelector(":scope > .page-main");
  const hasMain   = Boolean(mainEl && (mainEl.textContent || "").trim());

  const block = document.createElement("div");
  block.className = "talmud-layout";

  if (!hasMain) {
    layoutNoMain(block, streamsWrap, talmudStreams);
  } else if (talmudStreams.length === 1) {
    layoutOneCommentaryWithMain(block, streamsWrap, mainEl, talmudStreams[0]);
  } else {
    layoutTwoCommentariesWithMain(
      block, streamsWrap, mainEl,
      talmudStreams[0], talmudStreams[1]
    );
  }

  // Insert the block before the streams wrapper
  pageEl.insertBefore(block, streamsWrap);

  // 6. Remaining streams (not in talmud layout) go below, as normal
  const usedSet = new Set(talmudStreams);
  if (hasMain) usedSet.add(mainEl);
  allStreams
    .filter((s) => !usedSet.has(s))
    .sort((a, b) => originalOrder(a, 0) - originalOrder(b, 0))
    .forEach((s) => {
      s.style.clear = "both";
      streamsWrap.appendChild(s);
    });

  // 7. גלאי חריגה: לאחר עידכון הלייאאוט, נבדוק אם תוכן העמוד חורג
  //    מגבולות העמוד (clipped ע"י overflow:hidden של .page).
  //    שתי בדיקות נדחות (rAF + setTimeout) כדי להמתין לפריסה מחושבת.
  const checkOverflow = () => {
    pageEl.classList.remove("talmud-page-overflow");
    const innerHeight = pageEl.scrollHeight;
    const outerHeight = pageEl.clientHeight;
    if (innerHeight > outerHeight + 1) {
      pageEl.classList.add("talmud-page-overflow");
      pageEl.dataset.talmudOverflowPx = String(innerHeight - outerHeight);
      if (typeof console !== "undefined" && console.warn) {
        console.warn(`[talmud] page overflow: +${innerHeight - outerHeight}px`, pageEl);
      }
    } else {
      pageEl.removeAttribute("data-talmud-overflow-px");
    }
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(checkOverflow));
  }
  setTimeout(checkOverflow, 200);
}

// ─────────────────────────────────────────────
//  Apply to all pages + hook into virtual scroll
// ─────────────────────────────────────────────

export function applyTalmudLayoutToPages(container) {
  if (!isTalmudLayoutEnabled()) return;
  container.querySelectorAll(".page:not(.page-placeholder)").forEach((page) =>
    applyTalmudLayoutToPage(page)
  );

  // Hook into the page-realization pipeline (same pattern as mishna_wrap_layout.js)
  if (!container.__processRealizedPage?.__talmudLayout) {
    const prev = container.__processRealizedPage;
    const processor = function (page, idx) {
      if (typeof prev === "function") prev(page, idx);
      applyTalmudLayoutToPage(page);
    };
    processor.__talmudLayout = true;
    container.__processRealizedPage = processor;
  }

  const baseRealize = container.__realizePage;
  if (typeof baseRealize === "function" && !baseRealize.__talmudLayout) {
    const wrapped = function (idx) {
      baseRealize(idx);
      const page =
        typeof container.__getPageElement === "function"
          ? container.__getPageElement(idx)
          : container.querySelector(`.page[data-page-index="${idx}"]`);
      if (page) applyTalmudLayoutToPage(page);
    };
    wrapped.__talmudLayout = true;
    container.__realizePage = wrapped;
  }
}

// ─────────────────────────────────────────────
//  UI wiring
// ─────────────────────────────────────────────

export function wireTalmudLayoutControls(onChange) {
  const toggle       = document.getElementById("talmud-layout-toggle");
  const streamsInput = document.getElementById("talmud-streams-input");
  const crownInput   = document.getElementById("talmud-crown-lines-input");
  const widthInput   = document.getElementById("talmud-main-width-input");
  const sideSelect   = document.getElementById("talmud-side-mode-select");
  const gapInput     = document.getElementById("talmud-side-gap-input");

  if (!toggle) return;

  // Restore saved values into controls
  toggle.checked = isTalmudLayoutEnabled();
  if (streamsInput) streamsInput.value = getTalmudStreamsText();
  if (crownInput)   crownInput.value   = getTalmudCrownLines();
  if (widthInput)   widthInput.value   = getTalmudMainWidth();
  if (sideSelect)   sideSelect.value   = getTalmudSideMode();
  if (gapInput)     gapInput.value     = getTalmudSideGap();

  const commit = () => onChange?.();

  toggle.addEventListener("change", () => {
    setTalmudLayoutEnabled(toggle.checked);
    commit();
  });
  streamsInput?.addEventListener("change", () => {
    setTalmudStreamsText(streamsInput.value);
    commit();
  });
  streamsInput?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); streamsInput.blur(); }
  });
  crownInput?.addEventListener("change", () => {
    setTalmudCrownLines(crownInput.value);
    crownInput.value = getTalmudCrownLines();
    commit();
  });
  widthInput?.addEventListener("change", () => {
    setTalmudMainWidth(widthInput.value);
    widthInput.value = getTalmudMainWidth();
    commit();
  });
  sideSelect?.addEventListener("change", () => {
    setTalmudSideMode(sideSelect.value);
    commit();
  });
  gapInput?.addEventListener("change", () => {
    setTalmudSideGap(gapInput.value);
    gapInput.value = getTalmudSideGap();
    commit();
  });
}
