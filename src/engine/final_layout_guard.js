/*
  final_layout_guard.js

  עיקרון:
  יציבות לפי הפלט החי בפועל, לא לפי כרית מתמטית גלובלית.

  מותר:
  - למדוד overflow אמיתי אחרי הרינדור.
  - לנקות DOM שגוי שאין לו תוכן, כגון stream עם כותרת בלבד.
  - לנטרל רקעים שנשפכו מ-data-stream לתוך הדף המודפס.

  אסור:
  - לא לכתוב ravtext.layout.autoOverflowSafety.
  - לא להוסיף רווח גלובלי לכל הדפים.
  - לא להסתיר טקסט כדי להעמיד פנים שאין overflow.
*/

const OLD_AUTO_SAFETY_KEY = "ravtext.layout.autoOverflowSafety";
const OLD_SESSION_ATTEMPTS_KEY = "ravtext.layout.autoOverflowAttempts.v1";
const STYLE_ID = "ravtext-live-output-stability-css";

function injectLiveStabilityCss() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /*
      רקעים של [data-stream] נועדו לסימון בעורך/מקור.
      בתוך הדף המודפס הם יוצרים כתמי רקע מכוערים, במיוחד אחרי שהזרמים
      כבר מקבלים צבע טקסט משלהם.
    */
    #pages-container .page .stream[data-stream],
    .pages-container .page .stream[data-stream],
    #pages-container .page .note-child[data-stream],
    .pages-container .page .note-child[data-stream] {
      background: transparent !important;
      box-shadow: none !important;
    }

    /*
      אין להציג כותרת זרם יתומה.
      JS מסיר את האלמנט; CSS הוא רשת ביטחון בלבד.
    */
    #pages-container .page .stream.ravtext-empty-stream,
    .pages-container .page .stream.ravtext-empty-stream {
      display: none !important;
    }

    .ravtext-final-overflow-detected {
      outline: 1px dashed rgba(220, 38, 38, 0.45);
      outline-offset: -1px;
    }
  `;
  document.head.appendChild(style);
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

function textWithoutOwnTitle(streamEl) {
  const clone = streamEl.cloneNode(true);
  clone.querySelectorAll(".stream-title, .v9-stream-title").forEach((el) => el.remove());
  return (clone.textContent || "")
    .replace(/\s+/g, " ")
    .replace(/[\[\]()[\]{}־–—:;,.]/g, "")
    .trim();
}

function hasRealStreamBody(streamEl) {
  if (!streamEl) return false;

  const noteEls = Array.from(
    streamEl.querySelectorAll(".note, .note-inline, .note-part, .note-child")
  );

  for (const note of noteEls) {
    const txt = (note.textContent || "")
      .replace(/\s+/g, " ")
      .replace(/[\[\]()[\]{}־–—:;,.]/g, "")
      .trim();
    if (txt.length > 0) return true;
  }

  return textWithoutOwnTitle(streamEl).length > 0;
}

function pruneEmptyStreams(root) {
  if (!root || !root.querySelectorAll) return 0;

  let removed = 0;

  for (const stream of Array.from(root.querySelectorAll(".page .stream[data-stream]"))) {
    if (hasRealStreamBody(stream)) {
      stream.classList.remove("ravtext-empty-stream");
      continue;
    }

    stream.classList.add("ravtext-empty-stream");
    stream.remove();
    removed++;
  }

  for (const wrap of Array.from(root.querySelectorAll(".page .page-streams"))) {
    if (!wrap.querySelector(".stream")) wrap.remove();
  }

  return removed;
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
    return { ok: true, maxOverflow: 0, pages: [], removedEmptyStreams: 0 };
  }

  injectLiveStabilityCss();
  const removedEmptyStreams = pruneEmptyStreams(root);

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
    removedEmptyStreams,
  };
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
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1.5;
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 260;

  injectLiveStabilityCss();

  try {
    localStorage.removeItem(OLD_AUTO_SAFETY_KEY);
    sessionStorage.removeItem(OLD_SESSION_ATTEMPTS_KEY);
  } catch (_) {}

  let timer = null;
  let running = false;

  async function run(reason = "unknown") {
    if (running) return;
    running = true;

    try {
      await afterPaint();
      const result = validateRenderedPages(getPagesContainer(), { tolerance });
      window.__RAVTEXT_LAST_FINAL_LAYOUT_REPORT__ = result;

      if (result.removedEmptyStreams > 0) {
        console.warn("[final-layout-guard] removed empty stream headings", {
          reason,
          removedEmptyStreams: result.removedEmptyStreams,
        });
      }

      if (!result.ok) {
        console.warn("[final-layout-guard] final overflow detected; diagnostic only", {
          reason,
          maxOverflow: Math.round(result.maxOverflow * 100) / 100,
          maxBottomOverflow: Math.round(result.maxBottomOverflow * 100) / 100,
          pages: result.pages.length,
          result,
        });

        window.dispatchEvent(new CustomEvent("ravtext:final-overflow-detected", {
          detail: result,
        }));
      }
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
    obs.observe(container, { childList: true, subtree: true, characterData: true, attributes: true });
    container.__ravtextFinalLayoutGuardObserver = obs;
  }

  window.addEventListener("resize", () => schedule("resize"));
  window.addEventListener("ravtext:styles-changed", () => schedule("styles-changed"));
  window.addEventListener("ravtext:stream-order-changed", () => schedule("stream-order-changed"));
  window.addEventListener("ravtext:engine-rendered", () => schedule("engine-rendered"));
  window.addEventListener("ravtext:features-reserved-space-changed", () => schedule("reserved-space-changed"));

  window.__RAVTEXT_FINAL_LAYOUT_GUARD__ = {
    run,
    schedule,
    validate: () => validateRenderedPages(getPagesContainer(), { tolerance }),
    resetSafety: () => {
      try {
        localStorage.removeItem(OLD_AUTO_SAFETY_KEY);
        sessionStorage.removeItem(OLD_SESSION_ATTEMPTS_KEY);
      } catch (_) {}
      schedule("reset");
    },
  };

  schedule("install");
}