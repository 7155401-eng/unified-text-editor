// word_extractor_dialog.js — חלון בחירת קובץ + תצוגה מקדימה + מיפוי זרמים.
// פותח דיאלוג RTL, מפעיל זיהוי-אוטומטי על ה-DOCX שנבחר, מציג טבלת מיפוי
// עם אפשרות תצוגה מקדימה של ההערות ובחירה ידנית של אות זרם, ולבסוף
// קורא ל-extract_and_process ומפיץ את התוצאות לחלוניות.

import {
  find_all_note_sources,
  read_footnotes, read_endnotes, read_comments,
  extract_and_process, count_notes_per_stream,
  extract_doc_titles, extract_headers_footers,
  find_sections_in_docx, find_all_styles_in_docx,
  RichText, CharToken, richSlice,
} from "./word_extractor_engine.js";
import * as engine from "./word_extractor_engine.js";
import {
  extractBodyHtmlWithSymbols, extractNotesHtmlMap, buildDynamicStyleMap, buildStylesCss, injectStylesCss,
} from "./word_extractor_mammoth.js";
import {
  buildDefaultStreamMapping, streamsToSd, findDuplicateSeries,
} from "./word_extractor_streams.js";
import { mergeDocxStylesIntoRegistry } from "../style_registry.js";
import {
  SOURCE_LABELS, SOURCE_HEB_NAMES, SERIES_LETTERS,
  SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT,
  SOURCE_SIDENOTE, SOURCE_PARALLEL, SOURCE_EXTERNAL, SOURCE_CUSTOM,
  t,
} from "./word_extractor_i18n.js";
import "./word_extractor.css";

// משה 2026-05-08: סמני בקרה ייחודיים, כך ש-PARBREAK לא יבלבל אם מופיע בטקסט המשתמש
const SENTINEL_PAR = "PARBREAK";

const MODAL_ID = "word-extractor-modal";

let _state = {
  file: null,
  fileName: '',
  zipBuf: null,
  sources: [],
  streams: [],
  metadata: null,
  paneManagerRef: null,
  onLoadedRef: null,
  brackets: [], // [{ opener:'{', closer:'}', series:'F' }, ...]
  externals: [], // [{ file, fileName, zipBuf, marker:'@99', series:'G' }, ...] משה 2026-05-10
};

const BRACKET_SERIES_DEFAULTS = ['F', 'G', 'H', 'I', 'J', 'K', 'L'];
const EXTERNAL_SERIES_DEFAULTS = ['G', 'H', 'I', 'J', 'K', 'L'];

function nextSeriesLetter(usedSet, defaults) {
  for (const ch of defaults) if (!usedSet.has(ch)) return ch;
  for (const ch of 'ABCDEFGHIJKL') if (!usedSet.has(ch)) return ch;
  return 'F';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ensureModalShell() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement('section');
  modal.className = 'modal-overlay we-modal-overlay';
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="modal we-modal" dir="rtl">
      <h2 class="we-title">${escapeHtml(t('title'))}</h2>
      <p class="we-desc">${escapeHtml(t('desc'))}</p>

      <div class="we-pickrow">
        <button type="button" class="we-pick-btn">${escapeHtml(t('chooseFile'))}</button>
        <span class="we-filename">${escapeHtml(t('noFile'))}</span>
        <input type="file" accept=".docx" class="we-file-input" hidden>
      </div>

      <div class="we-status" hidden></div>
      <div class="we-meta" hidden></div>
      <div class="we-streams-wrap" hidden>
        <h3>${escapeHtml(t('streamsTable'))}</h3>
        <p class="we-automap">${escapeHtml(t('autoMapInfo'))}</p>
        <div class="we-table-wrap">
          <table class="we-streams">
            <thead>
              <tr>
                <th>${escapeHtml(t('colInclude'))}</th>
                <th>${escapeHtml(t('colSourceType'))}</th>
                <th>${escapeHtml(t('colMarker'))}</th>
                <th>${escapeHtml(t('colCount'))}</th>
                <th>${escapeHtml(t('colSeries'))}</th>
                <th>${escapeHtml(t('colPosition'))}</th>
                <th>${escapeHtml(t('colPreview'))}</th>
              </tr>
            </thead>
            <tbody class="we-streams-body"></tbody>
          </table>
        </div>
      </div>

      <div class="we-preview" hidden>
        <h3 class="we-preview-title"></h3>
        <ol class="we-preview-list"></ol>
        <button type="button" class="we-preview-close">${escapeHtml(t('previewClose'))}</button>
      </div>

      <div class="we-brackets-wrap">
        <h3>קבוצות סוגריים מותאמות</h3>
        <p class="we-brackets-info">כל מה שבין הסוגריים שתגדיר יילקח מהטקסט הראשי וייכנס לזרם הערות נפרד.</p>
        <div class="we-brackets-list"></div>
        <button type="button" class="we-bracket-add">➕ הוסף קבוצה</button>
      </div>

      <div class="we-external-wrap">
        <h3>מסמך נפרד (אופציונלי)</h3>
        <p class="we-external-info">בחר קובץ Word נוסף שיחובר ל-marker מסוים. הסימן (למשל @99) שנמצא בטקסט הראשי יוחלף בהערה מהמסמך הנפרד.</p>
        <div class="we-external-list"></div>
        <button type="button" class="we-external-add">➕ הוסף מסמך נפרד</button>
      </div>

      <div class="we-mode-wrap" style="margin:10px 0; padding:8px 10px; border:1px solid var(--border,#ccc); border-radius:6px;">
        <h3 style="margin:0 0 6px;">בעת ייבוא</h3>
        <label style="display:block; padding:3px 0;">
          <input type="checkbox" class="we-import-styles" checked>
          ייבא סגנונות Word לגלריית הסגנונות
        </label>
        <label style="display:block; padding:3px 0;">
          <input type="checkbox" class="we-skip-empty-notes" checked>
          דלג על הערות ריקות (רווחים בלבד)
        </label>
        <label style="display:block; padding:3px 0; margin-top:6px;">
          התאמת סימן בהערות:
          <select class="we-marker-match-mode" style="margin-right:6px; padding:2px 6px;">
            <option value="starts">מתחילה ב־ (אחרי רווחים)</option>
            <option value="contains">מכילה (בכל מקום)</option>
          </select>
        </label>
        <label style="display:block; padding:3px 0;">
          <input type="radio" name="we-import-mode" value="replace" class="we-mode-replace" checked>
          דרוס את כל הטקסט הקיים
        </label>
        <label style="display:block; padding:3px 0;">
          <input type="radio" name="we-import-mode" value="append" class="we-mode-append">
          הוסף בסוף הטקסט הקיים
        </label>
      </div>

      <div class="modal-btns we-btns">
        <button type="button" class="we-confirm primary">${escapeHtml(t('confirm'))}</button>
        <button type="button" class="we-cancel">${escapeHtml(t('cancel'))}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('.we-pick-btn').addEventListener('click', () => {
    modal.querySelector('.we-file-input').click();
  });
  modal.querySelector('.we-file-input').addEventListener('change', onFileChange);
  modal.querySelector('.we-cancel').addEventListener('click', closeModal);
  modal.querySelector('.we-confirm').addEventListener('click', onConfirm);
  modal.querySelector('.we-preview-close').addEventListener('click', () => {
    modal.querySelector('.we-preview').hidden = true;
  });
  modal.querySelector('.we-bracket-add').addEventListener('click', () => addBracketRow());
  modal.querySelector('.we-external-add').addEventListener('click', () => addExternalRow());
  // close on overlay click
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  return modal;
}

// =====================================================================
// Custom-bracket rows + external-doc rows (משה 2026-05-08)
// =====================================================================
function addBracketRow(opener = '{', closer = '}', series = null) {
  const list = document.querySelector('.we-brackets-list');
  if (!list) return;
  const used = new Set(_state.brackets.map(b => b.series));
  const ser = series || nextSeriesLetter(used, BRACKET_SERIES_DEFAULTS);
  const row = document.createElement('div');
  row.className = 'we-bracket-row';
  row.innerHTML = `
    <label>סוגר התחלה: <input type="text" class="we-br-open" value="${escapeHtml(opener)}" style="width:60px"></label>
    <label>סוגר סיום: <input type="text" class="we-br-close" value="${escapeHtml(closer)}" style="width:60px"></label>
    <label>אות זרם:
      <select class="we-br-series">
        ${'ABCDEFGHIJKL'.split('').map(c => `<option value="${c}"${c === ser ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="we-br-remove" title="הסר">✕</button>
  `;
  row.querySelector('.we-br-remove').addEventListener('click', () => {
    row.remove();
    syncBracketsState();
  });
  ['.we-br-open', '.we-br-close', '.we-br-series'].forEach(sel => {
    row.querySelector(sel).addEventListener('change', syncBracketsState);
    row.querySelector(sel).addEventListener('input', syncBracketsState);
  });
  list.appendChild(row);
  syncBracketsState();
}

function syncBracketsState() {
  const rows = document.querySelectorAll('.we-bracket-row');
  _state.brackets = Array.from(rows).map(row => ({
    opener: row.querySelector('.we-br-open').value || '{',
    closer: row.querySelector('.we-br-close').value || '}',
    series: row.querySelector('.we-br-series').value || 'F',
  }));
}

// משה 2026-05-10: שורות מסמך נפרד — מאפשר להעלות docx נוסף שיתחבר ל-marker.
function addExternalRow() {
  const list = document.querySelector('.we-external-list');
  if (!list) return;
  const idx = _state.externals.length;
  const used = new Set(_state.externals.map(e => e.series));
  const defSer = nextSeriesLetter(used, EXTERNAL_SERIES_DEFAULTS);
  const row = document.createElement('div');
  row.className = 'we-external-row';
  row.innerHTML = `
    <button type="button" class="we-ext-pick">בחר קובץ docx</button>
    <span class="we-ext-name">לא נבחר קובץ</span>
    <input type="file" accept=".docx" class="we-ext-file" hidden>
    <label>סימן: <input type="text" class="we-ext-marker" placeholder="@99" maxlength="6" style="width:60px"></label>
    <label>אות זרם:
      <select class="we-ext-series">
        ${'ABCDEFGHIJKL'.split('').map(c => `<option value="${c}"${c === defSer ? ' selected' : ''}>${c}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="we-ext-remove" title="הסר">✕</button>
  `;
  const fileInput = row.querySelector('.we-ext-file');
  row.querySelector('.we-ext-pick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    row.querySelector('.we-ext-name').textContent = f.name;
    const buf = await f.arrayBuffer();
    if (!_state.externals[idx]) _state.externals[idx] = {};
    _state.externals[idx].file = f;
    _state.externals[idx].fileName = f.name;
    _state.externals[idx].zipBuf = buf;
    syncExternalsState();
  });
  ['.we-ext-marker', '.we-ext-series'].forEach(sel => {
    row.querySelector(sel).addEventListener('input', syncExternalsState);
    row.querySelector(sel).addEventListener('change', syncExternalsState);
  });
  row.querySelector('.we-ext-remove').addEventListener('click', () => {
    row.remove();
    syncExternalsState();
  });
  list.appendChild(row);
  _state.externals.push({ file: null, fileName: '', zipBuf: null, marker: '', series: defSer });
  syncExternalsState();
}

function syncExternalsState() {
  const rows = document.querySelectorAll('.we-external-row');
  const arr = [];
  rows.forEach((row, i) => {
    const prev = _state.externals[i] || {};
    arr.push({
      file: prev.file || null,
      fileName: prev.fileName || '',
      zipBuf: prev.zipBuf || null,
      marker: row.querySelector('.we-ext-marker').value.trim() || '',
      series: row.querySelector('.we-ext-series').value || 'G',
    });
  });
  _state.externals = arr;
}


function openModal() {
  const m = ensureModalShell();
  m.classList.add('active');
  // ברירת מחדל — שורה אחת של {…} אם רשימת הקבוצות ריקה
  const list = m.querySelector('.we-brackets-list');
  if (list && list.children.length === 0) addBracketRow('{', '}', 'F');
}
export function closeModal() {
  const m = document.getElementById(MODAL_ID);
  if (m) m.classList.remove('active');
}

function setStatus(text, isError) {
  const m = document.getElementById(MODAL_ID); if (!m) return;
  const el = m.querySelector('.we-status');
  if (!text) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('we-error', !!isError);
}

async function onFileChange(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  _state.file = file;
  _state.fileName = file.name;
  const m = document.getElementById(MODAL_ID);
  m.querySelector('.we-filename').textContent = file.name;
  setStatus(t('scanning'));

  try {
    _state.zipBuf = await file.arrayBuffer();
    const [titles, headerFooter, sections, styles, sources, stylesFull] = await Promise.all([
      extract_doc_titles(_state.zipBuf.slice(0)),
      extract_headers_footers(_state.zipBuf.slice(0)),
      find_sections_in_docx(_state.zipBuf.slice(0)),
      find_all_styles_in_docx(_state.zipBuf.slice(0)),
      find_all_note_sources(_state.zipBuf.slice(0)),
      engine.find_all_styles_full(_state.zipBuf.slice(0)),
    ]);
    _state.metadata = { titles, headerFooter, sections, styles };
    _state.stylesFull = stylesFull;
    _state.sources = sources;
    _state.streams = buildDefaultStreamMapping(sources);
    renderMeta();
    renderStreamsTable();
    setStatus('');
  } catch (e) {
    console.error('[word_extractor] scan failed:', e);
    setStatus(`${t('scanFailed')} ${e && e.message ? e.message : e}`, true);
  }
}

function renderMeta() {
  const m = document.getElementById(MODAL_ID); if (!m) return;
  const wrap = m.querySelector('.we-meta');
  const md = _state.metadata || {};
  const [title, subtitle] = md.titles || ['', ''];
  const hf = md.headerFooter || { header: '', footer: '' };
  const secs = md.sections || [];
  const styles = md.styles || {};
  const lines = [];
  if (title)    lines.push(`<div><b>${escapeHtml(t('docTitle'))}</b> ${escapeHtml(title)}</div>`);
  if (subtitle) lines.push(`<div><b>${escapeHtml(t('docSubtitle'))}</b> ${escapeHtml(subtitle)}</div>`);
  if (hf.header) lines.push(`<div><b>${escapeHtml(t('headerLabel'))}</b> ${escapeHtml(hf.header)}</div>`);
  if (hf.footer) lines.push(`<div><b>${escapeHtml(t('footerLabel'))}</b> ${escapeHtml(hf.footer)}</div>`);
  if (secs.length) lines.push(`<div><b>${escapeHtml(t('sectionsLabel'))}</b> ${secs.length}</div>`);
  const stKeys = Object.keys(styles);
  if (stKeys.length) lines.push(`<div><b>${escapeHtml(t('stylesLabel'))}</b> ${stKeys.length}</div>`);
  if (_state.sources.length) {
    const cnt = _state.sources.reduce((a, s) => a + (s.count || 0), 0);
    lines.push(`<div><b>${escapeHtml(t('detectedSources'))}</b> ${_state.sources.length} (${cnt} ${escapeHtml(t('notes'))})</div>`);
  }
  wrap.innerHTML = lines.join('');
  wrap.hidden = !lines.length;
}

function renderStreamsTable() {
  const m = document.getElementById(MODAL_ID); if (!m) return;
  const wrap = m.querySelector('.we-streams-wrap');
  const body = m.querySelector('.we-streams-body');
  body.innerHTML = '';
  if (!_state.streams.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  for (let i = 0; i < _state.streams.length; i++) {
    const st = _state.streams[i];
    const tr = document.createElement('tr');
    tr.dataset.idx = String(i);

    // include
    const td0 = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!st.included;
    cb.addEventListener('change', () => { st.included = cb.checked; });
    td0.appendChild(cb); tr.appendChild(td0);

    // source type icon + name
    const td1 = document.createElement('td');
    td1.innerHTML = `${escapeHtml(st.icon || SOURCE_LABELS[st.source_type] || '')}<br><small>${escapeHtml(SOURCE_HEB_NAMES[st.source_type] || st.source_type || '')}</small>`;
    tr.appendChild(td1);

    // marker
    const td2 = document.createElement('td');
    if (st.marker) td2.textContent = `@${st.marker}`;
    else td2.innerHTML = `<i>${escapeHtml(t('none'))}</i>`;
    tr.appendChild(td2);

    // count
    const td3 = document.createElement('td');
    td3.textContent = String(st.count || 0);
    tr.appendChild(td3);

    // series picker
    const td4 = document.createElement('td');
    const sel = document.createElement('select');
    for (const L of SERIES_LETTERS) {
      const opt = document.createElement('option');
      opt.value = L; opt.textContent = L;
      if (L === st.series) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => { st.series = sel.value; });
    td4.appendChild(sel); tr.appendChild(td4);

    // position (only meaningful for sidenote)
    const td5 = document.createElement('td');
    if (st.source_type === SOURCE_SIDENOTE) {
      const psel = document.createElement('select');
      for (const [val, label] of [['right', 'ימין'], ['left', 'שמאל'], ['inner', 'פנימי'], ['outer', 'חיצוני']]) {
        const o = document.createElement('option');
        o.value = val; o.textContent = label;
        if (val === (st.position || 'right')) o.selected = true;
        psel.appendChild(o);
      }
      psel.addEventListener('change', () => { st.position = psel.value; });
      td5.appendChild(psel);
    } else {
      td5.textContent = '—';
    }
    tr.appendChild(td5);

    // preview
    const td6 = document.createElement('td');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'we-preview-btn';
    btn.textContent = t('previewBtn');
    btn.addEventListener('click', () => previewStream(st));
    td6.appendChild(btn); tr.appendChild(td6);

    body.appendChild(tr);
  }
}

async function previewStream(st) {
  if (!_state.zipBuf) return;
  const m = document.getElementById(MODAL_ID); if (!m) return;
  const previewBox = m.querySelector('.we-preview');
  const titleEl = m.querySelector('.we-preview-title');
  const list = m.querySelector('.we-preview-list');
  list.innerHTML = '';
  titleEl.textContent = `${st.icon || ''} ${SOURCE_HEB_NAMES[st.source_type] || ''} ${st.marker ? '@' + st.marker : t('none')}`;

  let notes_dict = {};
  try {
    if (st.source_type === SOURCE_FOOTNOTE) notes_dict = await read_footnotes(_state.zipBuf.slice(0));
    else if (st.source_type === SOURCE_ENDNOTE) notes_dict = await read_endnotes(_state.zipBuf.slice(0));
    else if (st.source_type === SOURCE_COMMENT) notes_dict = await read_comments(_state.zipBuf.slice(0));
    else { previewBox.hidden = false; return; }
  } catch (e) {
    titleEl.textContent += ` — ${t('importFailed')} ${e && e.message ? e.message : e}`;
    previewBox.hidden = false;
    return;
  }

  const ids = Object.keys(notes_dict).sort((a, b) => {
    const av = /^\d+$/.test(a) ? parseInt(a, 10) : 0;
    const bv = /^\d+$/.test(b) ? parseInt(b, 10) : 0;
    return av - bv;
  });

  let shown = 0;
  for (const nid of ids) {
    const rich = notes_dict[nid];
    const text = rich.get_text();
    if (st.marker) {
      const re = new RegExp('@' + st.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!re.test(text)) continue;
    } else {
      if (/@\d+/.test(text)) continue;
    }
    let display = text;
    if (st.marker) {
      const re2 = new RegExp('^.*?@' + st.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*');
      display = display.replace(re2, '');
    }
    const li = document.createElement('li');
    li.textContent = display.trim().slice(0, 320);
    list.appendChild(li);
    shown++;
    if (shown >= 25) break;
  }
  if (!shown) {
    const li = document.createElement('li');
    li.innerHTML = `<i>${escapeHtml(t('none'))}</i>`;
    list.appendChild(li);
  }
  previewBox.hidden = false;
}

// =====================================================================
// Confirm — תרגום בפועל
// =====================================================================

async function onConfirm() {
  const selected = _state.streams.filter(s => s.included);
  if (!selected.length) {
    setStatus(t('selectAtLeastOne'), true);
    return;
  }
  const dups = findDuplicateSeries(selected);
  if (dups.length) {
    setStatus(`${t('seriesAlreadyUsed')} (${dups.join(', ')})`, true);
    return;
  }
  setStatus(t('scanning'));

  try {
    // משה 2026-05-14: קריאת אפשרויות נוספות
    const skipEmptyNotes = document.querySelector('.we-skip-empty-notes')?.checked !== false;
    const markerMatchMode = document.querySelector('.we-marker-match-mode')?.value || 'starts';
    
    // משה 2026-05-09: מסלול ב — חיקוי docx_extract של comparator_tool.py.
    // בגוף נכנס רק הסמל (@01), תוכן ההערה לזרם הנפרד. אין LaTeX, אין סינון.
    syncBracketsState();
    if (document.querySelector('.we-import-styles')?.checked !== false) {
      mergeDocxStylesIntoRegistry(_state.stylesFull || {});
    }
    const simpleSelected = [];
    let nextCode = 1;
    const seriesToCode = {};
    for (const s of selected) {
      if (!seriesToCode[s.series]) {
        seriesToCode[s.series] = String(nextCode++).padStart(2, '0');
      }
      simpleSelected.push({
        source: s.source_type || s.sourceType,
        marker: s.marker || null,
        symbol: '@' + seriesToCode[s.series],
      });
    }
    // משה 2026-05-10: ראשית — מפת HTML של הערות מ-mammoth (תמונות/רשימות/טבלאות).
    // נופלים ל-_dnotes_html שב-engine אם mammoth נכשל.
    let notesHtmlMap = {};
    try {
      const dynamicMap0 = buildDynamicStyleMap(_state.stylesFull || {});
      notesHtmlMap = await extractNotesHtmlMap(_state.zipBuf.slice(0), { styleMap: dynamicMap0 });
    } catch (notesErr) {
      console.warn('[word_extractor] notes mammoth fallback to plain:', notesErr);
    }
    const result = await engine.docx_extract_simple(
      _state.zipBuf.slice(0), simpleSelected, { 
        notesHtmlMap,
        skipEmptyNotes,
        markerMatchMode 
      }
    );
    // משה 2026-05-09: שלב 1+2 — mammoth מספק HTML מעוצב לגוף עם סמלי הזרמים שלנו.
    // הזרמים עצמם ממשיכים להגיע מ-docx_extract_simple. הגוף = mammoth, זרמים = result.streams.
    let bodyHtml = null;
    try {
      // משה 2026-05-09: שלב 4 — styleMap דינמי לפי קטלוג הסגנונות, ו-CSS שמוזרק לעמוד.
      const dynamicMap = buildDynamicStyleMap(_state.stylesFull || {});
      const css = buildStylesCss(_state.stylesFull || {});
      if (css) injectStylesCss(css);
      const mres = await extractBodyHtmlWithSymbols(
        _state.zipBuf.slice(0), simpleSelected, { styleMap: dynamicMap }
      );
      bodyHtml = mres.html;
    } catch (mammothErr) {
      console.warn('[word_extractor] mammoth fallback to plain:', mammothErr);
    }
    // משה 2026-05-09: החזרת תמיכת קבוצות סוגריים מותאמות (שהוסרה בטעות).
    // לכל שורת bracket: חותכים מ-result.main את הטקסט שבין opener ל-closer
    // ומעבירים אותו לזרם מתאים, במקום משאירים סמל בגוף.
    if (_state.brackets && _state.brackets.length) {
      for (const b of _state.brackets) {
        if (!seriesToCode[b.series]) {
          seriesToCode[b.series] = String(nextCode++).padStart(2, '0');
        }
        const sym = '@' + seriesToCode[b.series];
        const collected = [];
        const escO = (b.opener || '{').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escC = (b.closer || '}').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escO + '\\s*([\\s\\S]*?)\\s*' + escC, 'g');
        result.main = result.main.replace(re, (_m, inner) => {
          collected.push(`${sym}${inner}`);
          return sym;
        });
        // משה 2026-05-09: גם ב-bodyHtml של mammoth — להחליף סוגריים בסמלים.
        if (bodyHtml) {
          bodyHtml = bodyHtml.replace(re, (_m, inner) => {
            // ה-inner שמגיע ב-bodyHtml יכול להכיל תגי HTML; אנחנו אוספים רק את הטקסט
            // לזרם, ובמקום הסוגריים בגוף נשאיר את הסמל.
            return sym;
          });
        }
        if (collected.length) {
          const existing = result.streams.find(([s]) => s === sym);
          if (existing) existing[1] = existing[1] + '\n' + collected.join('\n');
          else result.streams.push([sym, collected.join('\n')]);
        }
      }
    }
    // משה 2026-05-10: מסמכים נפרדים — לכל external רץ mammoth, מחליף את ה-marker
    // בגוף ובגוף ה-HTML בסמל הסדרה, ומוסיף את התוכן כזרם נפרד.
    syncExternalsState();
    if (_state.externals && _state.externals.length) {
      // result.streamsHtml הופך לחובה אם יש externals — נוסיף HTML גם לזרמים שכבר קיימים
      if (!result.streamsHtml) {
        result.streamsHtml = result.streams.map(([s, t]) => [s, plainToHtml(t)]);
      }
      for (const ex of _state.externals) {
        if (!ex.zipBuf || !ex.marker) continue;
        if (!seriesToCode[ex.series]) {
          seriesToCode[ex.series] = String(nextCode++).padStart(2, '0');
        }
        const sym = '@' + seriesToCode[ex.series];
        const markerNoAt = ex.marker.replace(/^@/, '');
        const escMarker = markerNoAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // החלפת @<marker> → @<sym> בגוף הראשי וב-HTML
        result.main = result.main.replace(new RegExp('@' + escMarker, 'g'), sym);
        if (bodyHtml) bodyHtml = bodyHtml.replace(new RegExp('@' + escMarker, 'g'), sym);
        // טעינת המסמך הנפרד דרך mammoth — תמיכה מלאה (bold/lists/tables/images)
        let extHtml = '';
        let extPlain = '';
        try {
          const mres = await extractBodyHtmlWithSymbols(ex.zipBuf.slice(0), [], {});
          extHtml = mres.html || '';
          // טקסט פשוט לזרם הקלאסי
          extPlain = extHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        } catch (extErr) {
          console.warn('[word_extractor] external doc failed:', extErr);
        }
        if (extHtml || extPlain) {
          // חיבור לזרם — אם הסמל כבר קיים, מצרפים. אחרת יוצרים חדש.
          const existing = result.streams.find(([s]) => s === sym);
          if (existing) existing[1] = existing[1] + '\n' + extPlain;
          else result.streams.push([sym, extPlain]);
          const existingH = result.streamsHtml.find(([s]) => s === sym);
          if (existingH) existingH[1] = existingH[1] + extHtml;
          else result.streamsHtml.push([sym, extHtml]);
        }
      }
    }
    // משה 2026-05-09: מצב ייבוא — דרוס/הוסף בסוף
    const modeEl = document.querySelector('.we-mode-append');
    const importMode = (modeEl && modeEl.checked) ? 'append' : 'replace';
    distributeToPanesSimple(result, bodyHtml, importMode);
    setStatus('');
    closeModal();
    if (typeof _state.onLoadedRef === 'function') _state.onLoadedRef();
  } catch (e) {
    console.error('[word_extractor] import failed:', e);
    setStatus(`${t('importFailed')} ${e && e.message ? e.message : e}`, true);
  }
}

// משה 2026-05-08: distributeToPanes עוברת לפלט HTML עם עיצוב אמיתי.
// במקום להחזיר LaTeX גולמי לעורך, חותכים את ה-RichText שב-extract_and_process
// משה 2026-05-09: distributeToPanesSimple — מקבלת { main, streams } מ-docx_extract_simple.
// המרת \n ל-<p>, אפס LaTeX, אפס regex cleanup. בדיוק כמו ב-comparator_tool.py.
function escTxt(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function plainToHtml(s) {
  if (!s) return '<p></p>';
  const lines = s.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return '<p></p>';
  return lines.map(l => `<p>${escTxt(l)}</p>`).join('');
}
function distributeToPanesSimple(result, bodyHtml, mode = 'replace') {
  if (!_state.paneManagerRef) return;
  const pm = _state.paneManagerRef;
  // משה 2026-05-09: במצב 'replace' (ברירת מחדל) — אתחול מלא של הפנייות.
  // במצב 'append' — לא מאתחלים, מוסיפים לסוף הקיים.
  if (mode !== 'append') {
    pm.load({
      version: 1,
      activeId: 'word-main',
      panes: [{
        id: 'word-main',
        streamCode: null,
        symbol: '',
        label: 'ראשי',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      }],
    });
  }
  const mainPane = pm.getMainPane();
  if (mainPane && mainPane.editor) {
    // משה 2026-05-09: עדיפות ל-HTML המעוצב מ-mammoth; נפילה ל-plainToHtml אם נכשל.
    const html = (bodyHtml && bodyHtml.length) ? bodyHtml : plainToHtml(result.main);
    if (mode === 'append') {
      // הוספה בסוף — ללא דריסה
      mainPane.editor.chain().focus('end').insertContent(html).run();
    } else {
      mainPane.editor.commands.setContent(html);
    }
  }
  // משה 2026-05-10: בונים מילון symbol → HTML מ-streamsHtml אם קיים (כדי לשמר bold/italic).
  const htmlBySym = {};
  if (result.streamsHtml && Array.isArray(result.streamsHtml)) {
    for (const [sym, h] of result.streamsHtml) htmlBySym[sym] = h;
  }
  for (const [sym, txt] of result.streams) {
    const code = sym.replace(/^@/, '');
    let pane = pm.panes.find(p => p.symbol === sym || p.streamCode === code);
    if (!pane) {
      pane = pm.addPane({ streamCode: code, symbol: sym, label: `זרם ${sym}` });
    }
    if (pane && pane.editor) {
      pane.symbol = sym;
      if (pane.editor.storage && pane.editor.storage.streamMark) {
        pane.editor.storage.streamMark.symbol = sym;
      }
      // משה 2026-05-10: עדיפות ל-HTML עם עיצוב; נפילה ל-plainToHtml אם חסר.
      const streamHtml = htmlBySym[sym] || plainToHtml(txt);
      if (mode === 'append') {
        pane.editor.chain().focus('end').insertContent(streamHtml).run();
      } else {
        pane.editor.commands.setContent(streamHtml);
      }
    }
  }
}

// החזיר, שולפים את \footnoteX{...} ו-\ledXnote{...} כ-RichText נפרדים,
// וממירים כל אחד ל-HTML עם <strong>/<em>/<u>/color/size לעיצוב אמיתי בעורך.
function distributeToPanes(full, sd) {
  const text = full.get_text();
  const seriesToCode = {};
  const seriesToSymbol = {};
  let nextCode = 1;
  for (const sid of Object.keys(sd)) {
    const s = sd[sid];
    if (!s.series) continue;
    if (!seriesToCode[s.series]) {
      const code = String(nextCode++).padStart(2, '0');
      seriesToCode[s.series] = code;
      // משה 2026-05-08: תמיד @<code> (01, 02...) — ה-marker הוא תיוג פנימי
      // של רב-טקסט בתוך ה-content, לא סמל שצריך להופיע ב-text הראשי.
      seriesToSymbol[s.series] = `@${code}`;
    }
  }

  // streamBuckets: series → [RichText, RichText, ...]
  // משה 2026-05-08: לוקחים מ-engine.extract_and_process.streamRichTexts
  // (ה-RichText המקורי לפני המרה ל-LaTeX) — שמירת עיצוב אמיתי.
  const streamBuckets = {};
  const engineBuckets = engine.extract_and_process.streamRichTexts || {};
  for (const series of Object.keys(engineBuckets)) {
    streamBuckets[series] = engineBuckets[series].slice();
  }
  // mainSegments: רצף של מקטעים שמרכיבים את הגוף הראשי. כל מקטע הוא או
  //   { kind:'rich', start, end } — חתיכת RichText מקורית
  //   או { kind:'symbol', symbol } — סמל זרם להחלפה (@01 וכו')
  const mainSegments = [];

  function findBracketEnd(t, openIdx) {
    // openIdx מצביע על '{'. מחזיר אינדקס של ה-'}' התואם.
    let depth = 1;
    let j = openIdx + 1;
    while (j < t.length && depth > 0) {
      if (t[j] === '\\' && j + 1 < t.length) { j += 2; continue; }
      if (t[j] === '{') depth++;
      else if (t[j] === '}') { depth--; if (depth === 0) return j; }
      j++;
    }
    return -1;
  }

  let i = 0;
  let lastFlush = 0;
  while (i < text.length) {
    // \footnoteA{...}
    if (text[i] === '\\' && text.startsWith('\\footnote', i)) {
      const after = i + '\\footnote'.length;
      const seriesChar = text[after];
      if (/[A-L]/.test(seriesChar) && text[after + 1] === '{') {
        const innerStart = after + 2;
        const closeIdx = findBracketEnd(text, after + 1);
        if (closeIdx > 0) {
          if (i > lastFlush) mainSegments.push({ kind: 'rich', start: lastFlush, end: i });
          // לא דוחפים noteRich (LaTeX wrapped) — streamBuckets כבר מאוכלס
          // מ-extract_and_process.streamRichTexts עם RichText מקורי בלי עטיפת _mk_fn.
          const sym = seriesToSymbol[seriesChar] || `@${seriesChar}`;
          mainSegments.push({ kind: 'symbol', symbol: sym });
          i = closeIdx + 1;
          lastFlush = i;
          continue;
        }
      }
    }
    // \ledrightnote / \ledleftnote / \ledinnernote / \ledouternote{...}
    if (text[i] === '\\') {
      const sideMatch = text.slice(i).match(/^\\(ledrightnote|ledleftnote|ledinnernote|ledouternote)\{/);
      if (sideMatch) {
        const openIdx = i + sideMatch[0].length - 1;
        const closeIdx = findBracketEnd(text, openIdx);
        if (closeIdx > 0) {
          if (i > lastFlush) mainSegments.push({ kind: 'rich', start: lastFlush, end: i });
          // הערות צד — מסירים מהראשי, ולא משייכים ל-bucket (אין series ידוע)
          i = closeIdx + 1;
          lastFlush = i;
          continue;
        }
      }
    }
    i++;
  }
  if (text.length > lastFlush) mainSegments.push({ kind: 'rich', start: lastFlush, end: text.length });

  if (!_state.paneManagerRef) return;
  const pm = _state.paneManagerRef;

  pm.load({
    version: 1,
    activeId: "word-main",
    panes: [{
      id: "word-main",
      streamCode: null,
      symbol: "",
      label: "ראשי",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }],
  });

  const mainPane = pm.getMainPane();
  if (mainPane && mainPane.editor) {
    const mainHtml = mainSegmentsToHtml(mainSegments, full);
    mainPane.editor.commands.setContent(mainHtml);
  }

  for (const series of Object.keys(streamBuckets)) {
    const code = seriesToCode[series] || series;
    const symbol = seriesToSymbol[series] || `@${code}`;
    const noteRichArr = streamBuckets[series];
    let pane = pm.panes.find(p => p.streamCode === code);
    if (!pane) {
      pane = pm.addPane({ streamCode: code, symbol, label: `זרם ${series}` });
    }
    if (pane && pane.editor) {
      pane.symbol = symbol;
      if (pane.editor.storage && pane.editor.storage.streamMark) {
        pane.editor.storage.streamMark.symbol = symbol;
      }
      const html = noteRichArr.map(r => richToParagraphsHtml(r)).join('') || '<p></p>';
      pane.editor.commands.setContent(html);
    }
  }
}

// מצרף mainSegments ל-HTML עם פסקאות (\par) ועיצוב אמיתי.
function mainSegmentsToHtml(segments, full) {
  const parts = [];
  for (const seg of segments) {
    if (seg.kind === 'symbol') {
      parts.push(seg.symbol);
    } else if (seg.kind === 'rich') {
      const sliced = richSlice(full, seg.start, seg.end);
      parts.push(richToInlineHtml(sliced));
    }
  }
  const combined = parts.join('');
  const blocks = combined.split(SENTINEL_PAR).map(s => s.trim()).filter(Boolean);
  if (!blocks.length) return '<p></p>';
  return blocks.map(b => `<p>${b}</p>`).join('');
}

// מנקה רצף raw_latex tokens מ-LaTeX commands שאין להם תרגום HTML, אבל
// משאיר את ה-markers (@\d+) ואת סימן הפסקה (\par/\newline -> SENTINEL_PAR).
function cleanRawLatexRun(raw) {
  let s = raw;

  // PHASE 1 — הסרת blocks שלמים לפני הסרת פקודות בודדות
  // 1a. par_cmd של _mk_fn — מ-\parfillskip עד \par שאחרי \hfil}
  s = s.replace(
    /\\parfillskip\s*=\s*0pt\s+plus\s+\d+(?:\.\d+)?\s*fil[\s\S]*?\\hfil\s*\}\s*\\par/g,
    SENTINEL_PAR
  );
  // 1b. \fontsize{X}{Y}\selectfont
  s = s.replace(/\\fontsize\s*\{[^}]*\}\s*\{[^}]*\}\s*\\selectfont/g, "");
  // 1c. \textcolor[HTML]{XXXXXX}
  s = s.replace(/\\textcolor\s*\[HTML\]\s*\{[0-9A-Fa-f]+\}/g, "");
  // 1d. \textcolor{שם-צבע}
  s = s.replace(/\\textcolor\s*\{[^}]+\}/g, "");
  // 1e. \opwhdg{...}{...}{ — wrapper של כותרת (השאריות המוכרות)
  s = s.replace(/\\opwhdg\s*\{[^}]*\}\s*\{[^}]*\}\s*\{/g, "");
  // 1f. \opwnote(raised|dropped)<series>{...}
  s = s.replace(/\\opwnote(?:raised|dropped)[A-L]\s*\{[^}]*\}/g, "");
  // 1g. \leavevmode\hskip Nem\relax
  s = s.replace(/\\leavevmode\s*\\hskip\s+\d+(?:\.\d+)?\s*em\s*\\relax/g, "");
  // 1h. \streamfont<series>
  s = s.replace(/\\streamfont[A-L]/g, "");
  // 1i. \setRTL / \setLTR
  s = s.replace(/\\setRTL/g, "");
  s = s.replace(/\\setLTR/g, "");
  // 1j. \strut
  s = s.replace(/\\strut/g, "");

  // PHASE 2 — סימני פסקה
  s = s.replace(/\\par\b\s*/g, SENTINEL_PAR);
  s = s.replace(/\\newline\{\}/g, SENTINEL_PAR);

  // PHASE 3 — פקודות בודדות
  s = s.replace(/\\[a-zA-Z]+[0-9]*\*?\s*(?:\[[^\]]*\])?/g, "");
  s = s.replace(/\\[^a-zA-Z\s]/g, "");

  // PHASE 3b — פקודות יתומות (ה-richSlice חתך את ה-\ הקודם):
  // ravtextbf, textbf, textit, fontsize, textcolor, setbox, hbox, unhbox, lastbox,
  // box, opwhdg, streamfont, setRTL, strut, noindent, hsize, hfil, relax, unskip,
  // null, par, parfillskip, lastlinefit, nolinebreak, leavevmode, hskip, selectfont,
  // footnote, newline.
  // המילון הזה מחפש את ה-substrings — מחקים מקרים שבהם רק חלק מהשם נשאר.
  const ORPHAN_LATEX_NAMES = [
    'ravtextbf','textbf','textit','underline','fontsize','selectfont',
    'textcolor','setbox','unhbox','lastbox','hbox','box',
    'opwhdg','opwheading','opwnoteraised','opwnotedropped',
    'streamfont','setRTL','setLTR','strut','noindent','hsize',
    'hfil','hfill','hskip','leavevmode','relax','unskip','null',
    'parfillskip','lastlinefit','nolinebreak','par','newline',
    'footnote','footnotetext','ledrightnote','ledleftnote','ledinnernote','ledouternote',
    'centering','raggedleft','raggedright',
  ];
  // בונים regex ענק שתופס כל אחד עם digits אופציונליים אחריו ועם opt bracket
  const orphanRe = new RegExp('\\b(?:' + ORPHAN_LATEX_NAMES.join('|') + ')[A-L]?[0-9]*\\*?(?:\\[[^\\]]*\\])?', 'g');
  s = s.replace(orphanRe, "");
  // PHASE 3c — שאריות שיכולות להיוותר בעקבות חיתוך אקראי באמצע מילה:
  // 'ontE' (חצי מ-fontsize), 'tbf' (חצי מ-textbf), 'box=' וכו'
  s = s.replace(/\b(?:onts|onte|ontE|tbf|tbox|extbf|extit|nhbox|astbox|amfont|elax|efit|line|inde|HTML|EE\d{4})\b/gi, "");
  // \\footnote/\\par שכבר טופלו אבל נשארו אותיות יתומות
  s = s.replace(/\bnoteB\b/g, "");

  // PHASE 4 — שאריות args של LaTeX
  s = s.replace(/0pt\s+plus\s+\d+(?:\.\d+)?\s*fil/g, "");
  s = s.replace(/=\s*\d+\s*pt(?:\s+plus\s+\d+(?:\.\d+)?\s*fil)?/g, "");
  s = s.replace(/=\s*\d+/g, "");
  s = s.replace(/\b\d+\s*=/g, "");
  s = s.replace(/\bto\s*\\?hsize\b/g, "");
  s = s.replace(/\bto\b\s*\d*/g, "");
  s = s.replace(/\bfillskip\b/g, "");
  s = s.replace(/\bhsize\b/g, "");

  // PHASE 5 — שאריות hex color (אחרי שה-wrappers הוסרו)
  s = s.replace(/(?<![A-Za-z0-9])[0-9A-F]{6}(?![A-Za-z0-9])/g, "");
  s = s.replace(/\bHTML\b/g, "");

  // PHASE 6 — שאריות font sizes יתומות (לאחר שה-wrappers הוסרו)
  s = s.replace(/\b\d+(?:\.\d+)?\s*pt\b/g, "");

  // PHASE 7 — סוגריים מסולסלות LaTeX
  s = s.replace(/[{}]/g, "");

  // PHASE 8 — צמצום סימני שוויון/רווחים יתומים
  s = s.replace(/={2,}/g, "");
  s = s.replace(/\s+=\s+/g, " ");
  s = s.replace(/\s{2,}/g, " ");
  s = s.replace(/^\s+|\s+$/g, "");

  return s;
}

function richToInlineHtml(rich) {
  // עוברים tokens. raw_latex נצברים כ-string רצוף ועוברים cleanRawLatexRun
  // כדי להסיר LaTeX wrappers ולשמר רק markers + סמני פסקה.
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const out = [];
  let i = 0;
  const tokens = rich.tokens;
  while (i < tokens.length) {
    const t0 = tokens[i];
    if (t0.is_raw_latex) {
      let raw = "";
      while (i < tokens.length && tokens[i].is_raw_latex) {
        raw += tokens[i].char;
        i++;
      }
      out.push(cleanRawLatexRun(raw));
      continue;
    }
    const b = t0.b, it = t0.i, u = t0.u, sz = t0.sz, col = t0.col;
    let text = "";
    while (i < tokens.length) {
      const tt = tokens[i];
      if (tt.is_raw_latex) break;
      if (tt.b !== b || tt.i !== it || tt.u !== u || tt.sz !== sz || tt.col !== col) break;
      text += tt.char;
      i++;
    }
    let chunk = escapeHtml(text);
    if (u) chunk = `<u>${chunk}</u>`;
    if (it) chunk = `<em>${chunk}</em>`;
    if (b) chunk = `<strong>${chunk}</strong>`;
    const styles = [];
    if (sz) styles.push(`font-size:${(sz / 2).toFixed(1)}pt`);
    if (col) styles.push(`color:#${col}`);
    if (styles.length) chunk = `<span style="${styles.join(';')}">${chunk}</span>`;
    out.push(chunk);
  }
  return out.join('');
}

function richToParagraphsHtml(rich) {
  const html = richToInlineHtml(rich);
  const blocks = html.split(SENTINEL_PAR).map(s => s.trim()).filter(Boolean);
  if (!blocks.length) return '<p></p>';
  return blocks.map(b => `<p>${b}</p>`).join('');
}

// =====================================================================
// Public — open dialog + setup
// =====================================================================

export function openWordExtractor(paneManager, onLoaded) {
  _state.paneManagerRef = paneManager || null;
  _state.onLoadedRef = onLoaded || null;
  _state.file = null;
  _state.fileName = '';
  _state.zipBuf = null;
  _state.sources = [];
  _state.streams = [];
  _state.metadata = null;

  ensureModalShell();
  const m = document.getElementById(MODAL_ID);
  if (m) {
    m.querySelector('.we-filename').textContent = t('noFile');
    m.querySelector('.we-meta').hidden = true;
    m.querySelector('.we-streams-wrap').hidden = true;
    m.querySelector('.we-preview').hidden = true;
    m.querySelector('.we-status').hidden = true;
    const fi = m.querySelector('.we-file-input');
    if (fi) fi.value = '';
  }
  openModal();
}
