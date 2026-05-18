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

  const TROUBLESHOOTING_STATUS_VALUES = new Set(['troubleshooting', 'פתרון בעיות', 'פתרון-בעיות', 'solutions']);
  const TROUBLESHOOTING_INTRO = 'להלן כמה דברים שאנו יודעים עליהם שיש בהם מגבלות מערכת והפתרון שלהם הוא ידני. יתכן שבהמשך נטפל בבעיות דלהלן שלא יצטרכו עבודה ידנית, לאחר שנסיים את הפיתוחים והתיקונים הדחופים יותר.';
  const TROUBLESHOOTING_ITEMS = [
    ['טקסטים עולים על טקסטים', 'נסו לבצע רענון (רנדור) חוזר.'],
    ['שינויים באמצע רענון', 'שינויים עשויים להיות לא תקפים/ לא חלים אם התוכנה באמצע רענון, נסו שוב לאחר רענון (נכון לעכשיו אין מעקף רשמי למגבלה זו).'],
    ['הדגשות לזרם', 'אם ברצונכם להדגיש זרם שלם במצב גפ"ת, נכון לעכשיו הפתרון הוא דרך הדגשת כל הזרם, אין כרגע פתרון רשמי להדגשת זרם דרך סגנונות.'],
    ['באג ידוע בהחלת סגנון', 'אם עוברים על המקלדת על הסגנונות בחצים למעלה ולמטה כרגע זה נתקע בגלל שהוא מתעכב בכל אחד מהם בהחלת הסגנון, הפתרון להשתמש בסימון הגלילה בצד בלבד.'],
    ['חיתוך דינמי', 'אין כרגע דרך מובטחת לחיתוך דינמי של הזרמים ב100% הצלחה לכל סוג מסמך (שלא יהיו שום עמודים עם רווחים ועם חריגה), ניתן לנסות באמצעות מנוע רינדור חכם (לנסות עם המנוע ובלי המנוע) וכן לשנות את גובה כרית העמוד, ובמידת הצורך לפנות אלינו ונעדכן את הקוד של האתר שיתאים גם למסמך שלכם.'],
    ['הערה ראשונה ככותרת', 'כשמכניסים הערה ראשונה בזרם מסויים ככותרת הזרם של ההערות (שיכנס אוטומטית למסמך ככותרת הזרם, צריך להגדיר זאת בממשק), אין להכניס את ההערה הראשונה  בתחילת המסמך אלא במיקום ההערה הראשונה האמיתית, על מנת לפתור קונפליקט שקיים במערכת כרגע (שהוא מזיז את ההערה הראשונה ה"אמיתית" למיקום ההערה הראשונה המשמשת לכותרת.']
  ];

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

  function escapeText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isTroubleshootingStatus(status) {
    return TROUBLESHOOTING_STATUS_VALUES.has(String(status || '').trim());
  }

  function normalizeTroubleshootingItems(items) {
    const managed = (items || [])
      .filter((item) => isTroubleshootingStatus(item?.status))
      .map((item) => [String(item?.title || '').trim(), String(item?.body || '').trim()])
      .filter(([title, body]) => title && body);
    return managed.length ? managed : TROUBLESHOOTING_ITEMS;
  }

  function troubleshootingItemsHtml(items) {
    return items.map(([title, body]) => `
      <div class="ravtext-troubleshooting-item"><strong>${escapeText(title)}:</strong> ${escapeText(body)}</div>
    `).join('');
  }

  async function refreshTroubleshootingFromAdmin() {
    try {
      const list = byId('ravtext-troubleshooting-list');
      if (!list) return;
      const res = await fetch('/api/bug-reports/public?limit=500', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      list.innerHTML = troubleshootingItemsHtml(normalizeTroubleshootingItems(data?.items || []));
    } catch (_) {
      // אם טעינת הרשומות מהמנהל נכשלת — נשארת ברירת המחדל הקבועה.
    }
  }

  function addTroubleshootingStyle() {
    if (byId('ravtext-troubleshooting-style')) return;
    const style = document.createElement('style');
    style.id = 'ravtext-troubleshooting-style';
    style.textContent = `
      #btn-troubleshooting .header-action-icon { filter: drop-shadow(0 1px 1px rgba(15,23,42,.18)); }
      .ravtext-troubleshooting-backdrop {
        position: fixed; inset: 0; z-index: 9998;
        background: rgba(15,23,42,.55);
        display: flex; align-items: center; justify-content: center;
      }
      .ravtext-troubleshooting-modal {
        direction: rtl; width: 700px; max-width: 92vw; max-height: 88vh;
        overflow: auto; background: #fff; border-radius: 14px;
        box-shadow: 0 12px 34px rgba(15,23,42,.24);
        padding: 22px 24px; font-family: 'Segoe UI', system-ui, sans-serif;
      }
      .ravtext-troubleshooting-head {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        margin-bottom: 14px;
      }
      .ravtext-troubleshooting-head h2 { margin: 0; font-size: 19px; color: #0f172a; }
      .ravtext-troubleshooting-close {
        border: 0; background: transparent; color: #64748b; cursor: pointer;
        font-size: 24px; line-height: 1; padding: 0 6px;
      }
      .ravtext-troubleshooting-intro {
        margin: 0 0 14px; color: #334155; line-height: 1.7; font-size: 14px;
      }
      .ravtext-troubleshooting-item {
        border: 1px solid #dbeafe; border-radius: 10px; padding: 12px 14px;
        background: #f8fafc; margin-bottom: 10px; line-height: 1.65;
        color: #1f2937; font-size: 14px;
      }
      .ravtext-troubleshooting-item strong { color: #0f172a; }
    `;
    document.head.appendChild(style);
  }

  function closeTroubleshootingModal() {
    byId('ravtext-troubleshooting-modal')?.remove();
    document.removeEventListener('keydown', troubleshootingEscHandler);
  }

  function troubleshootingEscHandler(ev) {
    if (ev.key === 'Escape') closeTroubleshootingModal();
  }

  function openTroubleshootingModal() {
    closeTroubleshootingModal();
    addTroubleshootingStyle();
    const backdrop = document.createElement('div');
    backdrop.id = 'ravtext-troubleshooting-modal';
    backdrop.className = 'ravtext-troubleshooting-backdrop';
    backdrop.innerHTML = `
      <div class="ravtext-troubleshooting-modal" role="dialog" aria-modal="true" aria-labelledby="ravtext-troubleshooting-title">
        <div class="ravtext-troubleshooting-head">
          <h2 id="ravtext-troubleshooting-title">🛠️ פתרון בעיות</h2>
          <button type="button" class="ravtext-troubleshooting-close" aria-label="סגור">×</button>
        </div>
        <div class="ravtext-troubleshooting-intro">${escapeText(TROUBLESHOOTING_INTRO)}</div>
        <div id="ravtext-troubleshooting-list">${troubleshootingItemsHtml(TROUBLESHOOTING_ITEMS)}</div>
      </div>
    `;
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) closeTroubleshootingModal(); });
    backdrop.querySelector('.ravtext-troubleshooting-close')?.addEventListener('click', closeTroubleshootingModal);
    document.addEventListener('keydown', troubleshootingEscHandler);
    document.body.appendChild(backdrop);
    refreshTroubleshootingFromAdmin();
  }

  function ensureTroubleshootingHeaderButton() {
    const actions = document.querySelector('.app-header .app-header-actions') || document.querySelector('.app-header-actions');
    if (!actions) return;
    addTroubleshootingStyle();
    let btn = byId('btn-troubleshooting');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-troubleshooting';
      btn.className = 'header-action-btn header-action-btn-icon';
      btn.title = 'פתרון בעיות ומגבלות ידועות';
      btn.setAttribute('aria-label', 'פתרון בעיות ומגבלות ידועות');
      btn.innerHTML = '<span class="header-action-icon">🛠️</span><span class="header-action-text">פתרון בעיות</span>';
      const devUpdates = byId('btn-dev-updates');
      if (devUpdates && devUpdates.parentNode === actions) devUpdates.after(btn);
      else actions.insertBefore(btn, actions.firstElementChild || null);
    }
    if (btn.dataset.troubleshootingBootstrap !== '1') {
      btn.dataset.troubleshootingBootstrap = '1';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        openTroubleshootingModal();
      });
    }
  }

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
    ensureTroubleshootingHeaderButton();
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
      if (++count < 36) setTimeout(retry, 250);
    };
    setTimeout(retry, 250);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    setTimeout(install, 0);
  }
})();


// perfect-render-safety: supplementary UI; keeps existing troubleshooting/pause-stop behavior.
(() => {
  const SNAP_KEY = 'ravtext.snapshots.v1';
  const byId = (id) => document.getElementById(id);
  const all = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const exactResetKeys = ['ravtext.streamSettings.v1','ravtext.globalStreamOverrides.v1','ravtext.streamOrder.v1','ravtext.talmudLayout','ravtext.mishnaWrap','ravtext.mishnaWrap.levels','ravtext.spacing.v1','ravtext.pageSettings.v1','ravtext.documentStyle.v1','ravtext.outputBackground','ravtext.vilnaV9Beta','ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1','ravtext.renderPaused','ravtext.renderPaused.prevLiveRender'];
  const resetPrefixes = ['ravtext.talmudLayout.','ravtext.mishnaWrap.','ravtext.v9.','ravtext.layout.','ravtext.liveOverflow.'];
  const dangerous = new Set(['clear-all','word-import','word-import-streams','auto-parse','auto-parse-paste','split-to-panes','split-special-notes','split-notes-advanced','merge-toggle','toggle-merge','merge-from-panes','pane-clear-storage','pane-remove','reset-system-state']);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const json = (v, fb) => { try { return JSON.parse(v); } catch (_) { return fb; } };
  function addStyle(){ if(byId('perfect-render-safety-style')) return; const s=document.createElement('style'); s.id='perfect-render-safety-style'; s.textContent=[
    '.perfect-btn{margin-inline-start:6px;white-space:nowrap}',
    '.perfect-toast{position:fixed;left:18px;bottom:18px;z-index:2147483100;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.24);direction:rtl;max-width:460px}',
    '.perfect-modal-backdrop{position:fixed;inset:0;z-index:2147483050;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px}',
    '.perfect-modal{direction:rtl;width:min(780px,94vw);max-height:88vh;overflow:auto;background:#fff;color:#111827;border-radius:14px;box-shadow:0 12px 34px rgba(15,23,42,.24);padding:20px 22px;font-family:Segoe UI,system-ui,sans-serif;line-height:1.55}',
    '.perfect-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.perfect-head h2{margin:0;font-size:19px}.perfect-close{border:0;background:transparent;cursor:pointer;font-size:24px;color:#64748b}.perfect-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.perfect-card{border:1px solid #dbeafe;border-radius:10px;padding:10px 12px;background:#f8fafc;margin:8px 0}.pass{color:#166534}.fail{color:#991b1b}',
    '.ravtext-stream-section{border:1px solid var(--rt-line,#d7d0be);border-radius:8px;margin:4px 6px;padding:4px 6px;background:var(--rt-surface-2,#fbf8ef);vertical-align:top}.ravtext-stream-section>summary{cursor:pointer;font-weight:700;color:var(--rt-ink,#222);padding:2px 0}.stream-settings-block.ravtext-grouped{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:flex-start;max-width:100%}.stream-settings-help{display:inline-block;max-width:560px;padding:4px 8px;border:1px solid var(--rt-line,#d7d0be);border-radius:7px;background:var(--rt-surface-2,#fbf8ef);color:var(--rt-ink-2,#5a4d3a);font-size:12px;line-height:1.35}',
    '.applied-pop{position:fixed;z-index:2147483040;max-width:340px;background:#0f172a;color:#fff;direction:rtl;padding:10px 12px;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.3);font-size:12px;line-height:1.55;pointer-events:none}.applied-pop b{color:#fde68a}'
  ].join('\n'); document.head.appendChild(s); }
  function toast(t){ all('.perfect-toast').forEach(e=>e.remove()); const el=document.createElement('div'); el.className='perfect-toast'; el.textContent=t; document.body.appendChild(el); setTimeout(()=>el.remove(),3200); }
  function closeModal(){ byId('perfect-modal')?.remove(); }
  function openModal(title, html, buttons=[]){ closeModal(); const b=document.createElement('div'); b.id='perfect-modal'; b.className='perfect-modal-backdrop'; b.innerHTML='<div class="perfect-modal"><div class="perfect-head"><h2>'+esc(title)+'</h2><button class="perfect-close" type="button">×</button></div><div>'+html+'</div><div class="perfect-actions"></div></div>'; const a=b.querySelector('.perfect-actions'); buttons.forEach(x=>{const btn=document.createElement('button');btn.type='button';btn.textContent=x.label;btn.addEventListener('click',x.onClick);a.appendChild(btn);}); b.addEventListener('click',ev=>{if(ev.target===b)closeModal();}); b.querySelector('.perfect-close')?.addEventListener('click',closeModal); document.body.appendChild(b); }
  function ensureBtn(id,text,title,after,fn){ let btn=byId(id); if(!btn&&after){btn=document.createElement('button');btn.type='button';btn.id=id;btn.className='perfect-btn';btn.textContent=text;btn.title=title;after.insertAdjacentElement('afterend',btn);} if(btn&&btn.dataset.perfectHook!=='1'){btn.dataset.perfectHook='1';btn.addEventListener('click',ev=>{ev.preventDefault();fn();});} return btn; }
  function installBtns(){ const render=byId('btn-render'); if(!render)return; let a=byId('btn-render-pause')||render; a=ensureBtn('btn-render-diagnostics','🔎 בדיקת רינדור','בדיקת מצב רינדור',a,diag)||a; a=ensureBtn('btn-ravtext-snapshots','⏪ שחזור','שחזור מגיבויים',a,snapManager)||a; ensureBtn('btn-reset-display-only','🧹 אפס תצוגה','איפוס הגדרות תצוגה בלבד',a,resetDisplay); }
  function snaps(){ const v=json(localStorage.getItem(SNAP_KEY)||'[]',[]); return Array.isArray(v)?v:[]; }
  function saveSnaps(v){ localStorage.setItem(SNAP_KEY,JSON.stringify(v.slice(0,6))); }
  function snapshot(reason){ const s={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),at:new Date().toISOString(),reason,local:{},session:{}}; try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i); if(k&&k!==SNAP_KEY&&(k.startsWith('ravtext.')||k.includes('pane')||k.includes('editor')))s.local[k]=localStorage.getItem(k);}}catch(_){} try{for(let i=0;i<sessionStorage.length;i++){const k=sessionStorage.key(i); if(k&&k.startsWith('ravtext.'))s.session[k]=sessionStorage.getItem(k);}}catch(_){} const arr=snaps(); arr.unshift(s); saveSnaps(arr); return s; }
  function snapManager(){ const rows=snaps().map((s,i)=>'<div class="perfect-card"><b>'+(i+1)+'. '+esc(new Date(s.at).toLocaleString('he-IL'))+'</b><br>סיבה: '+esc(s.reason||'')+'<div class="perfect-actions"><button data-snap="'+esc(s.id)+'">שחזר</button></div></div>').join('')||'<p>אין עדיין גיבויים.</p>'; openModal('⏪ שחזור מגיבוי',rows,[{label:'צור גיבוי עכשיו',onClick:()=>{snapshot('גיבוי ידני');snapManager();}},{label:'נקה גיבויים',onClick:()=>{if(confirm('למחוק גיבויים?')){localStorage.removeItem(SNAP_KEY);snapManager();}}}]); byId('perfect-modal')?.addEventListener('click',ev=>{const b=ev.target.closest('[data-snap]'); if(!b)return; const s=snaps().find(x=>x.id===b.dataset.snap); if(!s||!confirm('לשחזר? העמוד יתרענן.'))return; Object.entries(s.local||{}).forEach(([k,v])=>localStorage.setItem(k,v)); Object.entries(s.session||{}).forEach(([k,v])=>sessionStorage.setItem(k,v)); location.reload();}); }
  function resetDisplay(){ if(!confirm('לאפס רק הגדרות תצוגה ורינדור?\n\nהטקסט לא יימחק.'))return; snapshot('לפני איפוס תצוגה'); let n=0; const rem=(st)=>{exactResetKeys.forEach(k=>{if(st.getItem(k)!==null){st.removeItem(k);n++;}}); const ks=[]; for(let i=0;i<st.length;i++)ks.push(st.key(i)); ks.forEach(k=>{if(k&&resetPrefixes.some(p=>k.startsWith(p))){st.removeItem(k);n++;}});}; try{rem(localStorage);rem(sessionStorage);}catch(_){} toast('אופסו '+n+' הגדרות תצוגה.'); window.__ravtextRerender?.(); }
  function diag(){ const pg=byId('pages-container')||document.querySelector('.pages-container'); const pc=pg?pg.querySelectorAll('.page:not(.page-placeholder)').length:0; const tal=localStorage.getItem('ravtext.talmudLayout')==='1'; const paused=localStorage.getItem('ravtext.renderPaused')==='1'; const stale=['ravtext.layout.autoOverflowSafety','ravtext.layout.autoOverflowAttempts.v1'].filter(k=>localStorage.getItem(k)!==null||sessionStorage.getItem(k)!==null); const checks=[['מנוע',true,tal?'גפ״ת / V9':'רגיל'],['רינדור',true,paused?'מושהה':(localStorage.getItem('ravtext.liveRender')==='0'?'כבוי':'פעיל')],['עמודים',pc>0,String(pc)],['פונטים',true,document.fonts?.status||'לא ידוע'],['ביטול אמיתי',typeof window.__ravtextCancelRender==='function',typeof window.__ravtextCancelRender==='function'?'מותקן':'לא זוהה'],['מפתחות ישנים',stale.length===0,stale.length?stale.join(', '):'נקי'],['גיבויים',true,String(snaps().length)]]; openModal('🔎 בדיקת רינדור',checks.map(([a,ok,d])=>'<div class="perfect-card '+(ok?'pass':'fail')+'">'+(ok?'✓':'✗')+' <b>'+esc(a)+'</b> — '+esc(d)+'</div>').join(''),[{label:'רנדר עכשיו',onClick:()=>{closeModal();window.__ravtextRerender?.();}},{label:'אפס תצוגה בלבד',onClick:()=>{closeModal();resetDisplay();}}]); }
  function hookSnapshots(){ if(document.documentElement.dataset.perfectSnapshot==='1')return; document.documentElement.dataset.perfectSnapshot='1'; document.addEventListener('click',ev=>{const b=ev.target.closest('button[data-cmd]'); const c=b?.dataset?.cmd; if(c&&dangerous.has(c)){snapshot('לפני פעולה: '+((b.textContent||c).trim())); toast('נוצר גיבוי אוטומטי.');}},true); }
  function bucket(el){ const t=(el.textContent||el.getAttribute?.('title')||'').trim(); if(/כותרת|טורים|רצופות|שורה אחרונה|הערה ראשונה/.test(t))return'בסיס'; if(/סגנון זרם|סגנון כותרת|בולד|מודגש|דיבור המתחיל/.test(t))return'עיצוב ובולד'; if(/מספר|פתיחה|סגירה|פורמט|סוגר גוף|תת-הערה/.test(t))return'מספרים וסוגריים'; if(/פס|צבע פס|עובי פס/.test(t))return'פסים וקווים'; if(/פריסה|מיקום|משנ"ב|משנה|גמרא|אונקלוס|הערות צד/.test(t))return'פריסה'; return'מתקדם'; }
  function groupBlock(block){ if(!block||block.dataset.ravtextGrouped==='1')return; const kids=Array.from(block.children); if(kids.some(c=>c.classList?.contains('ravtext-stream-section')))return; block.innerHTML=''; const map=new Map(); const help=document.createElement('span'); help.className='stream-settings-help'; help.textContent='הבהרה: בולד אמיתי הוא סימון B בעורך. דיבור המתחיל הוא הדגשה אוטומטית. “סגנון לבולד” רק מחליף איך טקסט שכבר מודגש נראה.'; block.appendChild(help); kids.forEach(el=>{ if(el.classList?.contains('stream-settings-code')||el.classList?.contains('stream-order-controls')){block.appendChild(el);return;} const k=bucket(el); if(!map.has(k)){const d=document.createElement('details');d.className='ravtext-stream-section';d.open=k==='בסיס'||k==='עיצוב ובולד';const s=document.createElement('summary');s.textContent=k;d.appendChild(s);map.set(k,d);} map.get(k).appendChild(el);}); map.forEach(d=>block.appendChild(d)); block.classList.add('ravtext-grouped'); block.dataset.ravtextGrouped='1'; }
  function groupSettings(){ const p=byId('stream-columns-panel'); if(!p)return; all('.stream-settings-block',p).forEach(groupBlock); if(p.dataset.perfectObs!=='1'){p.dataset.perfectObs='1'; new MutationObserver(()=>all('.stream-settings-block',p).forEach(groupBlock)).observe(p,{childList:true,subtree:false});} }
  let pop=null; function info(el){ const se=el.closest?.('[data-stream]'); const code=se?.getAttribute('data-stream')||el.getAttribute?.('data-stream')||''; const s=json(localStorage.getItem('ravtext.streamSettings.v1')||'{}',{})[code]||{}; const cs=getComputedStyle(el); return [['זרם',code||'לא זוהה'],['משקל פונט',cs.fontWeight],['גופן',cs.fontFamily],['גודל',cs.fontSize],['סגנון זרם',s.styleId||'—'],['סגנון שמחליף בולד',s.boldOverrideEnabled?(s.boldOverrideStyleId||'מופעל בלי סגנון'):'כבוי'],['דיבור המתחיל',s.lemmaBold===false?'כבוי':'פעיל']]; }
  function inspect(){ const root=byId('pages-container')||document.querySelector('.pages-container'); if(!root||root.dataset.perfectInspect==='1')return; root.dataset.perfectInspect='1'; const sel='.note,.note-part,.note-number,.note-lemma,.stream-ref,.stream[data-stream],.v9-line,[data-stream][data-note-num]'; root.addEventListener('mouseover',ev=>{const el=ev.target.closest(sel); if(!el||!root.contains(el))return; if(!pop){pop=document.createElement('div');pop.className='applied-pop';document.body.appendChild(pop);} pop.innerHTML=info(el).map(([k,v])=>'<div><b>'+esc(k)+':</b> '+esc(v)+'</div>').join(''); move(ev);}); root.addEventListener('mousemove',move); root.addEventListener('mouseout',ev=>{if(!ev.relatedTarget||!ev.relatedTarget.closest?.(sel)){pop?.remove();pop=null;}}); }
  function move(ev){ if(!pop)return; pop.style.left=Math.min(window.innerWidth-360,ev.clientX+16)+'px'; pop.style.top=Math.min(window.innerHeight-240,ev.clientY+16)+'px'; }
  function boot(){ addStyle(); installBtns(); hookSnapshots(); groupSettings(); inspect(); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true}); else setTimeout(boot,0); let n=0; const retry=()=>{boot(); if(++n<80)setTimeout(retry,250);}; setTimeout(retry,250);
})();
