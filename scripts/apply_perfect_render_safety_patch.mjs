import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const abs = (rel) => path.resolve(root, rel);
const read = (rel) => fs.readFileSync(abs(rel), "utf8");
const write = (rel, value) => fs.writeFileSync(abs(rel), value, "utf8");

function patchOnce(rel, name, oldText, newText, marker) {
  let src = read(rel);
  if (src.includes(marker)) {
    console.log(`[perfect-render-safety] ${name}: already patched`);
    return false;
  }
  if (!src.includes(oldText)) {
    throw new Error(`[perfect-render-safety] ${name}: expected block not found in ${rel}`);
  }
  src = src.replace(oldText, newText);
  write(rel, src);
  console.log(`[perfect-render-safety] ${name}: patched`);
  return true;
}

function appendOnce(rel, name, text, marker) {
  let src = read(rel);
  if (src.includes(marker)) {
    console.log(`[perfect-render-safety] ${name}: already appended`);
    return false;
  }
  if (!src.endsWith("\n")) src += "\n";
  src += text;
  write(rel, src);
  console.log(`[perfect-render-safety] ${name}: appended`);
  return true;
}

// ---------------------------------------------------------------------------
// 1. Real render cancellation: raise the private render token, cancel debounce,
//    and expose a public runtime hook for toolbar/progress UI.
// ---------------------------------------------------------------------------
patchOnce(
  "src/engine_bridge.js",
  "engine cancel API",
`export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);
}

// Smart-tune state: prevent re-entry while a tune cycle is active.`,
`export function scheduleEngineRender(paneManager, pagesContainer, pdfToolbarApi = null) {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const statusEl = document.getElementById("status");
  if (statusEl) statusEl.textContent = "מרענן...";
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _renderToken++;
    const myToken = _renderToken;
    _runRender(paneManager, pagesContainer, pdfToolbarApi, myToken, /*skipSmartTune*/false);
  }, LIVE_RENDER_DELAY_MS);
}

export function cancelEngineRender(reason = "user") {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _renderToken++;
  const statusEl = typeof document !== "undefined" ? document.getElementById("status") : null;
  if (statusEl) statusEl.textContent = "הרינדור נעצר. התצוגה הקודמת נשמרה.";
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("ravtext:engine-render-cancelled", {
      detail: { reason, token: _renderToken },
    }));
  }
}

if (typeof window !== "undefined") {
  window.__ravtextCancelRender = cancelEngineRender;
}

// Smart-tune state: prevent re-entry while a tune cycle is active.`,
  "export function cancelEngineRender("
);

patchOnce(
  "src/engine_bridge.js",
  "cancel after preflight",
`    }

    // v33: inject demo watermarks INTO source content BEFORE pagination —`,
`    }
    if (myToken !== _renderToken) return;

    // v33: inject demo watermarks INTO source content BEFORE pagination —`,
  "if (myToken !== _renderToken) return;\n\n    // v33: inject demo watermarks"
);

patchOnce(
  "src/engine_bridge.js",
  "cancel after beforeBuild hook",
`    await firePackerHook("beforeBuild", { container: pagesContainer, pages });
    // משה 2026-05-08: שלב talmud_layout הוסר — V1/V2/V8 נמחקו. מצב לא־גפ"ת`,
`    await firePackerHook("beforeBuild", { container: pagesContainer, pages });
    if (myToken !== _renderToken) return;
    // משה 2026-05-08: שלב talmud_layout הוסר — V1/V2/V8 נמחקו. מצב לא־גפ"ת`,
  "await firePackerHook(\"beforeBuild\", { container: pagesContainer, pages });\n    if (myToken !== _renderToken) return;"
);

patchOnce(
  "src/engine_bridge.js",
  "cancel after mishna wrap",
`    await applyMishnaWrapToPages(pagesContainer);
    logEvent("balanced_columns");`,
`    await applyMishnaWrapToPages(pagesContainer);
    if (myToken !== _renderToken) return;
    logEvent("balanced_columns");`,
  "await applyMishnaWrapToPages(pagesContainer);\n    if (myToken !== _renderToken) return;"
);

patchOnce(
  "src/engine_bridge.js",
  "cancel after balanced columns",
`    await applyBalancedColumnsToPages(pagesContainer);
    logEvent("opening_word");`,
`    await applyBalancedColumnsToPages(pagesContainer);
    if (myToken !== _renderToken) return;
    logEvent("opening_word");`,
  "await applyBalancedColumnsToPages(pagesContainer);\n    if (myToken !== _renderToken) return;"
);

// ---------------------------------------------------------------------------
// 2. Add an actual Stop button inside the V9 progress dialog.
// ---------------------------------------------------------------------------
patchOnce(
  "src/render_progress_ui.js",
  "progress dialog grid supports stop",
`      grid-template-columns: auto 1fr auto;`,
`      grid-template-columns: auto 1fr auto auto;`,
  "grid-template-columns: auto 1fr auto auto;"
);

patchOnce(
  "src/render_progress_ui.js",
  "progress card accepts pointer events",
`      backdrop-filter: blur(18px) saturate(1.18);
      -webkit-backdrop-filter: blur(18px) saturate(1.18);`,
`      backdrop-filter: blur(18px) saturate(1.18);
      -webkit-backdrop-filter: blur(18px) saturate(1.18);
      pointer-events: auto;`,
  "pointer-events: auto;\n    }\n\n    #ravtext-render-progress-ui .rtp-card::before"
);

patchOnce(
  "src/render_progress_ui.js",
  "progress cancel button style",
`    #ravtext-render-progress-ui .rtp-percent {
      min-width: 54px;
      text-align: left;
      font-size: 22px;
      line-height: 1;
      font-weight: 850;
      letter-spacing: -.3px;
      color: #2c5aa0;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 0 rgba(255,255,255,.85);
    }`,
`    #ravtext-render-progress-ui .rtp-percent {
      min-width: 54px;
      text-align: left;
      font-size: 22px;
      line-height: 1;
      font-weight: 850;
      letter-spacing: -.3px;
      color: #2c5aa0;
      font-variant-numeric: tabular-nums;
      text-shadow: 0 1px 0 rgba(255,255,255,.85);
    }

    #ravtext-render-progress-ui .rtp-cancel {
      border: 1px solid rgba(153, 27, 27, .22);
      border-radius: 999px;
      background: rgba(255,255,255,.72);
      color: #991b1b;
      font-weight: 800;
      font-size: 12px;
      line-height: 1;
      padding: 8px 10px;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 1px 0 rgba(255,255,255,.75);
    }

    #ravtext-render-progress-ui .rtp-cancel:hover {
      background: #fee2e2;
      border-color: rgba(153, 27, 27, .38);
    }`,
  ".rtp-cancel"
);

patchOnce(
  "src/render_progress_ui.js",
  "progress cancel button markup",
`          <div class="rtp-percent" data-rtp="percent">0%</div>`,
`          <div class="rtp-percent" data-rtp="percent">0%</div>
          <button type="button" class="rtp-cancel" data-rtp-action="cancel" title="עצור רינדור">עצור</button>`,
  "data-rtp-action=\"cancel\""
);

patchOnce(
  "src/render_progress_ui.js",
  "progress cancel button behavior",
`  document.body.appendChild(host);
  return host;`,
`  document.body.appendChild(host);
  const cancelBtn = host.querySelector('[data-rtp-action="cancel"]');
  if (cancelBtn && cancelBtn.dataset.bound !== "1") {
    cancelBtn.dataset.bound = "1";
    cancelBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try { window.__ravtextCancelRender?.("progress-dialog"); } catch (_) {}
      hideVilnaRenderProgressImmediately();
      const statusEl = document.getElementById("status");
      if (statusEl) statusEl.textContent = "הרינדור נעצר מתוך חלון ההתקדמות.";
    });
  }
  return host;`,
  "progress-dialog"
);

// ---------------------------------------------------------------------------
// 3. Keep the existing dynamic troubleshooting and pause/stop UI, and add only
//    the missing safety layer: snapshots, diagnostics, display reset, grouped
//    stream settings, bold help, and applied-style inspector.
// ---------------------------------------------------------------------------
patchOnce(
  "template-picker.js",
  "toolbar stop uses real cancellation",
`  function stopRender() {
    state.running = false;`,
`  function stopRender() {
    try { window.__ravtextCancelRender?.('toolbar'); } catch (_) {}
    state.running = false;`,
  "window.__ravtextCancelRender?.('toolbar')"
);

appendOnce(
  "template-picker.js",
  "supplementary UI safety layer",
`

// perfect-render-safety supplementary layer: does not replace the existing
// dynamic troubleshooting or pause/stop code; it only adds the missing tools.
(() => {
  const SNAP_KEY = 'ravtext.snapshots.v1';
  const MAX_SNAPS = 6;
  const byId = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const displayResetExactKeys = [
    'ravtext.streamSettings.v1', 'ravtext.globalStreamOverrides.v1', 'ravtext.streamOrder.v1',
    'ravtext.talmudLayout', 'ravtext.talmudLayout.mainWidth', 'ravtext.talmudLayout.crownLines',
    'ravtext.talmudLayout.gapFillMin', 'ravtext.talmudLayout.gapFillMaxMainLines',
    'ravtext.talmudLayout.carryOnlyMin', 'ravtext.mishnaWrap', 'ravtext.mishnaWrap.levels',
    'ravtext.spacing.v1', 'ravtext.pageSettings.v1', 'ravtext.documentStyle.v1',
    'ravtext.outputBackground', 'ravtext.vilnaV9Beta', 'ravtext.layout.autoOverflowSafety',
    'ravtext.layout.autoOverflowAttempts.v1', 'ravtext.renderPaused',
    'ravtext.renderPaused.prevLiveRender'
  ];
  const displayResetPrefixes = ['ravtext.talmudLayout.', 'ravtext.mishnaWrap.', 'ravtext.v9.', 'ravtext.layout.', 'ravtext.liveOverflow.'];
  const dangerousCommands = new Set([
    'clear-all', 'word-import', 'word-import-streams', 'auto-parse', 'auto-parse-paste',
    'split-to-panes', 'split-special-notes', 'split-notes-advanced', 'merge-toggle',
    'toggle-merge', 'merge-from-panes', 'pane-clear-storage', 'pane-remove', 'reset-system-state'
  ]);

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function parseJson(value, fallback) { try { return JSON.parse(value); } catch (_) { return fallback; } }
  function toast(text) {
    qsa('.ravtext-perfect-toast').forEach((el) => el.remove());
    const el = document.createElement('div');
    el.className = 'ravtext-perfect-toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function addStyle() {
    if (byId('ravtext-perfect-safety-style')) return;
    const s = document.createElement('style');
    s.id = 'ravtext-perfect-safety-style';
    s.textContent = [
      '.ravtext-perfect-btn{margin-inline-start:6px;white-space:nowrap}',
      '.ravtext-perfect-toast{position:fixed;left:18px;bottom:18px;z-index:2147483100;background:#111827;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.24);direction:rtl;max-width:460px}',
      '.ravtext-perfect-modal-backdrop{position:fixed;inset:0;z-index:2147483050;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px}',
      '.ravtext-perfect-modal{direction:rtl;width:min(780px,94vw);max-height:88vh;overflow:auto;background:#fff;color:#111827;border-radius:14px;box-shadow:0 12px 34px rgba(15,23,42,.24);padding:20px 22px;font-family:Segoe UI,system-ui,sans-serif;line-height:1.55}',
      '.ravtext-perfect-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.ravtext-perfect-head h2{margin:0;font-size:19px}.ravtext-perfect-close{border:0;background:transparent;cursor:pointer;font-size:24px;color:#64748b}',
      '.ravtext-perfect-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.ravtext-perfect-card{border:1px solid #dbeafe;border-radius:10px;padding:10px 12px;background:#f8fafc;margin:8px 0}.ravtext-pass{color:#166534}.ravtext-fail{color:#991b1b}',
      '.ravtext-stream-section{border:1px solid var(--rt-line,#d7d0be);border-radius:8px;margin:4px 6px;padding:4px 6px;background:var(--rt-surface-2,#fbf8ef);vertical-align:top}.ravtext-stream-section>summary{cursor:pointer;font-weight:700;color:var(--rt-ink,#222);padding:2px 0}.stream-settings-block.ravtext-grouped{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:flex-start;max-width:100%}',
      '.stream-settings-help{display:inline-block;max-width:560px;padding:4px 8px;border:1px solid var(--rt-line,#d7d0be);border-radius:7px;background:var(--rt-surface-2,#fbf8ef);color:var(--rt-ink-2,#5a4d3a);font-size:12px;line-height:1.35}',
      '.ravtext-applied-popover{position:fixed;z-index:2147483040;max-width:340px;background:#0f172a;color:#fff;direction:rtl;padding:10px 12px;border-radius:10px;box-shadow:0 8px 26px rgba(15,23,42,.3);font-size:12px;line-height:1.55;pointer-events:none}.ravtext-applied-popover b{color:#fde68a}'
    ].join('\n');
    document.head.appendChild(s);
  }
  function closeModal() { byId('ravtext-perfect-modal')?.remove(); }
  function openModal(title, html, buttons = []) {
    closeModal();
    const b = document.createElement('div');
    b.id = 'ravtext-perfect-modal';
    b.className = 'ravtext-perfect-modal-backdrop';
    b.innerHTML = '<div class="ravtext-perfect-modal" role="dialog" aria-modal="true"><div class="ravtext-perfect-head"><h2>' + escapeHtml(title) + '</h2><button type="button" class="ravtext-perfect-close" aria-label="סגור">×</button></div><div class="ravtext-perfect-body">' + html + '</div><div class="ravtext-perfect-actions"></div></div>';
    const actions = b.querySelector('.ravtext-perfect-actions');
    buttons.forEach((cfg) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cfg.label;
      btn.addEventListener('click', cfg.onClick);
      actions.appendChild(btn);
    });
    b.addEventListener('click', (ev) => { if (ev.target === b) closeModal(); });
    b.querySelector('.ravtext-perfect-close')?.addEventListener('click', closeModal);
    document.body.appendChild(b);
  }
  function ensureButton(id, text, title, afterEl, onClick) {
    let btn = byId(id);
    if (!btn && afterEl) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.id = id;
      btn.className = 'ravtext-perfect-btn';
      btn.textContent = text;
      btn.title = title || text;
      afterEl.insertAdjacentElement('afterend', btn);
    }
    if (btn && btn.dataset.perfectHook !== '1') {
      btn.dataset.perfectHook = '1';
      btn.addEventListener('click', (ev) => { ev.preventDefault(); onClick(); });
    }
    return btn;
  }
  function installButtons() {
    const render = byId('btn-render');
    if (!render) return;
    let anchor = byId('btn-render-pause') || render;
    const diag = ensureButton('btn-render-diagnostics', '🔎 בדיקת רינדור', 'בדיקת מצב רינדור, פונטים, הגדרות ועמודים', anchor, renderDiagnostics); anchor = diag || anchor;
    const snap = ensureButton('btn-ravtext-snapshots', '⏪ שחזור', 'שחזור מגיבויים אוטומטיים לפני פעולות מסוכנות', anchor, openSnapshotManager); anchor = snap || anchor;
    ensureButton('btn-reset-display-only', '🧹 אפס תצוגה', 'איפוס הגדרות תצוגה ורינדור בלבד — בלי למחוק טקסט', anchor, resetDisplayOnly);
  }
  function readSnaps() { const v = parseJson(localStorage.getItem(SNAP_KEY) || '[]', []); return Array.isArray(v) ? v : []; }
  function writeSnaps(items) {
    let arr = items.slice(0, MAX_SNAPS);
    while (arr.length) {
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(arr)); return; }
      catch (_) { arr = arr.slice(0, -1); }
    }
  }
  function collectSnapshot(reason) {
    const data = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(), reason: reason || 'גיבוי', localStorage: {}, sessionStorage: {} };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k === SNAP_KEY) continue;
        if (k.startsWith('ravtext.') || k.includes('pane') || k.includes('editor')) data.localStorage[k] = localStorage.getItem(k);
      }
    } catch (_) {}
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (!k) continue;
        if (k.startsWith('ravtext.')) data.sessionStorage[k] = sessionStorage.getItem(k);
      }
    } catch (_) {}
    const arr = readSnaps();
    arr.unshift(data);
    writeSnaps(arr);
    return data;
  }
  function restoreSnapshot(id) {
    const snap = readSnaps().find((s) => s.id === id);
    if (!snap) return;
    if (!confirm('לשחזר את הגיבוי הזה? העמוד יתרענן לאחר השחזור.')) return;
    try { Object.entries(snap.localStorage || {}).forEach(([k, v]) => localStorage.setItem(k, v)); } catch (_) {}
    try { Object.entries(snap.sessionStorage || {}).forEach(([k, v]) => sessionStorage.setItem(k, v)); } catch (_) {}
    location.reload();
  }
  function openSnapshotManager() {
    const snaps = readSnaps();
    const rows = snaps.length ? snaps.map((s, i) => '<div class="ravtext-perfect-card"><strong>' + (i + 1) + '. ' + escapeHtml(new Date(s.at).toLocaleString('he-IL')) + '</strong><br>סיבה: ' + escapeHtml(s.reason || '') + '<div class="ravtext-perfect-actions"><button type="button" data-restore-snapshot="' + escapeHtml(s.id) + '">שחזר גיבוי זה</button></div></div>').join('') : '<p>עדיין אין גיבויים.</p>';
    openModal('⏪ שחזור מגיבוי', '<p>נוצר גיבוי לפני פעולות מסוכנות, ואפשר ליצור גיבוי ידני.</p>' + rows, [
      { label: 'צור גיבוי עכשיו', onClick: () => { collectSnapshot('גיבוי ידני'); openSnapshotManager(); } },
      { label: 'נקה גיבויים', onClick: () => { if (confirm('למחוק את רשימת הגיבויים?')) { localStorage.removeItem(SNAP_KEY); openSnapshotManager(); } } }
    ]);
    byId('ravtext-perfect-modal')?.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-restore-snapshot]');
      if (btn) restoreSnapshot(btn.dataset.restoreSnapshot);
    });
  }
  function hookDangerousSnapshots() {
    if (document.documentElement.dataset.perfectSnapshotHook === '1') return;
    document.documentElement.dataset.perfectSnapshotHook = '1';
    document.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button[data-cmd]');
      const cmd = btn?.dataset?.cmd;
      if (!cmd || !dangerousCommands.has(cmd)) return;
      collectSnapshot('לפני פעולה: ' + ((btn.textContent || cmd).trim()));
      toast('נוצר גיבוי אוטומטי לפני הפעולה.');
    }, true);
  }
  function removeDisplayKeys(storage) {
    const removed = [];
    displayResetExactKeys.forEach((k) => { try { if (storage.getItem(k) !== null) { storage.removeItem(k); removed.push(k); } } catch (_) {} });
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
      keys.forEach((k) => { if (k && displayResetPrefixes.some((p) => k.startsWith(p))) { storage.removeItem(k); removed.push(k); } });
    } catch (_) {}
    return removed;
  }
  function resetDisplayOnly() {
    if (!confirm('לאפס רק הגדרות תצוגה ורינדור?\n\nהטקסט והחלוניות לא יימחקו.')) return;
    collectSnapshot('לפני איפוס תצוגה בלבד');
    const n = removeDisplayKeys(localStorage).length + removeDisplayKeys(sessionStorage).length;
    try { delete window.__STREAM_SETTINGS__; delete window.__STREAM_LABELS__; } catch (_) {}
    toast('איפוס תצוגה הושלם: ' + n + ' הגדרות נוקו.');
    window.__ravtextRerender?.();
  }
  function countStreamSettings() { return Object.keys(parseJson(localStorage.getItem('ravtext.streamSettings.v1') || '{}', {}) || {}).length; }
  function renderDiagnostics() {
    const pg = byId('pages-container') || document.querySelector('.pages-container');
    const pages = pg ? pg.querySelectorAll('.page:not(.page-placeholder)').length : 0;
    const talmud = localStorage.getItem('ravtext.talmudLayout') === '1';
    const paused = localStorage.getItem('ravtext.renderPaused') === '1';
    const stale = ['ravtext.layout.autoOverflowSafety', 'ravtext.layout.autoOverflowAttempts.v1'].filter((k) => localStorage.getItem(k) !== null || sessionStorage.getItem(k) !== null);
    const checks = [
      ['מנוע רינדור', true, talmud ? 'גפ״ת / V9' : 'רגיל'],
      ['רינדור חי/מושהה', true, paused ? 'מושהה' : ((localStorage.getItem('ravtext.liveRender') === '0') ? 'כבוי' : 'פעיל')],
      ['עמודים מרונדרים', pages > 0, String(pages)],
      ['מצב טעינת פונטים', true, document.fonts?.status || 'לא ידוע'],
      ['הגדרות זרמים שמורות', true, String(countStreamSettings())],
      ['מפתחות עימוד ישנים', stale.length === 0, stale.length ? stale.join(', ') : 'נקי'],
      ['גיבויים זמינים', true, String(readSnaps().length)],
      ['ביטול רינדור אמיתי', typeof window.__ravtextCancelRender === 'function', typeof window.__ravtextCancelRender === 'function' ? 'מותקן' : 'לא זוהה']
    ];
    const html = checks.map(([label, ok, detail]) => '<div class="ravtext-perfect-card ' + (ok ? 'ravtext-pass' : 'ravtext-fail') + '">' + (ok ? '✓' : '✗') + ' <strong>' + escapeHtml(label) + '</strong> — ' + escapeHtml(detail) + '</div>').join('');
    openModal('🔎 בדיקת רינדור', '<p>בדיקה מהירה למה שקורה כרגע בתצוגה.</p>' + html, [
      { label: 'רנדר עכשיו', onClick: () => { closeModal(); window.__ravtextRerender?.(); } },
      { label: 'אפס תצוגה בלבד', onClick: () => { closeModal(); resetDisplayOnly(); } },
      { label: 'צור גיבוי עכשיו', onClick: () => { collectSnapshot('גיבוי ידני מבדיקת רינדור'); toast('נוצר גיבוי.'); } }
    ]);
  }
  function classifyControl(el) {
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
  function groupBlock(block) {
    if (!block || block.dataset.ravtextGrouped === '1') return;
    const children = Array.from(block.children);
    if (children.some((c) => c.classList?.contains('ravtext-stream-section'))) return;
    const keep = [], controls = [];
    children.forEach((c) => ((c.classList?.contains('stream-settings-code') || c.classList?.contains('stream-order-controls') || c.textContent === '⋮⋮') ? keep : controls).push(c));
    block.innerHTML = '';
    keep.forEach((c) => block.appendChild(c));
    addBoldHelp(block);
    const buckets = new Map();
    controls.forEach((el) => {
      const name = classifyControl(el);
      if (!buckets.has(name)) {
        const d = document.createElement('details');
        d.className = 'ravtext-stream-section';
        d.open = name === 'בסיס' || name === 'עיצוב ובולד';
        const sum = document.createElement('summary');
        sum.textContent = name;
        d.appendChild(sum);
        buckets.set(name, d);
      }
      buckets.get(name).appendChild(el);
    });
    buckets.forEach((d) => block.appendChild(d));
    block.classList.add('ravtext-grouped');
    block.dataset.ravtextGrouped = '1';
  }
  function groupStreamSettings() {
    const panel = byId('stream-columns-panel');
    if (!panel) return;
    qsa('.stream-settings-block', panel).forEach(groupBlock);
    if (panel.dataset.perfectObserver !== '1') {
      panel.dataset.perfectObserver = '1';
      new MutationObserver(() => qsa('.stream-settings-block', panel).forEach(groupBlock)).observe(panel, { childList: true, subtree: false });
    }
  }
  function streamSettings(code) {
    const all = parseJson(localStorage.getItem('ravtext.streamSettings.v1') || '{}', {}) || {};
    const global = parseJson(localStorage.getItem('ravtext.globalStreamOverrides.v1') || '{}', {}) || {};
    const eff = Object.assign({}, code ? (all[code] || {}) : {});
    Object.entries(global || {}).forEach(([k, v]) => { if (v && v.enabled) eff[k] = v.value; });
    return eff;
  }
  let popover = null;
  function appliedRows(el) {
    const streamEl = el.closest?.('[data-stream]');
    const code = streamEl?.getAttribute('data-stream') || el.getAttribute?.('data-stream') || '';
    const s = streamSettings(code);
    const cs = getComputedStyle(el);
    const isLemma = !!el.closest?.('.note-lemma') || el.classList?.contains('note-lemma');
    const isNumber = !!el.closest?.('.note-number,.stream-ref') || el.classList?.contains('note-number') || el.classList?.contains('stream-ref');
    return [['זרם', code || 'לא זוהה'], ['דיבור המתחיל', isLemma ? 'כן' : 'לא'], ['מספר/הפניה', isNumber ? 'כן' : 'לא'], ['משקל פונט בפועל', cs.fontWeight], ['גופן בפועל', cs.fontFamily], ['גודל בפועל', cs.fontSize], ['סגנון זרם', s.styleId || '—'], ['סגנון שמחליף בולד', s.boldOverrideEnabled ? (s.boldOverrideStyleId || 'מופעל בלי סגנון') : 'כבוי'], ['דיבור המתחיל אוטומטי', s.lemmaBold === false ? 'כבוי' : 'פעיל'], ['מספר בראשי', s.mainRefEnabled ? 'פעיל' : 'כבוי'], ['מספר בהערה', s.noteNumEnabled === false ? 'כבוי' : 'פעיל']];
  }
  function showPopover(ev, el) {
    if (!popover) { popover = document.createElement('div'); popover.className = 'ravtext-applied-popover'; document.body.appendChild(popover); }
    popover.innerHTML = appliedRows(el).map(([k, v]) => '<div><b>' + escapeHtml(k) + ':</b> ' + escapeHtml(v) + '</div>').join('');
    movePopover(ev);
  }
  function movePopover(ev) {
    if (!popover) return;
    popover.style.left = Math.min(window.innerWidth - 360, ev.clientX + 16) + 'px';
    popover.style.top = Math.min(window.innerHeight - 240, ev.clientY + 16) + 'px';
  }
  function hidePopover() { popover?.remove(); popover = null; }
  function installAppliedInspector() {
    const root = byId('pages-container') || document.querySelector('.pages-container');
    if (!root || root.dataset.perfectAppliedInspector === '1') return;
    root.dataset.perfectAppliedInspector = '1';
    const selector = '.note,.note-part,.note-number,.note-lemma,.stream-ref,.stream[data-stream],.v9-line,[data-stream][data-note-num]';
    root.addEventListener('mouseover', (ev) => { const el = ev.target.closest(selector); if (el && root.contains(el)) showPopover(ev, el); });
    root.addEventListener('mousemove', movePopover);
    root.addEventListener('mouseout', (ev) => { if (!ev.relatedTarget || !ev.relatedTarget.closest?.(selector)) hidePopover(); });
  }
  function boot() {
    addStyle();
    installButtons();
    hookDangerousSnapshots();
    groupStreamSettings();
    installAppliedInspector();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else setTimeout(boot, 0);
  let n = 0;
  const retry = () => { boot(); if (++n < 80) setTimeout(retry, 250); };
  setTimeout(retry, 250);
})();
`,
  "perfect-render-safety supplementary layer"
);

console.log("[perfect-render-safety] done");
