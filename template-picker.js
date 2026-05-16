// template-picker.js — lightweight render controls.
(() => {
  const LIVE = "ravtext.liveRender";
  const PAUSED = "ravtext.renderPaused";
  const PREV = "ravtext.renderPaused.prevLiveRender";
  const state = { paused: false, pending: false, running: false, installed: false };
  const $ = (id) => document.getElementById(id);
  const setStatus = (s) => { const el = $("status"); if (el) el.textContent = s; };
  const liveOn = () => { const v = localStorage.getItem(LIVE); return v === null ? true : v === "1"; };
  const setLive = (on) => { localStorage.setItem(LIVE, on ? "1" : "0"); const cb = $("live-render-toggle"); if (cb) cb.checked = !!on; };

  function addCss() {
    if ($("ravtext-render-controls-style")) return;
    const style = document.createElement("style");
    style.id = "ravtext-render-controls-style";
    style.textContent = `
      #btn-render.render-running{background:#b91c1c!important;color:#fff!important;border-color:#991b1b!important;animation:ravtext-render-pulse .8s ease-in-out infinite}
      @keyframes ravtext-render-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.72;transform:scale(1.03)}}
      .btn-render-pause{margin-inline-start:6px;white-space:nowrap}.btn-render-pause.active{background:#f59e0b!important;color:#111827!important;border-color:#d97706!important;font-weight:700}
      body.render-paused #status{color:#92400e}body.render-running #status{color:#991b1b}
    `;
    document.head.appendChild(style);
  }

  function ensurePauseButton() {
    const r = $("btn-render");
    if (!r || $("btn-render-pause")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.id = "btn-render-pause";
    b.className = "btn-render-pause";
    b.textContent = "⏸ השהיית רינדור";
    b.title = "השהה רינדור אוטומטי בזמן שינוי כמה דברים";
    r.insertAdjacentElement("afterend", b);
  }

  function ui() {
    const r = $("btn-render");
    const p = $("btn-render-pause");
    if (r) {
      r.classList.toggle("render-running", state.running);
      r.textContent = state.running ? "■ עצור רינדור" : "⟳ רנדר";
      r.title = state.running ? "עצור את הרינדור הנוכחי מבחינת המשתמש" : "רנדר עכשיו";
    }
    if (p) {
      p.classList.toggle("active", state.paused);
      p.textContent = state.paused ? (state.pending ? "▶ המשך ורנדר" : "▶ המשך רינדור") : "⏸ השהיית רינדור";
      p.title = state.paused ? "בטל השהיה ורנדר פעם אחת את המצב האחרון" : "השהה רינדור אוטומטי";
    }
    document.body.classList.toggle("render-paused", state.paused);
    document.body.classList.toggle("render-running", state.running);
  }

  function pause() {
    localStorage.setItem(PREV, liveOn() ? "1" : "0");
    localStorage.setItem(PAUSED, "1");
    state.paused = true;
    state.pending = false;
    setLive(false);
    setStatus("רינדור מושהה — אפשר לשנות כמה דברים בלי להמתין.");
    ui();
  }

  function resume() {
    const prev = localStorage.getItem(PREV);
    localStorage.removeItem(PAUSED);
    localStorage.removeItem(PREV);
    state.paused = false;
    setLive(prev === "0" ? false : true);
    const shouldRender = state.pending;
    state.pending = false;
    ui();
    if (shouldRender && typeof window.__ravtextRerender === "function") {
      state.running = true;
      ui();
      setStatus("יוצא מהשהיית רינדור — מרנדר פעם אחת את המצב האחרון...");
      window.__ravtextRerender();
    } else {
      setStatus("רינדור פעיל.");
    }
  }

  function wire() {
    ensurePauseButton();
    const r = $("btn-render");
    const p = $("btn-render-pause");
    if (r && r.dataset.renderControlsWired !== "1") {
      r.dataset.renderControlsWired = "1";
      r.addEventListener("click", (ev) => {
        if (state.running) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          state.running = false;
          setStatus("הרינדור נעצר מבחינת המשתמש. אפשר ללחוץ רנדר שוב לפי הצורך.");
          ui();
          return;
        }
        state.running = true;
        ui();
      }, true);
    }
    if (p && p.dataset.renderPauseWired !== "1") {
      p.dataset.renderPauseWired = "1";
      p.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (state.paused) resume(); else pause();
      });
    }
    ui();
  }

  function markPending(ev) {
    if (!state.paused) return;
    if (!ev.target?.closest?.("#panes-container,.ProseMirror,.pane,.toolbar")) return;
    state.pending = true;
    setStatus("רינדור מושהה — השינויים נשמרו, אבל עדיין לא רונדרו.");
    ui();
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    state.paused = localStorage.getItem(PAUSED) === "1";
    if (state.paused) setLive(false);
    addCss();
    wire();
    document.addEventListener("input", markPending, true);
    document.addEventListener("change", markPending, true);
    document.addEventListener("paste", markPending, true);
    window.addEventListener("ravtext:engine-rendered", () => { state.running = false; ui(); });
    let n = 0;
    const retry = () => { wire(); if (++n < 24) setTimeout(retry, 250); };
    setTimeout(retry, 250);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true }); else setTimeout(install, 0);
})();
