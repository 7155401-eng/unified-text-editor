(() => {
  const keyLive = 'ravtext.liveRender';
  const keyPaused = 'ravtext.renderPaused';
  const keyPrev = 'ravtext.renderPaused.prevLiveRender';
  const state = { paused: false, pending: false, busy: false };
  const byId = id => document.getElementById(id);
  function setStatus(text) { const el = byId('status'); if (el) el.textContent = text; }
  function liveEnabled() { const v = localStorage.getItem(keyLive); return v === null ? true : v === '1'; }
  function setLiveEnabled(on) { localStorage.setItem(keyLive, on ? '1' : '0'); const cb = byId('live-render-toggle'); if (cb) cb.checked = !!on; }
  function addStyle() {
    if (byId('ravtext-render-control-style')) return;
    const s = document.createElement('style');
    s.id = 'ravtext-render-control-style';
    s.textContent = '#btn-render.render-busy{background:#b91c1c!important;color:#fff!important;border-color:#991b1b!important;animation:rtPulse .8s ease-in-out infinite}@keyframes rtPulse{0%,100%{opacity:1}50%{opacity:.7}}.btn-render-pause.active{background:#f59e0b!important;color:#111827!important;font-weight:700}';
    document.head.appendChild(s);
  }
  function ensurePauseButton() {
    const render = byId('btn-render');
    if (!render || byId('btn-render-pause')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-render-pause';
    btn.className = 'btn-render-pause';
    btn.textContent = 'pause render';
    btn.title = 'Pause automatic rendering';
    render.insertAdjacentElement('afterend', btn);
  }
  function paint() {
    const render = byId('btn-render');
    const pause = byId('btn-render-pause');
    if (render) {
      render.classList.toggle('render-busy', state.busy);
      render.textContent = state.busy ? 'stop render' : 'render';
    }
    if (pause) {
      pause.classList.toggle('active', state.paused);
      pause.textContent = state.paused ? (state.pending ? 'resume and render' : 'resume render') : 'pause render';
    }
  }
  function pauseRender() {
    localStorage.setItem(keyPrev, liveEnabled() ? '1' : '0');
    localStorage.setItem(keyPaused, '1');
    state.paused = true;
    state.pending = false;
    setLiveEnabled(false);
    setStatus('Render paused. Changes will be collected until resume.');
    paint();
  }
  function resumeRender() {
    const prev = localStorage.getItem(keyPrev);
    localStorage.removeItem(keyPaused);
    localStorage.removeItem(keyPrev);
    state.paused = false;
    setLiveEnabled(prev === '0' ? false : true);
    const shouldRender = state.pending;
    state.pending = false;
    paint();
    if (shouldRender && typeof window.__ravtextRerender === 'function') {
      state.busy = true;
      paint();
      setStatus('Rendering the latest paused changes...');
      window.__ravtextRerender();
    }
  }
  function wire() {
    ensurePauseButton();
    const render = byId('btn-render');
    const pause = byId('btn-render-pause');
    if (render && render.dataset.renderControl !== '1') {
      render.dataset.renderControl = '1';
      render.addEventListener('click', () => { state.busy = true; paint(); }, true);
    }
    if (pause && pause.dataset.renderControl !== '1') {
      pause.dataset.renderControl = '1';
      pause.addEventListener('click', e => { e.preventDefault(); if (state.paused) resumeRender(); else pauseRender(); });
    }
    paint();
  }
  function markPending(e) {
    if (!state.paused) return;
    const t = e.target;
    if (!t || !t.closest || !t.closest('#panes-container,.ProseMirror,.pane,.toolbar')) return;
    state.pending = true;
    setStatus('Render paused. Pending changes are waiting.');
    paint();
  }
  function install() {
    addStyle();
    state.paused = localStorage.getItem(keyPaused) === '1';
    if (state.paused) setLiveEnabled(false);
    wire();
    document.addEventListener('input', markPending, true);
    document.addEventListener('change', markPending, true);
    document.addEventListener('paste', markPending, true);
    window.addEventListener('ravtext:engine-rendered', () => { state.busy = false; paint(); });
    let n = 0;
    const retry = () => { wire(); if (++n < 24) setTimeout(retry, 250); };
    setTimeout(retry, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true }); else setTimeout(install, 0);
})();
