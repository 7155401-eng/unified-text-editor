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

  // לפני כל דבר: ממזגים body-portions בחזרה לזרם המקורי שלהם.
  // body-portion הוא <div data-talmud-body-of="<code>"> עם ילדי תוכן שנגזרו מהזרם.
  Array.from(block.querySelectorAll(":scope > [data-talmud-body-of]")).forEach((bodyEl) => {
    const code = bodyEl.dataset.talmudBodyOf;
    const parent = block.querySelector(`:scope > .stream[data-stream="${code}"]:not([data-talmud-body-of])`);
    if (parent) {
      while (bodyEl.firstChild) parent.appendChild(bodyEl.firstChild);
    }
    bodyEl.remove();
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
 * מודד היכן קצוות תוכן הפרשן חוצים את גובה הכתר ב-50% רוחב.
 * מחזיר אינדקס הילד הראשון שאינו נכנס לכתר; null אם כל התוכן נכנס.
 */
function measureSplitIndex(streamEl, crownLines, blockWidthPx) {
  if (crownLines <= 0) return 0;
  if (!blockWidthPx) return null;

  const wideWidth = Math.max(40, blockWidthPx * 0.5);
  const clone = streamEl.cloneNode(true);
  clone.style.cssText = [
    "position:absolute",
    "top:-99999px",
    "left:-99999px",
    `width:${wideWidth}px`,
    "visibility:hidden",
    "float:none",
    "margin:0",
    "padding-left:3px",
    "padding-right:3px",
    "box-sizing:border-box",
  ].join(";");
  clone.classList.remove("talmud-crown-portion", "talmud-fits-in-crown");
  document.body.appendChild(clone);

  const cloneRect = clone.getBoundingClientRect();
  const titleEl = clone.querySelector(":scope > .stream-title");
  const titleH = titleEl ? titleEl.getBoundingClientRect().height : 0;
  const styleObj = getComputedStyle(clone);
  const lineH = parseFloat(styleObj.lineHeight) || (parseFloat(styleObj.fontSize) * 1.4) || 14;
  const targetH = titleH + crownLines * lineH;

  const cloneChildren = Array.from(clone.children).filter((c) => !c.classList?.contains("stream-title"));
  let splitIdx = cloneChildren.length;
  for (let i = 0; i < cloneChildren.length; i++) {
    const r = cloneChildren[i].getBoundingClientRect();
    const childBottom = r.bottom - cloneRect.top;
    if (childBottom > targetH + 1) {
      splitIdx = i;
      break;
    }
  }
  document.body.removeChild(clone);

  // אם רק הפסקה הראשונה כבר חורגת — נכריח אותה לכתר (אחרת הכתר יישאר ריק)
  if (splitIdx === 0 && cloneChildren.length > 0) splitIdx = 1;

  return splitIdx;
}

/**
 * מחלק streamEl לשני חלקים: הראש (נשאר ב-streamEl) והגוף (חדש).
 * מחזיר { fitsInCrown, bodyEl } — bodyEl יהיה null אם אין מה לחתוך.
 */
function splitStreamForCrown(streamEl, crownLines, blockWidthPx, sideClass) {
  const splitIdx = measureSplitIndex(streamEl, crownLines, blockWidthPx);
  const titleEl = streamEl.querySelector(":scope > .stream-title");
  const contentChildren = Array.from(streamEl.children).filter((c) => !c.classList?.contains("stream-title"));

  if (splitIdx == null) {
    return { fitsInCrown: false, bodyEl: null };
  }
  if (splitIdx >= contentChildren.length || contentChildren.length === 0) {
    // כל התוכן נכנס לכתר — פשוט להרחיב את הזרם ל-50%
    return { fitsInCrown: true, bodyEl: null };
  }

  // יוצרים אלמנט גוף חדש שמכיל את החלק שלא נכנס לכתר
  const bodyEl = document.createElement("div");
  bodyEl.className = "stream talmud-commentary talmud-body-portion " + sideClass;
  bodyEl.dataset.talmudBodyOf = streamEl.getAttribute("data-stream") || "";
  bodyEl.dataset.talmudRole = "commentary-body";
  for (let i = splitIdx; i < contentChildren.length; i++) {
    bodyEl.appendChild(contentChildren[i]);
  }
  return { fitsInCrown: false, bodyEl };
}

/**
 * בודק האם הפרשן ארוך מספיק כדי להצדיק כתר אמיתי.
 * הקריטריון: גובה התוכן ב-50% רוחב >= title + (crownLines + EXTRA) שורות.
 * זה דינמי לחלוטין — לא תלוי בספירת תווים, אלא במדידת DOM אמיתית.
 */
function commentaryFillsCrownPlusExtra(streamEl, crownLines, blockWidthPx) {
  if (!blockWidthPx || crownLines <= 0) return false;
  const wideWidth = Math.max(40, blockWidthPx * 0.5);
  const clone = streamEl.cloneNode(true);
  clone.style.cssText = [
    "position:absolute",
    "top:-99999px",
    "left:-99999px",
    `width:${wideWidth}px`,
    "visibility:hidden",
    "float:none",
    "margin:0",
    "padding-left:3px",
    "padding-right:3px",
    "box-sizing:border-box",
  ].join(";");
  clone.classList.remove("talmud-crown-portion", "talmud-fits-in-crown");
  document.body.appendChild(clone);

  const titleH = (clone.querySelector(":scope > .stream-title")?.getBoundingClientRect().height) || 0;
  const styleObj = getComputedStyle(clone);
  const lineH = parseFloat(styleObj.lineHeight) || (parseFloat(styleObj.fontSize) * 1.4) || 14;
  const requiredH = titleH + (crownLines + CROWN_EXTRA_LINES) * lineH;
  const totalH = clone.getBoundingClientRect().height;

  document.body.removeChild(clone);
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

  const mainWidth  = getTalmudMainWidth();
  const sideWidth  = 100 - mainWidth;
  const side       = orderedSides(streamsWrap)[0]; // first preferred side

  commentary.classList.add("talmud-commentary", side === "right" ? "talmud-right" : "talmud-left");
  commentary.dataset.talmudRole = "commentary";
  commentary.style.float  = side;
  commentary.style.width  = `${sideWidth.toFixed(4)}%`;

  block.appendChild(commentary);

  mainEl.classList.add("talmud-main");
  mainEl.dataset.talmudRole = "main";
  block.appendChild(mainEl);

  // main will reflow naturally around the float — no explicit width needed
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
  const sides     = orderedSides(streamsWrap); // e.g. ["right","left"]
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

  // הוספת זרמים זמנית לבלוק (לפני המדידה — צריך להיות בעץ ה-DOM כדי שמדידות יעבדו).
  // הבלוק עצמו עוד לא בעמוד, אבל נכניס אותו זמנית כדי לקבל רוחב.
  block.appendChild(streamA);
  block.appendChild(streamB);
  block.appendChild(mainEl);

  // נכניס את הבלוק ל-streamsWrap.parentElement (=pageEl) זמנית כדי לקבל רוחב.
  const tempParent = streamsWrap.parentElement;
  tempParent.insertBefore(block, streamsWrap);
  const blockWidthPx = block.getBoundingClientRect().width;
  // נסיר זמנית — נחזיר אחרי הסידור
  block.remove();

  // החלטה דינמית: האם שני הפרשנים ארוכים מספיק לכתר אמיתי?
  const aFitsCrown = commentaryFillsCrownPlusExtra(streamA, crownLines, blockWidthPx);
  const bFitsCrown = commentaryFillsCrownPlusExtra(streamB, crownLines, blockWidthPx);
  const doCrown    = aFitsCrown && bFitsCrown && crownLines > 0;

  // ננקה את ה-block ונבנה אותו מחדש לפי ההחלטה
  while (block.firstChild) block.removeChild(block.firstChild);

  if (!doCrown) {
    // אין כתר — שני הפרשנים בצדדים 29% מהרגע הראשון, ראשי באמצע 42%, כל ה-3 מהשורה הראשונה
    block.classList.add("talmud-no-crown");
    streamA.style.float = sideA;
    streamA.style.width = `${sideWidth}%`;
    streamB.style.float = sideB;
    streamB.style.width = `${sideWidth}%`;

    block.appendChild(streamA);
    block.appendChild(streamB);
    mainEl.classList.add("talmud-main");
    mainEl.dataset.talmudRole = "main";
    block.appendChild(mainEl);
  } else {
    // יש כתר — מחלקים כל פרשן ל: ראש (50% רחב, ב-crown) + גוף (29% רחב, מתחת לכתר)
    block.classList.add("talmud-with-crown");

    const splitA = splitStreamForCrown(streamA, crownLines, blockWidthPx, sideAClass);
    const splitB = splitStreamForCrown(streamB, crownLines, blockWidthPx, sideBClass);

    // הכתר: streamA נשאר עם החלק שנכנס לכתר; הופך ל-50% רוחב
    streamA.classList.add("talmud-crown-portion");
    streamA.style.float = sideA;
    streamA.style.width = "50%";

    streamB.classList.add("talmud-crown-portion");
    streamB.style.float = sideB;
    streamB.style.width = "50%";

    block.appendChild(streamA);
    block.appendChild(streamB);

    // הגוף: אם נוצר אלמנט body, מציבים אותו עם clear לאותו צד, רוחב 29%
    if (splitA.bodyEl) {
      splitA.bodyEl.style.float = sideA;
      splitA.bodyEl.style.width = `${sideWidth}%`;
      splitA.bodyEl.style.clear = sideA;
      block.appendChild(splitA.bodyEl);
    }
    if (splitB.bodyEl) {
      splitB.bodyEl.style.float = sideB;
      splitB.bodyEl.style.width = `${sideWidth}%`;
      splitB.bodyEl.style.clear = sideB;
      block.appendChild(splitB.bodyEl);
    }

    // הראשי: זורם באופן טבעי מתחת לכתר (ה-floats של 50%+50% דוחפים אותו)
    mainEl.classList.add("talmud-main");
    mainEl.dataset.talmudRole = "main";
    block.appendChild(mainEl);
  }

  // קלאסים מידע (לעתיד — להתרחבות צד כשהראשי קצר)
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
