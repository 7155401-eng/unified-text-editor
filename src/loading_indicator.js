// loading_indicator.js
// LOADING_INDICATOR_20260907
//
// A customer asked whether anything on screen says "I am working". Until now
// nothing did: the only sign of life was one line of text in #status, up in the
// header, which is easy to miss while you are looking at the pages area.
//
// This module adds one small pill in the bottom corner with a turning ring next
// to it. It does not invent a second status system - it MIRRORS #status, so
// there is still exactly one sentence in the app describing what is happening.
//
// It is shown for two things only:
//   1. start-up, from the moment the app boots until the document is loaded;
//   2. a render, from the moment the engine starts until the engine reports it
//      has finished - success, empty document, cancellation or crash alike.
//
// Disappearing reliably is the whole point, so it is switched off by every one
// of the engine's end events AND by a hard safety timer. A stuck spinner would
// be worse than no spinner at all.
//
// It never covers the toolbars: it is pinned to the bottom corner, it ignores
// the mouse (pointer-events: none) and it sits below the modal layer.
//
// Anti-churn rule (the app once had a self-feeding mutation loop): every write
// to the DOM is compared with what is already there and skipped when equal.

const EL_ID = "ravtext-loading";
const STYLE_ID = "ravtext-loading-style";

// "loading" - the same word the installer banner in index.html already uses.
const STARTUP_TEXT = "טוען…";

// If the engine ever fails to announce its own end, the pill still goes away.
const SAFETY_MS = 45000;
// While visible we re-read #status so the pill always shows the live sentence.
const MIRROR_MS = 400;
// A finished render is often followed immediately by the engine's own
// self-correction pass. Measured: two render cycles per edit, with a gap of
// well under a second between them. Hiding on the first end and showing again
// a moment later would read as a flicker, so an ending waits this long to see
// whether another render is already on its way.
const SETTLE_MS = 700;
// The start-up pill must be on screen long enough to actually be seen.
const STARTUP_MIN_MS = 700;

let pill = null;
let labelEl = null;
let startupOn = false;
let renderOn = false;
let safetyTimer = null;
let mirrorTimer = null;
let settleTimer = null;
let lastText = null;
let lastVisible = null;
let startupShownAt = 0;
let startupEndRequested = false;
let inFlight = 0;

function statusText() {
  const el = document.getElementById("status");
  const text = el ? (el.textContent || "").trim() : "";
  return text;
}

function addStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${EL_ID} {
      position: fixed;
      inset-block-end: 18px;
      inset-inline-start: 18px;
      z-index: 2147482000;
      display: none;
      align-items: center;
      gap: 8px;
      max-width: min(52vw, 460px);
      padding: 8px 14px;
      border-radius: 999px;
      background: rgba(17, 24, 39, .92);
      color: #f8fafc;
      font: 600 13px/1.5 "Segoe UI", system-ui, sans-serif;
      box-shadow: 0 8px 22px rgba(15, 23, 42, .28);
      direction: rtl;
      text-align: right;
      pointer-events: none;
      user-select: none;
    }
    #${EL_ID}[data-visible="1"] { display: flex; }
    #${EL_ID} .rt-loading-ring {
      inline-size: 14px;
      block-size: 14px;
      flex: 0 0 auto;
      border-radius: 50%;
      border: 2px solid rgba(248, 250, 252, .28);
      border-block-start-color: #f8fafc;
      animation: rt-loading-spin .8s linear infinite;
    }
    #${EL_ID} .rt-loading-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @keyframes rt-loading-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      #${EL_ID} .rt-loading-ring { animation-duration: 2.4s; }
    }
    body.light-theme #${EL_ID} {
      background: rgba(30, 41, 59, .94);
      color: #f8fafc;
    }
  `;
  document.head.appendChild(style);
}

function ensureEl() {
  if (pill && pill.isConnected) return pill;
  addStyle();
  pill = document.getElementById(EL_ID);
  if (!pill) {
    pill = document.createElement("div");
    pill.id = EL_ID;
    pill.dir = "rtl";
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.hidden = true;
    const ring = document.createElement("span");
    ring.className = "rt-loading-ring";
    ring.setAttribute("aria-hidden", "true");
    labelEl = document.createElement("span");
    labelEl.className = "rt-loading-label";
    pill.appendChild(ring);
    pill.appendChild(labelEl);
    (document.body || document.documentElement).appendChild(pill);
  } else {
    labelEl = pill.querySelector(".rt-loading-label");
  }
  return pill;
}

function wantedText() {
  // While a render runs, #status already carries the engine's own sentence.
  // During start-up there is no engine sentence yet, so we use the app's own
  // "loading" word.
  if (renderOn) {
    const live = statusText();
    if (live) return live;
  }
  return STARTUP_TEXT;
}

// The only place that touches the DOM. Writes nothing when nothing changed.
function paint() {
  const visible = !!(startupOn || renderOn);
  if (!visible && lastVisible === false) return;
  const el = ensureEl();
  if (!el) return;

  if (visible) {
    const text = wantedText();
    if (text !== lastText) {
      lastText = text;
      if (labelEl && labelEl.textContent !== text) labelEl.textContent = text;
    }
  }

  if (visible !== lastVisible) {
    lastVisible = visible;
    if (el.hidden !== !visible) el.hidden = !visible;
    const flag = visible ? "1" : "0";
    if (el.getAttribute("data-visible") !== flag) el.setAttribute("data-visible", flag);
  }

  if (visible && !mirrorTimer) {
    mirrorTimer = setInterval(paint, MIRROR_MS);
  } else if (!visible && mirrorTimer) {
    clearInterval(mirrorTimer);
    mirrorTimer = null;
    lastText = null;
  }
}

function armSafety() {
  clearTimeout(safetyTimer);
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    renderOn = false;
    paint();
  }, SAFETY_MS);
}

function disarmSafety() {
  clearTimeout(safetyTimer);
  safetyTimer = null;
}

// The start-up phase ends when three things are all true: the caller says the
// document has loaded, the browser says the page has loaded, and the pill has
// been on screen long enough to be seen. Otherwise a fast start would flash it
// for 20ms, which is the same as not having it at all.
function tryFinishStartup() {
  if (!startupEndRequested || !startupOn) return;
  if (document.readyState !== "complete") return;
  const shownFor = Date.now() - startupShownAt;
  if (shownFor < STARTUP_MIN_MS) {
    setTimeout(tryFinishStartup, STARTUP_MIN_MS - shownFor);
    return;
  }
  startupOn = false;
  paint();
}

export function setStartupLoading(on) {
  if (on) {
    startupEndRequested = false;
    if (startupOn) return;
    startupOn = true;
    startupShownAt = Date.now();
    paint();
    return;
  }
  startupEndRequested = true;
  if (typeof window !== "undefined" && document.readyState !== "complete") {
    window.addEventListener("load", tryFinishStartup, { once: true });
  }
  tryFinishStartup();
}

export function setRenderLoading(on) {
  if (on) {
    inFlight++;
    clearTimeout(settleTimer);
    settleTimer = null;
    armSafety();
    if (renderOn) return;
    renderOn = true;
    paint();
    return;
  }
  inFlight = Math.max(0, inFlight - 1);
  disarmSafety();
  if (!renderOn) return;
  // Wait a moment before going dark, in case the engine immediately starts its
  // follow-up pass. A new start cancels this timer.
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    renderOn = false;
    paint();
  }, SETTLE_MS);
}

export function installLoadingIndicator() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.__ravtextLoadingInstalled) return;
  window.__ravtextLoadingInstalled = true;

  const start = () => setRenderLoading(true);
  const end = () => setRenderLoading(false);

  // Start: the engine says a render has begun.
  window.addEventListener("ravtext:engine-render-start", start);
  // End: every way a render can finish. "engine-rendered" is dispatched by the
  // engine on success, on an empty document AND from its catch block, so a
  // render that throws switches the pill off exactly like one that succeeds.
  window.addEventListener("ravtext:engine-rendered", end);
  window.addEventListener("ravtext:engine-render-cancelled", end);
  window.addEventListener("ravtext:engine-render-kept", end);

  // If the page is hidden mid-render and comes back, re-check reality rather
  // than trusting a timer that may have been throttled.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) paint();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paint, { once: true });
  }

  window.__ravtextLoading = {
    startup: setStartupLoading,
    renderStart: start,
    renderEnd: end,
    isVisible: () => {
      const el = document.getElementById(EL_ID);
      if (!el || el.hidden) return false;
      return getComputedStyle(el).display !== "none";
    },
    state: () => ({ startupOn, renderOn, text: lastText }),
  };
}
