(() => {
  'use strict';

  const KEYS = {
    live: 'ravtext.liveRender',
    pause: 'ravtext.renderPaused',
    prevLive: 'ravtext.renderPaused.prevLiveRender',
    snapshots: 'ravtext.snapshots.v1',
  };

  const MAX_SNAPSHOTS = 12;
  const STOP_GUARD_MS = 15000;

  const dangerousCommands = new Set([
    'clear-all',
    'word-import',
    'word-import-streams',
    'auto-parse',
    'auto-parse-paste',
    'split-to-panes',
    'split-special-notes',
    'split-notes-advanced',
    'merge-toggle',
    'toggle-merge',
    'merge-from-panes',
    'pane-clear-storage',
    'pane-remove',
    'reset-system-state',
  ]);

  const displayResetExactKeys = [
    'ravtext.streamSettings.v1',
    'ravtext.globalStreamOverrides.v1',
    'ravtext.streamOrder.v1',
    'ravtext.talmudLayout',
    'ravtext.talmudLayout.mainWidth',
    'ravtext.talmudLayout.crownLines',
    'ravtext.talmudLayout.gapFillMin',
    'ravtext.talmudLayout.carryOnlyMin',
    'ravtext.mishnaWrap',
    'ravtext.mishnaWrap.levels',
    'ravtext.spacing.v1',
    'ravtext.pageSettings.v1',
    'ravtext.documentStyle.v1',
    'ravtext.outputBackground',
    'ravtext.vilnaV9Beta',
    'ravtext.layout.autoOverflowSafety',
    'ravtext.layout.autoOverflowAttempts.v1',
    KEYS.pause,
    KEYS.prevLive,
  ];

  const displayResetPrefixes = [
    'ravtext.talmudLayout.',
    'ravtext.mishnaWrap.',
    'ravtext.v9.',
    'ravtext.layout.',
    'ravtext.liveOverflow.',
  ];

  const T = {
    render: '⟳ רנדר',
    stop: '■ עצור רינדור',
    pause: '⏸ השהה רינדור',
    resume: '▶ המשך רינדור',
    resumeRender: '▶ המשך ורנדר',
    snapshot: '⏪ שחזור',
    resetDisplay: '🧹 אפס תצוגה',
    diagnostics: '🔎 בדיקת רינדור',
    paused: 'רינדור מושהה — אפשר לשנות כמה דברים בלי להמתין.',
    pending: 'רינדור מושהה — השינויים נשמרו, אבל עדיין לא רונדרו.',
    resumeStatus: 'יוצא מהשהיה — מרנדר פעם אחת את המצב האחרון...',
    active: 'רינדור פעיל.',
    stopped: 'הרינדור נעצר. התצוגה הקודמת נשארה כפי שהיא.',
  };

  const troubleshootingIntro = 'להלן כמה דברים שאנו יודעים עליהם שיש בהם מגבלות מערכת והפתרון שלהם הוא ידני. יתכן שבהמשך נטפל בבעיות דלהלן שלא יצטרכו עבודה ידנית, לאחר שנסיים את הפיתוחים והתיקונים הדחופים יותר.';
  const troubleshootingItems = [
    ['טקסטים עולים על טקסטים', 'נסו לבצע רענון (רנדור) חוזר.'],
    ['שינויים באמצע רענון', 'שינויים עשויים להיות לא תקפים אם התוכנה באמצע רענון. הפתרון הזמני: עצרו רינדור או השהו רינדור אוטומטי.'],
    ['בולד ודיבור המתחיל', 'בולד אמיתי הוא סימון B בעורך. דיבור המתחיל הוא הדגשה אוטומטית של תחילת ההערה. סגנון לבולד רק מחליף איך טקסט שכבר מודגש נראה.'],
    ['הדגשות לזרם שלם', 'אם ברצונכם להדגיש זרם שלם במצב גפ״ת, נכון לעכשיו הפתרון הבטוח הוא הדגשת כל הזרם בעורך.'],
    ['חיתוך דינמי', 'אין כרגע דרך מובטחת לחיתוך דינמי מושלם לכל מסמך. מומלץ להשתמש בבדיקת הרינדור, לשנות גובה/ריווח, ובמידת הצורך לשלוח לנו דוגמה.'],
    ['הערה ראשונה ככותרת', 'כשמשתמשים בהערה ראשונה ככותרת, אין להכניס אותה בתחילת המסמך אלא במיקום ההערה הראשונה האמיתית.'],
  ];

  const state = {
    installed: false,
    paused: false,
    pending: false,
    running: false,
    stoppedUntil: 0,
    snapshotHtml: null,
    snapshotScrollTop: 0,
    popover: null,
  };

  const byId = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const pages = () => byId('pages-container') || document.querySelector('.pages-container');
  const renderButton = () => byId('btn-render');
  const pauseButton = () => byId('btn-render-pause');
  const paneManager = () => window.paneManager || window.__paneManager || null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeJsonParse(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function setStatus(text) {
    const el = byId('status');
    if (el) el.textContent = text;
  }

  function liveEnabled() {
    const value = localStorage.getItem(KEYS.live);
    return value === null ? true : value === '1';
  }

  function setLiveEnabled(on) {
    localStorage.setItem(KEYS.live, on ? '1' : '0');
    const cb = byId('live-render-toggle');
    if (cb) cb.checked = !!on;
  }

  function addStyle() {
    if (byId('ravtext-complete-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'ravtext-complete-ui-style';
    style.textContent = `
      #btn-render.render-running {
        background: #b91c1c !important;
        color: #fff !important;
        border-color: #991b1b !important;
        animation: ravtext-render-pulse .8s ease-in-out infinite;
      }
      @keyframes ravtext-render-pulse {
        0%,100% { opacity: 1; transform: scale(1); }
        50% { opacity: .72; transform: scale(1.03); }
      }
      .ravtext-extra-render-btn { margin-inline-start: 6px; white-space: nowrap; }
      .ravtext-extra-render-btn.active {
        background: #f59e0b !important;
        color: #111827 !important;
        border-color: #d97706 !important;
        font-weight: 700;
      }
      body.render-paused #status { color: #92400e; }
      body.render-running #status { color: #991b1b; }
      .ravtext-modal-backdrop {
        position: fixed; inset: 0; z-index: 9998; background: rgba(15,23,42,.55);
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .ravtext-modal {
        direction: rtl; width: min(760px, 94vw); max-height: 88vh; overflow: auto;
        background: #fff; color: #111827; border-radius: 14px;
        box-shadow: 0 12px 34px rgba(15,23,42,.24); padding: 20px 22px;
        font-family: 'Segoe UI', system-ui, sans-serif; line-height: 1.55;
      }
      .ravtext-modal-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .ravtext-modal-head h2 { margin:0; font-size:19px; }
      .ravtext-modal-close { border:0; background:transparent; cursor:pointer; font-size:24px; color:#64748b; }
      .ravtext-modal-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; }
      .ravtext-modal button { cursor:pointer; }
      .ravtext-card { border:1px solid #dbeafe; border-radius:10px; padding:10px 12px; background:#f8fafc; margin:8px 0; }
      .ravtext-check-pass { color:#166534; }
      .ravtext-check-warn { color:#92400e; }
      .ravtext-check-fail { color:#991b1b; }
      .ravtext-toast { position: fixed; left: 18px; bottom: 18px; z-index: 9999; background:#111827; color:#fff; padding:10px 14px; border-radius:10px; box-shadow:0 8px 20px rgba(0,0,0,.22); direction:rtl; max-width:460px; }
      .ravtext-stream-section { border:1px solid var(--rt-line,#d7d0be); border-radius:8px; margin:4px 6px; padding:4px 6px; background:var(--rt-surface-2,#fbf8ef); vertical-align:top; }
      .ravtext-stream-section > summary { cursor:pointer; font-weight:700; color:var(--rt-ink,#222); padding:2px 0; }
      .stream-settings-block.ravtext-grouped { display:inline-flex; flex-wrap:wrap; gap:4px; align-items:flex-start; max-width:100%; }
      .stream-settings-help { display:inline-block; max-width:560px; padding:4px 8px; border:1px solid var(--rt-line,#d7d0be); border-radius:7px; background:var(--rt-surface-2,#fbf8ef); color:var(--rt-ink-2,#5a4d3a); font-size:12px; line-height:1.35; }
      .ravtext-applied-popover { position:fixed; z-index:9997; max-width:330px; background:#0f172a; color:#fff; direction:rtl; padding:10px 12px; border-radius:10px; box-shadow:0 8px 26px rgba(15,23,42,.3); font-size:12px; line-height:1.55; pointer-events:none; }
      .ravtext-applied-popover b { color:#fde68a; }
    `;
    document.head.appendChild(style);
  }

  function showToast(text) {
    qsa('.ravtext-toast').forEach((el) => el.remove());
    const t = document.createElement('div');
    t.className = 'ravtext-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  function openModal({ title, html, buttons = [] }) {
    closeModal();
    const backdrop = document.createElement('div');
    backdrop.className = 'ravtext-modal-backdrop';
    backdrop.id = 'ravtext-modal-backdrop';
    backdrop.innerHTML = `
      <div class="ravtext-modal" role="dialog" aria-modal="true">
        <div class="ravtext-modal-head"><h2>${escapeHtml(title)}</h2><button type="button" class="ravtext-modal-close" aria-label="סגור">×</button></div>
        <div class="ravtext-modal-body">${html}</div>
        <div class="ravtext-modal-actions"></div>
      </div>`;
    const actions = backdrop.querySelector('.ravtext-modal-actions');
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      if (b.className) btn.className = b.className;
      btn.addEventListener('click', b.onClick);
      actions.appendChild(btn);
    }
    backdrop.addEventListener('click', (ev) => { if (ev.target === backdrop) closeModal(); });
    backdrop.querySelector('.ravtext-modal-close')?.addEventListener('click', closeModal);
    document.body.appendChild(backdrop);
  }

  function closeModal() {
    byId('ravtext-modal-backdrop')?.remove();
  }

  function ensureTroubleshootingHeaderButton() {
    const actions = document.querySelector('.app-header .app-header-actions') || document.querySelector('.app-header-actions');
    if (!actions) return;
    let btn = byId('btn-troubleshooting');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btn-troubleshooting';
      btn.className = 'header-action-btn header-action-btn-icon';
      btn.title = 'פתרון בעיות ומגבלות ידועות';
      btn.setAttribute('aria-label', 'פתרון בעיות ומגבלות ידועות');
      btn.innerHTML = '<span class="header-action-icon">🛠️</span><span class="header-action-text">פתרון בעיות</span>';
      const dev = byId('btn-dev-updates');
      if (dev && dev.parentNode === actions) dev.after(btn); else actions.prepend(btn);
    }
    if (btn.dataset.ravtextHook !== '1') {
      btn.dataset.ravtextHook = '1';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        const items = troubleshootingItems.map(([a, b]) => `<div class="ravtext-card"><strong>${escapeHtml(a)}:</strong> ${escapeHtml(b)}</div>`).join('');
        openModal({ title: '🛠️ פתרון בעיות', html: `<p>${escapeHtml(troubleshootingIntro)}</p>${items}` });
      });
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

  function ensureButton(id, label, title, afterEl) {
    let btn = byId(id);
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = 'ravtext-extra-render-btn';
      btn.textContent = label;
      btn.title = title || label;
      afterEl?.insertAdjacentElement('afterend', btn);
    }
    return btn;
  }

  function ensureRenderButtons() {
    const render = renderButton();
    if (!render) return;
    let anchor = render;
    const pause = ensureButton('btn-render-pause', T.pause, 'השהה רינדור אוטומטי בזמן שינוי כמה הגדרות יחד', anchor); anchor = pause;
    const stop = ensureButton('btn-render-stop', T.stop, 'עצור את הרינדור הנוכחי ושמור את התצוגה הקודמת', anchor); anchor = stop;
    const diag = ensureButton('btn-render-diagnostics', T.diagnostics, 'בדוק מצב רינדור, הגדרות ופונטים', anchor); anchor = diag;
    const snap = ensureButton('btn-ravtext-snapshots', T.snapshot, 'שחזור מגיבויים אוטומטיים לפני פעולות מסוכנות', anchor); anchor = snap;
    ensureButton('btn-reset-display-only', T.resetDisplay, 'אפס הגדרות תצוגה ורינדור בלבד — בלי למחוק טקסט', anchor);
  }

  function paintRenderButtons() {
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
    localStorage.setItem(KEYS.prevLive, liveEnabled() ? '1' : '0');
    localStorage.setItem(KEYS.pause, '1');
    state.paused = true;
    state.pending = false;
    setLiveEnabled(false);
    setStatus(T.paused);
    paintRenderButtons();
  }

  function resumeRender() {
    if (!state.paused) return;
    const prev = localStorage.getItem(KEYS.prevLive);
    localStorage.removeItem(KEYS.pause);
    localStorage.removeItem(KEYS.prevLive);
    state.paused = false;
    setLiveEnabled(prev === '0' ? false : true);
    const shouldRender = state.pending;
    state.pending = false;
    paintRenderButtons();
    if (shouldRender && typeof window.__ravtextRerender === 'function') {
      snapshotPreview();
      state.running = true;
      paintRenderButtons();
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
    paintRenderButtons();
  }

  function markRenderPending(ev) {
    if (!state.paused) return;
    const target = ev.target;
    if (!target?.closest) return;
    if (!target.closest('#panes-container,.ProseMirror,.pane,.toolbar,.ribbon-toolbar,.ribbon-panel')) return;
    state.pending = true;
    setStatus(T.pending);
    paintRenderButtons();
  }

  function wireRenderButtons() {
    ensureRenderButtons();
    const render = renderButton();
    const pause = pauseButton();
    const stop = byId('btn-render-stop');
    const diag = byId('btn-render-diagnostics');
    const snap = byId('btn-ravtext-snapshots');
    const reset = byId('btn-reset-display-only');

    if (render && render.dataset.completeUiHook !== '1') {
      render.dataset.completeUiHook = '1';
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
        paintRenderButtons();
      }, true);
    }
    if (pause && pause.dataset.completeUiHook !== '1') {
      pause.dataset.completeUiHook = '1';
      pause.addEventListener('click', (ev) => { ev.preventDefault(); state.paused ? resumeRender() : pauseRender(); });
    }
    if (stop && stop.dataset.completeUiHook !== '1') {
      stop.dataset.completeUiHook = '1';
      stop.addEventListener('click', (ev) => { ev.preventDefault(); stopRender(); });
    }
    if (diag && diag.dataset.completeUiHook !== '1') {
      diag.dataset.completeUiHook = '1';
      diag.addEventListener('click', runRenderDiagnostics);
    }
    if (snap && snap.dataset.completeUiHook !== '1') {
      snap.dataset.completeUiHook = '1';
      snap.addEventListener('click', openSnapshotManager);
    }
    if (reset && reset.dataset.completeUiHook !== '1') {
      reset.dataset.completeUiHook = '1';
      reset.addEventListener('click', resetDisplayOnly);
    }
    paintRenderButtons();
  }

  function readSnapshots() {
    const arr = safeJsonParse(localStorage.getItem(KEYS.snapshots) || '[]', []);
    return Array.isArray(arr) ? arr : [];
  }

  function writeSnapshots(arr) {
    localStorage.setItem(KEYS.snapshots, JSON.stringify(arr.slice(0, MAX_SNAPSHOTS)));
  }

  function collectSnapshot(reason = 'פעולה ידנית') {
    const pm = paneManager();
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      reason,
      panes: null,
      paneStorage: localStorage.getItem('ravtext.panes.state.v1'),
      settings: {},
    };
    try { if (pm?.serialize) item.panes = pm.serialize(); } catch (_) {}
    for (const key of displayResetExactKeys) {
      try {
        const value = localStorage.getItem(key);
        if (value !== null) item.settings[key] = value;
      } catch (_) {}
    }
    const arr = readSnapshots();
    arr.unshift(item);
    writeSnapshots(arr);
    return item;
  }

  function restoreSnapshot(item) {
    if (!item) return;
    const pm = paneManager();
    try {
      if (item.panes && pm?.load) {
        pm.load(item.panes);
      } else if (item.paneStorage) {
        localStorage.setItem('ravtext.panes.state.v1', item.paneStorage);
      }
      for (const [key, value] of Object.entries(item.settings || {})) localStorage.setItem(key, value);
      showToast('השחזור הוחל. אם משהו לא הופיע מיד — רענן את העמוד.');
      if (typeof window.__ravtextRerender === 'function') window.__ravtextRerender();
      closeModal();
    } catch (err) {
      alert('שחזור נכשל: ' + (err?.message || err));
    }
  }

  function openSnapshotManager() {
    const arr = readSnapshots();
    const rows = arr.length ? arr.map((s, idx) => `
      <div class="ravtext-card">
        <strong>${idx + 1}. ${escapeHtml(new Date(s.at).toLocaleString('he-IL'))}</strong><br>
        סיבה: ${escapeHtml(s.reason || '')}<br>
        חלוניות: ${escapeHtml(s.panes?.panes?.length || 'לא ידוע')}
        <div class="ravtext-modal-actions"><button type="button" data-snapshot-id="${escapeHtml(s.id)}">שחזר גיבוי זה</button></div>
      </div>`).join('') : '<p>עדיין אין גיבויים אוטומטיים.</p>';
    openModal({
      title: '⏪ שחזור מגיבוי אוטומטי',
      html: `<p>נוצר גיבוי לפני פעולות מסוכנות כמו ייבוא, מיזוג, פיצול, מחיקה ואיפוס.</p>${rows}`,
      buttons: [
        { label: 'צור גיבוי עכשיו', onClick: () => { collectSnapshot('גיבוי ידני'); openSnapshotManager(); } },
        { label: 'נקה רשימת גיבויים', onClick: () => { if (confirm('למחוק את רשימת הגיבויים?')) { writeSnapshots([]); openSnapshotManager(); } } },
      ],
    });
    byId('ravtext-modal-backdrop')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-snapshot-id]');
      if (!btn) return;
      restoreSnapshot(readSnapshots().find((s) => s.id === btn.dataset.snapshotId));
    });
  }

  function hookDangerousSnapshots() {
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-cmd]');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      if (!dangerousCommands.has(cmd)) return;
      collectSnapshot('לפני פעולה: ' + (btn.textContent || cmd).trim());
      showToast('נוצר גיבוי אוטומטי לפני הפעולה.');
    }, true);
  }

  function removeKeys(storage) {
    const removed = [];
    for (const key of displayResetExactKeys) {
      try {
        if (storage.getItem(key) !== null) { storage.removeItem(key); removed.push(key); }
      } catch (_) {}
    }
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
      for (const key of keys) {
        if (key && displayResetPrefixes.some((p) => key.startsWith(p))) {
          storage.removeItem(key);
          removed.push(key);
        }
      }
    } catch (_) {}
    return removed;
  }

  function resetDisplayOnly() {
    if (!confirm('לאפס רק הגדרות תצוגה ורינדור?\n\nהטקסט והחלוניות לא יימחקו.')) return;
    collectSnapshot('לפני איפוס תצוגה בלבד');
    const removed = [...removeKeys(localStorage), ...removeKeys(sessionStorage)];
    try { delete window.__STREAM_SETTINGS__; } catch (_) {}
    try { delete window.__STREAM_LABELS__; } catch (_) {}
    state.paused = false;
    state.pending = false;
    paintRenderButtons();
    showToast('איפוס תצוגה הושלם: ' + removed.length + ' הגדרות נוקו.');
    if (typeof window.__ravtextRerender === 'function') window.__ravtextRerender();
  }

  function countStreamSettings() {
    return Object.keys(safeJsonParse(localStorage.getItem('ravtext.streamSettings.v1') || '{}', {}) || {}).length;
  }

  function runRenderDiagnostics() {
    const pm = paneManager();
    const pg = pages();
    const talmud = localStorage.getItem('ravtext.talmudLayout') === '1';
    const pageCount = pg ? pg.querySelectorAll('.page:not(.page-placeholder)').length : 0;
    const stale = ['ravtext.layout.autoOverflowSafety', 'ravtext.layout.autoOverflowAttempts.v1']
      .filter((k) => localStorage.getItem(k) !== null || sessionStorage.getItem(k) !== null);
    const checks = [
      ['מנוע רינדור', true, talmud ? 'גפ״ת / V9' : 'רגיל'],
      ['רינדור חי', true, liveEnabled() ? (state.paused ? 'מושהה' : 'פעיל') : 'כבוי'],
      ['עמודים מרונדרים', pageCount > 0, String(pageCount)],
      ['חלוניות', !!pm, String(pm?.panes?.length || pm?.count?.() || 'לא ידוע')],
      ['הגדרות זרמים שמורות', true, String(countStreamSettings())],
      ['מצב טעינת פונטים', true, document.fonts?.status || 'לא ידוע'],
      ['מפתחות עימוד ישנים ידועים', stale.length === 0, stale.length ? stale.join(', ') : 'נקי'],
      ['כפתורי השהיה/עצירה', !!byId('btn-render-pause') && !!byId('btn-render-stop'), 'מותקנים'],
      ['גיבוי אוטומטי', true, readSnapshots().length + ' גיבויים'],
      ['בדיקת החלטות הערה מאוחדות', true, 'renderer/V9 משתמשים ב-note_content_builder לפי בדיקת קוד סטטית בענף'],
    ];
    const html = checks.map(([label, ok, detail]) => `<div class="ravtext-card ${ok ? 'ravtext-check-pass' : 'ravtext-check-fail'}">${ok ? '✓' : '✗'} <strong>${escapeHtml(label)}</strong> — ${escapeHtml(detail)}</div>`).join('');
    openModal({
      title: '🔎 בדיקת רינדור',
      html: `<p>בדיקה מהירה שמראה מה פעיל כרגע ומה עלול להסביר תקלת תצוגה.</p>${html}`,
      buttons: [
        { label: 'רנדר עכשיו', onClick: () => { closeModal(); window.__ravtextRerender?.(); } },
        { label: 'אפס תצוגה בלבד', onClick: () => { closeModal(); resetDisplayOnly(); } },
        { label: 'צור גיבוי עכשיו', onClick: () => { collectSnapshot('גיבוי ידני מבדיקת רינדור'); showToast('נוצר גיבוי.'); } },
      ],
    });
  }

  function classifyStreamControl(el) {
    const txt = (el.textContent || el.getAttribute?.('title') || '').trim();
    if (/כותרת|טורים|רצופות|שורה אחרונה|הערה ראשונה/.test(txt)) return 'בסיס';
    if (/סגנון זרם|סגנון כותרת|בולד|מודגש|דיבור המתחיל/.test(txt)) return 'עיצוב ובולד';
    if (/מספר|פתיחה|סגירה|פורמט|סוגר גוף|תת-הערה/.test(txt)) return 'מספרים וסוגריים';
    if (/פס|צבע פס|עובי פס/.test(txt)) return 'פסים וקווים';
    if (/פריסה|מיקום|משנ"ב|משנה|גמרא|אונקלוס|הערות צד/.test(txt)) return 'פריסה';
    if (/מילה פותחת|N:|גופן|משקל|שורות|רווח|דלג קצר|מרכז מלא/.test(txt)) return 'מילה פותחת';
    return 'מתקדם';
  }

  function addBoldHelp(block) {
    if (block.querySelector('.stream-settings-help')) return;
    const help = document.createElement('span');
    help.className = 'stream-settings-help';
    help.textContent = 'הבהרה: בולד אמיתי הוא סימון B בעורך. דיבור המתחיל הוא הדגשה אוטומטית. “סגנון לבולד” רק מחליף איך טקסט שכבר מודגש נראה.';
    const code = block.querySelector('.stream-settings-code');
    if (code) code.after(help); else block.prepend(help);
  }

  function groupOneStreamBlock(block) {
    if (!block || block.dataset.ravtextGrouped === '1') return;
    const children = Array.from(block.children);
    if (children.some((c) => c.classList?.contains('ravtext-stream-section'))) return;
    const keep = [];
    const controls = [];
    for (const child of children) {
      const isHeader = child.classList?.contains('stream-settings-code') || child.classList?.contains('stream-order-controls') || child.textContent === '⋮⋮';
      if (isHeader) keep.push(child); else controls.push(child);
    }
    block.innerHTML = '';
    keep.forEach((el) => block.appendChild(el));
    const buckets = new Map();
    for (const el of controls) {
      const name = classifyStreamControl(el);
      if (!buckets.has(name)) {
        const d = document.createElement('details');
        d.className = 'ravtext-stream-section';
        d.open = ['בסיס', 'עיצוב ובולד'].includes(name);
        d.innerHTML = `<summary>${escapeHtml(name)}</summary>`;
        buckets.set(name, d);
      }
      buckets.get(name).appendChild(el);
    }
    addBoldHelp(block);
    for (const d of buckets.values()) block.appendChild(d);
    block.classList.add('ravtext-grouped');
    block.dataset.ravtextGrouped = '1';
  }

  function groupStreamSettingsPanel() {
    const panel = byId('stream-columns-panel');
    if (!panel) return;
    qsa('.stream-settings-block', panel).forEach(groupOneStreamBlock);
  }

  function installStreamSettingsGrouping() {
    groupStreamSettingsPanel();
    const panel = byId('stream-columns-panel');
    if (!panel || panel.dataset.ravtextObserver === '1') return;
    panel.dataset.ravtextObserver = '1';
    const mo = new MutationObserver(() => groupStreamSettingsPanel());
    mo.observe(panel, { childList: true, subtree: false });
  }

  function getSettingsForStream(code) {
    const all = safeJsonParse(localStorage.getItem('ravtext.streamSettings.v1') || '{}', {}) || {};
    const global = safeJsonParse(localStorage.getItem('ravtext.globalStreamOverrides.v1') || '{}', {}) || {};
    const own = code ? (all[code] || {}) : {};
    const effective = { ...own };
    for (const [key, item] of Object.entries(global || {})) {
      if (item?.enabled) effective[key] = item.value;
    }
    return effective;
  }

  function appliedInfoForElement(el) {
    const streamEl = el.closest?.('[data-stream]');
    const code = streamEl?.getAttribute('data-stream') || el.getAttribute?.('data-stream') || '';
    const noteNum = el.closest?.('[data-note-num]')?.getAttribute('data-note-num') || el.dataset?.noteNum || '';
    const settings = getSettingsForStream(code);
    const cs = getComputedStyle(el);
    const isLemma = !!el.closest?.('.note-lemma') || el.classList?.contains('note-lemma');
    const isNumber = !!el.closest?.('.note-number,.stream-ref') || el.classList?.contains('note-number') || el.classList?.contains('stream-ref');
    return [
      ['סוג', el.className || el.tagName],
      ['זרם', code || 'לא זוהה'],
      ['מספר הערה', noteNum || '—'],
      ['דיבור המתחיל', isLemma ? 'כן' : 'לא'],
      ['מספר/הפניה', isNumber ? 'כן' : 'לא'],
      ['משקל פונט בפועל', cs.fontWeight],
      ['גופן בפועל', cs.fontFamily],
      ['גודל בפועל', cs.fontSize],
      ['סגנון זרם', settings.styleId || '—'],
      ['סגנון שמחליף בולד', settings.boldOverrideEnabled ? (settings.boldOverrideStyleId || 'מופעל בלי סגנון') : 'כבוי'],
      ['דיבור המתחיל אוטומטי', settings.lemmaBold === false ? 'כבוי' : 'פעיל'],
      ['מספר בראשי', settings.mainRefEnabled ? 'פעיל' : 'כבוי'],
      ['מספר בהערה', settings.noteNumEnabled === false ? 'כבוי' : 'פעיל'],
    ];
  }

  function showAppliedPopover(ev, el) {
    if (!state.popover) {
      state.popover = document.createElement('div');
      state.popover.className = 'ravtext-applied-popover';
      document.body.appendChild(state.popover);
    }
    const rows = appliedInfoForElement(el).map(([k, v]) => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</div>`).join('');
    state.popover.innerHTML = rows;
    moveAppliedPopover(ev);
  }

  function moveAppliedPopover(ev) {
    if (!state.popover) return;
    state.popover.style.left = Math.min(window.innerWidth - 350, ev.clientX + 16) + 'px';
    state.popover.style.top = Math.min(window.innerHeight - 220, ev.clientY + 16) + 'px';
  }

  function hideAppliedPopover() {
    state.popover?.remove();
    state.popover = null;
  }

  function installAppliedInspector() {
    const root = pages();
    if (!root || root.dataset.appliedInspector === '1') return;
    root.dataset.appliedInspector = '1';
    const selector = '.note,.note-part,.note-number,.note-lemma,.stream-ref,.stream[data-stream],.v9-line,[data-stream][data-note-num]';
    root.addEventListener('mouseover', (ev) => {
      const el = ev.target.closest(selector);
      if (el && root.contains(el)) showAppliedPopover(ev, el);
    });
    root.addEventListener('mousemove', moveAppliedPopover);
    root.addEventListener('mouseout', (ev) => {
      if (!ev.relatedTarget || !ev.relatedTarget.closest?.(selector)) hideAppliedPopover();
    });
  }

  function install() {
    if (state.installed) return;
    state.installed = true;
    state.paused = localStorage.getItem(KEYS.pause) === '1';
    if (state.paused) setLiveEnabled(false);
    addStyle();
    ensureTroubleshootingHeaderButton();
    wireRenderButtons();
    hookDangerousSnapshots();
    installStreamSettingsGrouping();
    installAppliedInspector();
    document.addEventListener('input', markRenderPending, true);
    document.addEventListener('change', markRenderPending, true);
    document.addEventListener('paste', markRenderPending, true);
    window.addEventListener('ravtext:engine-rendered', () => {
      if (stoppedGuardActive()) {
        restorePreview();
        setStatus(T.stopped);
      }
      state.running = false;
      paintRenderButtons();
      installStreamSettingsGrouping();
      installAppliedInspector();
    });
    let count = 0;
    const retry = () => {
      ensureTroubleshootingHeaderButton();
      wireRenderButtons();
      installStreamSettingsGrouping();
      installAppliedInspector();
      if (++count < 80) setTimeout(retry, 250);
    };
    setTimeout(retry, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else setTimeout(install, 0);
})();
