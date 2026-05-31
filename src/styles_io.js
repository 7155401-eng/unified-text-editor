// משה 2026-05-31: ייצוא וייבוא של תוכן / סגנונות / הגדרות עימוד-ורינדור.
// עובד זהה בשרת ובמקומי. שלוש קטגוריות שבהן המשתמש יכול לבחור פר ייצוא
// וגם פר ייבוא:
//   • content  — המסמך עצמו (paneManager.serialize / load).
//   • styles   — הסגנונות + כללי סגנון לזרם + העדפות פונט.
//   • layout   — הגדרות עימוד, רינדור, פריסה (תלמוד / שני טורים / משנה / כתר).
//
// קטגוריה רביעית "other" מציגה את שאר ה-ravtext.* keys (שלא ב-blacklist).
// סגנונות + עימוד + שונות חיים ב-localStorage; המסמך עצמו לא — הוא ב-pane
// manager (במקומי גם משתקף ל-IndexedDB דרך mock של /api/documents/current).

const KEY_PREFIX = 'ravtext.';

// אותו blacklist שב-server_persistence.js — לא מייצאים API keys, מצב דמו,
// אוטוסייב זמני, או cache פנימי שאין טעם לייצא.
const BLACKLIST_EXACT = new Set([
  'ravtext.ai.apiKey',
  'ravtext.demo.blockedUntil',
  'ravtext.demoMode',
  'ravtext.panes.state.v1', // התוכן יוצא דרך paneManager.serialize, לא דרך localStorage
  'ravtext.nikud_merger.autosave',
  'ravtext.cssInject.css',
  'ravtext.caricature.gemini_api_key',
  'ravtext.torah_transcription.config',
  'ravtext.layout.autoOverflowSafety',
  'ravtext.layout.autoOverflowAttempts.v1',
  'ravtext.layout.overflowReserve.v1',
  'ravtext.layout.overflowReserve.v1.iter',
]);
const BLACKLIST_PREFIXES = [
  'ravtext.ai.apiKey.',
  'ravtext.caricature.',
  'ravtext.torah_transcription.',
  'ravtext.talmudLayout.smartCache.',
];

function isBlocked(k) {
  if (BLACKLIST_EXACT.has(k)) return true;
  for (const p of BLACKLIST_PREFIXES) if (k.startsWith(p)) return true;
  return false;
}

// סדר הקטגוריות חשוב — נבדק לפי המוקדמת שמתאימה. "other" תופס הכל בסוף.
const CATEGORIES = [
  {
    id: 'styles',
    label: 'סגנונות טקסט',
    icon: '🎨',
    desc: 'סגנונות שמורים, כללי סגנון לכל זרם, העדפות פונט',
    match: (k) => /customStyles|streamAutoStyleRules|stream\.style|font|family|colors?/i.test(k),
  },
  {
    id: 'layout',
    label: 'עימוד ורינדור',
    icon: '📐',
    desc: 'פריסה (תלמוד / שני טורים / משנה), כתר, גודל עמוד, ריווח, מילת פתיח',
    match: (k) => /layout|talmud|mishna|balance|page|margin|crown|openingWord|stretch|safety|note|sidenote|stream/i.test(k),
  },
];
const CATEGORY_OTHER = { id: 'other', label: 'שונות', icon: '⚙️', desc: 'כל שאר ההעדפות' };
const CATEGORY_CONTENT = { id: 'content', label: 'תוכן (מסמך)', icon: '📄', desc: 'הטקסט עצמו על כל הזרמים, ההערות, החלוקה לעמודים' };

function categorize(key) {
  for (const c of CATEGORIES) if (c.match(key)) return c;
  return CATEGORY_OTHER;
}

// ─────────────────────────────────────────────────────────────────────────
// איסוף נתונים
// ─────────────────────────────────────────────────────────────────────────

function collectLocalStorageGrouped() {
  const out = { styles: {}, layout: {}, other: {} };
  if (typeof localStorage === 'undefined') return out;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      if (isBlocked(k)) continue;
      const cat = categorize(k);
      out[cat.id][k] = localStorage.getItem(k);
    }
  } catch {}
  return out;
}

function getPaneManagerContent() {
  try {
    const pm = (typeof window !== 'undefined' && window.paneManager) || null;
    if (pm && typeof pm.serialize === 'function') return pm.serialize();
  } catch {}
  return null;
}

function setPaneManagerContent(content) {
  try {
    const pm = (typeof window !== 'undefined' && window.paneManager) || null;
    if (pm && typeof pm.load === 'function' && content != null) {
      pm.load(content);
      return true;
    }
  } catch {}
  return false;
}

function fmtBytes(n) {
  if (n < 1024) return n + ' בייטים';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function byteSize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  try { return new Blob([text]).size; } catch { return text.length; }
}

function fileTimestamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

export function buildExportPayload(selected) {
  const sel = selected || { content: true, styles: true, layout: true, other: false };
  const grouped = collectLocalStorageGrouped();
  const payload = {
    _meta: {
      app: 'ravtext',
      kind: 'export',
      version: 2,
      exportedAt: new Date().toISOString(),
      included: Object.keys(sel).filter((k) => sel[k]),
    },
  };
  if (sel.content) {
    const content = getPaneManagerContent();
    if (content != null) payload.content = content;
  }
  if (sel.styles) payload.styles = grouped.styles;
  if (sel.layout) payload.layout = grouped.layout;
  if (sel.other)  payload.other  = grouped.other;
  return payload;
}

export function exportSelectedToFile(selected) {
  const payload = buildExportPayload(selected);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ravtext-export-${fileTimestamp()}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  return { ok: true };
}

export function parseImportPayload(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { return { ok: false, reason: 'קובץ JSON לא תקין: ' + e.message }; }
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'מבנה הקובץ לא תקין.' };

  // תאימות עם הפורמט הישן (version 1: {settings: {...}}) — נכניס לכל הקטגוריות
  // לפי כללי categorize, ונדחוף ל-styles/layout/other בהתאם.
  if (obj.settings && !obj.styles && !obj.layout && !obj.other && !obj.content) {
    const grouped = { styles: {}, layout: {}, other: {} };
    for (const [k, v] of Object.entries(obj.settings)) {
      if (typeof k !== 'string' || !k.startsWith(KEY_PREFIX)) continue;
      if (isBlocked(k)) continue;
      grouped[categorize(k).id][k] = v;
    }
    return { ok: true, meta: obj._meta || null, ...grouped };
  }

  return {
    ok: true,
    meta: obj._meta || null,
    content: obj.content != null ? obj.content : undefined,
    styles: obj.styles && typeof obj.styles === 'object' ? obj.styles : undefined,
    layout: obj.layout && typeof obj.layout === 'object' ? obj.layout : undefined,
    other:  obj.other  && typeof obj.other  === 'object' ? obj.other  : undefined,
  };
}

export function applyImported(parsed, selected, opts = {}) {
  if (!parsed || !parsed.ok) return { ok: false, reason: 'לא ניתן ליישם — קובץ לא תקין.' };
  const { replace = false } = opts;
  const sel = selected || { content: !!parsed.content, styles: !!parsed.styles, layout: !!parsed.layout, other: !!parsed.other };
  const report = { content: null, styles: 0, layout: 0, other: 0, skipped: 0, errors: [] };

  function applyBucket(bucket) {
    if (typeof localStorage === 'undefined') return 0;
    const data = parsed[bucket];
    if (!data || typeof data !== 'object') return 0;
    let n = 0;
    if (replace) {
      try {
        const toDelete = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(KEY_PREFIX)) continue;
          if (isBlocked(k)) continue;
          if (categorize(k).id !== bucket) continue;
          toDelete.push(k);
        }
        for (const k of toDelete) localStorage.removeItem(k);
      } catch (e) { report.errors.push('replace ' + bucket + ': ' + e.message); }
    }
    try {
      for (const [k, v] of Object.entries(data)) {
        if (typeof k !== 'string' || !k.startsWith(KEY_PREFIX)) { report.skipped++; continue; }
        if (isBlocked(k)) { report.skipped++; continue; }
        if (v == null) { report.skipped++; continue; }
        localStorage.setItem(k, String(v));
        n++;
      }
    } catch (e) { report.errors.push(bucket + ': ' + e.message); }
    return n;
  }

  if (sel.styles) report.styles = applyBucket('styles');
  if (sel.layout) report.layout = applyBucket('layout');
  if (sel.other)  report.other  = applyBucket('other');
  if (sel.content && parsed.content != null) {
    report.content = setPaneManagerContent(parsed.content) ? 'loaded' : 'no-paneManager';
    if (report.content !== 'loaded') report.errors.push('content: paneManager not ready');
  }
  return { ok: report.errors.length === 0, ...report };
}

// ─────────────────────────────────────────────────────────────────────────
// UI — דיאלוג ייצוא + ייבוא
// ─────────────────────────────────────────────────────────────────────────

const DIALOG_ID = 'styles-io-dialog';
const BUTTON_ID = 'btn-styles-io';

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'class') e.className = v;
    else if (k === 'on' && typeof v === 'object') {
      for (const [ev, h] of Object.entries(v)) e.addEventListener(ev, h);
    } else if (k === 'html') e.innerHTML = v;
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

function summarizeExport() {
  const grouped = collectLocalStorageGrouped();
  const content = getPaneManagerContent();
  const contentBytes = content ? byteSize(content) : 0;
  return {
    content: {
      available: !!content,
      paneCount: content?.panes?.length || 0,
      bytes: contentBytes,
    },
    styles: {
      count: Object.keys(grouped.styles).length,
      bytes: Object.values(grouped.styles).reduce((s, v) => s + byteSize(v), 0),
    },
    layout: {
      count: Object.keys(grouped.layout).length,
      bytes: Object.values(grouped.layout).reduce((s, v) => s + byteSize(v), 0),
    },
    other: {
      count: Object.keys(grouped.other).length,
      bytes: Object.values(grouped.other).reduce((s, v) => s + byteSize(v), 0),
    },
  };
}

function buildCheckboxRow(idAttr, cat, label, defaultChecked) {
  const row = el('label', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 10px',
      border: '1px solid #e0e4e8',
      borderRadius: '6px',
      marginBottom: '6px',
      background: '#fff',
      cursor: 'pointer',
    },
  });
  const cb = el('input', { type: 'checkbox', id: idAttr });
  if (defaultChecked) cb.checked = true;
  const text = el('div', {},
    el('div', { style: { fontWeight: '600', fontSize: '14px' } }, `${cat.icon}  ${cat.label}`),
    el('div', { style: { fontSize: '12px', color: '#666' } }, cat.desc),
  );
  const stat = el('div', { style: { fontSize: '12px', color: '#444', textAlign: 'left', direction: 'ltr', whiteSpace: 'nowrap' } }, label);
  row.append(cb, text, stat);
  return { row, cb };
}

export function openStylesIODialog() {
  document.getElementById(DIALOG_ID)?.remove();

  const summary = summarizeExport();

  const bd = el('div', {
    id: DIALOG_ID,
    role: 'dialog',
    'aria-modal': 'true',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)',
      zIndex: '99999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  });

  const box = el('div', {
    dir: 'rtl',
    style: {
      background: '#fff', borderRadius: '10px', maxWidth: '680px', width: '94%',
      maxHeight: '90vh', overflow: 'auto', padding: '22px 26px',
      boxShadow: '0 8px 40px rgba(0,0,0,.35)', fontFamily: 'inherit',
      color: '#222', lineHeight: '1.5',
    },
  });

  box.append(
    el('h3', { style: { margin: '0 0 6px', fontSize: '20px' } }, '🎨 ייצוא / ייבוא'),
    el('p', { style: { margin: '0 0 14px', color: '#555', fontSize: '13px' } },
      'בחר/י מה לכלול. הקובץ פועל הן במחשבון בשרת והן בסביבה המקומית.'
    ),
  );

  // ----- TABS -----
  const tabRow = el('div', {
    style: { display: 'flex', borderBottom: '1px solid #d0d4d8', marginBottom: '14px' },
  });
  function tab(label, active) {
    return el('button', {
      type: 'button',
      style: {
        padding: '8px 16px', border: '0', background: 'transparent', cursor: 'pointer',
        fontSize: '15px', fontWeight: '600',
        borderBottom: active ? '3px solid #2b6cb0' : '3px solid transparent',
        color: active ? '#2b6cb0' : '#555',
      },
    }, label);
  }
  const tabExport = tab('📤 ייצוא', true);
  const tabImport = tab('📥 ייבוא', false);
  tabRow.append(tabExport, tabImport);
  box.append(tabRow);

  // ----- EXPORT PANE -----
  const exportPane = el('section');
  const exContent = buildCheckboxRow('exp-content', CATEGORY_CONTENT,
    summary.content.available
      ? `${summary.content.paneCount} זרמים · ${fmtBytes(summary.content.bytes)}`
      : 'לא זמין',
    summary.content.available);
  if (!summary.content.available) exContent.cb.disabled = true;
  const exStyles  = buildCheckboxRow('exp-styles',  CATEGORIES[0],
    summary.styles.count
      ? `${summary.styles.count} פריטים · ${fmtBytes(summary.styles.bytes)}`
      : 'אין נתונים',
    summary.styles.count > 0);
  if (!summary.styles.count) exStyles.cb.disabled = true;
  const exLayout  = buildCheckboxRow('exp-layout',  CATEGORIES[1],
    summary.layout.count
      ? `${summary.layout.count} פריטים · ${fmtBytes(summary.layout.bytes)}`
      : 'אין נתונים',
    summary.layout.count > 0);
  if (!summary.layout.count) exLayout.cb.disabled = true;
  const exOther   = buildCheckboxRow('exp-other',   CATEGORY_OTHER,
    summary.other.count
      ? `${summary.other.count} פריטים · ${fmtBytes(summary.other.bytes)}`
      : 'אין נתונים',
    false);
  if (!summary.other.count) exOther.cb.disabled = true;
  exportPane.append(exContent.row, exStyles.row, exLayout.row, exOther.row);

  const expStatus = el('div', { style: { minHeight: '22px', fontSize: '13px', color: '#555', marginTop: '8px' } });
  const expBtn = el('button', {
    type: 'button',
    style: {
      padding: '9px 18px', fontSize: '14px', cursor: 'pointer',
      background: '#2b6cb0', color: '#fff', border: '0', borderRadius: '6px',
      marginTop: '10px',
    },
    on: {
      click: () => {
        const sel = {
          content: exContent.cb.checked,
          styles:  exStyles.cb.checked,
          layout:  exLayout.cb.checked,
          other:   exOther.cb.checked,
        };
        if (!sel.content && !sel.styles && !sel.layout && !sel.other) {
          expStatus.style.color = '#b00020';
          expStatus.textContent = 'בחר/י לפחות קטגוריה אחת לייצוא.';
          return;
        }
        exportSelectedToFile(sel);
        const picked = [];
        if (sel.content) picked.push('תוכן');
        if (sel.styles)  picked.push('סגנונות');
        if (sel.layout)  picked.push('עימוד');
        if (sel.other)   picked.push('שונות');
        expStatus.style.color = '#1e5631';
        expStatus.textContent = 'הורד קובץ עם: ' + picked.join(', ') + '. שמור/י אותו במקום בטוח.';
      },
    },
  }, '⬇️ הורד קובץ');
  exportPane.append(expBtn, expStatus);

  // ----- IMPORT PANE -----
  const importPane = el('section', { style: { display: 'none' } });
  importPane.append(el('p', { style: { margin: '0 0 10px', color: '#555', fontSize: '13px' } },
    'בחר/י קובץ JSON שייצאת קודם. אחרי טעינה תראה/י מה הקובץ מכיל ' +
    'ותוכל/י לסמן אילו קטגוריות לייבא.'
  ));

  const fileInput = el('input', {
    type: 'file', accept: 'application/json,.json',
    style: { width: '100%', padding: '8px', border: '1px dashed #888', borderRadius: '6px', marginBottom: '10px' },
  });
  importPane.append(fileInput);

  const importStatus = el('div', { style: { minHeight: '22px', fontSize: '13px', color: '#555', marginBottom: '8px' } });
  const importChecksHost = el('div');
  const modeRow = el('div', { style: { display: 'none', fontSize: '13px', margin: '4px 0 10px' } });
  const r1 = el('label', { style: { marginInlineEnd: '14px' } });
  const radio1 = el('input', { type: 'radio', name: 'sio-mode', value: 'merge' });
  radio1.checked = true;
  r1.append(radio1, ' מיזוג (משאיר קיים)');
  const r2 = el('label');
  const radio2 = el('input', { type: 'radio', name: 'sio-mode', value: 'replace' });
  r2.append(radio2, ' החלפה (מוחק קיים בקטגוריות שנבחרו, ואז טוען)');
  modeRow.append(r1, r2);

  const applyBtn = el('button', {
    type: 'button',
    style: {
      padding: '9px 18px', fontSize: '14px', cursor: 'pointer',
      background: '#1e5631', color: '#fff', border: '0', borderRadius: '6px',
      marginTop: '10px', display: 'none',
    },
  }, '✅ ייבא את הקטגוריות שנבחרו');

  importPane.append(importStatus, importChecksHost, modeRow, applyBtn);

  let lastParsed = null;
  let importCBs = { content: null, styles: null, layout: null, other: null };

  fileInput.addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    importChecksHost.innerHTML = '';
    applyBtn.style.display = 'none';
    modeRow.style.display = 'none';
    if (!f) return;
    importStatus.style.color = '#555';
    importStatus.textContent = 'קורא את הקובץ...';
    const rd = new FileReader();
    rd.onload = () => {
      const parsed = parseImportPayload(String(rd.result || ''));
      if (!parsed.ok) {
        importStatus.style.color = '#b00020';
        importStatus.textContent = parsed.reason;
        return;
      }
      lastParsed = parsed;
      const has = {
        content: parsed.content != null,
        styles: parsed.styles && Object.keys(parsed.styles).length > 0,
        layout: parsed.layout && Object.keys(parsed.layout).length > 0,
        other:  parsed.other  && Object.keys(parsed.other).length  > 0,
      };
      if (!has.content && !has.styles && !has.layout && !has.other) {
        importStatus.style.color = '#b00020';
        importStatus.textContent = 'הקובץ ריק או שאין בו קטגוריות מוכרות.';
        return;
      }
      importStatus.style.color = '#444';
      const metaInfo = parsed.meta?.exportedAt
        ? ` (נוצר ${new Date(parsed.meta.exportedAt).toLocaleString('he-IL')})`
        : '';
      importStatus.textContent = `הקובץ מכיל${metaInfo} — בחר/י מה לייבא:`;

      const buildRow = (catKey, cat, labelText) => {
        const r = buildCheckboxRow('imp-' + catKey, cat, labelText, true);
        importCBs[catKey] = r.cb;
        importChecksHost.append(r.row);
      };
      importCBs = { content: null, styles: null, layout: null, other: null };
      if (has.content) {
        const c = parsed.content;
        const lbl = `${c?.panes?.length || '?'} זרמים · ${fmtBytes(byteSize(c))}`;
        buildRow('content', CATEGORY_CONTENT, lbl);
      }
      if (has.styles) {
        const n = Object.keys(parsed.styles).length;
        const b = Object.values(parsed.styles).reduce((s, v) => s + byteSize(v), 0);
        buildRow('styles', CATEGORIES[0], `${n} פריטים · ${fmtBytes(b)}`);
      }
      if (has.layout) {
        const n = Object.keys(parsed.layout).length;
        const b = Object.values(parsed.layout).reduce((s, v) => s + byteSize(v), 0);
        buildRow('layout', CATEGORIES[1], `${n} פריטים · ${fmtBytes(b)}`);
      }
      if (has.other) {
        const n = Object.keys(parsed.other).length;
        const b = Object.values(parsed.other).reduce((s, v) => s + byteSize(v), 0);
        buildRow('other', CATEGORY_OTHER, `${n} פריטים · ${fmtBytes(b)}`);
      }
      modeRow.style.display = 'block';
      applyBtn.style.display = 'inline-block';
    };
    rd.onerror = () => {
      importStatus.style.color = '#b00020';
      importStatus.textContent = 'נכשל בקריאת הקובץ.';
    };
    rd.readAsText(f);
  });

  applyBtn.addEventListener('click', () => {
    if (!lastParsed) return;
    const sel = {
      content: !!importCBs.content?.checked,
      styles:  !!importCBs.styles?.checked,
      layout:  !!importCBs.layout?.checked,
      other:   !!importCBs.other?.checked,
    };
    if (!sel.content && !sel.styles && !sel.layout && !sel.other) {
      importStatus.style.color = '#b00020';
      importStatus.textContent = 'בחר/י לפחות קטגוריה אחת לייבוא.';
      return;
    }
    const res = applyImported(lastParsed, sel, { replace: radio2.checked });
    if (!res.ok && res.errors?.length) {
      importStatus.style.color = '#b00020';
      importStatus.textContent = 'שגיאות בייבוא: ' + res.errors.join('; ');
      return;
    }
    const parts = [];
    if (res.content === 'loaded') parts.push('תוכן הוטען');
    if (res.styles) parts.push(`${res.styles} סגנונות`);
    if (res.layout) parts.push(`${res.layout} הגדרות עימוד`);
    if (res.other)  parts.push(`${res.other} שונות`);
    importStatus.style.color = '#1e5631';
    importStatus.textContent = 'יובאו: ' + (parts.join(', ') || 'כלום') +
      (res.content === 'loaded' ? ' — התוכן נטען מיד.' : ' — הדף יתרענן בעוד שנייה.');
    // אם רק תוכן הוטען, אין צורך לרענן — paneManager כבר עודכן.
    if (sel.styles || sel.layout || sel.other) {
      setTimeout(() => { location.reload(); }, 1500);
    }
  });

  // tab switching
  tabExport.addEventListener('click', () => {
    exportPane.style.display = '';
    importPane.style.display = 'none';
    tabExport.style.borderBottomColor = '#2b6cb0';
    tabExport.style.color = '#2b6cb0';
    tabImport.style.borderBottomColor = 'transparent';
    tabImport.style.color = '#555';
  });
  tabImport.addEventListener('click', () => {
    exportPane.style.display = 'none';
    importPane.style.display = '';
    tabImport.style.borderBottomColor = '#2b6cb0';
    tabImport.style.color = '#2b6cb0';
    tabExport.style.borderBottomColor = 'transparent';
    tabExport.style.color = '#555';
  });

  box.append(exportPane, importPane);

  // ----- Footer -----
  const footer = el('div', {
    style: { display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '14px' },
  });
  const closeBtn = el('button', {
    type: 'button',
    style: { padding: '7px 16px', fontSize: '14px', cursor: 'pointer' },
    on: { click: () => bd.remove() },
  }, 'סגור');
  footer.append(closeBtn);
  box.append(footer);

  bd.append(box);
  bd.addEventListener('click', (e) => { if (e.target === bd) bd.remove(); });
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') bd.remove(); });
  document.body.append(bd);
  closeBtn.focus();
}

export function installStylesIOButton() {
  if (typeof document === 'undefined') return null;
  if (document.getElementById(BUTTON_ID)) return document.getElementById(BUTTON_ID);
  const actions = document.querySelector('.app-header-actions');
  if (!actions) return null;
  const btn = el('button', {
    type: 'button',
    id: BUTTON_ID,
    class: 'header-action-btn header-action-btn-icon',
    title: 'ייצוא / ייבוא תוכן, סגנונות והעדפות',
    'aria-label': 'ייצוא / ייבוא תוכן, סגנונות והעדפות',
    on: { click: (ev) => { ev.preventDefault(); openStylesIODialog(); } },
    html: '<span class="header-action-icon">🎨</span><span class="header-action-text">ייצוא/ייבוא</span>',
  });
  const after = document.getElementById('btn-troubleshooting')
             || document.getElementById('btn-dev-updates');
  if (after && after.parentNode === actions) after.after(btn);
  else actions.insertBefore(btn, actions.firstElementChild || null);
  return btn;
}
