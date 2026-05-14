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

/**
 * Read the current reserve from session storage and apply it to the CSS
 * var so the very first pack pass already takes it into account.
 * Call this near app startup.
 */
export function bootstrapLiveOverflowReserve() {
  applyReserveToCssVar(readReserve());
}
