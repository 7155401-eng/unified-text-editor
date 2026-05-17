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