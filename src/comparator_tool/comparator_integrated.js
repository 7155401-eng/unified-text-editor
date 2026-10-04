// Comparator tool — INTEGRATED UI variant (verbatim port from
// "comparator_tool ממשק משתלב.py"). This is the simpler v11.20 version:
// no wow alerts (uses native alert()), no PR #105 transfer button,
// no visual/code-mode toggle, no expanded-tools panel, every editor
// shares the same toolbar from creation.

import {
  COMPARATOR_TR,
  COMPARATOR_DEFAULT_MARKERS,
  COMPARATOR_MARKER_COLORS
} from './comparator_i18n.js';
import {
  docx_find_streams,
  docx_extract
} from './comparator_engine.js';
import {
  buildComparatorDocxBytes,
  comparatorDocxFilename,
  downloadComparatorDocx
} from './comparator_docx_export.js';
import {
  getLangPref,
  setLangPref,
  getThemePref,
  setThemePref,
  getFontSize,
  setFontSize,
  getLastFileName
} from './comparator_storage.js';
import { renderComparatorMarkerBar } from './comparator_marker_bar.js';

const MC = COMPARATOR_MARKER_COLORS;
const dm = COMPARATOR_DEFAULT_MARKERS;

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function buildIntegratedHTML(initialLang) {
  const tr = COMPARATOR_TR[initialLang] || COMPARATOR_TR.he;
  return `
<div class="comparator-shell">
<div class="toolbar">
<div class="tb-group">
 <span class="tb-title" data-i18n="t_actions">${tr.t_actions}</span>
 <button class="btn green" data-action="addPane" data-i18n="addPane">${tr.addPane}</button>
 <button class="btn teal" data-action="splitNotes" data-i18n="split">${tr.split}</button>
 <button class="btn brown" id="mergeBtn" data-action="toggleMerge" data-i18n="merge">${tr.merge}</button>
</div>
<div class="tb-group">
 <span class="tb-title" data-i18n="t_files">${tr.t_files}</span>
 <button class="btn blue" data-action="doExport" data-i18n="export" title="⚡ מיזוג מהיר ל-DOCX עם הערות Word אמיתיות">${tr.export}</button>
 <button class="btn blue" data-action="doImport" data-i18n="import">${tr.import}</button>
</div>
<div class="tb-group">
 <span class="tb-title" data-i18n="t_view">${tr.t_view}</span>
 <button class="btn purple" id="previewBtn" data-action="togglePreview" data-i18n="preview">👁 מקדימה</button>
 <button class="btn" id="syncBtn" data-action="toggleSync" data-i18n="sync">${tr.sync}</button>
 <button class="btn" id="lineBtn" data-action="toggleLines" data-i18n="lines">${tr.lines}</button>
</div>
<div class="tb-group">
 <span class="tb-title" data-i18n="t_width">${tr.t_width}</span>
 <input type="range" id="widthSlider" min="10" max="100" value="50" style="width:70px; margin:0 5px; cursor:pointer;" data-action="changeWidth">
</div>
<div style="flex:1"></div>
<div class="tb-group">
 <span class="tb-title" data-i18n="t_theme">${tr.t_theme}</span>
 <button class="btn btn-sm" data-action="toggleTheme" title="Theme">☀️/🌙</button>
 <div class="sep"></div>
 <button class="btn btn-sm" data-action="changeFontSize" data-arg="-2">−−</button>
 <button class="btn btn-sm" data-action="changeFontSize" data-arg="-1">−</button>
 <span class="font-size" id="fsLabel">15</span>
 <button class="btn btn-sm" data-action="changeFontSize" data-arg="1">+</button>
 <button class="btn btn-sm" data-action="changeFontSize" data-arg="2">++</button>
</div>
<div class="tb-group">
 <span class="tb-title" data-i18n="t_nav">${tr.t_nav}</span>
 <button class="btn btn-sm" data-action="jumpMarker" data-arg="-1" data-i18n="prev">${tr.prev}</button>
 <button class="btn btn-sm" data-action="jumpMarker" data-arg="1" data-i18n="next">${tr.next}</button>
</div>
<button class="btn gold" data-action="toggleLang" id="langBtn" style="margin-right:8px">${initialLang === 'he' ? 'EN' : 'HE'}</button>
</div>

<div id="global-toolbar" class="ql-toolbar ql-snow">
  <span class="ql-formats">
    <select class="ql-size">
        <option value="small"></option>
        <option selected></option>
        <option value="large"></option>
        <option value="huge"></option>
    </select>
  </span>
  <span class="ql-formats">
    <button class="ql-bold"></button>
    <button class="ql-italic"></button>
    <button class="ql-underline"></button>
    <button class="ql-strike"></button>
  </span>
  <span class="ql-formats">
    <select class="ql-color"></select>
    <select class="ql-background"></select>
  </span>
  <span class="ql-formats">
    <button class="ql-script" value="sub"></button>
    <button class="ql-script" value="super"></button>
  </span>
  <span class="ql-formats">
    <button class="ql-header" value="1"></button>
    <button class="ql-header" value="2"></button>
  </span>
  <span class="ql-formats">
    <button class="ql-list" value="ordered"></button>
    <button class="ql-list" value="bullet"></button>
    <button class="ql-indent" value="-1"></button>
    <button class="ql-indent" value="+1"></button>
  </span>
  <span class="ql-formats">
    <button class="ql-direction" value="rtl"></button>
    <select class="ql-align"></select>
  </span>
  <span class="ql-formats">
    <button class="ql-clean"></button>
  </span>
</div>

<div class="panes" id="panesContainer">
<div class="pane" id="pane-1" data-id="1">
<div class="pane-header source"><span class="pane-title" data-i18n="mainText">${tr.mainText}</span></div>
<div class="marker-bar" id="markers-1"></div>
<div id="editor-1"></div>
</div>
<div class="resizer" id="resizer-first"></div>
<div class="pane" id="pane-2" data-id="2">
<div class="pane-header">
<span class="pane-title" data-i18n="notesStream" data-stream="1">${tr.notesStream} 1</span>
<div><span class="sym-label" data-i18n="linkMarker">${tr.linkMarker}</span><input class="sym-input" id="sym-2" value="@01"></div>
</div>
<div class="marker-bar" id="markers-2"></div>
<div id="editor-2"></div>
</div>
</div>

<div class="modal-overlay" id="importModal">
<div class="modal">
<h2 data-i18n="importTitle">${tr.importTitle}</h2>
<p style="color:var(--muted);margin-bottom:12px" data-i18n="importDesc">${tr.importDesc}</p>
<div id="streamList"></div>
<div class="modal-btns">
<button class="btn gold" data-action="confirmImport" data-i18n="btnLoad">${tr.btnLoad}</button>
<button class="btn" data-action="closeImportModal" data-i18n="btnCancel">${tr.btnCancel}</button>
</div>
</div>
</div>

<input type="file" id="comparator-file-input" accept=".docx" style="display:none">
</div>
`;
}

export function mountComparatorIntegratedUI(rootEl, options = {}) {
  if (!window.Quill) {
    console.error('Comparator-Integrated: Quill is not loaded');
    rootEl.innerHTML = '<div style="padding:24px;color:#fff;">שגיאה: Quill.js לא נטען</div>';
    return null;
  }

  const initialLang = options.lang || getLangPref();
  rootEl.id = 'comparator-modal-root';
  rootEl.setAttribute('dir', initialLang === 'he' ? 'rtl' : 'ltr');
  rootEl.classList.toggle('light-theme', getThemePref() === 'light');
  rootEl.innerHTML = buildIntegratedHTML(initialLang);

  const state = {
    currentLang: initialLang,
    tr: COMPARATOR_TR,
    eds: {},
    nxId: 3,
    fs: getFontSize(),
    sync: false,
    lineMode: false,
    merged: false,
    impPath: '',
    impFile: null,
    impStreams: [],
    isSyncing: false,
    quotaBlocked: !!options.quotaReadOnly,
    sessionActionPending: null,
  };

  function syncIconButtonA11y() {
    const he = state.currentLang === 'he';
    const setLabel = (selector, heLabel, enLabel) => {
      const el = rootEl.querySelector(selector);
      if (el) el.setAttribute('aria-label', he ? heLabel : enLabel);
    };

    setLabel('[data-action="toggleTheme"]', 'החלף ערכת נושא', 'Toggle theme');
    setLabel('[data-action="changeFontSize"][data-arg="-2"]', 'הקטן גודל טקסט בשתי דרגות', 'Decrease text size by two steps');
    setLabel('[data-action="changeFontSize"][data-arg="-1"]', 'הקטן גודל טקסט', 'Decrease text size');
    setLabel('[data-action="changeFontSize"][data-arg="1"]', 'הגדל גודל טקסט', 'Increase text size');
    setLabel('[data-action="changeFontSize"][data-arg="2"]', 'הגדל גודל טקסט בשתי דרגות', 'Increase text size by two steps');
    setLabel('#widthSlider', 'רוחב כללי', 'Global width');
    rootEl.querySelectorAll('input.sym-input[id^="sym-"]').forEach((el) => {
      el.setAttribute('aria-label', he ? 'סימן קישור לחלונית' : 'Pane link marker');
    });
    rootEl.querySelectorAll('[data-action="removePane"]').forEach((el) => {
      el.setAttribute('aria-label', he ? 'סגור חלונית' : 'Close pane');
    });
  }

  syncIconButtonA11y();

  function lockComparatorForQuota() {
    state.quotaBlocked = true;
    Object.values(state.eds).forEach(q => {
      try { q.enable(false); } catch (_) {}
    });
    rootEl.querySelectorAll('button, input[type="button"], input[type="submit"]').forEach(el => {
      try {
        el.disabled = true;
        el.style.opacity = '0.45';
        el.title = 'המכסה החינמית של עורך רב טקסט הסתיימה.';
      } catch (_) {}
    });
  }

  async function noteComparatorUserAction() {
    if (state.quotaBlocked) return false;
    if (typeof options.onSessionAction !== 'function') return true;
    if (state.sessionActionPending) return state.sessionActionPending;

    state.sessionActionPending = Promise.resolve(options.onSessionAction())
      .then(ok => {
        if (ok === false) lockComparatorForQuota();
        return ok !== false;
      })
      .catch(() => {
        lockComparatorForQuota();
        return false;
      })
      .finally(() => { state.sessionActionPending = null; });

    return state.sessionActionPending;
  }

  // Marker blot — register only once globally
  if (!window._comparatorMarkerBlotRegistered) {
    const Inline = window.Quill.import('blots/inline');
    class MarkerBlot extends Inline {
      static create(val) {
        const node = super.create();
        node.setAttribute('data-num', val.num);
        node.style.backgroundColor = val.color;
        node.style.color = val.textColor;
        node.classList.add('note-marker');
        return node;
      }
      static formats(node) {
        return {
          num: node.getAttribute('data-num'),
          color: node.style.backgroundColor,
          textColor: node.style.color
        };
      }
    }
    MarkerBlot.blotName = 'marker';
    MarkerBlot.tagName = 'span';
    window.Quill.register(MarkerBlot);
    window._comparatorMarkerBlotRegistered = true;
  }

  // mkEd — integrated version: every editor uses the shared toolbar
  function mkEd(id) {
    const trCur = state.tr[state.currentLang];
    const ph = id == 1 ? trCur.mainPh : trCur.notePh;
    const q = new window.Quill(rootEl.querySelector('#editor-' + id), {
      theme: 'snow',
      modules: { toolbar: rootEl.querySelector('#global-toolbar') },
      placeholder: ph
    });

    const dir = state.currentLang === 'he' ? 'rtl' : false;
    const align = state.currentLang === 'he' ? 'right' : false;
    q.format('direction', dir);
    q.format('align', align);
    state.eds[id] = q;

    const scroller = rootEl.querySelector('#pane-' + id + ' .ql-editor');
    if (scroller) {
      scroller.addEventListener('scroll', function () {
        if (!state.sync || state.isSyncing) return;
        state.isSyncing = true;
        const maxScroll = this.scrollHeight - this.clientHeight;
        const fraction = maxScroll > 0 ? this.scrollTop / maxScroll : 0;
        Object.keys(state.eds).forEach(e => {
          if (e != id) {
            const otherScroller = rootEl.querySelector('#pane-' + e + ' .ql-editor');
            if (otherScroller) {
              const otherMax = otherScroller.scrollHeight - otherScroller.clientHeight;
              otherScroller.scrollTop = fraction * otherMax;
            }
          }
        });
        window.requestAnimationFrame(() => { state.isSyncing = false; });
      });
    }

    q.on('text-change', function (delta, oldDelta, source) {
      if (source === 'user') noteComparatorUserAction();
      clearTimeout(q._hlTimer);
      q._hlTimer = setTimeout(function () { highlightMarkers(id); }, 200);
    });
    return q;
  }

  function getSym(id) {
    const e = rootEl.querySelector('#sym-' + id);
    return e ? e.value.trim() : '';
  }

  function getSymbols() {
    const syms = [];
    Object.keys(state.eds).forEach(id => {
      if (id != '1') {
        const s = getSym(id);
        if (s) syms.push({ sym: s, id: id });
      }
    });
    return syms;
  }

  function highlightMarkers(edId) {
    const q = state.eds[edId];
    if (!q) return;
    const text = q.getText();
    const syms = getSymbols();
    if (!syms.length) return;
    const len = q.getLength();
    q.formatText(0, len, 'marker', false, 'silent');
    const counts = {};
    syms.forEach((s, ci) => {
      const c = MC[ci % MC.length];
      counts[s.sym] = 0;
      let idx = text.indexOf(s.sym);
      while (idx !== -1) {
        counts[s.sym]++;
        q.formatText(idx, s.sym.length, 'marker', { num: counts[s.sym], color: c.bg, textColor: c.fg }, 'silent');
        idx = text.indexOf(s.sym, idx + s.sym.length);
      }
    });
    updateBar(edId, syms, counts);
  }

  function updateBar(edId, syms, counts) {
    const bar = rootEl.querySelector('#markers-' + edId);
    renderComparatorMarkerBar(bar, edId, syms, counts);
  }

  function jumpToNth(edId, sym, nth) {
    const q = state.eds[edId];
    if (!q) return;
    const text = q.getText();
    let count = 0, idx = text.indexOf(sym);
    while (idx !== -1) {
      count++;
      if (count === nth) {
        q.setSelection(idx, sym.length);
        const ed = rootEl.querySelector('#pane-' + edId + ' .ql-editor');
        if (ed) {
          const span = ed.querySelector('.ql-cursor') || ed.querySelector('.note-marker');
          if (span) span.scrollIntoView({ block: 'center' });
        }
        q.focus();
        break;
      }
      idx = text.indexOf(sym, idx + sym.length);
    }
  }

  function highlightAll() {
    Object.keys(state.eds).forEach(id => highlightMarkers(id));
  }

  // Resizers (verbatim)
  function initResizer(resizer) {
    let startX, startWidthPrev, startWidthNext;
    let prevPane, nextPane;
    resizer.addEventListener('mousedown', function (e) {
      e.preventDefault();
      prevPane = resizer.previousElementSibling;
      nextPane = resizer.nextElementSibling;
      if (!prevPane || !nextPane) return;
      startX = e.clientX;
      startWidthPrev = prevPane.getBoundingClientRect().width;
      startWidthNext = nextPane.getBoundingClientRect().width;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
    });
    function resize(e) {
      const dx = e.clientX - startX;
      const prevRect = prevPane.getBoundingClientRect();
      const nextRect = nextPane.getBoundingClientRect();
      let newPrevWidth, newNextWidth;
      if (prevRect.left < nextRect.left) {
        newPrevWidth = startWidthPrev + dx;
        newNextWidth = startWidthNext - dx;
      } else {
        newPrevWidth = startWidthPrev - dx;
        newNextWidth = startWidthNext + dx;
      }
      const parentWidth = resizer.parentElement.clientWidth;
      const prevPct = (newPrevWidth / parentWidth) * 100;
      const nextPct = (newNextWidth / parentWidth) * 100;
      if (prevPct > 5 && nextPct > 5) {
        prevPane.style.flex = `0 0 ${prevPct}%`;
        nextPane.style.flex = `0 0 ${nextPct}%`;
      }
    }
    function stopResize() {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
    }
  }
  rootEl.querySelectorAll('.resizer').forEach(initResizer);

  function addPane() {
    const id = state.nxId++;
    const sn = id - 1;
    const sym = '@' + String(sn).padStart(2, '0');
    const trCur = state.tr[state.currentLang];
    const titleText = trCur.notesStream + ' ' + sn;
    const markerText = trCur.linkMarker;

    rootEl.querySelector('#panesContainer').insertAdjacentHTML('beforeend',
      `<div class="resizer"></div>
   <div class="pane" id="pane-${id}" data-id="${id}">
     <div class="pane-header">
         <span class="pane-title" data-i18n="notesStream" data-stream="${sn}">${titleText}</span>
         <div><span class="sym-label" data-i18n="linkMarker">${markerText}</span><input class="sym-input" id="sym-${id}" value="${sym}"><button class="btn btn-sm" data-action="removePane" data-arg="${id}" style="margin:0 4px">✕</button></div>
     </div>
     <div class="marker-bar" id="markers-${id}"></div><div id="editor-${id}"></div>
  </div>`);
    syncIconButtonA11y();
    const newResizer = rootEl.querySelector('#pane-' + id).previousElementSibling;
    if (newResizer) initResizer(newResizer);
    mkEd(id);
    if (state.lineMode) {
      const p = rootEl.querySelector('#pane-' + id + ' .ql-editor');
      if (p) p.classList.add('no-wrap');
    }
    highlightAll();
  }

  function removePane(id) {
    if (id <= 2) return;
    const el = rootEl.querySelector('#pane-' + id);
    if (el) {
      const resizer = el.previousElementSibling;
      if (resizer && resizer.classList.contains('resizer')) resizer.remove();
      el.remove();
    }
    delete state.eds[id];
    highlightAll();
  }

  function toggleSync() {
    state.sync = !state.sync;
    rootEl.querySelector('#syncBtn').classList.toggle('active', state.sync);
  }

  function toggleLines() {
    state.lineMode = !state.lineMode;
    rootEl.querySelector('#lineBtn').classList.toggle('active', state.lineMode);
    const syms = getSymbols();
    Object.keys(state.eds).forEach(id => {
      const q = state.eds[id];
      let text = q.getText();
      if (syms.length > 0) {
        if (state.lineMode) {
          let markersToBreak = [];
          syms.forEach(s => {
            let idx = text.indexOf(s.sym);
            while (idx !== -1) {
              if (idx > 0 && text[idx - 1] !== '\n') markersToBreak.push(idx);
              idx = text.indexOf(s.sym, idx + s.sym.length);
            }
          });
          markersToBreak.sort((a, b) => b - a);
          markersToBreak.forEach(idx => {
            if (text[idx - 1] === ' ') {
              q.deleteText(idx - 1, 1, 'silent');
              q.insertText(idx - 1, '\n', 'silent');
            } else {
              q.insertText(idx, '\n', 'silent');
            }
          });
        } else {
          let markersToFix = [];
          syms.forEach(s => {
            let idx = text.indexOf('\n' + s.sym);
            while (idx !== -1) {
              markersToFix.push(idx);
              idx = text.indexOf('\n' + s.sym, idx + s.sym.length + 1);
            }
          });
          markersToFix.sort((a, b) => b - a);
          markersToFix.forEach(idx => {
            q.deleteText(idx, 1, 'silent');
            q.insertText(idx, ' ', 'silent');
          });
        }
      }
    });
    rootEl.querySelectorAll('.ql-editor').forEach(e => {
      if (state.lineMode) e.classList.add('no-wrap');
      else e.classList.remove('no-wrap');
    });
    highlightAll();
  }

  function changeWidth(val) {
    rootEl.querySelectorAll('.pane').forEach(p => p.style.flexBasis = val + '%');
  }

  function changeFontSize(d) {
    state.fs = Math.max(10, Math.min(40, state.fs + d));
    setFontSize(state.fs);
    rootEl.querySelector('#fsLabel').textContent = state.fs;
    rootEl.querySelectorAll('.ql-editor').forEach(e => e.style.fontSize = state.fs + 'px');
  }

  function toggleTheme() {
    rootEl.classList.toggle('light-theme');
    setThemePref(rootEl.classList.contains('light-theme') ? 'light' : 'dark');
  }

  // Integrated togglePreview (no visual mode — verbatim from integrated PY)
  function togglePreview() {
    const p = rootEl.querySelector('#previewBtn').classList.toggle('active');
    rootEl.querySelector('#global-toolbar').style.display = p ? 'none' : '';
    rootEl.querySelectorAll('.ql-editor').forEach(e => {
      e.style.fontFamily = p ? '"David",serif' : '"David","Segoe UI",serif';
      e.style.fontSize = p ? (state.fs + 4) + 'px' : state.fs + 'px';
      e.style.background = p ? '#0D1117' : 'var(--ed-bg)';
      e.contentEditable = !p;
    });
    if (p && rootEl.classList.contains('light-theme')) {
      rootEl.querySelectorAll('.ql-editor').forEach(e => e.style.background = '#F9FAFB');
    }
  }

  function toggleLang() {
    state.currentLang = state.currentLang === 'he' ? 'en' : 'he';
    setLangPref(state.currentLang);
    rootEl.setAttribute('dir', state.currentLang === 'he' ? 'rtl' : 'ltr');
    rootEl.querySelector('#langBtn').textContent = state.currentLang === 'he' ? 'EN' : 'HE';
    const trCur = state.tr[state.currentLang];
    rootEl.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (trCur[key]) {
        if (key === 'notesStream') {
          const sn = el.getAttribute('data-stream');
          if (sn) el.textContent = trCur[key] + ' ' + sn;
          else el.textContent = trCur[key];
        } else {
          el.textContent = trCur[key];
        }
      }
    });
    syncIconButtonA11y();

    const mBtn = rootEl.querySelector('#mergeBtn');
    if (state.merged && mBtn) mBtn.textContent = trCur.unmerge;
    Object.keys(state.eds).forEach(id => {
      const q = state.eds[id];
      const dir = state.currentLang === 'he' ? 'rtl' : false;
      const align = state.currentLang === 'he' ? 'right' : false;
      q.root.dataset.placeholder = id == 1 ? trCur.mainPh : trCur.notePh;
      const len = q.getLength();
      q.formatLine(0, len, 'align', align);
      q.formatLine(0, len, 'direction', dir);
    });
  }

  function toggleMerge() {
    const btn = rootEl.querySelector('#mergeBtn');
    const mainEd = state.eds[1];
    if (!mainEd) return;
    const trCur = state.tr[state.currentLang];

    if (state.merged) {
      let mainText = mainEd.getText();
      Object.keys(state.eds).forEach(id => {
        if (id == 1) return;
        const sym = getSym(id);
        if (!sym) return;
        const extracted = [];
        const safeSym = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\[\\[${safeSym}([\\s\\S]*?)\\]\\]`, 'g');
        mainText = mainText.replace(regex, (match, content) => {
          extracted.push(content.trim());
          return sym;
        });
        if (extracted.length > 0) {
          state.eds[id].setText(extracted.map(n => `${sym} ${n}`).join('\n'));
        }
      });
      mainEd.setText(mainText);
      state.merged = false;
      rootEl.querySelectorAll('.pane').forEach(p => p.style.display = '');
      rootEl.querySelectorAll('.resizer').forEach(p => p.style.display = '');
      btn.textContent = trCur.merge;
      btn.classList.remove('active');
    } else {
      let mainText = mainEd.getText();
      Object.keys(state.eds).forEach(id => {
        if (id == 1) return;
        const sym = getSym(id);
        if (!sym) return;
        const noteText = state.eds[id].getText().trim();
        if (!noteText) return;
        let parts = noteText.split(sym);
        if (parts.length > 0 && parts[0].trim() === '') parts.shift();
        let counter = 0;
        const safeSym = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(safeSym, 'g');
        mainText = mainText.replace(regex, (match) => {
          if (counter < parts.length) {
            const note = parts[counter].trim();
            counter++;
            return `[[${sym} ${note}]]`;
          }
          return match;
        });
      });
      mainEd.setText(mainText);
      state.merged = true;
      rootEl.querySelectorAll('.pane').forEach(p => {
        if (p.id !== 'pane-1') p.style.display = 'none';
      });
      rootEl.querySelectorAll('.resizer').forEach(p => p.style.display = 'none');
      btn.textContent = trCur.unmerge;
      btn.classList.add('active');
    }
    highlightAll();
  }

  function doImport() {
    const fileInput = rootEl.querySelector('#comparator-file-input');
    fileInput.value = '';
    fileInput.onchange = async function () {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      state.impFile = file;
      state.impPath = file.name;
      try {
        state.impStreams = await docx_find_streams(file);
      } catch (e) {
        alert('שגיאה בטעינה: ' + e);
        return;
      }
      if (!state.impStreams.length) {
        alert('לא נמצאו הערות.');
        return;
      }
      const l = rootEl.querySelector('#streamList');
      l.innerHTML = '';
      state.impStreams.forEach((s, i) => {
        const sym = dm[i % dm.length];
        l.innerHTML += '<div class="stream-row"><input type="checkbox" checked id="chk-' + i + '"><label for="chk-' + i + '">' + escapeHtml(s.label) + ' (' + escapeHtml(s.count) + ')</label><input type="text" id="si-' + i + '" value="' + escapeHtml(sym) + '"></div>';
      });
      rootEl.querySelector('#importModal').classList.add('active');
    };
    fileInput.click();
  }

  async function confirmImport() {
    const sel = [];
    state.impStreams.forEach((s, i) => {
      if (rootEl.querySelector('#chk-' + i).checked) {
        sel.push({ stream: s, symbol: rootEl.querySelector('#si-' + i).value.trim() });
      }
    });
    if (!sel.length) {
      alert('סמנו לפחות זרם אחד.');
      return;
    }
    closeImportModal();
    const formatted = sel.map(s => [s.stream, s.symbol]);
    let d;
    try {
      d = await docx_extract(state.impFile, formatted);
    } catch (e) {
      alert('שגיאה בחילוץ: ' + e);
      return;
    }
    state.eds[1].setText(d.main);
    state.eds[1].formatLine(0, state.eds[1].getLength(), 'direction', state.currentLang === 'he' ? 'rtl' : false);
    state.eds[1].formatLine(0, state.eds[1].getLength(), 'align', state.currentLang === 'he' ? 'right' : false);
    d.streams.forEach((entry, i) => {
      const sym = entry[0], text = entry[1];
      const pid = i + 2;
      if (!state.eds[pid]) addPane();
      state.eds[pid].setText(text);
      state.eds[pid].formatLine(0, state.eds[pid].getLength(), 'direction', state.currentLang === 'he' ? 'rtl' : false);
      state.eds[pid].formatLine(0, state.eds[pid].getLength(), 'align', state.currentLang === 'he' ? 'right' : false);
      const si = rootEl.querySelector('#sym-' + pid);
      if (si) si.value = sym;
    });
    setTimeout(highlightAll, 300);
  }

  function closeImportModal() {
    rootEl.querySelector('#importModal').classList.remove('active');
  }

  function getRichHtml(quillInst) {
    const delta = quillInst.getContents();
    let html = '';
    delta.ops.forEach(op => {
      if (typeof op.insert === 'string') {
        let text = op.insert.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        if (op.attributes) {
          if (op.attributes.bold) text = `<b>${text}</b>`;
          if (op.attributes.italic) text = `<i>${text}</i>`;
          if (op.attributes.underline) text = `<u>${text}</u>`;
        }
        html += text.replace(/\n/g, '<br>');
      }
    });
    return html;
  }

  async function doExport() {
    try {
      if (state.merged) {
        throw Object.assign(
          new Error("לפני הייצוא יש ללחוץ „פרק חזרה לחלוניות”. ייצוא DOCX נעשה מהמצב המפוצל כדי למנוע שכפול של טקסט ההערות."),
          { code: "EXPORT_REQUIRES_SPLIT_VIEW" }
        );
      }
      const streams = Object.keys(state.eds)
        .filter(id => id != 1)
        .map(id => ({
          marker: getSym(id),
          delta: state.eds[id].getContents(),
        }))
        .filter(s => s.marker);

      const built = buildComparatorDocxBytes({
        mainDelta: state.eds[1].getContents(),
        streams,
        title: (getLastFileName() || "רב טקסט").replace(/\.[^.]+$/u, ""),
      });
      const filename = comparatorDocxFilename(getLastFileName());
      downloadComparatorDocx(built.bytes, filename);

      const summary = built.report.streams
        .map(s => `${s.marker}: ${s.notes}`)
        .join(" | ");

      alert(
        `${state.tr[state.currentLang].alertSaved}${filename}\n\n` +
        `מיזוג מהיר: ${built.report.footnotes} הערות Word אמיתיות.\n${summary}`
      );
    } catch (error) {
      alert(`הייצוא נעצר:\n\n${error?.message || error}`);
    }
  }

  function jumpMarker(dir) {
    const q = state.eds[1];
    if (!q) return;
    const text = q.getText();
    const syms = getSymbols();
    if (!syms.length) return;
    let markers = [];
    syms.forEach(s => {
      let idx = text.indexOf(s.sym);
      while (idx !== -1) {
        markers.push({ index: idx, length: s.sym.length });
        idx = text.indexOf(s.sym, idx + s.sym.length);
      }
    });
    if (markers.length === 0) return;
    markers.sort((a, b) => a.index - b.index);
    const cursorPos = q.getSelection() ? q.getSelection().index : 0;
    let targetIndex = -1;
    if (dir === 1) {
      targetIndex = markers.findIndex(m => m.index > cursorPos);
      if (targetIndex === -1) targetIndex = 0;
    } else {
      for (let i = markers.length - 1; i >= 0; i--) {
        if (markers[i].index < cursorPos) { targetIndex = i; break; }
      }
      if (targetIndex === -1) targetIndex = markers.length - 1;
    }
    const target = markers[targetIndex];
    q.setSelection(target.index, target.length);
    const edNode = rootEl.querySelector('#pane-1 .ql-editor');
    if (edNode) {
      const span = edNode.querySelector('.ql-cursor') || edNode.querySelector('.note-marker');
      if (span) span.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    q.focus();
  }

  function splitNotes() {
    const trCur = state.tr[state.currentLang];
    if (!state.eds[1] || !state.eds[2]) {
      alert(trCur.alertSplit);
      return;
    }
    const filterSymbol = window.prompt(trCur.promptFilter, '*');
    if (!filterSymbol) return;
    const newLinkSymbol = window.prompt(trCur.promptNewSym, '$');
    if (!newLinkSymbol) return;
    const linkSymbolInput = rootEl.querySelector('#sym-2');
    const linkSymbol = linkSymbolInput ? linkSymbolInput.value.trim() : '';
    if (!linkSymbol) { alert(trCur.alertNoSym); return; }
    const mainText = state.eds[1].getText();
    const notesText = state.eds[2].getText();
    const mainParts = mainText.split(linkSymbol);
    const noteIndices = [];
    let ci = notesText.indexOf(linkSymbol);
    while (ci > -1) { noteIndices.push(ci); ci = notesText.indexOf(linkSymbol, ci + 1); }
    let newMainText = mainParts[0];
    const normalNotes = [];
    const specialNotes = [];
    if (noteIndices.length > 0 && noteIndices[0] > 0) normalNotes.push(notesText.substring(0, noteIndices[0]));
    else if (noteIndices.length === 0) normalNotes.push(notesText);
    for (let i = 0; i < noteIndices.length; i++) {
      const start = noteIndices[i];
      const end = (i + 1 < noteIndices.length) ? noteIndices[i + 1] : notesText.length;
      const content = notesText.substring(start, end);
      const nextPart = mainParts[i + 1] || '';
      if (content.includes(filterSymbol)) {
        specialNotes.push(content);
        newMainText += newLinkSymbol + nextPart;
      } else {
        normalNotes.push(content);
        newMainText += linkSymbol + nextPart;
      }
    }
    state.eds[1].setText(newMainText);
    state.eds[2].setText(normalNotes.join(''));
    if (specialNotes.length > 0) {
      addPane();
      const newPaneId = state.nxId - 1;
      setTimeout(() => {
        state.eds[newPaneId].setText(specialNotes.join(''));
        const symInput = rootEl.querySelector('#sym-' + newPaneId);
        if (symInput) symInput.value = newLinkSymbol;
        highlightAll();
      }, 100);
    } else {
      alert(trCur.alertNoMatch + filterSymbol);
    }
    highlightAll();
  }

  // Action dispatcher
  const actions = {
    addPane,
    splitNotes,
    toggleMerge,
    doExport,
    doImport,
    togglePreview,
    toggleSync,
    toggleLines,
    toggleTheme,
    changeFontSize: (arg) => changeFontSize(parseInt(arg, 10)),
    jumpMarker: (arg) => jumpMarker(parseInt(arg, 10)),
    toggleLang,
    confirmImport,
    closeImportModal,
    removePane: (arg) => removePane(parseInt(arg, 10)),
    jumpToNth: (arg, ev) => {
      const t = ev.target;
      jumpToNth(parseInt(t.dataset.edid, 10), t.dataset.sym, parseInt(t.dataset.nth, 10));
    }
  };

  rootEl.addEventListener('click', async (ev) => {
    const trg = ev.target.closest('[data-action]');
    if (!trg) return;
    const allowed = await noteComparatorUserAction();
    if (!allowed) return;
    const name = trg.getAttribute('data-action');
    const arg = trg.getAttribute('data-arg');
    const fn = actions[name];
    if (typeof fn === 'function') fn(arg, ev);
  });

  rootEl.addEventListener('input', (ev) => {
    if (ev.target && ev.target.classList && ev.target.classList.contains('sym-input')) {
      highlightAll();
    } else if (ev.target && ev.target.id === 'widthSlider') {
      changeWidth(ev.target.value);
    }
  });

  // init
  rootEl.querySelector('#fsLabel').textContent = state.fs;
  mkEd(1);
  mkEd(2);
  rootEl.querySelectorAll('.ql-editor').forEach(e => e.style.fontSize = state.fs + 'px');
  setTimeout(highlightAll, 500);
  if (state.quotaBlocked) setTimeout(lockComparatorForQuota, 0);

  return {
    state,
    addPane, removePane, doImport, doExport,
    setMainText: (text) => { if (state.eds[1]) state.eds[1].setText(text || ''); },
    setStreamText: (paneId, text) => {
      if (!state.eds[paneId]) {
        while (state.nxId <= paneId) addPane();
      }
      if (state.eds[paneId]) state.eds[paneId].setText(text || '');
    }
  };
}
