// template-picker.js
// Loaded by index.html. Also installs render pause/stop controls for the editor.

(() => {
  const LIVE_RENDER_KEY = "ravtext.liveRender";
  const PAUSED_KEY = "ravtext.renderPaused";
  const PREV_LIVE_KEY = "ravtext.renderPaused.prevLiveRender";
  const STOP_GUARD_MS = 12000;

  const state = {
    installed: false,
    paused: false,
    pendingWhilePaused: false,
    running: false,
    stopped: false,
    stopUntil: 0,
    snapshotHtml: null,
    snapshotScrollTop: 0,
    suppressObserver: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(text) {
    const status = $("status");
    if (status) status.textContent = text;
  }

  function getPagesContainer() {
    return $("pages-container") || document.querySelector(".pages-container");
  }

  function getRenderButton() {
    return $("btn-render");
  }

  function getPauseButton() {
    return $("btn-render-pause");
  }

  function getLiveRenderToggle() {
    return $("live-render-toggle");
  }

  function snapshotCurrentOutput() {
    const pages = getPagesContainer();
    if (!pages) return;
    state.snapshotHtml = pages.innerHTML;
    state.snapshotScrollTop = pages.scrollTop || 0;
  }

  function restoreStoppedSnapshot() {
    const pages = getPagesContainer();
    if (!pages || state.snapshotHtml == null) return;

    state.suppressObserver = true;
    try {
      pages.innerHTML = state.snapshotHtml;
      pages.scrollTop = state.snapshotScrollTop || 0;
    } finally {
      requestAnimationFrame(() => {
        state.suppressObserver = false;
      });
    }
  }

  function isStoppedGuardActive() {
    return state.stopped && Date.now() < state.stopUntil;
  }

  function markRunning() {
    if (!state.running) snapshotCurrentOutput();
    state.running = true;
    state.stopped = false;
    updateRenderControlsUi();
  }

  function markFinished() {
    if (isStoppedGuardActive()) {
      restoreStoppedSnapshot();
      setStatus("הרינדור נעצר. התצוגה הקודמת נשארה כפי שהיא.");
    }
    state.running = false;
    state.stopped = false;
    state.stopUntil = 0;
    updateRenderControlsUi();
  }

  function stopCurrentRender() {
    if (state.snapshotHtml == null) snapshotCurrentOutput();
    state.running = false;
    state.stopped = true;
    state.stopUntil = Date.now() + STOP_GUARD_MS;
    restoreStoppedSnapshot();
    setStatus("הרינדור נעצר. התצוגה הקודמת נשארה כפי שהיא.");
    updateRenderControlsUi();
  }

  function setLiveRenderEnabled(enabled) {
    localStorage.setItem(LIVE_RENDER_KEY, enabled ? "1" : "0");
    const cb = getLiveRenderToggle();
    if (cb) cb.checked = !!enabled;
  }

  function getStoredLiveRenderEnabled() {
    const v = localStorage.getItem(LIVE_RENDER_KEY);
    return v === null ? true : v === "1";
  }

  function pauseRender() {
    if (state.paused) return;

    localStorage.setItem(PREV_LIVE_KEY, getStoredLiveRenderEnabled() ? "1" : "0");
    localStorage.setItem(PAUSED_KEY, "1");
    state.paused = true;
    state.pendingWhilePaused = false;

    setLiveRenderEnabled(false);
    if (state.running) stopCurrentRender();
    setStatus("רינדור מושהה — אפשר לשנות כמה דברים בלי להמתין.");
    updateRenderControlsUi();
  }

  function resumeRenderAndFlush() {
    if (!state.paused) return;

    const prev = localStorage.getItem(PREV_LIVE_KEY);
    localStorage.removeItem(PAUSED_KEY);
    localStorage.removeItem(PREV_LIVE_KEY);
    state.paused = false;

    // When leaving pause mode, restore live render unless it was explicitly off.
    setLiveRenderEnabled(prev === "0" ? false : true);

    const shouldRender = state.pendingWhilePaused;
    state.pendingWhilePaused = false;
    updateRenderControlsUi();

    if (shouldRender && typeof window.__ravtextRerender === "function") {
      setStatus("יוצא מהשהיית רינדור — מרנדר פעם אחת את המצב האחרון...");
      snapshotCurrentOutput();
      state.running = true;
      updateRenderControlsUi();
      window.__ravtextRerender();
    } else {
      setStatus("רינדור פעיל.");
    }
  }

  function markPendingWhilePaused() {
    if (!state.paused) return;
    state.pendingWhilePaused = true;
    setStatus("רינדור מושהה — השינויים נשמרו, אבל עדיין לא רונדרו.");
    updateRenderControlsUi();
  }

  function ensurePauseButton() {
    const renderBtn = getRenderButton();
    if (!renderBtn || getPauseButton()) return;

    const pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.id = "btn-render-pause";
    pauseBtn.className = "btn-render-pause";
    pauseBtn.title = "השהה רינדור אוטומטי בזמן שינוי כמה דברים";
    pauseBtn.textContent = "⏸ השהיית רינדור";

    renderBtn.insertAdjacentElement("afterend", pauseBtn);
  }

  function updateRenderControlsUi() {
    const renderBtn = getRenderButton();
    const pauseBtn = getPauseButton();

    if (renderBtn) {
      const busy = state.running || isStoppedGuardActive();
      renderBtn.classList.toggle("render-running", !!state.running);
      renderBtn.classList.toggle("render-stopped", isStoppedGuardActive());
      renderBtn.setAttribute("aria-busy", state.running ? "true" : "false");
      renderBtn.textContent = state.running ? "■ עצור רינדור" : "⟳ רנדר";
      renderBtn.title = state.running
        ? "עצור את הרינדור שרץ עכשיו והשאר את התצוגה הקודמת"
        : "רנדר עכשיו";
      renderBtn.disabled = false;
      renderBtn.classList.add("btn-render-prominent");
      renderBtn.dataset.renderBusy = busy ? "1" : "0";
    }

    if (pauseBtn) {
      pauseBtn.classList.toggle("active", state.paused);
      pauseBtn.textContent = state.paused
        ? (state.pendingWhilePaused ? "▶ המשך ורנדר" : "▶ המשך רינדור")
        : "⏸ השהיית רינדור";
      pauseBtn.title = state.paused
        ? "בטל השהיה ורנדר פעם אחת את המצב האחרון"
        : "עצור רינדור אוטומטי בזמן שינוי כמה דברים";
      pauseBtn.setAttribute("aria-pressed", state.paused ? "true" : "false");
    }

    document.body.classList.toggle("render-paused", state.paused);
    document.body.classList.toggle("render-running", state.running);
  }

  function installCss() {
    if ($("ravtext-render-controls-style")) return;
    const style = document.createElement("style");
    style.id = "ravtext-render-controls-style";
    style.textContent = `
      #btn-render.render-running {
        background: #b91c1c !important;
        color: #fff !important;
        border-color: #991b1b !important;
        animation: ravtext-render-pulse 0.8s ease-in-out infinite;
      }
      #btn-render.render-running:hover { background: #991b1b !important; }
      @keyframes ravtext-render-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.72; transform: scale(1.03); }
      }
      .btn-render-pause {
        margin-inline-start: 6px;
        white-space: nowrap;
      }
      .btn-render-pause.active {
        background: #f59e0b !important;
        color: #111827 !important;
        border-color: #d97706 !important;
        font-weight: 700;
      }
      body.render-paused #status { color: #92400e; }
      body.render-running #status { color: #991b1b; }
    `;
    document.head.appendChild(style);
  }

  function installRenderButtonCapture() {
    const renderBtn = getRenderButton();
    if (!renderBtn || renderBtn.dataset.renderControlsCapture === "1") return;
    renderBtn.dataset.renderControlsCapture = "1";

    renderBtn.addEventListener("click", (ev) => {
      if (state.running) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        stopCurrentRender();
        return;
      }

      // Manual render is allowed even while pause is active.
      snapshotCurrentOutput();
      state.running = true;
      updateRenderControlsUi();
    }, true);
  }

  function installPauseButton() {
    const pauseBtn = getPauseButton();
    if (!pauseBtn || pauseBtn.dataset.renderControlsWired === "1") return;
    pauseBtn.dataset.renderControlsWired = "1";
    pauseBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.paused) resumeRenderAndFlush();
      else pauseRender();
    });
  }

  function installStatusObserver() {
    const status = $("status");
    if (!status || status.dataset.renderControlsObserved === "1") return;
    status.dataset.renderControlsObserved = "1";

    const observer = new MutationObserver(() => {
      const text = status.textContent || "";
      if (/מרענן|מרנדר|יוצא מהשהיית רינדור/.test(text)) {
        markRunning();
      }
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
  }

  function installPagesGuard() {
    const pages = getPagesContainer();
    if (!pages || pages.dataset.renderControlsGuard === "1") return;
    pages.dataset.renderControlsGuard = "1";

    const observer = new MutationObserver(() => {
      if (state.suppressObserver) return;
      if (!isStoppedGuardActive()) return;
      restoreStoppedSnapshot();
      setStatus("הרינדור נעצר. התצוגה הקודמת נשארה כפי שהיא.");
    });
    observer.observe(pages, { childList: true, subtree: true });
  }

  function installPausedChangeTracking() {
    if (document.body.dataset.renderControlsChangeTracking === "1") return;
    document.body.dataset.renderControlsChangeTracking = "1";

    const maybeEditorEvent = (ev) => {
      const target = ev.target;
      if (!target) return;
      if (target.closest?.("#panes-container, .ProseMirror, .pane")) {
        markPendingWhilePaused();
      }
    };

    document.addEventListener("input", maybeEditorEvent, true);
    document.addEventListener("change", maybeEditorEvent, true);
    document.addEventListener("paste", maybeEditorEvent, true);
    document.addEventListener("keyup", maybeEditorEvent, true);
  }

  function installEngineRenderedListener() {
    if (window.__ravtextRenderControlsRenderedListener) return;
    window.__ravtextRenderControlsRenderedListener = true;
    window.addEventListener("ravtext:engine-rendered", markFinished);
  }

  function syncPauseStateFromStorage() {
    state.paused = localStorage.getItem(PAUSED_KEY) === "1";
    if (state.paused) setLiveRenderEnabled(false);
  }

  function installRenderControls() {
    if (state.installed) return;
    state.installed = true;

    installCss();
    syncPauseStateFromStorage();
    ensurePauseButton();
    installRenderButtonCapture();
    installPauseButton();
    installStatusObserver();
    installPagesGuard();
    installPausedChangeTracking();
    installEngineRenderedListener();
    updateRenderControlsUi();

    // Some toolbar elements are injected/repositioned later by main.js.
    let tries = 0;
    const retry = () => {
      ensurePauseButton();
      installRenderButtonCapture();
      installPauseButton();
      installStatusObserver();
      installPagesGuard();
      updateRenderControlsUi();
      if (++tries < 20) setTimeout(retry, 250);
    };
    setTimeout(retry, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installRenderControls, { once: true });
  } else {
    setTimeout(installRenderControls, 0);
  }
})();
