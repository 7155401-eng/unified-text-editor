(() => {
  const LIVE_KEY = 'ravtext.liveRender';
  const PAUSE_KEY = 'ravtext.renderPaused';
  const PREV_LIVE_KEY = 'ravtext.renderPaused.prevLiveRender';
  const STOP_GUARD_MS = 15000;

  const T = {
    render: '\u27f3 \u05e8\u05e0\u05d3\u05e8',
    stop: '\u25a0 \u05e2\u05e6\u05d5\u05e8 \u05e8\u05d9\u05e0\u05d3\u05d5\u05e8',
    pause: '\u23f8 \u05d4\u05e9\u05d4\u05d9\u05d9\u05ea \u05e8\u05d9\u05e0\u05d3\u05d5\u05e8',
    resume: '\u25b6 \u05d4\u05de\u05e9\u05da \u05e8\u05d9\u05e0\u05d3\u05d5\u05e8',
    resumeRender: '\u25b6 \u05d4\u05de\u05e9\u05da \u05d5\u05e8\u05e0\u05d3\u05e8',
    paused: '\u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05de\u05d5\u05e9\u05d4\u05d4 \u2014 \u05d0\u05e4\u05e9\u05e8 \u05dc\u05e9\u05e0\u05d5\u05ea \u05db\u05de\u05d4 \u05d3\u05d1\u05e8\u05d9\u05dd \u05d1\u05dc\u05d9 \u05dc\u05d4\u05de\u05ea\u05d9\u05df.',
    pending: '\u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05de\u05d5\u05e9\u05d4\u05d4 \u2014 \u05d4\u05e9\u05d9\u05e0\u05d5\u05d9\u05d9\u05dd \u05e0\u05e9\u05de\u05e8\u05d5, \u05d0\u05d1\u05dc \u05e2\u05d3\u05d9\u05d9\u05df \u05dc\u05d0 \u05e8\u05d5\u05e0\u05d3\u05e8\u05d5.',
    resumeStatus: '\u05d9\u05d5\u05e6\u05d0 \u05de\u05d4\u05e9\u05d4\u05d9\u05d9\u05d4 \u2014 \u05de\u05e8\u05e0\u05d3\u05e8 \u05e4\u05e2\u05dd \u05d0\u05d7\u05ea \u05d0\u05ea \u05d4\u05de\u05e6\u05d1 \u05d4\u05d0\u05d7\u05e8\u05d5\u05df...',
    active: '\u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05e4\u05e2\u05d9\u05dc.',
    stopped: '\u05d4\u05e8\u05d9\u05e0\u05d3\u05d5\u05e8 \u05e0\u05e2\u05e6\u05e8. \u05d4\u05ea\u05e6\u05d5\u05d2\u05d4 \u05d4\u05e7\u05d5\u05d3\u05de\u05ea \u05e0\u05e9\u05d0\u05e8\u05d4 \u05db\u05e4\u05d9 \u05e9\u05d4\u05d9\u05d0.'
  };

  const state = {
    installed: false,
    paused: false,
    pending: false,
    running: false,
    stoppedUntil: 0,
    snapshotHtml: null,
    snapshotScrollTop: 0,
  };

  const byId = (id) => document.getElementById(id);
  const pages = () => byId('pages-container') || document.querySelector('.pages-container');
  const renderButton = () => byId('btn-render');
  const pauseButton = () => byId('btn-render-pause');

  function setStatus(text) {
    const el = byId('status');
    if (el) el.textContent = text;
  }

  function liveEnabled() {
    const value = localStorage.getItem(LIVE_KEY);
    return value === null ? true : value === '1';
  }

  function setLiveEnabled(on) {
    localStorage.setItem(LIVE_KEY, on ? '1' : '0');
    const cb = byId('live-render-toggle');
    if (cb) cb.checked = !!on;
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
    if (byId('ravtext-render-controls-style')) return;
    const style = document.createElement('style');
    style.id = 'ravtext-render-controls-style';
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
      body.render-paused #status { color: #92400e; }
      body.render-running #status { color: #991b1b; }
    `;
    document.head.appendChild(style);
  }

  function ensurePauseButton() {
    const render = renderButton();
    if (!render || pauseButton()) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-render-pause';
    btn.className = 'btn-render-pause';
    btn.textContent = T.pause;
    btn.title = T.pause;
    render.insertAdjacentElement('afterend', btn);
  }

  function paint() {
    const render = renderButton();
    const pause = pauseButton();
    if (render) {
      render.classList.toggle('render-running', state.running);
      render.setAttribute('aria-busy', state.running ? 'true' : 'false');
      render.textContent = state.running ? T.stop : T.render;
      render.title = state.running ? T.stop : T.render;
    }
    if (pause) {
      pause.classList.toggle('active', state.paused);
      pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
      pause.textContent = state.paused ? (state.pending ? T.resumeRender : T.resume) : T.pause;
    }
    document.body.classList.toggle('render-paused', state.paused);
    document.body.classList.toggle('render-running', state.running);
  }

  function pauseRender() {
    if (state.paused) return;
    localStorage.setItem(PREV_LIVE_KEY, liveEnabled() ? '1' : '0');
    localStorage.setItem(PAUSE_KEY, '1');
    state.paused = true;
    state.pending = false;
    setLiveEnabled(false);
    setStatus(T.paused);
    paint();
  }

  function resumeRender() {
    if (!state.paused) return;
    const prev = localStorage.getItem(PREV_LIVE_KEY);
    localStorage.removeItem(PAUSE_KEY);
    localStorage.removeItem(PREV_LIVE_KEY);
    state.paused = false;
    setLiveEnabled(prev === '0' ? false : true);
    const shouldRender = state.pending;
    state.pending = false;
    paint();
    if (shouldRender && typeof window.__ravtextRerender === 'function') {
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
    if (!target.closest('#panes-container,.ProseMirror,.pane,.toolbar,.ribbon-toolbar,.ribbon-panel')) return;
    state.pending = true;
    setStatus(T.pending);
    paint();
  }

  function wireButtons() {
    ensurePauseButton();
    const render = renderButton();
    const pause = pauseButton();

    if (render && render.dataset.renderPauseStopHook !== '1') {
      render.dataset.renderPauseStopHook = '1';
      render.addEventListener('click', (ev) => {
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

    if (pause && pause.dataset.renderPauseStopHook !== '1') {
      pause.dataset.renderPauseStopHook = '1';
      pause.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (state.paused) resumeRender();
        else pauseRender();
      });
    }
    paint();
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    state.paused = localStorage.getItem(PAUSE_KEY) === '1';
    if (state.paused) setLiveEnabled(false);
    addStyle();
    wireButtons();
    document.addEventListener('input', markPending, true);
    document.addEventListener('change', markPending, true);
    document.addEventListener('paste', markPending, true);
    window.addEventListener('ravtext:engine-rendered', () => {
      if (stoppedGuardActive()) {
        restorePreview();
        setStatus(T.stopped);
      }
      state.running = false;
      paint();
    });
    let count = 0;
    const retry = () => {
      wireButtons();
      if (++count < 24) setTimeout(retry, 250);
    };
    setTimeout(retry, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    setTimeout(install, 0);
  }
})();
