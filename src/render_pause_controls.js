// Surgical render pause/stop controls.
// Loaded through the main application bundle.

const INSTALLED_FLAG = "__ravtextRenderPauseControlsInstalled";

export function installRenderPauseControls() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window[INSTALLED_FLAG]) return;
  window[INSTALLED_FLAG] = true;

  const LIVE_KEY = "ravtext.liveRender";
  const LIVE_USER_CHOICE_KEY = LIVE_KEY + ".userChoice";
  const PAUSE_KEY = "ravtext.renderPaused";
  const PREV_LIVE_KEY = "ravtext.renderPaused.prevLiveRender";
  const STOP_GUARD_MS = 15000;
  const DEFAULT_OFF_GUARD_KEY = "__ravtextLiveRenderDefaultOffGuard";

  const T = {
    render: "⟳ רנדר",
    stop: "■ עצור רינדור",
    pause: "⏸ השהיית רינדור",
    resume: "▶ המשך רינדור",
    resumeRender: "▶ המשך ורנדר",
    paused: "רינדור מושהה — אפשר לערוך כמה דברים בלי להתקוע.",
    pending: "רינדור מושהה — השינויים נשמרו, אבל עדיין לא רונדרו.",
    resumeStatus: "יוצא מהשהייה — מרנדר פעם אחת את המצב האחרון...",
    active: "רינדור פעיל.",
    stopped: "הרינדור נעצר. התצוגה הקודמת נשארה כפי שהיא.",
  };

  const state = {
    paused: false,
    pending: false,
    running: false,
    stoppedUntil: 0,
    snapshotHtml: null,
    snapshotScrollTop: 0,
  };

  const byId = (id) => document.getElementById(id);
  const pages = () => byId("pages-container") || document.querySelector(".pages-container");
  const renderButton = () => byId("btn-render");
  const pauseButton = () => byId("btn-render-pause");

  function applyDefaultOffGuard() {
    try {
      if (!window[DEFAULT_OFF_GUARD_KEY]) window[DEFAULT_OFF_GUARD_KEY] = true;
      if (localStorage.getItem(LIVE_USER_CHOICE_KEY) !== "1") {
        localStorage.setItem(LIVE_KEY, "0");
      }
    } catch (_) {}
  }

  applyDefaultOffGuard();

  function setStatus(text) {
    const el = byId("status");
    if (el) el.textContent = text;
  }

  function liveEnabled() {
    try {
      const userChoice = localStorage.getItem(LIVE_USER_CHOICE_KEY) === "1";
      return userChoice && localStorage.getItem(LIVE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setLiveEnabled(on, options = {}) {
    try {
      if (options.userChoice) localStorage.setItem(LIVE_USER_CHOICE_KEY, "1");
      localStorage.setItem(LIVE_KEY, on ? "1" : "0");
    } catch (_) {}

    const oldCheckbox = byId("live-render-toggle");
    if (oldCheckbox && "checked" in oldCheckbox) oldCheckbox.checked = !!on;

    const btn = byId("live-render-toggle-button");
    if (btn) {
      btn.classList.toggle("active", !!on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "רינדור אוטומטי: פעיל" : "רינדור אוטומטי: כבוי";
      btn.title = on
        ? "לחץ כדי לכבות רינדור אוטומטי אחרי כל שינוי"
        : "לחץ כדי להפעיל רינדור אוטומטי אחרי כל שינוי. עלול להאט או לתקוע במסמכים גדולים.";
    }
  }

  function snapshotPreview() {
    const el = pages();
    if (!el) return;
    state.snapshotHtml = el.innerHTML;
    state.snapshotScrollTop = el.scrollTop || 0;
  }

  function restorePreview() {
    const el = pages();
    if (!el || state.snapshotHtml == null) return;
    el.innerHTML = state.snapshotHtml;
    el.scrollTop = state.snapshotScrollTop || 0;
  }

  function stoppedGuardActive() {
    return Date.now() < state.stoppedUntil;
  }

  function addStyle() {
    if (byId("ravtext-render-controls-style")) return;
    const style = document.createElement("style");
    style.id = "ravtext-render-controls-style";
    style.textContent = `
      #btn-render.render-running {
        background: #b91c1c !important;
        color: #fff !important;
        border-color: #991b1b !important;
        animation: ravtext-render-pulse .8s ease-in-out infinite;
      }
      @keyframes ravtext-render-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: .72; transform: scale(1.03); }
      }
      .btn-render-pause { margin-inline-start: 6px; white-space: nowrap; }
      .btn-render-pause.active {
        background: #f59e0b !important;
        color: #111827 !important;
        border-color: #d97706 !important;
        font-weight: 700;
      }
      .live-render-menu-group {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .live-render-menu-control {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-inline-start: 8px;
        white-space: nowrap;
        font-size: 12px;
      }
      .live-render-toggle-btn.active {
        font-weight: 700;
      }
      .live-render-warning {
        opacity: .78;
        font-size: 11px;
      }
      body.render-paused #status { color: #92400e; }
      body.render-running #status { color: #991b1b; }
    `;
    document.head.appendChild(style);
  }

  function ensurePauseButton() {
    const render = renderButton();
    if (!render || pauseButton()) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "btn-render-pause";
    btn.className = "btn-render-pause";
    btn.textContent = T.pause;
    btn.title = T.pause;
    render.insertAdjacentElement("afterend", btn);
  }

  function removeOldToolbarLiveToggle() {
    const old = byId("live-render-toggle");
    if (!old) return;

    const oldControl = old.closest(".toolbar-checkbox, .live-render-control, label");
    const inNewControl = old.closest(".live-render-menu-control");
    if (!inNewControl && oldControl) {
      oldControl.remove();
    } else if (!inNewControl) {
      old.remove();
    }
  }

  function lowerRibbonHost() {
    const toolbar = byId("main-ribbon-toolbar") || document.querySelector(".ribbon-toolbar.toolbar");
    if (!toolbar) return null;

    let group = byId("live-render-menu-group");
    if (!group) {
      group = document.createElement("div");
      group.id = "live-render-menu-group";
      group.className = "tb-group live-render-menu-group";
      group.dataset.ribbonTab = "streams view advanced home";
      group.title = "רינדור אוטומטי";
      toolbar.appendChild(group);
    }

    group.classList.remove("ribbon-hidden");
    return group;
  }

  function ensureLiveRenderToggleButton() {
    applyDefaultOffGuard();
    removeOldToolbarLiveToggle();

    const host = lowerRibbonHost();
    if (!host) return;

    let wrap = byId("live-render-toggle-button")?.closest(".live-render-menu-control") || null;
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.className = "live-render-menu-control";
      wrap.dir = "rtl";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "live-render-toggle-button";
      btn.className = "live-render-toggle-btn";
      btn.style.cssText = "white-space:nowrap;";

      const warning = document.createElement("span");
      warning.className = "live-render-warning";
      warning.textContent = "⚠ עלול להאט או לתקוע במסמכים גדולים";

      btn.addEventListener("click", () => {
        const next = !liveEnabled();
        if (next) {
          const ok = confirm("רינדור אוטומטי לאחר כל שינוי עלול להאט ואף לתקוע את העריכה במסמכים גדולים. להפעיל בכל זאת?");
          if (!ok) return;
        }

        setLiveEnabled(next, { userChoice: true });
        if (next) {
          try { renderButton()?.click(); } catch (_) {}
        }
      });

      wrap.appendChild(btn);
      wrap.appendChild(warning);
    }

    if (wrap.parentElement !== host) host.appendChild(wrap);
    setLiveEnabled(liveEnabled());
  }

  function paint() {
    const render = renderButton();
    const pause = pauseButton();
    if (render) {
      render.classList.toggle("render-running", state.running);
      render.setAttribute("aria-busy", state.running ? "true" : "false");
      render.textContent = state.running ? T.stop : T.render;
      render.title = state.running ? T.stop : T.render;
    }
    if (pause) {
      pause.classList.toggle("active", state.paused);
      pause.setAttribute("aria-pressed", state.paused ? "true" : "false");
      pause.textContent = state.paused ? (state.pending ? T.resumeRender : T.resume) : T.pause;
    }
    document.body.classList.toggle("render-paused", state.paused);
    document.body.classList.toggle("render-running", state.running);
    setLiveEnabled(liveEnabled());
  }

  function pauseRender() {
    if (state.paused) return;
    try {
      localStorage.setItem(PREV_LIVE_KEY, liveEnabled() ? "1" : "0");
      localStorage.setItem(PAUSE_KEY, "1");
    } catch (_) {}
    state.paused = true;
    state.pending = false;
    setLiveEnabled(false);
    setStatus(T.paused);
    paint();
  }

  function resumeRender() {
    if (!state.paused) return;
    let prev = "0";
    try {
      prev = localStorage.getItem(PREV_LIVE_KEY) || "0";
      localStorage.removeItem(PAUSE_KEY);
      localStorage.removeItem(PREV_LIVE_KEY);
    } catch (_) {}
    state.paused = false;
    setLiveEnabled(prev === "1");
    const shouldRender = state.pending;
    state.pending = false;
    paint();
    if (shouldRender && typeof window.__ravtextRerender === "function") {
      snapshotPreview();
      state.running = true;
      paint();
      setStatus(T.resumeStatus);
      window.__ravtextRerender();
    } else {
      setStatus(T.active);
    }
  }

  function stopRender() {
    state.running = false;
    state.stoppedUntil = Date.now() + STOP_GUARD_MS;
    restorePreview();
    setStatus(T.stopped);
    paint();
  }

  function markPending(ev) {
    if (!state.paused) return;
    const target = ev.target;
    if (!target || !target.closest) return;
    if (!target.closest("#panes-container,.ProseMirror,.pane,.toolbar,.ribbon-toolbar,.ribbon-panel")) return;
    state.pending = true;
    setStatus(T.pending);
    paint();
  }

  function wireButtons() {
    ensurePauseButton();
    ensureLiveRenderToggleButton();

    const render = renderButton();
    const pause = pauseButton();

    if (render && render.dataset.renderPauseStopHook !== "1") {
      render.dataset.renderPauseStopHook = "1";
      render.addEventListener("click", (ev) => {
        if (state.running) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          stopRender();
          return;
        }
        snapshotPreview();
        state.running = true;
        state.stoppedUntil = 0;
        paint();
      }, true);
    }

    if (pause && pause.dataset.renderPauseStopHook !== "1") {
      pause.dataset.renderPauseStopHook = "1";
      pause.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (state.paused) resumeRender();
        else pauseRender();
      });
    }

    paint();
  }

  function installNow() {
    state.paused = localStorage.getItem(PAUSE_KEY) === "1";
    if (state.paused) setLiveEnabled(false);
    applyDefaultOffGuard();
    addStyle();
    wireButtons();
    document.addEventListener("input", markPending, true);
    document.addEventListener("change", markPending, true);
    document.addEventListener("paste", markPending, true);
    window.addEventListener("ravtext:engine-rendered", () => {
      if (stoppedGuardActive()) {
        restorePreview();
        setStatus(T.stopped);
      }
      state.running = false;
      paint();
    });

    let count = 0;
    const retry = () => {
      applyDefaultOffGuard();
      wireButtons();
      if (++count < 80) setTimeout(retry, 250);
    };
    setTimeout(retry, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installNow, { once: true });
  } else {
    setTimeout(installNow, 0);
  }
}

installRenderPauseControls();
