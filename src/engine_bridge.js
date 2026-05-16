import * as core from "./engine_bridge_core.js";
export * from "./engine_bridge_core.js";

let _renderToken = 0;
let _debounceTimer = null;
let _renderPaused = false;
let _renderRunning = false;
let _renderScheduled = false;
let _pendingWhilePaused = false;
let _lastRenderArgs = null;
let _lastPagesContainer = null;
let _lastStableHtml = null;
let _lastStableScrollTop = 0;
let _cancelledToken = 0;

const LIVE_RENDER_DELAY_MS = 650;

function emitRenderState(reason = "") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("ravtext:render-state", {
    detail: getEngineRenderState(reason),
  }));
}

export function getEngineRenderState(reason = "") {
  return {
    paused: _renderPaused,
    running: _renderRunning,
    scheduled: _renderScheduled,
    pendingWhilePaused: _pendingWhilePaused,
    reason,
  };
}

function setStatus(text) {
  const el = typeof document !== "undefined" ? document.getElementById("status") : null;
  if (el) el.textContent = text;
}

function snapshotPages(pagesContainer) {
  if (!pagesContainer) return;
  _lastPagesContainer = pagesContainer;
  _lastStableHtml = pagesContainer.innerHTML;
  _lastStableScrollTop = pagesContainer.scrollTop || 0;
}

function restoreSnapshot() {
  const el = _lastPagesContainer;
  if (!el || _lastStableHtml == null) return;
  el.innerHTML = _lastStableHtml;
  el.scrollTop = _lastStableScrollTop || 0;
}

export function setEngineRenderPaused(paused, options = {}) {
  const flush = options.flush !== false;
  _renderPaused = !!paused;

  if (_renderPaused) {
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = null;
    _renderScheduled = false;
    setStatus("Render paused. Changes will be collected until resume.");
    emitRenderState("paused");
    return;
  }

  const shouldFlush = flush && _pendingWhilePaused && _lastRenderArgs;
  _pendingWhilePaused = false;
  setStatus(shouldFlush ? "Resuming render..." : "Render active.");
  emitRenderState("resumed");

  if (shouldFlush) {
    scheduleEngineRender(_lastRenderArgs.paneManager, _lastRenderArgs.pagesContainer, _lastRenderArgs.pdfToolbarApi, { force: true });
  }
}

export function cancelEngineRender(reason = "user") {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = null;
  _renderToken++;
  _cancelledToken = _renderToken;
  _renderRunning = false;
  _renderScheduled = false;
  restoreSnapshot();
  setStatus(reason === "user" ? "Render stopped. Previous preview was kept." : "Render cancelled.");
  emitRenderState("cancelled");
}

export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null, options = {}) {
  const force = !!options.force;
  _lastRenderArgs = { paneManager, pagesContainer, pdfToolbarApi };

  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = null;

  if (_renderPaused && !force) {
    _pendingWhilePaused = true;
    _renderToken++;
    _renderScheduled = false;
    _renderRunning = false;
    setStatus("Render paused. Pending changes were not rendered yet.");
    emitRenderState("pending-paused");
    return;
  }

  snapshotPages(pagesContainer);
  _renderScheduled = true;
  setStatus("Rendering...");
  emitRenderState("scheduled");

  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _renderScheduled = false;
    _renderRunning = true;
    _renderToken++;
    emitRenderState("running");

    try {
      core.scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi);
    } catch (err) {
      _renderRunning = false;
      emitRenderState("error");
      throw err;
    }
  }, force ? 0 : LIVE_RENDER_DELAY_MS);
}

function ensureRenderControlStyle() {
  if (typeof document === "undefined" || document.getElementById("ravtext-render-controller-style")) return;
  const style = document.createElement("style");
  style.id = "ravtext-render-controller-style";
  style.textContent = `
    #btn-render.render-running { background: #b91c1c !important; color: #fff !important; border-color: #991b1b !important; animation: ravtext-render-pulse 0.8s ease-in-out infinite; }
    @keyframes ravtext-render-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .72; transform: scale(1.03); } }
    .btn-render-pause { margin-inline-start: 6px; white-space: nowrap; }
    .btn-render-pause.active { background: #f59e0b !important; color: #111827 !important; border-color: #d97706 !important; font-weight: 700; }
    body.render-paused #status { color: #92400e; }
    body.render-running #status { color: #991b1b; }
  `;
  document.head.appendChild(style);
}

function ensurePauseButton() {
  const renderBtn = document.getElementById("btn-render");
  if (!renderBtn || document.getElementById("btn-render-pause")) return;
  const pauseBtn = document.createElement("button");
  pauseBtn.id = "btn-render-pause";
  pauseBtn.type = "button";
  pauseBtn.className = "btn-render-pause";
  pauseBtn.textContent = "Pause render";
  pauseBtn.title = "Pause automatic rendering while editing several things";
  renderBtn.insertAdjacentElement("afterend", pauseBtn);
}

function syncRenderButtons() {
  if (typeof document === "undefined") return;
  const state = getEngineRenderState();
  const renderBtn = document.getElementById("btn-render");
  const pauseBtn = document.getElementById("btn-render-pause");

  if (renderBtn) {
    const busy = state.running || state.scheduled;
    renderBtn.classList.toggle("render-running", busy);
    renderBtn.setAttribute("aria-busy", busy ? "true" : "false");
    renderBtn.textContent = busy ? "Stop render" : "Render";
    renderBtn.title = busy ? "Stop the current render" : "Render now";
  }

  if (pauseBtn) {
    pauseBtn.classList.toggle("active", state.paused);
    pauseBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    pauseBtn.textContent = state.paused ? (state.pendingWhilePaused ? "Resume and render" : "Resume render") : "Pause render";
  }

  document.body.classList.toggle("render-paused", state.paused);
  document.body.classList.toggle("render-running", state.running || state.scheduled);
}

function installRenderControlUi() {
  if (typeof document === "undefined") return;
  ensureRenderControlStyle();
  ensurePauseButton();
  syncRenderButtons();

  const renderBtn = document.getElementById("btn-render");
  if (renderBtn && renderBtn.dataset.renderControllerStop !== "1") {
    renderBtn.dataset.renderControllerStop = "1";
    renderBtn.addEventListener("click", (ev) => {
      const state = getEngineRenderState();
      if (state.running || state.scheduled) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cancelEngineRender("user");
      }
    }, true);
  }

  const pauseBtn = document.getElementById("btn-render-pause");
  if (pauseBtn && pauseBtn.dataset.renderControllerPause !== "1") {
    pauseBtn.dataset.renderControllerPause = "1";
    pauseBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const state = getEngineRenderState();
      setEngineRenderPaused(!state.paused, { flush: true });
    });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("ravtext:render-state", syncRenderButtons);
  window.addEventListener("ravtext:engine-rendered", () => {
    if (_cancelledToken && _cancelledToken >= _renderToken) {
      restoreSnapshot();
      setStatus("Render stopped. Previous preview was kept.");
      _cancelledToken = 0;
    }
    _renderRunning = false;
    _renderScheduled = false;
    emitRenderState("finished");
  });
  const installSoon = () => {
    let tries = 0;
    const tick = () => { installRenderControlUi(); if (++tries < 30) setTimeout(tick, 250); };
    tick();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installSoon, { once: true });
  else setTimeout(installSoon, 0);
}
