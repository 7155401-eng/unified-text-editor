/*
  final_layout_guard.js

  Stable live-output guard.

  Rules:
  - Measure actual final rendered output.
  - Never write global page-height safety.
  - Never hide real overflow.
  - Never delete layout DOM after rendering.
  - Only mark/diagnose overflow and hide truly empty stream shells.
*/

const OLD_AUTO_SAFETY_KEY = "ravtext.layout.autoOverflowSafety";
const OLD_SESSION_ATTEMPTS_KEY = "ravtext.layout.autoOverflowAttempts.v1";
const STYLE_ID = "ravtext-live-output-stability-css";

function installCss() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /*
      data-stream highlight backgrounds belong to editor/source markings.
      In printed pages they become ugly blocks because .stream also has data-stream.
      Keep stream text colors, remove only the printed-page background/underline spill.
    */
    #pages-container .page .stream[data-stream],
    .pages-container .page .stream[data-stream],
    #pages-container .page .note-child[data-stream],
    .pages-container .page .note-child[data-stream] {
      background: transparent !important;
      box-shadow: none !important;
    }

    /*
      Empty stream shells must not show orphan titles.
      JS marks these shells; CSS hides them without deleting DOM/state.
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
    el.closest("#__measure_root")
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
          text: String(el.textContent || "").trim().slice(0, 80),
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

export function validateRenderedPages(container, opts = {}) {
  const root = typeof container === "function" ? container() : container;
  if (!root || !root.querySelectorAll) {
    return { ok: true, maxOverflow: 0, maxBottomOverflow: 0, pages: [], emptyStreams: 0 };
  }

  installCss();

  const emptyStreams = markEmptyStreams(root);
  const pages = Array.from(
    root.querySelectorAll(".page:not(.page-placeholder), .v9-page")
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
  };
}

function frame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function afterPaint() {
  await frame();
  await frame();
  await new Promise((resolve) => setTimeout(resolve, 80));
}

export function installFinalLayoutGuard(options = {}) {
  const getPagesContainer = options.getPagesContainer || (() => document.querySelector("#pages-container"));
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1.5;
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 260;

  installCss();

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

      if (result.emptyStreams > 0) {
        console.warn("[final-layout-guard] empty stream shells hidden", {
          reason,
          emptyStreams: result.emptyStreams,
        });
      }

      if (!result.ok) {
        console.warn("[final-layout-guard] final overflow detected", {
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
    obs.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-stream", "data-page-index"],
    });
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