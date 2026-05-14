/*
  final_layout_guard.js

  Manual diagnostic validator only.

  Important architecture rule:
  pagination is decided inside dom_packer, not here.
  This file does not listen to mutation events, does not rerender, and does
  not write page-height safety values. It can be called from the console or
  debug snapshot tools to verify the final output.
*/

const OLD_AUTO_SAFETY_KEY = "ravtext.layout.autoOverflowSafety";
const OLD_SESSION_ATTEMPTS_KEY = "ravtext.layout.autoOverflowAttempts.v1";
const STYLE_ID = "ravtext-final-layout-diagnostic-css";

function installCss() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #pages-container .page .stream[data-stream],
    .pages-container .page .stream[data-stream],
    #pages-container .page .note-child[data-stream],
    .pages-container .page .note-child[data-stream] {
      background: transparent !important;
      box-shadow: none !important;
    }

    #pages-container .page .stream.ravtext-empty-stream,
    .pages-container .page .stream.ravtext-empty-stream {
      display: none !important;
    }

    #pages-container.ravtext-live-measure-all > .page:not(.measure-page),
    .pages-container.ravtext-live-measure-all > .page:not(.measure-page) {
      content-visibility: visible !important;
      contain-intrinsic-size: auto !important;
    }

    .ravtext-final-overflow-detected {
      outline: 1px dashed rgba(220, 38, 38, 0.45);
      outline-offset: -1px;
    }
  `;
  document.head.appendChild(style);
}

function visible(el) {
  if (!el || el.nodeType !== 1) return false;
  const st = getComputedStyle(el);
  return st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
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

function cleanText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/[\[\]()[\]{}־–—:;,.]/g, "")
    .trim();
}

function streamHasRealBody(streamEl) {
  if (!streamEl) return false;

  const notes = Array.from(
    streamEl.querySelectorAll(".note, .note-inline, .note-part, .note-child, .v9-line")
  );

  for (const note of notes) {
    if (cleanText(note.textContent).length > 0) return true;
  }

  const clone = streamEl.cloneNode(true);
  clone.querySelectorAll(".stream-title, .v9-stream-title").forEach((el) => el.remove());
  return cleanText(clone.textContent).length > 0;
}

function markEmptyStreams(root) {
  if (!root || !root.querySelectorAll) return 0;

  let count = 0;
  const streams = root.querySelectorAll(".page .stream[data-stream], .v9-page .stream[data-stream]");

  for (const stream of streams) {
    if (streamHasRealBody(stream)) {
      stream.classList.remove("ravtext-empty-stream");
    } else {
      stream.classList.add("ravtext-empty-stream");
      count++;
    }
  }

  return count;
}

function forceRenderAllPages(root) {
  if (!root) return 0;

  const before = root.querySelectorAll(".page-placeholder").length;

  if (
    typeof root.__pageCount === "number" &&
    typeof root.__realizePage === "function"
  ) {
    for (let i = 0; i < root.__pageCount; i++) {
      root.__realizePage(i);
    }
  }

  root.classList.add("ravtext-live-measure-all");
  return before;
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
  return Array.from(pageEl.querySelectorAll([
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
  ].join(","))).filter((el) => visible(el) && !ignorable(el));
}

export function measureRenderedPageOverflow(pageEl, opts = {}) {
  if (!pageEl || !visible(pageEl)) {
    return { bottom: 0, top: 0, left: 0, right: 0, max: 0, offenders: [] };
  }

  const tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 1.5;
  const pr = pageEl.getBoundingClientRect();

  if (!pr || !pr.width || !pr.height) {
    return { bottom: 0, top: 0, left: 0, right: 0, max: 0, offenders: [] };
  }

  const allowed = {
    top: pr.top - tolerance,
    bottom: pr.bottom + tolerance,
    left: pr.left - tolerance,
    right: pr.right + tolerance,
  };

  let bottom = 0;
  let top = 0;
  let left = 0;
  let right = 0;
  const offenders = [];

  for (const el of candidates(pageEl)) {
    for (const r of rectsFor(el)) {
      const b = r.bottom - allowed.bottom;
      const t = allowed.top - r.top;
      const l = allowed.left - r.left;
      const rr = r.right - allowed.right;
      const m = Math.max(b, t, l, rr);

      if (m > tolerance) {
        offenders.push({
          tag: el.tagName,
          className: String(el.className || ""),
          text: String(el.textContent || "").trim().slice(0, 100),
          bottom: Math.round(b * 100) / 100,
          top: Math.round(t * 100) / 100,
          left: Math.round(l * 100) / 100,
          right: Math.round(rr * 100) / 100,
        });
      }

      bottom = Math.max(bottom, b);
      top = Math.max(top, t);
      left = Math.max(left, l);
      right = Math.max(right, rr);
    }
  }

  bottom = Math.max(0, bottom);
  top = Math.max(0, top);
  left = Math.max(0, left);
  right = Math.max(0, right);

  return {
    bottom,
    top,
    left,
    right,
    max: Math.max(bottom, top, left, right),
    offenders,
  };
}

function frame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function afterPaint() {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (_) {}

  await frame();
  await frame();
  await new Promise((resolve) => setTimeout(resolve, 80));
}

export async function validateRenderedPages(container, opts = {}) {
  const root = typeof container === "function" ? container() : container;
  if (!root || !root.querySelectorAll) {
    return { ok: true, maxOverflow: 0, maxBottomOverflow: 0, pages: [], emptyStreams: 0, forcedPlaceholders: 0 };
  }

  installCss();

  const forcedPlaceholders = opts.forceLive === false ? 0 : forceRenderAllPages(root);
  await afterPaint();

  const emptyStreams = markEmptyStreams(root);
  const pages = Array.from(
    root.querySelectorAll(".page:not(.page-placeholder):not(.ravtext-empty-page), .v9-page")
  ).filter((p) => p && !p.classList.contains("page-placeholder"));

  const bad = [];
  let maxAny = 0;
  let maxBottom = 0;

  for (const page of pages) {
    const overflow = measureRenderedPageOverflow(page, opts);
    maxAny = Math.max(maxAny, overflow.max);
    maxBottom = Math.max(maxBottom, overflow.bottom);

    page.dataset.finalOverflowBottom = String(Math.round(overflow.bottom * 100) / 100);
    page.dataset.finalOverflowMax = String(Math.round(overflow.max * 100) / 100);

    if (overflow.max > (opts.tolerance || 1.5)) {
      page.classList.add("ravtext-final-overflow-detected");
      bad.push({ page, overflow });
    } else {
      page.classList.remove("ravtext-final-overflow-detected");
    }
  }

  return {
    ok: bad.length === 0,
    maxOverflow: maxAny,
    maxBottomOverflow: maxBottom,
    pages: bad,
    emptyStreams,
    forcedPlaceholders,
  };
}

export function installFinalLayoutGuard(options = {}) {
  const getPagesContainer = options.getPagesContainer || (() => document.querySelector("#pages-container"));

  installCss();

  try {
    localStorage.removeItem(OLD_AUTO_SAFETY_KEY);
    sessionStorage.removeItem(OLD_SESSION_ATTEMPTS_KEY);
  } catch (_) {}

  window.__RAVTEXT_FINAL_LAYOUT_GUARD__ = {
    forceRenderAllPages: () => forceRenderAllPages(getPagesContainer()),
    validate: () => validateRenderedPages(getPagesContainer()),
    resetSafety: () => {
      try {
        localStorage.removeItem(OLD_AUTO_SAFETY_KEY);
        sessionStorage.removeItem(OLD_SESSION_ATTEMPTS_KEY);
      } catch (_) {}
    },
  };
}
