// word_extractor_dialog.js — חלון בחירת קובץ + תצוגה מקדימה + מיפוי זרמים.
// פותח דיאלוג RTL, מפעיל זיהוי-אוטומטי על ה-DOCX שנבחר, מציג טבלת מיפוי
// עם אפשרות תצוגה מקדימה של ההערות ובחירה ידנית של אות זרם, ולבסוף
// קורא ל-extract_and_process ומפיץ את התוצאות לחלוניות.

import {
  find_all_note_sources,
  read_footnotes, read_endnotes, read_comments,
  extract_word_html,
  extract_doc_titles, extract_headers_footers,
  find_sections_in_docx, find_all_styles_in_docx,
} from "./word_extractor_engine.js";
import {
  buildDefaultStreamMapping, streamsToSd, findDuplicateSeries,
} from "./word_extractor_streams.js";
import {
  SOURCE_LABELS, SOURCE_HEB_NAMES, SERIES_LETTERS,
  SOURCE_FOOTNOTE, SOURCE_ENDNOTE, SOURCE_COMMENT,
  SOURCE_SIDENOTE, SOURCE_PARALLEL, SOURCE_EXTERNAL, SOURCE_CUSTOM,
  t,
} from "./word_extractor_i18n.js";
import "./word_extractor.css";

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
};

const BRACKET_SERIES_DEFAULTS = ['F', 'G', 'H', 'I', 'J', 'K', 'L'];

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
    <label>סוגר התחלה: <input type="text" class="we-br-open" value="${escapeHtml(opener)}" maxlength="3" style="width:40px"></label>
    <label>סוגר סיום: <input type="text" class="we-br-close" value="${escapeHtml(closer)}" maxlength="3" style="width:40px"></label>
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
    const [titles, headerFooter, sections, styles, sources] = await Promise.all([
      extract_doc_titles(_state.zipBuf.slice(0)),
      extract_headers_footers(_state.zipBuf.slice(0)),
      find_sections_in_docx(_state.zipBuf.slice(0)),
      find_all_styles_in_docx(_state.zipBuf.slice(0)),
      find_all_note_sources(_state.zipBuf.slice(0)),
    ]);
    _state.metadata = { titles, headerFooter, sections, styles };
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
// Confirm — תרגום בפועל (מנוע HTML טהור, ללא LaTeX)
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
    // משה 2026-05-08: עוברים למנוע HTML טהור (extract_word_html).
    // אין יותר LaTeX, אין cleanRawLatexRun. ה-engine מקבל רשימת
    // {stream, symbol} כמו שהדיאלוג כבר בנה (selected עם series כסמל).
    const selectedForEngine = selected.map(s => ({
      stream: {
        source_type: s.source_type,
        marker: s.marker || null,
        label: `${s.icon || ''} ${s.source_type}${s.marker ? ' @' + s.marker : ' ללא סימון'}`,
      },
      symbol: `@${s.series}`,
    }));
    const result = await extract_word_html(_state.zipBuf.slice(0), selectedForEngine);
    distributeToPanes(result);
    setStatus('');
    closeModal();
    if (typeof _state.onLoadedRef === 'function') _state.onLoadedRef();
  } catch (e) {
    console.error('[word_extractor] import failed:', e);
    setStatus(`${t('importFailed')} ${e && e.message ? e.message : e}`, true);
  }
}

// distributeToPanes — מקבל את הפלט של extract_word_html (mainHtml +
// streamsByCode + streamSymbols + streamLabels) ומפיץ ישירות לחלוניות
// העורך. אין יותר RichText/LaTeX באמצע — ה-engine מייצר HTML טהור.
function distributeToPanes(result) {
  if (!_state.paneManagerRef) return;
  const pm = _state.paneManagerRef;

  // איפוס ה-pane הראשי
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
    mainPane.editor.commands.setContent(result.mainHtml || '<p></p>');
  }

  // לכל code (01,02,...) — חלונית נפרדת
  for (const code of Object.keys(result.streamsByCode || {})) {
    const html = result.streamsByCode[code] || '<p></p>';
    const symbol = (result.streamSymbols && result.streamSymbols[code]) || `@${code}`;
    const label = (result.streamLabels && result.streamLabels[code]) || `זרם ${code}`;
    let pane = pm.panes.find(p => p.streamCode === code);
    if (!pane) {
      pane = pm.addPane({ streamCode: code, symbol, label });
    }
    if (pane && pane.editor) {
      pane.symbol = symbol;
      if (pane.editor.storage && pane.editor.storage.streamMark) {
        pane.editor.storage.streamMark.symbol = symbol;
      }
      pane.editor.commands.setContent(html);
    }
  }
}

// =====================================================================
// קוד legacy שלא בשימוש — נשאר רק כתאימות אחורה (לא נקרא יותר)
// =====================================================================
// היה כאן distributeToPanes ישן שבנה LaTeX ואז ניקה אותו ב-regex.
// המנוע החדש מייצר HTML ישיר ב-extract_word_html, ולכן כל הקוד הזה
// ירד.
async function _legacy_distributeToPanes_DELETED() {
  // unused — placeholder so the file ends correctly without breaking
  // any external imports.
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
