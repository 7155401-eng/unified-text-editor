// Comparator tool — full UI port (verbatim) from comparator_tool.py.
// All logic inside the embedded <script> of HTML in Python is reproduced here
// and bound to a per-instance namespace so it can run inside the project's
// modal without colliding with the host editor.

import {
  COMPARATOR_TR,
  COMPARATOR_TOOLTIPS,
  COMPARATOR_EXPANDED_TOOLS,
  COMPARATOR_QUICK_TAGS,
  COMPARATOR_DEFAULT_MARKERS,
  COMPARATOR_MARKER_COLORS
} from './comparator_i18n.js';
import {
  docx_find_streams,
  docx_extract,
  buildWordExportHtml,
  downloadDocFile
} from './comparator_engine.js';
import {
  getLangPref,
  setLangPref,
  toggleLangPref,
  getThemePref,
  setThemePref,
  getFontSize,
  setFontSize,
  getTransferSettings,
  setTransferSettings,
  getLastFileName,
  setLastFileName,
  suggestSaveFilename
} from './comparator_storage.js';

const MC = COMPARATOR_MARKER_COLORS;
const dm = COMPARATOR_DEFAULT_MARKERS;

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


// HTML body of the comparator (same structure as <body> of HTML in Python).
function buildComparatorHTML(initialLang) {
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
 <button class="btn blue" data-action="doExport" data-i18n="export">${tr.export}</button>
 <button class="btn blue" data-action="doImport" data-i18n="import">${tr.import}</button>
</div>
<div class="tb-group">
 <span class="tb-title" data-i18n="t_view">${tr.t_view}</span>
 <button class="btn purple" id="previewBtn" data-action="togglePreview" data-i18n="preview">${tr.preview}</button>
 <button class="btn gold" id="expandToolsBtn" data-action="toggleExpandTools" title="הרחב כלים">⚙️ כלים</button>
 <button class="btn gold" data-action="showTransferSettings" title="הגדרות העתקה">⚙️ העתקה</button>
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

<div class="modal-overlay" id="transferModal">
<div class="modal">
<h2 data-i18n="transferTitle">${tr.transferTitle}</h2>
<p style="color:var(--muted);margin-bottom:12px" data-i18n="transferDesc">${tr.transferDesc}</p>
<div style="display:flex; flex-direction:column; gap:10px; text-align:right;">
  <div>
    <label>זרם יעד:</label>
    <select id="transferStreamSelect" class="sym-input" style="width:100%; padding:5px; margin-top:5px;">
      <option value="2">זרם 1</option>
      <option value="3">זרם 2</option>
      <option value="4">זרם 3</option>
    </select>
  </div>
  <div>
    <label>תוספת לפני הטקסט (לדוגמה $$):</label>
    <input type="text" id="transferPrefix" class="sym-input" style="width:100%; padding:5px; margin-top:5px;">
  </div>
  <div>
    <label>תוספת אחרי הטקסט (לדוגמה ##):</label>
    <input type="text" id="transferSuffix" class="sym-input" style="width:100%; padding:5px; margin-top:5px;">
  </div>
</div>
<div class="modal-btns" style="margin-top:20px;">
<button class="btn gold" data-action="saveTransferSettings" data-i18n="btnSave">${tr.btnSave}</button>
<button class="btn" data-action="closeTransferModal" data-i18n="btnCancel">${tr.btnCancel}</button>
</div>
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

<div class="wow-overlay" id="wowAlert">
 <div class="wow-card" id="wowCard">
  <div class="wow-icon" id="wowIcon">ℹ</div>
  <div class="wow-title" id="wowTitle"></div>
  <div class="wow-msg" id="wowMsg"></div>
  <button class="wow-btn" data-action="closeWowAlert" data-i18n="btnOk">${tr.btnOk}</button>
 </div>
</div>

<input type="file" id="comparator-file-input" accept=".docx" style="display:none">
</div>
`;
}

// Bootstrap that injects the standalone comparator into a host element.
// Mirrors the embedded JS of HTML in comparator_tool.py.
export function mountComparatorUI(rootEl, options = {}) {
  if (!window.Quill) {
    console.error('Comparator: Quill is not loaded');
    rootEl.innerHTML = '<div style="padding:24px;color:#fff;">שגיאה: Quill.js לא נטען</div>';
    return null;
  }

  const initialLang = options.lang || getLangPref();
  rootEl.id = 'comparator-modal-root';
  rootEl.setAttribute('dir', initialLang === 'he' ? 'rtl' : 'ltr');
  rootEl.classList.toggle('light-theme', getThemePref() === 'light');
  rootEl.innerHTML = buildComparatorHTML(initialLang);

  // ────────────────────────────────────────────────────────────────────
  // State (verbatim from Python embedded JS)
  // ────────────────────────────────────────────────────────────────────
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
    impFile: null,            // browser-only: actual File handle
    impStreams: [],
    isSyncing: false,
    isVisualMode: false,
    isToolsExpanded: false,
    lastCursorPositions: {},
    activeQuillEditor: null,
    mainToolbarModule: null,
    pendingCloseAfterSave: false
  };
  // load saved transfer settings
  const savedTransfer = getTransferSettings();
  state.transferTargetStream = savedTransfer.targetStream;
  state.transferPrefix = savedTransfer.prefix;
  state.transferSuffix = savedTransfer.suffix;

  // Helper: query inside the root only
  const $ = (sel) => rootEl.querySelector(sel);
  const $$ = (sel) => Array.from(rootEl.querySelectorAll(sel));

  // ────────────────────────────────────────────────────────────────────
  // Marker blot — registered globally on Quill once
  // ────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────
  // mkEd — create a Quill instance for a pane (verbatim port)
  // ────────────────────────────────────────────────────────────────────
  function mkEd(id) {
    const trCur = state.tr[state.currentLang];
    const ph = id == 1 ? trCur.mainPh : trCur.notePh;

    // PR #108 — only the main editor gets the toolbar at startup; others get
    // toolbar:false and gain it via selection-change forwarding.
    const q = new window.Quill(rootEl.querySelector('#editor-' + id), {
      theme: 'snow',
      modules: id == 1 ? { toolbar: rootEl.querySelector('#global-toolbar') } : { toolbar: false },
      placeholder: ph
    });

    if (id == 1) {
      state.mainToolbarModule = q.getModule('toolbar');
      state.activeQuillEditor = q;
    }

    console.log(`[DEBUG] Created editor ${id} (toolbar=${id == 1 ? 'global' : 'none-on-init'})`);

    const dir = state.currentLang === 'he' ? 'rtl' : false;
    const align = state.currentLang === 'he' ? 'right' : false;
    q.format('direction', dir);
    q.format('align', align);

    state.eds[id] = q;
    initCursorTracking(id, q);

    // scroll sync
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
      // (quota check removed — browser context uses different gating)
      clearTimeout(q._hlTimer);
      q._hlTimer = setTimeout(function () { highlightMarkers(id); }, 200);
    });

    q.on('selection-change', function (range) {
      if (range) {
        state.activeQuillEditor = q;
        if (state.mainToolbarModule) {
          state.mainToolbarModule.quill = q;
          try { state.mainToolbarModule.update(range); } catch (_) {}
        }
      }
    });

    if (id === 1) {
      q.on('selection-change', function (range) {
        if (range) {
          if (range.length > 0) {
            handleMainSelection();
          } else {
            const existingBtn = rootEl.querySelector('#quick-transfer-btn');
            if (existingBtn) existingBtn.remove();
          }
        }
      });
    }

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
    if (!bar) return;
    bar.innerHTML = '';
    syms.forEach((s, ci) => {
      const n = counts[s.sym] || 0;
      if (n === 0) return;
      let html = '<span class="mc mc-' + ci + '"><span class="sym-label-bar">' + s.sym + '</span>';
      for (let i = 1; i <= n; i++) {
        const safeSym = s.sym.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        html += '<span class="badge" data-action="jumpToNth" data-edid="' + edId + '" data-sym="' + safeSym + '" data-nth="' + i + '" title="' + i + '">' + i + '</span>';
      }
      html += '</span>';
      bar.innerHTML += html;
    });
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

  // ────────────────────────────────────────────────────────────────────
  // Resizers (verbatim)
  // ────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────
  // addPane / removePane (verbatim)
  // ────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────
  // Toolbar actions (verbatim)
  // ────────────────────────────────────────────────────────────────────
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
              if (idx > 0 && text[idx - 1] !== '\n') {
                markersToBreak.push(idx);
              }
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
    rootEl.querySelectorAll('.pane').forEach(p => {
      p.style.flexBasis = val + '%';
    });
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

  // togglePreview — overridden below by the visual-mode version (verbatim port)
  function togglePreviewBasic() {
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

  // ────────────────────────────────────────────────────────────────────
  // Import flow (verbatim — but using browser <input type=file>)
  // ────────────────────────────────────────────────────────────────────
  function doImport() {
    const fileInput = rootEl.querySelector('#comparator-file-input');
    fileInput.value = '';
    fileInput.onchange = async function () {
      if (!fileInput.files || !fileInput.files[0]) return;
      const file = fileInput.files[0];
      state.impFile = file;
      state.impPath = file.name;
      setLastFileName(file.name);
      try {
        state.impStreams = await docx_find_streams(file);
      } catch (e) {
        await showWowAlert('שגיאה בטעינה', String(e), 'err');
        return;
      }
      // v11.39 — if no notes, still load the main text for editing/comparison
      if (!state.impStreams.length) {
        await showWowAlert(
          state.tr[state.currentLang].wowT_noNotes,
          state.tr[state.currentLang].wowM_noNotes,
          'info'
        );
        try {
          const d2 = await docx_extract(file, []);
          loadWordContent(state.eds[1], d2.main);
          state.eds[1].formatLine(0, state.eds[1].getLength(), 'direction', state.currentLang === 'he' ? 'rtl' : false);
          state.eds[1].formatLine(0, state.eds[1].getLength(), 'align', state.currentLang === 'he' ? 'right' : false);
        } catch (e) {
          await showWowAlert('שגיאה בטעינה', String(e), 'err');
        }
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
      await showWowAlert(
        state.tr[state.currentLang].wowT_noSelection,
        state.tr[state.currentLang].wowM_noSelection,
        'warn'
      );
      return;
    }
    closeImportModal();
    const formatted = sel.map(s => [s.stream, s.symbol]);
    let d;
    try {
      d = await docx_extract(state.impFile, formatted);
    } catch (e) {
      await showWowAlert('שגיאה בחילוץ', String(e), 'err');
      return;
    }
    loadWordContent(state.eds[1], d.main);
    state.eds[1].formatLine(0, state.eds[1].getLength(), 'direction', state.currentLang === 'he' ? 'rtl' : false);
    state.eds[1].formatLine(0, state.eds[1].getLength(), 'align', state.currentLang === 'he' ? 'right' : false);
    d.streams.forEach((entry, i) => {
      const sym = entry[0], text = entry[1];
      const pid = i + 2;
      if (!state.eds[pid]) addPane();
      loadWordContent(state.eds[pid], text);
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

  // ────────────────────────────────────────────────────────────────────
  // Cursor tracking + transfer (PR #105 — verbatim)
  // ────────────────────────────────────────────────────────────────────
  function initCursorTracking(id, q) {
    q.on('selection-change', function (range) {
      if (range) state.lastCursorPositions[id] = range.index;
    });
  }

  function showTransferSettings() {
    rootEl.querySelector('#transferStreamSelect').value = state.transferTargetStream;
    rootEl.querySelector('#transferPrefix').value = state.transferPrefix;
    rootEl.querySelector('#transferSuffix').value = state.transferSuffix;
    rootEl.querySelector('#transferModal').classList.add('active');
  }

  function closeTransferModal() {
    rootEl.querySelector('#transferModal').classList.remove('active');
  }

  function saveTransferSettings() {
    state.transferTargetStream = parseInt(rootEl.querySelector('#transferStreamSelect').value, 10);
    state.transferPrefix = rootEl.querySelector('#transferPrefix').value;
    state.transferSuffix = rootEl.querySelector('#transferSuffix').value;
    setTransferSettings({
      targetStream: state.transferTargetStream,
      prefix: state.transferPrefix,
      suffix: state.transferSuffix
    });
    closeTransferModal();
    updateTransferButtonText();
  }

  function updateTransferButtonText() {
    const btn = rootEl.querySelector('#quick-transfer-btn');
    if (btn) btn.textContent = `העתק לזרם ${state.transferTargetStream - 1}`;
  }

  function handleMainSelection() {
    const q = state.eds[1];
    if (!q) return;
    const existingBtn = rootEl.querySelector('#quick-transfer-btn');
    if (existingBtn) existingBtn.remove();
    const range = q.getSelection();
    if (!range || range.length === 0) return;
    const bounds = q.getBounds(range.index, range.length);
    if (!bounds) return;
    const btn = document.createElement('button');
    btn.id = 'quick-transfer-btn';
    btn.textContent = `העתק לזרם ${state.transferTargetStream - 1}`;
    const editorContainer = rootEl.querySelector('#pane-1 .ql-editor');
    const containerRect = editorContainer.getBoundingClientRect();
    const rootRect = rootEl.getBoundingClientRect();
    btn.style.left = (containerRect.left - rootRect.left + bounds.left) + 'px';
    btn.style.top = (containerRect.top - rootRect.top + bounds.bottom + 10) + 'px';
    btn.onmousedown = function (e) { e.preventDefault(); };
    btn.onclick = function () { copySelectedText(); btn.remove(); };
    rootEl.appendChild(btn);
    clearTimeout(window._comparator_transferBtnTimer);
    window._comparator_transferBtnTimer = setTimeout(() => {
      if (btn.parentNode) btn.remove();
    }, 4000);
  }

  function copySelectedText() {
    const qMain = state.eds[1];
    if (!qMain) return;
    const range = qMain.getSelection();
    if (!range || range.length === 0) return;
    const text = qMain.getText(range.index, range.length);
    const targetId = state.transferTargetStream;
    let qTarget = state.eds[targetId];
    if (!qTarget) {
      while (state.nxId <= targetId) {
        try { addPane(); } catch (e) { break; }
      }
      qTarget = state.eds[targetId];
      if (!qTarget) return;
    }
    const fullText = state.transferPrefix + text + state.transferSuffix;
    const insertPos = state.lastCursorPositions[targetId] || qTarget.getLength();
    qTarget.insertText(insertPos, fullText, 'user');
    qTarget.setSelection(insertPos + fullText.length, 0, 'user');
    qTarget.focus();
  }

  // ────────────────────────────────────────────────────────────────────
  // Wow alert (verbatim)
  // ────────────────────────────────────────────────────────────────────
  function showWowAlert(title, message, type) {
    const ov = rootEl.querySelector('#wowAlert');
    const card = rootEl.querySelector('#wowCard');
    const icon = rootEl.querySelector('#wowIcon');
    const t = rootEl.querySelector('#wowTitle');
    const m = rootEl.querySelector('#wowMsg');
    const typeMap = {
      'info': { cls: 'wow-info', ic: 'ℹ' },
      'warn': { cls: 'wow-warn', ic: '⚠' },
      'err': { cls: 'wow-err', ic: '✖' },
      'ok': { cls: 'wow-ok', ic: '✔' }
    };
    const cfg = typeMap[type] || typeMap['info'];
    card.className = 'wow-card ' + cfg.cls;
    icon.textContent = cfg.ic;
    t.textContent = title || '';
    m.textContent = message || '';
    ov.classList.add('active');
    return new Promise(res => { state._wowResolve = res; });
  }
  function closeWowAlert() {
    const ov = rootEl.querySelector('#wowAlert');
    ov.classList.remove('active');
    if (state._wowResolve) {
      state._wowResolve(true);
      state._wowResolve = null;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Rich HTML helpers (verbatim)
  // ────────────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────────────
  // Export to Word (verbatim — direct download in browser)
  // ────────────────────────────────────────────────────────────────────
  async function doExport() {
    let mainRich = getRichHtml(state.eds[1]);
    let raw_lines = mainRich.split('<br>');
    let mc = raw_lines.join('</span></p>\n<p class=MsoNormal dir=RTL><span lang=HE>');

    const symConfigs = [];
    Object.keys(state.eds).forEach(id => {
      if (id == 1) return;
      const sym = getSym(id);
      if (!sym) return;
      const noteRich = getRichHtml(state.eds[id]);
      const parts = noteRich.split(sym);
      if (parts.length > 0 && parts[0].trim() === '') parts.shift();
      symConfigs.push({ symbol: sym, prefix: `[${id - 1}] `, parts: parts, counter: 0 });
    });

    let fnHTML = '';
    let nc = 1;

    if (symConfigs.length > 0) {
      symConfigs.sort((a, b) => b.symbol.length - a.symbol.length);
      const regexStr = symConfigs.map(c => c.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      const regex = new RegExp(`(${regexStr})`, 'g');

      mc = mc.replace(regex, (match) => {
        const cfg = symConfigs.find(c => c.symbol === match);
        if (cfg && cfg.counter < cfg.parts.length) {
          let note = cfg.parts[cfg.counter].trim().replace(/<br>/g, ' ');
          cfg.counter++;
          const id = nc;
          nc++;
          const refMarker = `<a style='mso-footnote-id:ftn${id}; vertical-align:super; font-size:80%;' href='#_ftn${id}' name='_ftnref${id}'><span class='MsoFootnoteReference'><span style='mso-special-character:footnote'></span></span></a>`;
          fnHTML += `<div style='mso-element:footnote' id='ftn${id}'><p class="MsoFootnoteText"><a style='mso-footnote-id:ftn${id}' href='#_ftnref${id}' name='_ftn${id}'><span class='MsoFootnoteReference'><span style='mso-special-character:footnote'></span></span></a><span dir="rtl" lang="HE"> <b>${cfg.prefix}</b> ${note}</span></p></div>`;
          return refMarker;
        }
        return match;
      });
    }

    const docHtml = buildWordExportHtml(mc, fnHTML);
    const filename = suggestSaveFilename(getLastFileName());
    downloadDocFile(filename, docHtml);
    await showWowAlert(
      state.tr[state.currentLang].wowT_saved,
      state.tr[state.currentLang].alertSaved + filename,
      'ok'
    );
    if (state.pendingCloseAfterSave) {
      state.pendingCloseAfterSave = false;
      if (typeof options.onClose === 'function') options.onClose();
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // jumpMarker (verbatim)
  // ────────────────────────────────────────────────────────────────────
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
        if (markers[i].index < cursorPos) {
          targetIndex = i;
          break;
        }
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

  // ────────────────────────────────────────────────────────────────────
  // splitNotes (verbatim)
  // ────────────────────────────────────────────────────────────────────
  async function splitNotes() {
    const trCur = state.tr[state.currentLang];
    if (!state.eds[1] || !state.eds[2]) {
      await showWowAlert(trCur.wowT_noSplit, trCur.alertSplit, 'warn');
      return;
    }

    const filterSymbol = window.prompt(trCur.promptFilter, '*');
    if (!filterSymbol) return;

    const newLinkSymbol = window.prompt(trCur.promptNewSym, '$');
    if (!newLinkSymbol) return;

    const linkSymbolInput = rootEl.querySelector('#sym-2');
    const linkSymbol = linkSymbolInput ? linkSymbolInput.value.trim() : '';
    if (!linkSymbol) {
      await showWowAlert(trCur.wowT_noSym, trCur.alertNoSym, 'warn');
      return;
    }

    const mainText = state.eds[1].getText();
    const notesText = state.eds[2].getText();
    const mainParts = mainText.split(linkSymbol);

    const noteIndices = [];
    let ci = notesText.indexOf(linkSymbol);
    while (ci > -1) {
      noteIndices.push(ci);
      ci = notesText.indexOf(linkSymbol, ci + 1);
    }

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
      await showWowAlert(trCur.wowT_noMatch, trCur.alertNoMatch + filterSymbol, 'info');
    }
    highlightAll();
  }

  // ────────────────────────────────────────────────────────────────────
  // Visual mode (verbatim)
  // ────────────────────────────────────────────────────────────────────
  function htmlToDelta(html) {
    const tempCont = document.createElement('div');
    tempCont.innerHTML = html;
    let ops = [];

    function processNode(node, currentAttr) {
      if (node.nodeType === Node.TEXT_NODE) {
        let text = node.textContent;
        if (text.length > 0) {
          ops.push({ insert: text, attributes: Object.keys(currentAttr).length > 0 ? { ...currentAttr } : undefined });
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        let attr = { ...currentAttr };
        const tag = node.tagName.toLowerCase();

        if (tag === 'b' || tag === 'strong') attr.bold = true;
        if (tag === 'i' || tag === 'em') attr.italic = true;
        if (tag === 'u') attr.underline = true;
        if (node.style && node.style.color) attr.color = node.style.color;

        if (tag === 'br') {
          ops.push({ insert: '\n', attributes: Object.keys(attr).length > 0 ? attr : undefined });
        } else {
          for (let i = 0; i < node.childNodes.length; i++) {
            processNode(node.childNodes[i], attr);
          }
          if (tag === 'p' || tag === 'div' || tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'li') {
            if (ops.length > 0 && !ops[ops.length - 1].insert.endsWith('\n')) {
              ops.push({ insert: '\n', attributes: Object.keys(currentAttr).length > 0 ? { ...currentAttr } : undefined });
            }
          }
        }
      }
    }

    for (let i = 0; i < tempCont.childNodes.length; i++) {
      processNode(tempCont.childNodes[i], {});
    }

    if (ops.length === 0 || !ops[ops.length - 1].insert.endsWith('\n')) {
      ops.push({ insert: '\n' });
    }
    return { ops: ops };
  }

  function togglePreview() {
    state.isVisualMode = !state.isVisualMode;
    const btn = rootEl.querySelector('#previewBtn');
    btn.classList.toggle('active', state.isVisualMode);

    if (state.isVisualMode) {
      btn.textContent = state.currentLang === 'he' ? '💻 עורך קוד' : '💻 Code Editor';
      rootEl.querySelector('#global-toolbar').style.display = '';

      Object.keys(state.eds).forEach(id => {
        const q = state.eds[id];
        const align = q.getFormat(0, 1).align;
        const dir = q.getFormat(0, 1).direction;

        let rawText = q.getText();
        try {
          let d = htmlToDelta(rawText);
          q.setContents(d, 'silent');
        } catch (e) {
          console.error('Error parsing HTML to Visual Mode:', e);
        }

        q.formatLine(0, q.getLength(), 'direction', dir, 'silent');
        q.formatLine(0, q.getLength(), 'align', align, 'silent');

        const e = rootEl.querySelector('#editor-' + id + ' .ql-editor');
        e.style.fontFamily = '"David",serif';
        e.style.fontSize = (state.fs + 4) + 'px';
        e.style.background = rootEl.classList.contains('light-theme') ? '#F9FAFB' : '#0D1117';
        e.contentEditable = true;
      });
    } else {
      btn.textContent = state.currentLang === 'he' ? '👁 עורך ויזואלי' : '👁 Visual Editor';
      rootEl.querySelector('#global-toolbar').style.display = '';

      Object.keys(state.eds).forEach(id => {
        const q = state.eds[id];
        const align = q.getFormat(0, 1).align;
        const dir = q.getFormat(0, 1).direction;

        let richHtml = getRichHtml(q);
        richHtml = richHtml.replace(/(<br>)*$/g, '');
        q.setText(richHtml + '\n', 'silent');

        q.formatLine(0, q.getLength(), 'direction', dir, 'silent');
        q.formatLine(0, q.getLength(), 'align', align, 'silent');

        const e = rootEl.querySelector('#editor-' + id + ' .ql-editor');
        e.style.fontFamily = '"David","Segoe UI",serif';
        e.style.fontSize = state.fs + 'px';
        e.style.background = 'var(--ed-bg)';
        e.contentEditable = true;

        e.addEventListener('mouseup', handleCodeModeSelection);
        e.addEventListener('keyup', handleCodeModeSelection);
      });
    }
    highlightAll();
  }

  function handleCodeModeSelection() {
    if (state.isVisualMode) return;
    const selection = window.getSelection();
    if (selection.rangeCount === 0 || selection.toString().trim() === '') return;
    const selectedText = selection.toString();
    if (selectedText.length === 0) return;
    if (selectedText.includes('<') && selectedText.includes('>')) return;
    showQuickTagMenu(selection, selectedText);
  }

  function showQuickTagMenu(selection, text) {
    const existingMenu = rootEl.querySelector('#quick-tag-menu');
    if (existingMenu) existingMenu.remove();
    const menu = document.createElement('div');
    menu.id = 'quick-tag-menu';
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top = (rect.bottom + 5) + 'px';

    COMPARATOR_QUICK_TAGS.forEach(({ label, tag, title }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.title = title;
      btn.onclick = () => {
        if (tag === 'br') {
          selection.deleteContents();
          selection.insertNode(document.createTextNode('<br>'));
        } else {
          const taggedText = `<${tag}>${text}</${tag}>`;
          selection.deleteContents();
          selection.insertNode(document.createTextNode(taggedText));
        }
        menu.remove();
      };
      menu.appendChild(btn);
    });

    rootEl.appendChild(menu);
    setTimeout(() => { if (menu.parentNode) menu.remove(); }, 3000);
  }

  // ────────────────────────────────────────────────────────────────────
  // Expanded tools (verbatim — extra tools menu)
  // ────────────────────────────────────────────────────────────────────
  function toggleExpandTools() {
    state.isToolsExpanded = !state.isToolsExpanded;
    const btn = rootEl.querySelector('#expandToolsBtn');
    if (state.isToolsExpanded) {
      btn.textContent = '🔧 כלים מורחבים';
      showExpandedTools();
    } else {
      btn.textContent = '⚙️ כלים';
      hideExpandedTools();
    }
  }

  function showExpandedTools() {
    const toolbar = rootEl.querySelector('#global-toolbar');
    const expandedTools = document.createElement('div');
    expandedTools.id = 'expanded-tools';

    if (rootEl.getAttribute('dir') === 'rtl' || state.currentLang === 'he') {
      expandedTools.style.direction = 'rtl';
      expandedTools.style.justifyContent = 'flex-end';
    }

    const toolActions = {
      showStats: showStats,
      advancedSearch: advancedSearch,
      textFormatter: textFormatter,
      themeSelector: themeSelector,
      quickActions: quickActions,
      linkManager: linkManager,
      editHistory: editHistory,
      advancedSettings: advancedSettings
    };

    COMPARATOR_EXPANDED_TOOLS.forEach(tool => {
      const btn = document.createElement('button');
      btn.textContent = tool.text;
      btn.className = 'btn blue';
      btn.style.fontSize = '12px';
      btn.onclick = () => {
        const fn = toolActions[tool.action];
        if (typeof fn === 'function') fn();
      };
      expandedTools.appendChild(btn);
    });

    toolbar.appendChild(expandedTools);
  }

  function hideExpandedTools() {
    const expanded = rootEl.querySelector('#expanded-tools');
    if (expanded) expanded.remove();
  }

  // Stub tools — verbatim from Python (alert demo)
  function showStats() {
    alert('📊 סטטיסטיקות: ' + (rootEl.querySelector('.ql-editor')?.innerText.length || 0) + ' תווים');
  }
  function advancedSearch() { alert('🔍 חיפוש מתקדם - בפיתוח'); }
  function textFormatter() { alert('📝 מעצב טקסט - בפיתוח'); }
  function themeSelector() { alert('🎨 ערכות נושא - בפיתוח'); }
  function quickActions() { alert('⚡ פעולות מהירות - בפיתוח'); }
  function linkManager() { alert('🔗 ניהול קישורים - בפיתוח'); }
  function editHistory() { alert('📋 היסטוריית עריכה - בפיתוח'); }
  function advancedSettings() { alert('🛠️ הגדרות מתקדמות - בפיתוח'); }

  // ────────────────────────────────────────────────────────────────────
  // loadWordContent (verbatim)
  // ────────────────────────────────────────────────────────────────────
  function loadWordContent(editor, htmlContent) {
    if (!htmlContent) return;
    console.log('=== DEBUG: Word Content ===');
    console.log('Raw content:', htmlContent);
    console.log('Contains HTML tags:', htmlContent.includes('<'));
    console.log('Current mode:', state.isVisualMode ? 'VISUAL' : 'CODE');
    console.log('==========================');

    if (state.isVisualMode) {
      if (htmlContent.includes('<')) {
        try {
          const delta = htmlToDelta(htmlContent);
          editor.setContents(delta, 'silent');
          console.log('✓ Loaded as rich content with HTML formatting');
          return;
        } catch (e) {
          console.warn('Failed to parse HTML as rich content:', e);
        }
      }
      editor.setText(htmlContent);
      console.log('⚠ Loaded as plain text (no HTML or parsing failed)');
    } else {
      editor.setText(htmlContent + '\n', 'silent');
      console.log('✓ Loaded in CODE mode - HTML tags should be visible');
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Toolbar button interception for code mode (verbatim)
  // ────────────────────────────────────────────────────────────────────
  function interceptToolbarButtons() {
    const toolbar = rootEl.querySelector('#global-toolbar');
    if (!toolbar) return;
    rootEl.addEventListener('click', function (e) {
      if (!state.isVisualMode && e.target.closest('.ql-toolbar')) {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.classList.contains('ql-bold')) { e.preventDefault(); e.stopPropagation(); insertHtmlTag('b'); return false; }
        if (btn.classList.contains('ql-italic')) { e.preventDefault(); e.stopPropagation(); insertHtmlTag('i'); return false; }
        if (btn.classList.contains('ql-underline')) { e.preventDefault(); e.stopPropagation(); insertHtmlTag('u'); return false; }
        if (btn.classList.contains('ql-strike')) { e.preventDefault(); e.stopPropagation(); insertHtmlTag('s'); return false; }
      }
    }, true);
    console.log('✓ Toolbar button interceptors installed');
  }

  function insertHtmlTag(tagName) {
    console.log(`Inserting HTML tag: ${tagName} in code mode`);
    let activeEditor = document.activeElement;
    if (!activeEditor || !activeEditor.closest('.ql-editor')) {
      activeEditor = rootEl.querySelector('.ql-editor');
      if (activeEditor) activeEditor.focus();
    }
    if (!activeEditor) {
      console.warn('No active editor found');
      return;
    }
    const selection = window.getSelection();
    const selectedText = selection.toString();
    if (selectedText.trim() === '') {
      const tagPair = `<${tagName}></${tagName}>`;
      document.execCommand('insertText', false, tagPair);
      setTimeout(() => {
        const pos = activeEditor.selectionStart || 0;
        const newPos = pos - tagName.length - 3;
        if (activeEditor.setSelectionRange) activeEditor.setSelectionRange(newPos, newPos);
      }, 10);
      console.log(`✓ Inserted empty tag pair: ${tagPair}`);
    } else {
      const taggedText = `<${tagName}>${selectedText}</${tagName}>`;
      document.execCommand('insertText', false, taggedText);
      console.log(`✓ Wrapped selected text with <${tagName}> tags`);
    }
    setTimeout(highlightAll, 100);
  }

  function addToolbarTooltips() {
    Object.entries(COMPARATOR_TOOLTIPS).forEach(([selector, tooltip]) => {
      const element = rootEl.querySelector('.ql-toolbar ' + selector);
      if (element) {
        element.setAttribute('data-tooltip', tooltip);
        element.setAttribute('title', tooltip);
      }
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Action dispatcher — bind data-action handlers
  // ────────────────────────────────────────────────────────────────────
  const actions = {
    addPane,
    splitNotes,
    toggleMerge,
    doExport,
    doImport,
    togglePreview,
    toggleExpandTools,
    showTransferSettings,
    toggleSync,
    toggleLines,
    toggleTheme,
    changeFontSize: (arg) => changeFontSize(parseInt(arg, 10)),
    jumpMarker: (arg) => jumpMarker(parseInt(arg, 10)),
    toggleLang,
    saveTransferSettings,
    closeTransferModal,
    confirmImport,
    closeImportModal,
    closeWowAlert,
    removePane: (arg) => removePane(parseInt(arg, 10)),
    jumpToNth: (arg, ev) => {
      const t = ev.target;
      jumpToNth(parseInt(t.dataset.edid, 10), t.dataset.sym, parseInt(t.dataset.nth, 10));
    }
  };

  rootEl.addEventListener('click', (ev) => {
    const trg = ev.target.closest('[data-action]');
    if (!trg) return;
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

  // ESC closes wow alert (verbatim)
  rootEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ov = rootEl.querySelector('#wowAlert');
      if (ov && ov.classList.contains('active')) closeWowAlert();
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // Init: apply font size, create panes, wire tooltips, intercept toolbar
  // ────────────────────────────────────────────────────────────────────
  rootEl.querySelector('#fsLabel').textContent = state.fs;
  rootEl.querySelectorAll('.ql-editor').forEach(e => e.style.fontSize = state.fs + 'px');
  mkEd(1);
  mkEd(2);
  rootEl.querySelectorAll('.ql-editor').forEach(e => e.style.fontSize = state.fs + 'px');
  setTimeout(highlightAll, 500);
  setTimeout(() => {
    interceptToolbarButtons();
    addToolbarTooltips();
  }, 100);

  // Floating language button (verbatim — _inject_lang_btn)
  const langFloating = document.createElement('button');
  langFloating.id = 'rt_lang_btn_floating';
  langFloating.textContent = state.currentLang === 'he' ? '🌐 English' : '🌐 עברית';
  langFloating.onclick = () => {
    const newLang = toggleLangPref();
    langFloating.textContent = newLang === 'he' ? '🌐 English' : '🌐 עברית';
    alert(newLang === 'he' ? 'השפה תוחלף בפתיחה הבאה.' : 'Language will switch on next launch.');
  };
  rootEl.appendChild(langFloating);

  return {
    // Public API for the host (close, dirty checks, etc)
    state,
    addPane, removePane, doImport, doExport,
    importBlob: async (file, opts) => {
      state.impFile = file;
      state.impPath = file.name;
      state.impStreams = await docx_find_streams(file);
      // automatically open the import modal
      const l = rootEl.querySelector('#streamList');
      l.innerHTML = '';
      state.impStreams.forEach((s, i) => {
        const sym = dm[i % dm.length];
        l.innerHTML += '<div class="stream-row"><input type="checkbox" checked id="chk-' + i + '"><label for="chk-' + i + '">' + escapeHtml(s.label) + ' (' + escapeHtml(s.count) + ')</label><input type="text" id="si-' + i + '" value="' + escapeHtml(sym) + '"></div>';
      });
      rootEl.querySelector('#importModal').classList.add('active');
    },
    setMainText: (text) => {
      if (state.eds[1]) loadWordContent(state.eds[1], text || '');
    },
    setStreamText: (paneId, text) => {
      if (!state.eds[paneId]) {
        while (state.nxId <= paneId) addPane();
      }
      if (state.eds[paneId]) loadWordContent(state.eds[paneId], text || '');
    }
  };
}
