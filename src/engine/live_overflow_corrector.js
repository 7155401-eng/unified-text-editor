/*
  live_overflow_corrector.js

  Real-time self-correcting layout: after the engine renders pages,
  measure each one with Range.getBoundingClientRect, and if any page
  has bottom-overflow, push a small extra "overflow reserve" via the
  --ravtext-features-overflow-reserve CSS variable. dom_packer reads
  that variable in getDomPageGeom and packs less per page on the next
  rerender. Bounded to MAX_ITERATIONS so no infinite loops.

  Architecture rule (matches final_layout_guard.js):
  - No MutationObserver, no auto-bind to events here. The corrector is
    invoked explicitly by the engine pipeline after a render finishes.
  - Pagination decisions still live in dom_packer; this module just
    tells it "shave N pixels from page height" until the live DOM stops
    overflowing.
*/

const RESERVE_CSS_VAR = "--ravtext-features-overflow-reserve";
const SESSION_KEY = "ravtext.layout.overflowReserve.v1";
const MAX_ITERATIONS = 4;
const TOLERANCE_PX = 1.5;
const STEP_FLOOR_PX = 2;

function readReserve() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    const n = parseFloat(raw || "");
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

function writeReserve(px) {
  try {
    sessionStorage.setItem(SESSION_KEY, String(Math.max(0, Math.round(px))));
  } catch (_) {}
}

function applyReserveToCssVar(px) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(RESERVE_CSS_VAR, `${Math.max(0, Math.round(px))}px`);
}

function readIterations() {
  try {
    const n = parseInt(sessionStorage.getItem(SESSION_KEY + ".iter") || "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

function writeIterations(n) {
  try {
    sessionStorage.setItem(SESSION_KEY + ".iter", String(Math.max(0, n)));
  } catch (_) {}
}

export function resetLiveOverflowReserve() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY + ".iter");
  } catch (_) {}
  applyReserveToCssVar(0);
}

function visible(el) {
  if (!el || el.nodeType !== 1) return false;
  const st = getComputedStyle(el);
  return st.display !== "none" && st.visibility !== "hidden" && parseFloat(st.opacity || "1") > 0;
}

function ignorable(el) {
  if (!el || !el.classList) return true;
  return !!(
    el.classList.contains("page-placeholder") ||
    el.closest(".page-placeholder") ||
    el.closest(".pdf-toolbar") ||
    el.closest(".toolbar") ||
    el.closest(".app-header") ||
    el.closest(".modal") ||
    el.closest(".ctx-menu") ||
    el.closest(".toast") ||
    el.closest("#__measure_root") ||
    el.closest("#ravtext-layout-context-measure-page")
  );
}

function rectsFor(el) {
  const out = [];
  try {
    if (el.textContent && el.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width > 0.5 && r.height > 0.5) out.push(r);
      }
      range.detach && range.detach();
    }
  } catch (_) {}
  if (!out.length) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width > 0.5 && r.height > 0.5) out.push(r);
    } catch (_) {}
  }
  return out;
}

function candidates(pageEl) {
  return Array.from(
    pageEl.querySelectorAll([
      ".page-main",
      ".page-main *",
      ".page-streams",
      ".page-streams *",
      ".stream",
      ".stream *",
      ".note",
      ".note *",
      ".note-inline",
      ".note-inline *",
      ".note-part",
      ".note-part *",
      ".ravtext-table",
      ".ravtext-table *",
      ".v9-line",
      ".v9-line *",
      ".v9-stream-title",
      ".v9-stream-title *",
    ].join(","))
  ).filter((el) => visible(el) && !ignorable(el));
}

function measurePageBottomOverflow(pageEl) {
  if (!pageEl || !visible(pageEl)) return 0;
  const pr = pageEl.getBoundingClientRect();
  if (!pr || !pr.height) return 0;
  let worst = 0;
  for (const el of candidates(pageEl)) {
    for (const r of rectsFor(el)) {
      const over = r.bottom - pr.bottom;
      if (over > worst) worst = over;
    }
  }
  return Math.max(0, worst);
}

/**
 * Measure all pages in the container; if any has bottom-overflow above
 * tolerance, bump the overflow-reserve and ask the host to rerender.
 *
 * Returns true if a rerender was scheduled, false if layout is clean
 * or the iteration cap was reached.
 */
export function correctLiveOverflowOnce(container, { onScheduleRerender } = {}) {
  if (!container || !container.querySelectorAll) return false;
  const pages = Array.from(
    container.querySelectorAll(".page:not(.page-placeholder), .v9-page")
  ).filter((p) => p && !p.classList.contains("page-placeholder"));
  if (!pages.length) return false;

  let worstOverflow = 0;
  for (const page of pages) {
    const over = measurePageBottomOverflow(page);
    if (over > worstOverflow) worstOverflow = over;
  }

  if (worstOverflow <= TOLERANCE_PX) {
    // Layout looks clean. We do NOT zero the reserve here — the rerender
    // hook does that when the document changes. Just stop iterating.
    writeIterations(0);
    return false;
  }

  const iter = readIterations();
  if (iter >= MAX_ITERATIONS) {
    // Give up to prevent infinite loops. The user still sees the page,
    // just with some residual overflow.
    return false;
  }

  const current = readReserve();
  const step = Math.max(STEP_FLOOR_PX, Math.ceil(worstOverflow + 1));
  const next = current + step;
  writeReserve(next);
  writeIterations(iter + 1);
  applyReserveToCssVar(next);

  if (typeof onScheduleRerender === "function") {
    onScheduleRerender();
  } else if (typeof window !== "undefined" && typeof window.__ravtextRerender === "function") {
    window.__ravtextRerender();
  }
  return true;
}

// משה 2026-05-14: סורק זוגות סימני פיצול U+2060 ובודק עם getBoundingClientRect
// האם שני החצאים יכולים להתאחד באותו עמוד כעת. אם כן — שומר hint
// ל-window.__ravtextRemergeHints ו-rerender. עוזר במצב שהפריסה השתנתה
// (גופן/מרווחים/הסרת תוכן) ופיצול ישן כבר לא נחוץ.
let _remergeIters = 0;
const REMERGE_MAX_ITERS = 2;

function findSplitMarkPairs(container) {
  if (!container || !container.querySelectorAll) return [];
  // סלקטור רחב — כולל הערות, V9, וטקסט ראשי. כולל גם stream columns
  // (childrren של .stream-balanced-columns שיש להן .note*).
  const SCAN = [
    ".note",
    ".note-inline",
    ".note-part",
    ".note-child",
    ".v9-line",
    ".page-main p",
    ".page-main h1, .page-main h2, .page-main h3",
  ].join(",");
  const nodes = Array.from(container.querySelectorAll(SCAN));
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    const at = a.textContent || "";
    if (!at.length) continue;
    if (at.charCodeAt(at.length - 1) !== 0x2060) continue;
    // בדיקה: האם יש אלמנט הבא בסדר המסמך שמתחיל ב-U+2060?
    for (let j = i + 1; j < nodes.length; j++) {
      const bt = nodes[j].textContent || "";
      if (!bt.trim()) continue;
      if (bt.charCodeAt(0) === 0x2060) {
        pairs.push({ first: a, second: nodes[j] });
      }
      break;
    }
  }
  return pairs;
}

function getPageOf(el) {
  return el?.closest?.(".page:not(.page-placeholder), .v9-page") || null;
}

function couldFitMerged(pair) {
  // האם שני החצאים יכולים לשבת באותו עמוד? נמדוד את הגובה של החלק השני
  // (b) ונבדוק אם יש מספיק מקום בעמוד של החלק הראשון (a). שמרני: מוסיף
  // 2px ביטחון.
  const a = pair.first;
  const b = pair.second;
  const aPage = getPageOf(a);
  if (!aPage) return false;
  const aPR = aPage.getBoundingClientRect();
  const bR = b.getBoundingClientRect();
  const bottomLimit = aPR.bottom;
  // המקום הפנוי בעמוד = bottomLimit - actual content bottom of aPage
  let contentBottom = aPR.top;
  for (const el of aPage.querySelectorAll(".v9-line, .note, .note-inline, .note-part, .stream, .page-main p")) {
    const r = el.getBoundingClientRect();
    if (r.bottom > contentBottom) contentBottom = r.bottom;
  }
  const free = bottomLimit - contentBottom - 2;
  return bR.height > 0 && bR.height < free;
}

export function tryRemergeSplitMarks(container, { onScheduleRerender } = {}) {
  if (typeof window === "undefined") return false;
  if (_remergeIters >= REMERGE_MAX_ITERS) return false;
  const pairs = findSplitMarkPairs(container);
  if (!pairs.length) {
    _remergeIters = 0;
    return false;
  }
  // נאסוף hints — לכל זוג שמסוגל להתמזג, נשמור את הקוד/anchor של החלק הראשון
  // כדי שהפק הבא ידע להעדיף לא לפצל.
  const hints = [];
  for (const p of pairs) {
    if (!couldFitMerged(p)) continue;
    const code = p.first.closest?.("[data-stream]")?.getAttribute("data-stream") || "main";
    hints.push({
      streamCode: code,
      // anchor שמור על dataset של ה-note (אם קיים)
      anchor: p.first.dataset?.anchor || "",
      num: p.first.dataset?.noteNum || "",
    });
  }
  if (!hints.length) return false;
  window.__ravtextRemergeHints = hints;
  _remergeIters++;
  if (typeof onScheduleRerender === "function") {
    onScheduleRerender();
  } else if (typeof window.__ravtextRerender === "function") {
    window.__ravtextRerender();
  }
  return true;
}

export function resetRemergeIterations() {
  _remergeIters = 0;
  if (typeof window !== "undefined") {
    delete window.__ravtextRemergeHints;
  }
}

/**
 * Read the current reserve from session storage and apply it to the CSS
 * var so the very first pack pass already takes it into account.
 * Call this near app startup.
 */
export function bootstrapLiveOverflowReserve() {
  applyReserveToCssVar(readReserve());
}
