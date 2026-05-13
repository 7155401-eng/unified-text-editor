/*
  final_layout_guard.js

  שכבת הגנה לעימוד:
  מודדת את הדף אחרי הרינדור הסופי, לא לפניו.

  אם אחרי כל הפיצ'רים:
  inline runs, spans, fontSize, fontFamily, bold, הערות,
  משנה ברורה/V9, כותרות, מספרי עמודים וכו'
  עדיין יש טקסט שיוצא מגבול העמוד —
  לא מסתירים אותו, אלא מגדילים כרית עימוד ומרנדרים שוב.
*/

const AUTO_SAFETY_KEY = "ravtext.layout.autoOverflowSafety";
const SESSION_ATTEMPTS_KEY = "ravtext.layout.autoOverflowAttempts.v1";

const MAX_AUTO_SAFETY = 280;
const MIN_INCREMENT = 10;
const MAX_ATTEMPTS = 8;

function readIntStorage(key, fallback = 0, min = 0, max = 9999) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === "") return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  } catch (_) {
    return fallback;
  }
}

function writeIntStorage(key, value) {
  try {
    localStorage.setItem(key, String(Math.max(0, Math.round(value || 0))));
  } catch (_) {}
}

function readAttempts() {
  try {
    const raw = sessionStorage.getItem(SESSION_ATTEMPTS_KEY);
    const n = parseInt(raw || "0", 10);
    return Number.isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}

function writeAttempts(n) {
  try {
    sessionStorage.setItem(SESSION_ATTEMPTS_KEY, String(Math.max(0, n || 0)));
  } catch (_) {}
}

function isVisibleElement(el) {
  if (!el || el.nodeType !== 1) return false;
  const st = getComputedStyle(el);
  if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
  return true;
}

function isIgnorable(el) {
  if (!el || !el.classList) return true;

  if (el.classList.contains("page-placeholder")) return true;
  if (el.closest(".page-placeholder")) return true;

  if (el.closest(".pdf-toolbar")) return true;
  if (el.closest(".toolbar")) return true;
  if (el.closest(".app-header")) return true;
  if (el.closest(".modal")) return true;
  if (el.closest(".ctx-menu")) return true;
  if (el.closest(".toast")) return true;
  if (el.closest("#__measure_root")) return true;

  return false;
}

function textAwareRects(el) {
  const rects = [];

  try {
    if (el.childNodes && el.textContent && el.textContent.trim()) {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of Array.from(range.getClientRects())) {
        if (r && r.width > 0.5 && r.height > 0.5) rects.push(r);
      }
      range.detach && range.detach();
    }
  } catch (_) {}

  if (!rects.length) {
    try {
      const r = el.getBoundingClientRect();
      if (r && r.width > 0.5 && r.height > 0.5) rects.push(r);
    } catch (_) {}
  }

  return rects;
}

function collectPrintableCandidates(pageEl) {
  const selector = [
    ".page-main",
    ".page-main *",
    ".page-streams",
    ".page-streams *",
    ".stream",
    ".stream *",
    ".note",
    ".note *",
    ".stream-title",
    ".ravtext-table",
    ".ravtext-table *",

    ".v9-line",
    ".v9-line *",
    ".v9-stream-title",
    ".v9-stream-title *",

    ".ravtext-page-header",
    ".ravtext-page-header *",
    ".ravtext-page-footer",
    ".ravtext-page-footer *",
    ".ravtext-page-number-overlay",
    ".ravtext-page-number-overlay *"
  ].join(",");

  return Array.from(pageEl.querySelectorAll(selector))
    .filter((el) => isVisibleElement(el) && !isIgnorable(el));
}

export function measureRenderedPageOverflow(pageEl, opts = {}) {
  if (!pageEl || !isVisibleElement(pageEl)) {
    return { bottom: 0, top: 0, left: 0, right: 0, max: 0, offenders: [] };
  }

  const tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 1.5;
  const pageRect = pageEl.getBoundingClientRect();

  if (!pageRect || !pageRect.width || !pageRect.height) {
    return { bottom: 0, top: 0, left: 0, right: 0, max: 0, offenders: [] };
  }

  const allowed = {
    top: pageRect.top - tolerance,
    bottom: pageRect.bottom + tolerance,
    left: pageRect.left - tolerance,
    right: pageRect.right + tolerance,
  };

  let overflowBottom = 0;
  let overflowTop = 0;
  let overflowLeft = 0;
  let overflowRight = 0;
  const offenders = [];

  for (const el of collectPrintableCandidates(pageEl)) {
    for (const r of textAwareRects(el)) {
      const b = r.bottom - allowed.bottom;
      const t = allowed.top - r.top;
      const l = allowed.left - r.left;
      const rr = r.right - allowed.right;

      const localMax = Math.max(b, t, l, rr);

      if (localMax > tolerance) {
        offenders.push({
          tag: el.tagName,
          className: String(el.className || ""),
          text: String(el.textContent || "").trim().slice(0, 80),
          bottom: Math.round(b * 100) / 100,
          top: Math.round(t * 100) / 100,
          left: Math.round(l * 100) / 100,
          right: Math.round(rr * 100) / 100,
        });
      }

      overflowBottom = Math.max(overflowBottom, b);
      overflowTop = Math.max(overflowTop, t);
      overflowLeft = Math.max(overflowLeft, l);
      overflowRight = Math.max(overflowRight, rr);
    }
  }

  overflowBottom = Math.max(0, overflowBottom);
  overflowTop = Math.max(0, overflowTop);
  overflowLeft = Math.max(0, overflowLeft);
  overflowRight = Math.max(0, overflowRight);

  return {
    bottom: overflowBottom,
    top: overflowTop,
    left: overflowLeft,
    right: overflowRight,
    max: Math.max(overflowBottom, overflowTop, overflowLeft, overflowRight),
    offenders,
  };
}

export function validateRenderedPages(container, opts = {}) {
  const root = typeof container === "function" ? container() : container;
  if (!root || !root.querySelectorAll) {
    return { ok: true, maxOverflow: 0, pages: [] };
  }

  const pages = Array.from(
    root.querySelectorAll(".page:not(.page-placeholder), .v9-page")
  ).filter((p) => p && !p.classList.contains("page-placeholder"));

  const report = [];
  let maxBottom = 0;
  let maxAny = 0;

  for (const page of pages) {
    const overflow = measureRenderedPageOverflow(page, opts);
    maxBottom = Math.max(maxBottom, overflow.bottom);
    maxAny = Math.max(maxAny, overflow.max);

    page.dataset.finalOverflowBottom = String(Math.round(overflow.bottom * 100) / 100);
    page.dataset.finalOverflowMax = String(Math.round(overflow.max * 100) / 100);

    if (overflow.max > (opts.tolerance || 1.5)) {
      page.classList.add("ravtext-final-overflow-detected");
      report.push({ page, overflow });
    } else {
      page.classList.remove("ravtext-final-overflow-detected");
    }
  }

  return {
    ok: report.length === 0,
    maxOverflow: maxAny,
    maxBottomOverflow: maxBottom,
    pages: report,
  };
}

function injectGuardCss() {
  if (document.getElementById("ravtext-final-layout-guard-css")) return;

  const style = document.createElement("style");
  style.id = "ravtext-final-layout-guard-css";
  style.textContent = `
    .page-main,
    .page-main p,
    .stream,
    .note,
    .note-inline,
    .note-part {
      overflow-wrap: anywhere;
      word-break: normal;
    }

    .page-main span,
    .stream span,
    .note span,
    .note-inline span,
    .note-part span {
      max-width: 100%;
    }

    .ravtext-final-overflow-detected {
      outline: 1px dashed rgba(220, 38, 38, 0.45);
      outline-offset: -1px;
    }
  `;
  document.head.appendChild(style);
}

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function afterPaint() {
  await nextAnimationFrame();
  await nextAnimationFrame();
  await new Promise((resolve) => setTimeout(resolve, 80));
}

export function installFinalLayoutGuard(options = {}) {
  const getPagesContainer = options.getPagesContainer || (() => document.querySelector("#pages-container"));
  const rerender = options.rerender || (() => {
    if (typeof window.__ravtextRerender === "function") window.__ravtextRerender();
  });

  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1.5;
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 260;
  const maxAutoSafety = Number.isFinite(options.maxAutoSafety) ? options.maxAutoSafety : MAX_AUTO_SAFETY;

  injectGuardCss();

  let timer = null;
  let running = false;
  let lastSignature = "";

  async function run(reason = "unknown") {
    if (running) return;
    running = true;

    try {
      await afterPaint();

      const container = getPagesContainer();
      const result = validateRenderedPages(container, { tolerance });

      if (typeof window !== "undefined") {
        window.__RAVTEXT_LAST_FINAL_LAYOUT_REPORT__ = result;
      }

      if (result.ok) {
        writeAttempts(0);
        return;
      }

      const bottom = Math.ceil(result.maxBottomOverflow || 0);
      if (bottom <= tolerance) return;

      const current = readIntStorage(AUTO_SAFETY_KEY, 0, 0, maxAutoSafety);
      const inc = Math.max(MIN_INCREMENT, bottom + 8);
      const next = Math.min(maxAutoSafety, current + inc);

      const attempts = readAttempts();
      const sig = `${Math.round(bottom)}:${current}:${next}:${result.pages.length}`;

      if (attempts >= MAX_ATTEMPTS || next <= current || sig === lastSignature) {
        console.warn("[final-layout-guard] overflow remains after max attempts", {
          reason,
          current,
          next,
          attempts,
          result,
        });
        return;
      }

      lastSignature = sig;
      writeAttempts(attempts + 1);
      writeIntStorage(AUTO_SAFETY_KEY, next);

      console.warn("[final-layout-guard] detected final overflow; increasing layout safety and rerendering", {
        reason,
        bottom,
        current,
        next,
        attempts: attempts + 1,
      });

      await new Promise((resolve) => setTimeout(resolve, 40));
      rerender();
    } finally {
      running = false;
    }
  }

  function schedule(reason = "mutation") {
    clearTimeout(timer);
    timer = setTimeout(() => run(reason), debounceMs);
  }

  const container = getPagesContainer();
  if (container && typeof MutationObserver !== "undefined") {
    const obs = new MutationObserver(() => schedule("pages-mutated"));
    obs.observe(container, { childList: true, subtree: true, characterData: true });
    container.__ravtextFinalLayoutGuardObserver = obs;
  }

  window.addEventListener("resize", () => schedule("resize"));
  window.addEventListener("ravtext:styles-changed", () => schedule("styles-changed"));
  window.addEventListener("ravtext:stream-order-changed", () => schedule("stream-order-changed"));

  window.__RAVTEXT_FINAL_LAYOUT_GUARD__ = {
    run,
    schedule,
    validate: () => validateRenderedPages(getPagesContainer(), { tolerance }),
    resetSafety: () => {
      writeIntStorage(AUTO_SAFETY_KEY, 0);
      writeAttempts(0);
      rerender();
    },
    getSafety: () => readIntStorage(AUTO_SAFETY_KEY, 0, 0, maxAutoSafety),
  };

  schedule("install");
}
