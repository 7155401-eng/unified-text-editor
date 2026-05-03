// pane_manager.js
// מנהל חלוניות עורך — כל חלונית = עורך TipTap עם קוד זרם משלה.
// תומך עד 99 חלוניות, הוספה/מחיקה דינמית, בחירת זרם, תפריט קליק‑ימני,
// שמירת מצב ב‑localStorage.

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, Color, BackgroundColor, FontFamily, FontSize } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Youtube from "@tiptap/extension-youtube";
import { StreamMark, findAllStreamMarks, colorForStream } from "./stream_mark.js";
import { initResizer } from "./resizer.js";

const MAX_PANES = 99;
const STORAGE_KEY = "ravtext.panes.state.v1";

let _paneIdCounter = 0;

function nextPaneId() {
  _paneIdCounter++;
  return `pane-${Date.now().toString(36)}-${_paneIdCounter}`;
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
    Superscript,
    Subscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ allowBase64: true }),
    Youtube.configure({ controls: true, nocookie: true }),
    StreamMark,
  ];
}

export class Pane {
  constructor({ id, streamCode, symbol, label, dir, markerBarCollapsed, onFocus, onChange }) {
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
    this.markerBarCollapsed = !!markerBarCollapsed;
    this._manager = null;
  }

  mount(parent) {
    this.element = document.createElement("section");
    this.element.className = "pane";
    this.element.dataset.paneId = this.id;

    const header = document.createElement("div");
    header.className = "pane-header";

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
      content: this.streamCode
        ? `<p>תוכן זרם ${this.streamCode}…</p>`
        : "<p>תוכן ראשי. לחץ \"טען דוגמה\" או הקלד.</p>",
      onFocus: () => this.onFocus(this),
      onUpdate: () => {
        this.onChange(this);
        this._save();
        this.updateMarkerBar();
      },
    });

    this.editor.storage.streamMark.symbol = this.symbol || null;
    this.editor.storage.streamMark.streamCode = this.streamCode || null;

    body.addEventListener("scroll", () => this._onScroll());
    body.addEventListener("contextmenu", (ev) => this._onContextMenu(ev));
    this.updateMarkerBar();
  }

  destroy() {
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
    if (this.editor && content) this.editor.commands.setContent(content);
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
    const maxScroll = body.scrollHeight - body.clientHeight;
    const fraction = maxScroll > 0 ? body.scrollTop / maxScroll : 0;
    for (const other of mgr.panes) {
      if (other === this || !other._body) continue;
      const otherMax = other._body.scrollHeight - other._body.clientHeight;
      other._body.scrollTop = fraction * otherMax;
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
    this._listeners = { change: [] };
    this.syncEnabled = false;
    this.syncBusy = false;
    this.lineMode = false;
    this.merged = false;

    container.addEventListener("pane-remove-request", (ev) => {
      this.removePane(ev.detail.id);
    });
  }

  on(event, fn) { this._listeners[event].push(fn); }
  _emit(event) { for (const fn of this._listeners[event] || []) fn(this); }

  count() { return this.panes.length; }

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

    if (this.panes.length >= 1) {
      const resizer = document.createElement("div");
      resizer.className = "resizer";
      this.container.appendChild(resizer);
      initResizer(resizer);
    }

    const onFocus = (p) => {
      this.activePane = p;
      this._emit("change");
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

    this._save();
    this._emit("change");
    this._refreshAllMarkerBars();
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

    if (pane.element && pane.element.previousElementSibling) {
      const sibling = pane.element.previousElementSibling;
      if (sibling.classList.contains("resizer")) {
        sibling.remove();
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
    return true;
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
    for (const p of [...this.panes]) p.destroy();
    this.container.innerHTML = "";
    this.panes = [];
    this.activePane = null;
    for (const ps of state.panes || []) {
      const pane = this.addPane({
        id: ps.id,
        streamCode: ps.streamCode,
        symbol: ps.symbol,
        label: ps.label,
        dir: ps.dir,
        markerBarCollapsed: ps.markerBarCollapsed,
      });
      if (pane && ps.content) pane.load(ps.content);
    }
    if (state.activeId) {
      const a = this.panes.find(p => p.id === state.activeId);
      if (a) this.activePane = a;
    }
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
    } catch (e) {
      console.warn("[paneManager] save failed:", e);
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      this.load(JSON.parse(raw));
      return true;
    } catch (e) {
      console.warn("[paneManager] load failed:", e);
      return false;
    }
  }

  clearStorage() {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}
