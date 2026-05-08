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
  buildDefaultStreamMapping, streamsToSd, findDuplicateSeries,
} from "./word_extractor_streams.js";
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
};

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
  // close on overlay click
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  return modal;
}

function openModal() {
  const m = ensureModalShell();
  m.classList.add('active');
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
    const sd = streamsToSd(selected);
    const full = await extract_and_process(_state.zipBuf.slice(0), sd, {});
    distributeToPanes(full, sd);
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
      seriesToSymbol[s.series] = s.marker ? `@${s.marker}` : `@${code}`;
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
  // 1. שומרים סימני פסקה
  s = s.replace(/\\par\b\s*/g, SENTINEL_PAR);
  s = s.replace(/\\newline\{\}/g, SENTINEL_PAR);
  // 2. מסירים פקודות עם optional bracket: \nolinebreak[3], \footnote*[1]
  s = s.replace(/\\[a-zA-Z]+\*?\s*(?:\[[^\]]*\])?/g, "");
  // 3. מסירים פקודות עם תו לא-אות: \, \. \; \: \! \" וכו'
  s = s.replace(/\\[^a-zA-Z\s]/g, "");
  // 4. מסירים סוגריים מסולסלות LaTeX (התוכן נשאר)
  s = s.replace(/[{}]/g, "");
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
