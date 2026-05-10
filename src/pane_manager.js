// pane_manager.js
// מנהל חלוניות עורך — כל חלונית = עורך TipTap עם קוד זרם משלה.
// תומך עד 99 חלוניות, הוספה/מחיקה דינמית, בחירת זרם, תפריט קליק‑ימני,
// שמירת מצב ב‑localStorage.

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, BackgroundColor, FontFamily, FontSize } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Youtube from "@tiptap/extension-youtube";
import Highlight from "@tiptap/extension-highlight";
// משה 2026-05-10: הרחבות מותאמות ל-line-height ו-indent (ייבוא DOCX).
import { LineHeight, Indent } from "./tiptap_custom_extensions.js";
import { StreamMark, findAllStreamMarks, colorForStream } from "./stream_mark.js";
import { TableExt, TableRowExt, TableCellExt } from "./tables_module.js";
import { initMainStreamResizer, initResizer } from "./resizer.js";

const MAX_PANES = 99;
const STORAGE_KEY = "ravtext.panes.state.v1";
const MAX_BOOT_STORAGE_BYTES = 900000;

let _paneIdCounter = 0;

function nextPaneId() {
  _paneIdCounter++;
  return `pane-${Date.now().toString(36)}-${_paneIdCounter}`;
}

function isStorageDisabled() {
  return typeof window !== "undefined" && window.__RAVTEXT_STORAGE_DISABLED__ === true;
}

function escapeSelectorValue(value) {
  if (typeof window !== "undefined" && window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value));
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

function paneScrollRange(body) {
  const prose = body?.querySelector(".ProseMirror");
  const contentHeight = prose
    ? Math.max(prose.scrollHeight, prose.getBoundingClientRect().height)
    : body.scrollHeight;
  return Math.max(0, contentHeight - body.clientHeight);
}

function visibleMarkerAnchor(body) {
  if (!body) return null;
  const markers = Array.from(body.querySelectorAll(".stream-marker[data-stream][data-num]"));
  if (markers.length === 0) return null;
  const viewport = body.getBoundingClientRect();
  const targetY = viewport.top + viewport.height * 0.5;
  let best = null;
  let bestDist = Infinity;

  for (const marker of markers) {
    const rect = marker.getBoundingClientRect();
    if (rect.bottom < viewport.top || rect.top > viewport.bottom) continue;
    const dist = Math.abs(rect.top - targetY);
    if (dist < bestDist) {
      bestDist = dist;
      best = { marker, rect };
    }
  }

  if (!best) return null;
  const code = best.marker.getAttribute("data-stream");
  const num = parseInt(best.marker.getAttribute("data-num") || "", 10);
  if (!code || !Number.isFinite(num)) return null;
  return {
    code,
    num,
    offsetRatio: Math.max(0, Math.min(1, (best.rect.top - viewport.top) / Math.max(1, viewport.height))),
  };
}

function scrollPaneToAnchor(pane, anchor) {
  if (!pane?._body || !anchor?.code || !Number.isFinite(anchor.num)) return false;
  const body = pane._body;
  const code = escapeSelectorValue(anchor.code);
  const num = escapeSelectorValue(anchor.num);
  let target = body.querySelector(`.stream-marker[data-stream="${code}"][data-num="${num}"]`);
  if (!target && pane.streamCode === anchor.code) {
    target = body.querySelector(`.stream-marker[data-num="${num}"]`);
  }
  if (!target) return false;

  const bodyRect = body.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const desiredTop = bodyRect.top + bodyRect.height * Math.max(0.05, Math.min(0.45, anchor.offsetRatio ?? 0.25));
  const maxScroll = paneScrollRange(body);
  body.scrollTop = Math.max(0, Math.min(maxScroll, body.scrollTop + targetRect.top - desiredTop));
  return true;
}

function syncPaneByFraction(sourceBody, targetBody) {
  const sourceMax = paneScrollRange(sourceBody);
  const targetMax = paneScrollRange(targetBody);
  const fraction = sourceMax > 0 ? sourceBody.scrollTop / sourceMax : 0;
  targetBody.scrollTop = Math.max(0, Math.min(targetMax, fraction * targetMax));
}

function buildEditorExtensions() {
  return [
    StarterKit,
    TextStyle.configure({ types: ["textStyle"] }),
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Underline,
    Superscript,
    Subscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: true }),
    Link.configure({ openOnClick: false }),
    Youtube.configure({ controls: true, nocookie: true }),
    TableExt,
    TableRowExt,
    TableCellExt,
    StreamMark,
    Highlight.configure({ multicolor: true }),
    LineHeight,
    Indent,
  ];
}

export class Pane {
  constructor({ id, streamCode, symbol, label, dir, markerBarCollapsed, content, onFocus, onChange }) {
    this.id = id || nextPaneId();
    this.streamCode = streamCode;
    this.symbol = symbol || (streamCode ? `@${streamCode}` : "");
    this.label = label || (streamCode ? `זרם ${streamCode}` : "ראשי");
    this.dir = dir || "rtl";
    this.onFocus = onFocus || (() => {});
    this.onChange = onChange || (() => {});
    this.element = null;
    this.editor = null;
    this._body = null;
    this._markerBar = null;
    this._markerToggle = null;
    this._markerTimer = null;
    this.initialContent = content;
    this.markerBarCollapsed = markerBarCollapsed === undefined ? true : !!markerBarCollapsed;
    this._manager = null;
  }

  mount(parent) {
    this.element = document.createElement("section");
    this.element.className = "pane";
    if (!this.streamCode) {
      this.element.classList.add("main-pane");
    }
    this.element.dataset.paneId = this.id;

    const header = document.createElement("div");
    header.className = "pane-header";
    this._header = header;

    const chip = document.createElement("span");
    chip.className = "pane-chip";
    if (this.streamCode) {
      const c = colorForStream(this.streamCode);
      chip.style.backgroundColor = c.bg;
      chip.style.color = c.fg;
      chip.textContent = this.streamCode;
    } else {
      chip.style.backgroundColor = "#D4AF37";
      chip.style.color = "#000";
      chip.textContent = "ראשי";
    }
    header.appendChild(chip);

    const labelEl = document.createElement("span");
    labelEl.className = "pane-label";
    labelEl.textContent = this.label;
    header.appendChild(labelEl);

    if (this.streamCode) {
      header.draggable = true;
      header.classList.add("pane-drag-handle");
      header.title = "גרור כדי לסדר חלוניות זרמים";

      const symInput = document.createElement("input");
      symInput.className = "pane-symbol";
      symInput.value = this.symbol;
      symInput.title = "סימן מותאם";
      symInput.addEventListener("input", (e) => {
        this.symbol = e.target.value;
        if (this.editor) {
          this.editor.storage.streamMark.symbol = this.symbol || null;
          this.editor.view.dispatch(this.editor.state.tr);
        }
        this._save();
      });
      header.appendChild(symInput);
    }

    const spacer = document.createElement("span");
    spacer.style.flex = "1";
    header.appendChild(spacer);

    const markerToggle = document.createElement("button");
    markerToggle.type = "button";
    markerToggle.className = "pane-marker-toggle";
    markerToggle.title = "מזער רשימת מספרי הערות";
    markerToggle.addEventListener("click", () => {
      this.markerBarCollapsed = !this.markerBarCollapsed;
      this._applyMarkerBarState();
      if (!this.markerBarCollapsed) this.updateMarkerBar();
      this._save();
    });
    this._markerToggle = markerToggle;
    header.appendChild(markerToggle);

    if (this.streamCode) {
      const close = document.createElement("button");
      close.className = "pane-close";
      close.textContent = "✕";
      close.title = "סגור חלונית";
      close.addEventListener("click", () => {
        if (confirm(`למחוק את חלונית "${this.label}"? התוכן יאבד.`)) {
          this._requestRemove();
        }
      });
      header.appendChild(close);
    }

    const markerBar = document.createElement("div");
    markerBar.className = "marker-bar";
    this._markerBar = markerBar;

    const body = document.createElement("div");
    body.className = "pane-body";
    body.dir = this.dir || "rtl";
    this._body = body;

    this.element.appendChild(header);
    this.element.appendChild(markerBar);
    this.element.appendChild(body);
    parent.appendChild(this.element);
    this._applyMarkerBarState();

    this.editor = new Editor({
      element: body,
      extensions: buildEditorExtensions(),
      content: this.initialContent !== undefined
        ? this.initialContent
        : this.streamCode
        ? `<p>תוכן זרם ${this.streamCode}…</p>`
        : "<p>תוכן ראשי. לחץ \"טען דוגמה\" או הקלד.</p>",
      onFocus: () => this.onFocus(this),
      onUpdate: () => {
        this.onChange(this);
        this.scheduleMarkerBarUpdate();
      },
    });

    this.editor.storage.streamMark.symbol = this.symbol || null;
    this.editor.storage.streamMark.streamCode = this.streamCode || null;
    this._scheduleInitialStreamScan();

    body.addEventListener("scroll", () => this._onScroll());
    body.addEventListener("contextmenu", (ev) => this._onContextMenu(ev));
    if (this.streamCode) {
      header.addEventListener("dragstart", (ev) => this._onDragStart(ev));
      header.addEventListener("dragend", () => this._manager?.clearDragState());
      this.element.addEventListener("dragover", (ev) => this._onDragOver(ev));
      this.element.addEventListener("dragleave", () => this._clearDropHint());
      this.element.addEventListener("drop", (ev) => this._onDrop(ev));
    }
    this.updateMarkerBar();
  }

  _scheduleInitialStreamScan() {
    if (!this.editor) return;
    if (typeof window !== "undefined" && window.__STREAM_MARK_SCAN_DISABLED__) return;
    const docSize = this.editor.state.doc.content.size;
    if (docSize > 120000) return;
    const text = this.editor.state.doc.textBetween(0, docSize, "\n", "\n");
    const symbol = (this.symbol || "").trim();
    const hasMarker = symbol ? text.includes(symbol) : /@\d{1,3}/.test(text);
    if (!hasMarker) return;
    const run = () => {
      if (!this.editor) return;
      this.editor.view.dispatch(this.editor.state.tr.setMeta("forceStreamMarkScan", true));
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      setTimeout(run, 0);
    }
  }

  destroy() {
    if (this._markerTimer) {
      clearTimeout(this._markerTimer);
      this._markerTimer = null;
    }
    if (this.editor) { this.editor.destroy(); this.editor = null; }
    if (this.element) { this.element.remove(); this.element = null; }
  }

  serialize() {
    return {
      id: this.id,
      streamCode: this.streamCode,
      symbol: this.symbol,
      label: this.label,
      dir: this.dir,
      markerBarCollapsed: this.markerBarCollapsed,
      content: this.editor ? this.editor.getJSON() : null,
    };
  }

  load(content) {
    if (this.editor && content) {
      this.editor.commands.setContent(content, { emitUpdate: false });
      this._scheduleInitialStreamScan();
      this.scheduleMarkerBarUpdate({ immediate: true });
    }
  }

  setDir(dir) {
    this.dir = dir;
    if (this._body) this._body.dir = dir;
    this._save();
  }

  _onScroll() {
    const mgr = this._manager;
    if (!mgr || !mgr.syncEnabled || mgr.syncBusy) return;
    mgr.syncBusy = true;
    const body = this._body;
    const anchor = visibleMarkerAnchor(body);
    for (const other of mgr.panes) {
      if (other === this || !other._body) continue;
      if (anchor && scrollPaneToAnchor(other, anchor)) continue;
      syncPaneByFraction(body, other._body);
    }
    requestAnimationFrame(() => { mgr.syncBusy = false; });
  }

  _applyMarkerBarState() {
    if (this.element) {
      this.element.classList.toggle("marker-bar-collapsed", this.markerBarCollapsed);
    }
    if (this._markerToggle) {
      this._markerToggle.textContent = this.markerBarCollapsed ? "מס׳ ▾" : "מס׳ ▴";
      this._markerToggle.title = this.markerBarCollapsed
        ? "הצג רשימת מספרי הערות"
        : "מזער רשימת מספרי הערות";
    }
  }

  updateMarkerBar() {
    if (!this._markerBar || !this.editor) return;
    if (this.markerBarCollapsed) {
      this._markerBar.innerHTML = "";
      if (this._markerToggle) this._markerToggle.disabled = false;
      return;
    }

    const all = findAllStreamMarks(this.editor.state);
    if (this._markerToggle) {
      this._markerToggle.disabled = all.length === 0;
    }
    const bySym = new Map();
    for (const m of all) {
      const sym = m.symbol || `@${m.streamCode}`;
      if (!bySym.has(sym)) bySym.set(sym, []);
      bySym.get(sym).push(m);
    }

    this._markerBar.innerHTML = "";
    let ci = 0;
    for (const [sym, items] of bySym) {
      const span = document.createElement("span");
      span.className = `mc mc-${ci % 6}`;

      const lbl = document.createElement("span");
      lbl.className = "sym-label-bar";
      lbl.textContent = sym;
      span.appendChild(lbl);

      items.forEach((m, idx) => {
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.dataset.n = String(idx + 1);
        badge.dataset.sym = sym;
        badge.title = `מופע ${idx + 1}`;
        badge.textContent = String(idx + 1);
        badge.addEventListener("click", () => this.jumpToNth(sym, idx + 1));
        span.appendChild(badge);
      });

      this._markerBar.appendChild(span);
      ci++;
    }
  }

  scheduleMarkerBarUpdate({ immediate = false } = {}) {
    if (!this._markerBar || this.markerBarCollapsed) return;
    if (this._markerTimer) clearTimeout(this._markerTimer);
    const run = () => {
      this._markerTimer = null;
      this.updateMarkerBar();
    };
    if (immediate) run();
    else this._markerTimer = setTimeout(run, 250);
  }

  jumpToNth(sym, n) {
    if (!this.editor) return false;

    const all = findAllStreamMarks(this.editor.state);
    const matching = all.filter(m => (m.symbol || `@${m.streamCode}`) === sym);

    if (n < 1 || n > matching.length) {
      console.warn(`jumpToNth: out of range, sym=${sym}, n=${n}, available=${matching.length}`);
      return false;
    }

    const target = matching[n - 1];
    this.editor.commands.setTextSelection({ from: target.from, to: target.to });
    this.editor.commands.scrollIntoView();
    this.editor.commands.focus();

    setTimeout(() => {
      const body = this._body;
      if (!body) return;
      const targetEl = body.querySelector(`.stream-marker[data-uid="${target.uid}"]`);
      if (targetEl) {
        targetEl.classList.add("fresh");
        setTimeout(() => targetEl.classList.remove("fresh"), 1300);
      }
    }, 50);

    return true;
  }

  _save() {
    if (this._manager && typeof this._manager._save === "function") {
      this._manager._save();
    }
  }

  _requestRemove() {
    const ev = new CustomEvent("pane-remove-request", { detail: { id: this.id }, bubbles: true });
    if (this.element) this.element.dispatchEvent(ev);
  }

  _onDragStart(ev) {
    if (!this.streamCode || !this._manager) return;
    if (ev.target.closest("input, button")) {
      ev.preventDefault();
      return;
    }
    this._manager._dragPaneId = this.id;
    this.element.classList.add("dragging-pane");
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", this.id);
  }

  _onDragOver(ev) {
    const mgr = this._manager;
    const dragId = mgr?._dragPaneId || ev.dataTransfer.getData("text/plain");
    if (!mgr || !this.streamCode || !dragId || dragId === this.id) return;

    const dragged = mgr.panes.find(p => p.id === dragId);
    if (!dragged?.streamCode) return;

    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    const rect = this.element.getBoundingClientRect();
    const midpoint = rect.left + rect.width / 2;
    this._dropPosition = ev.clientX < midpoint ? "after" : "before";
    this.element.classList.toggle("drag-over-before", this._dropPosition === "before");
    this.element.classList.toggle("drag-over-after", this._dropPosition === "after");
  }

  _onDrop(ev) {
    const mgr = this._manager;
    const dragId = mgr?._dragPaneId || ev.dataTransfer.getData("text/plain");
    if (!mgr || !dragId || dragId === this.id) return;
    ev.preventDefault();
    mgr.reorderPane(dragId, this.id, this._dropPosition || "before");
    mgr.clearDragState();
  }

  _clearDropHint() {
    if (!this.element) return;
    this.element.classList.remove("drag-over-before", "drag-over-after");
  }

  _onContextMenu(ev) {
    ev.preventDefault();
    closeAllContextMenus();
    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    menu.style.position = "fixed";
    menu.style.top = `${ev.clientY}px`;
    menu.style.right = `${window.innerWidth - ev.clientX}px`;
    const items = [
      { l: "📋 העתק", h: () => document.execCommand("copy") },
      { l: "✂ גזור", h: () => document.execCommand("cut") },
      { l: "📥 הדבק", h: () => document.execCommand("paste") },
      { l: "🅰 בחר הכל", h: () => this.editor && this.editor.commands.selectAll() },
    ];
    if (this.streamCode) {
      items.push({ l: "—", h: null });
      items.push({ l: "🗑 מחק חלונית", h: () => { if (confirm("למחוק חלונית?")) this._requestRemove(); } });
    }
    for (const it of items) {
      if (it.l === "—") {
        const sep = document.createElement("hr");
        sep.className = "ctx-sep";
        menu.appendChild(sep);
      } else {
        const b = document.createElement("button");
        b.textContent = it.l;
        b.addEventListener("click", () => { it.h(); closeAllContextMenus(); });
        menu.appendChild(b);
      }
    }
    document.body.appendChild(menu);
    setTimeout(() => {
      document.addEventListener("click", closeAllContextMenus, { once: true });
    }, 0);
  }
}

function closeAllContextMenus() {
  document.querySelectorAll(".ctx-menu").forEach(m => m.remove());
}

export class PaneManager {
  constructor(container) {
    this.container = container;
    this.panes = [];
    this.activePane = null;
    this._listeners = { change: [], focus: [] };
    this.syncEnabled = false;
    this.syncBusy = false;
    this.lineMode = false;
    this.merged = false;
    this._dragPaneId = null;
    this._batchDepth = 0;
    this._pendingChange = false;
    this._pendingMarkerRefresh = false;
    this._savePending = false;
    this._saveTimer = null;

    container.addEventListener("pane-remove-request", (ev) => {
      this.removePane(ev.detail.id);
    });
  }

  on(event, fn) { this._listeners[event].push(fn); }
  _emit(event) {
    if (event === "change" && this._batchDepth > 0) {
      this._pendingChange = true;
      return;
    }
    for (const fn of this._listeners[event] || []) fn(this);
  }

  count() { return this.panes.length; }

  _beginBatch() {
    this._batchDepth++;
  }

  _endBatch() {
    if (this._batchDepth > 0) this._batchDepth--;
    if (this._batchDepth > 0) return;
    if (this._pendingMarkerRefresh) {
      this._pendingMarkerRefresh = false;
      this._refreshAllMarkerBars();
    }
    this._updateLayoutClasses();
    if (this._savePending) this._save();
    if (this._pendingChange) {
      this._pendingChange = false;
      for (const fn of this._listeners.change || []) fn(this);
    }
  }

  addPane(opts = {}) {
    if (this.panes.length >= MAX_PANES) {
      alert(`מקסימום ${MAX_PANES} חלוניות.`);
      return null;
    }

    if (opts.streamCode && !opts.symbol) {
      opts.symbol = `@${opts.streamCode}`;
    }
    if (!opts.streamCode && opts.symbol === undefined) {
      opts.symbol = "";
    }

    const streamPaneCount = this.panes.filter(p => p.streamCode).length;
    if (opts.streamCode && streamPaneCount === 0) {
      const mainPane = this.getMainPane();
      if (mainPane?.element && !this.container.querySelector(".main-stream-resizer")) {
        const mainResizer = document.createElement("div");
        mainResizer.className = "main-stream-resizer";
        this.container.appendChild(mainResizer);
        initMainStreamResizer(mainResizer);
      }
    }
    if (opts.streamCode && streamPaneCount >= 1) {
      const resizer = document.createElement("div");
      resizer.className = "resizer";
      this.container.appendChild(resizer);
      initResizer(resizer);
    }

    const onFocus = (p) => {
      this.activePane = p;
      this._emit("focus");
    };
    const onChange = () => {
      this._save();
      this._emit("change");
    };
    const pane = new Pane({ ...opts, onFocus, onChange });
    pane._manager = this;
    pane.mount(this.container);
    this.panes.push(pane);
    if (!this.activePane) this.activePane = pane;

    if (this.lineMode && pane._body) {
      pane._body.classList.add("line-mode");
    }

    if (this._batchDepth > 0) {
      this._savePending = true;
      this._pendingChange = true;
      this._pendingMarkerRefresh = true;
    } else {
      this._save();
      this._emit("change");
      this._refreshAllMarkerBars();
      this._updateLayoutClasses();
    }
    return pane;
  }

  removePane(id) {
    const idx = this.panes.findIndex(p => p.id === id);
    if (idx === -1) return false;
    const pane = this.panes[idx];
    if (!pane.streamCode && this.panes.length === 1) {
      alert("אסור למחוק את החלונית האחרונה.");
      return false;
    }

    if (pane.element) {
      const prev = pane.element.previousElementSibling;
      const next = pane.element.nextElementSibling;
      if (prev && prev.classList.contains("resizer")) {
        prev.remove();
      } else if (next && next.classList.contains("resizer")) {
        next.remove();
      }
    }

    pane.destroy();
    this.panes.splice(idx, 1);
    if (this.activePane === pane) {
      this.activePane = this.panes[0] || null;
    }
    this._save();
    this._emit("change");
    this._refreshAllMarkerBars();
    this._updateLayoutClasses();
    return true;
  }

  reorderPane(dragId, targetId, position = "before") {
    if (!dragId || !targetId || dragId === targetId) return false;
    const state = this.serialize();
    const mainPanes = state.panes.filter(p => !p.streamCode);
    const streamPanes = state.panes.filter(p => p.streamCode);
    const dragIndex = streamPanes.findIndex(p => p.id === dragId);
    if (dragIndex === -1) return false;
    const [dragged] = streamPanes.splice(dragIndex, 1);
    let targetIndex = streamPanes.findIndex(p => p.id === targetId);
    if (targetIndex === -1) return false;
    if (position === "after") targetIndex++;
    streamPanes.splice(targetIndex, 0, dragged);
    state.panes = [...mainPanes, ...streamPanes];
    state.activeId = dragId;
    this.load(state);
    return true;
  }

  clearDragState() {
    this._dragPaneId = null;
    for (const p of this.panes) {
      p.element?.classList.remove("dragging-pane", "drag-over-before", "drag-over-after");
    }
  }

  getActiveEditor() {
    return this.activePane ? this.activePane.editor : null;
  }

  getMainPane() {
    return this.panes.find(p => !p.streamCode) || this.panes[0];
  }

  getActiveSymbols() {
    const syms = [];
    for (const p of this.panes) {
      if (!p.streamCode) continue;
      const s = (p.symbol || '').trim();
      if (s) syms.push({ sym: s, paneId: p.id, code: p.streamCode });
    }
    return syms;
  }

  _refreshAllMarkerBars() {
    for (const p of this.panes) {
      if (typeof p.updateMarkerBar === 'function') p.updateMarkerBar();
    }
  }

  _updateLayoutClasses() {
    const hasStreams = this.panes.some(p => p.streamCode);
    this.container.classList.toggle("has-stream-panes", hasStreams);
    const mainResizer = this.container.querySelector(".main-stream-resizer");
    if (mainResizer && !hasStreams) {
      mainResizer.remove();
    }
  }

  nextAvailableStreamCode() {
    const used = new Set(this.panes
      .filter(p => p.streamCode)
      .map(p => p.streamCode));
    for (let i = 1; i <= 99; i++) {
      const c = String(i).padStart(2, "0");
      if (!used.has(c)) return c;
    }
    return null;
  }

  serialize() {
    return {
      version: 1,
      activeId: this.activePane ? this.activePane.id : null,
      panes: this.panes.map(p => p.serialize()),
    };
  }

  load(state) {
    // משחזר חלוניות מ‑state — לא קוטל את הראשית הנוכחית אם קיימת
    this._beginBatch();
    try {
      for (const p of [...this.panes]) p.destroy();
      this.container.innerHTML = "";
      this.panes = [];
      this.activePane = null;
    for (const ps of state.panes || []) {
      this.addPane({
        id: ps.id,
        streamCode: ps.streamCode,
        symbol: ps.symbol,
        label: ps.label,
        dir: ps.dir,
        markerBarCollapsed: ps.markerBarCollapsed,
        content: ps.content,
      });
    }
    if (state.activeId) {
      const a = this.panes.find(p => p.id === state.activeId);
      if (a) this.activePane = a;
    }
      this._pendingChange = true;
      this._pendingMarkerRefresh = true;
      this._savePending = true;
    } finally {
      this._endBatch();
    }
  }

  _writeStorageNow() {
    if (isStorageDisabled()) {
      this._savePending = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
      this._savePending = false;
    } catch (e) {
      console.warn("[paneManager] save failed:", e);
    }
  }

  _save({ immediate = false } = {}) {
    this._savePending = true;
    if (this._batchDepth > 0) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    if (immediate) {
      this._saveTimer = null;
      this._writeStorageNow();
      return;
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._writeStorageNow();
    }, 350);
  }

  flushSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (this._savePending) this._writeStorageNow();
  }

  loadFromStorage() {
    if (isStorageDisabled()) return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      if (raw.length > MAX_BOOT_STORAGE_BYTES) {
        const backupKey = `${STORAGE_KEY}.oversized.${Date.now()}`;
        try { localStorage.setItem(backupKey, raw); } catch {}
        localStorage.removeItem(STORAGE_KEY);
        console.warn(`[paneManager] skipped oversized saved state (${raw.length} bytes), backup=${backupKey}`);
        return false;
      }
      this.load(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn("[paneManager] load failed:", e);
      return false;
    }
  }

  clearStorage() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._savePending = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}
