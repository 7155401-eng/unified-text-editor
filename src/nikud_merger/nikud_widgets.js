// nikud_widgets.js
// ================
// תרגום של ui/widgets_qt.py — שלושה ווידג'טים:
//   • HebrewTextBox — תיבת טקסט עם RTL אמיתי + סרגל כלים
//   • FilterPanel   — פאנל סינון עם 4 scopes
//   • DiffView      — תצוגת תוצאת מיזוג עם הדגשות צבעוניות

import {
  FilterConfig,
  SCOPE_OFF, SCOPE_VOC, SCOPE_CLEAN, SCOPE_BOTH,
  SCOPE_LABELS, SCOPE_LABELS_EN,
  SegmentKind,
  renderAsHtml, renderAsPlain,
} from "./nikud_client_engine.js";
import * as i18n from "./nikud_i18n.js";

const SCOPE_VALUES = [SCOPE_OFF, SCOPE_VOC, SCOPE_CLEAN, SCOPE_BOTH];

function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.id) e.id = opts.id;
  if (opts.title) e.title = opts.title;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  if (opts.type) e.type = opts.type;
  if (opts.value !== undefined) e.value = opts.value;
  if (opts.placeholder) e.placeholder = opts.placeholder;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.dataset) for (const [k, v] of Object.entries(opts.dataset)) e.dataset[k] = v;
  if (opts.css) for (const [k, v] of Object.entries(opts.css)) e.style.setProperty(k, v);
  if (opts.on) for (const [ev, fn] of Object.entries(opts.on)) e.addEventListener(ev, fn);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}

function scopeLabel(scope) {
  const labels = i18n.isRtl() ? SCOPE_LABELS : SCOPE_LABELS_EN;
  return labels[scope] || scope;
}

// ═══════════════════════════════════════════════════════════════════════════
//  HebrewTextBox
// ═══════════════════════════════════════════════════════════════════════════

export class HebrewTextBox {
  constructor({ label = "", accentClass = "accent-clean" } = {}) {
    this._labelText = label;
    this._direction = "rtl";
    this._listeners = [];

    this.root = el("div", { cls: `text-card frame-card ${accentClass}` });
    this._buildUi();
    this._applyDirection();
  }

  on(event, fn) { this._listeners.push([event, fn]); }
  _emit(event, ...args) {
    for (const [e, fn] of this._listeners) if (e === event) try { fn(...args); } catch (_) {}
  }

  _mkIconBtn(icon, tooltip, fn) {
    return el("button", {
      cls: "icon-btn",
      type: "button",
      title: tooltip,
      text: icon,
      on: { click: fn },
    });
  }

  _buildUi() {
    // header row
    const header = el("div", { cls: "text-card-header" });

    this.label = el("span", { cls: "label", text: this._labelText });

    this.loadBtn  = this._mkIconBtn("📂", i18n.t("tb_load_file"), () => this._loadFile());
    this.undoBtn  = this._mkIconBtn("⟲", i18n.t("tb_undo"),     () => this._undo());
    this.redoBtn  = this._mkIconBtn("⟳", i18n.t("tb_redo"),     () => this._redo());
    this.copyBtn  = this._mkIconBtn("⎘", i18n.t("tb_copy"),    () => this._copyAll());
    this.clearBtn = this._mkIconBtn("✕", i18n.t("tb_clear"),    () => this._clear());

    this.directionBtn = el("button", {
      cls: "direction-btn",
      type: "button",
      text: i18n.t("tb_rtl"),
      attrs: { "data-accent": "gold" },
      on: { click: () => this._toggleDirection() },
    });

    header.appendChild(this.label);
    const headerSpacer = el("span", { css: { flex: "1" } });
    header.appendChild(headerSpacer);
    for (const b of [this.loadBtn, this.undoBtn, this.redoBtn, this.copyBtn, this.clearBtn]) header.appendChild(b);
    header.appendChild(this.directionBtn);

    this.root.appendChild(header);

    this.text = el("textarea", {
      cls: "text-area",
      attrs: { spellcheck: "false", dir: "rtl" },
      on: {
        input: () => this._onTextChange(),
        contextmenu: (ev) => this._onContextMenu(ev),
      },
    });
    this.root.appendChild(this.text);

    this.wordCounter = el("span", { cls: "word-counter", text: "0 מילים ● 0 תווים" });
    this.root.appendChild(this.wordCounter);
  }

  _toggleDirection() {
    this._direction = this._direction === "rtl" ? "ltr" : "rtl";
    this._applyDirection();
  }

  _applyDirection() {
    if (this._direction === "rtl") {
      this.text.setAttribute("dir", "rtl");
      this.directionBtn.textContent = i18n.t("tb_rtl");
      this.directionBtn.setAttribute("data-accent", "gold");
    } else {
      this.text.setAttribute("dir", "ltr");
      this.directionBtn.textContent = i18n.t("tb_ltr");
      this.directionBtn.setAttribute("data-accent", "blue");
    }
  }

  _onTextChange() {
    const content = this.text.value;
    const chars = content.length;
    const words = content.split(/\s+/).filter(Boolean).length;
    if (i18n.isRtl()) this.wordCounter.textContent = `${words} מילים ● ${chars} תווים`;
    else this.wordCounter.textContent = `${words} words ● ${chars} chars`;
    this._emit("contentChanged");
  }

  _onContextMenu(ev) {
    // תפריט קליק-ימני מותאם — תואם לפייתון: cut / copy / paste / select all / undo / redo
    ev.preventDefault();

    // הסרת תפריט קודם (אם נשאר פתוח)
    if (this._activeMenu && this._activeMenu.parentNode) {
      this._activeMenu.parentNode.removeChild(this._activeMenu);
    }

    const menu = el("div", { cls: "hebrew-text-context-menu" });
    menu.style.cssText =
      "position:fixed;z-index:10000;min-width:160px;background:#162040;color:#FFF4CC;" +
      "border:1px solid #8B7333;border-radius:6px;padding:4px 0;" +
      "box-shadow:0 6px 20px rgba(0,0,0,0.45);font-family:'Segoe UI',sans-serif;font-size:10pt;" +
      "direction:" + (this._direction === "rtl" ? "rtl" : "ltr") + ";";
    if (document.body.classList.contains("theme-light") ||
        document.querySelector(".nikud-merger.theme-light")) {
      menu.style.background = "#FFFCF2";
      menu.style.color = "#2A1F0A";
      menu.style.borderColor = "#B8932E";
    }

    const addItem = (labelKey, action) => {
      const item = el("div", { cls: "ctx-item", text: i18n.t(labelKey) });
      item.style.cssText = "padding:6px 14px;cursor:pointer;";
      item.addEventListener("mouseenter", () => {
        item.style.background = "#C9A84C";
        item.style.color = "#0A1020";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "";
        item.style.color = "";
      });
      item.addEventListener("click", () => {
        try { this.text.focus(); } catch (_) {}
        try { action(); } catch (_) {}
        this._closeContextMenu();
      });
      menu.appendChild(item);
    };

    const addSep = () => {
      const sep = el("div");
      sep.style.cssText = "height:1px;background:#8B7333;margin:4px 8px;opacity:0.5;";
      menu.appendChild(sep);
    };

    addItem("menu_cut", () => {
      try { document.execCommand("cut"); } catch (_) {
        try {
          const start = this.text.selectionStart, end = this.text.selectionEnd;
          if (end > start) {
            const sel = this.text.value.slice(start, end);
            try { navigator.clipboard.writeText(sel); } catch (_) {}
            this.text.value = this.text.value.slice(0, start) + this.text.value.slice(end);
            this.text.selectionStart = this.text.selectionEnd = start;
            this._onTextChange();
          }
        } catch (_) {}
      }
    });
    addItem("menu_copy", () => {
      try { document.execCommand("copy"); } catch (_) {
        try {
          const start = this.text.selectionStart, end = this.text.selectionEnd;
          const sel = this.text.value.slice(start, end);
          if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        } catch (_) {}
      }
    });
    addItem("menu_paste", () => {
      try { document.execCommand("paste"); } catch (_) {
        try {
          navigator.clipboard.readText().then(text => {
            const start = this.text.selectionStart, end = this.text.selectionEnd;
            this.text.value = this.text.value.slice(0, start) + text + this.text.value.slice(end);
            this.text.selectionStart = this.text.selectionEnd = start + text.length;
            this._onTextChange();
          }).catch(() => {});
        } catch (_) {}
      }
    });
    addSep();
    addItem("menu_select_all", () => {
      try { this.text.select(); } catch (_) {}
    });
    addSep();
    addItem("menu_undo", () => {
      try { document.execCommand("undo"); } catch (_) {}
      this._onTextChange();
    });
    addItem("menu_redo", () => {
      try { document.execCommand("redo"); } catch (_) {}
      this._onTextChange();
    });

    document.body.appendChild(menu);
    this._activeMenu = menu;

    // מיקום — צמוד לעכבר, אך בתוך הוויופורט
    const pad = 6;
    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = menu.getBoundingClientRect();
    let x = ev.clientX, y = ev.clientY;
    if (x + rect.width + pad > vw) x = vw - rect.width - pad;
    if (y + rect.height + pad > vh) y = vh - rect.height - pad;
    menu.style.left = Math.max(pad, x) + "px";
    menu.style.top  = Math.max(pad, y) + "px";

    // סגירה בלחיצה במקום אחר / ESC
    const closer = (e) => {
      if (!menu.contains(e.target)) this._closeContextMenu();
    };
    const escer = (e) => {
      if (e.key === "Escape") this._closeContextMenu();
    };
    setTimeout(() => {
      document.addEventListener("mousedown", closer, { once: true });
      document.addEventListener("keydown", escer, { once: true });
    }, 0);
    this._activeMenuClosers = { closer, escer };
  }

  _closeContextMenu() {
    if (this._activeMenu && this._activeMenu.parentNode) {
      this._activeMenu.parentNode.removeChild(this._activeMenu);
    }
    this._activeMenu = null;
    if (this._activeMenuClosers) {
      try {
        document.removeEventListener("mousedown", this._activeMenuClosers.closer);
        document.removeEventListener("keydown", this._activeMenuClosers.escer);
      } catch (_) {}
      this._activeMenuClosers = null;
    }
  }

  _loadFile() {
    const input = el("input", { type: "file", attrs: { accept: ".txt,.md,text/*" } });
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      if (!f) { input.remove(); return; }
      // ננסה כמה קידודים — utf-8 ראשית
      const tryEncodings = ["utf-8", "windows-1255"];
      let content = null;
      for (const enc of tryEncodings) {
        try {
          const buf = await f.arrayBuffer();
          const dec = new TextDecoder(enc, { fatal: true });
          content = dec.decode(buf);
          break;
        } catch (_) { continue; }
      }
      if (content == null) {
        try {
          content = await f.text();
        } catch (_) {
          alert("Unknown encoding");
        }
      }
      if (content != null) this.setContent(content);
      input.remove();
    });
    input.click();
  }

  _clear() {
    if (this.text.value.trim()) {
      const msg = i18n.isRtl() ? "לנקות את התיבה?" : "Clear textbox?";
      if (!confirm(msg)) return;
    }
    this.text.value = "";
    this._onTextChange();
  }

  _copyAll() {
    try {
      navigator.clipboard.writeText(this.text.value);
    } catch (_) {
      this.text.select();
      try { document.execCommand("copy"); } catch (_) {}
    }
  }

  _undo() {
    // לטקסטערה אין API ישיר ל-undo, אבל ה-execCommand("undo") עדיין עובד
    // עבור הפוקוס הנוכחי. נדאג שהפוקוס יהיה על התיבה.
    try { this.text.focus(); } catch (_) {}
    try { document.execCommand("undo"); } catch (_) {}
    this._onTextChange();
  }

  _redo() {
    try { this.text.focus(); } catch (_) {}
    try { document.execCommand("redo"); } catch (_) {}
    this._onTextChange();
  }

  // API
  getContent() { return this.text.value; }
  setContent(content) { this.text.value = content || ""; this._onTextChange(); this._applyDirection(); }
  setLabel(t) { this._labelText = t; this.label.textContent = t; }
  getCursorOffset() { return this.text.selectionStart || 0; }
}


// ═══════════════════════════════════════════════════════════════════════════
//  FilterPanel
// ═══════════════════════════════════════════════════════════════════════════

export class FilterPanel {
  constructor(config) {
    this.config = config || new FilterConfig();
    this._dropdowns = {};
    this._boolChecks = {};
    this._listeners = [];
    this.root = el("div", { cls: "filter-panel-wrap frame-panel" });
    this._buildUi();
  }

  on(event, fn) { this._listeners.push([event, fn]); }
  _emit(event, ...args) {
    for (const [e, fn] of this._listeners) if (e === event) try { fn(...args); } catch (_) {}
  }

  _buildUi() {
    this.root.replaceChildren();

    // כותרת
    const title = el("div", {
      cls: "panel-title",
      text: "⚙  " + (i18n.isRtl() ? "הגדרות סינון" : "Filter Settings"),
    });
    this.root.appendChild(title);

    // הסבר
    const helpCard = el("div", { cls: "frame-panel" }, [
      el("div", { cls: "help-text", text: this._helpText() }),
    ]);
    this.root.appendChild(helpCard);

    // פריסטים
    const presets = el("div", { cls: "preset-row" });
    const loose = el("button", {
      type: "button",
      attrs: { "data-accent": "green" },
      text: "📖 " + (i18n.isRtl() ? "גמיש" : "Loose"),
      on: { click: () => this._applyPreset(FilterConfig.presetLoose()) },
    });
    const midrash = el("button", {
      type: "button",
      attrs: { "data-accent": "cyan" },
      text: "📚 " + (i18n.isRtl() ? "מדרש" : "Midrash"),
      on: { click: () => this._applyPreset(FilterConfig.presetMidrash()) },
    });
    const strict = el("button", {
      type: "button",
      attrs: { "data-accent": "red" },
      text: "🎯 " + (i18n.isRtl() ? "קפדני" : "Strict"),
      on: { click: () => this._applyPreset(FilterConfig.presetStrict()) },
    });
    for (const b of [loose, midrash, strict]) presets.appendChild(b);
    this.root.appendChild(presets);

    // ─── ניקוד וטעמים ───
    this._addSection(i18n.isRtl() ? "✎  ניקוד וטעמים" : "Nikud & Taamim", [
      ["nikud", i18n.isRtl() ? "ניקוד" : "Nikud"],
      ["taamim", i18n.isRtl() ? "טעמי מקרא" : "Taamim"],
    ]);

    this._addSection(i18n.isRtl() ? "⊙  פיסוק" : "Punctuation", [
      ["periods", i18n.isRtl() ? "נקודה ." : "Period ."],
      ["commas", i18n.isRtl() ? "פסיק ," : "Comma ,"],
      ["colons", i18n.isRtl() ? "נקודתיים :" : "Colons :"],
      ["semicolons", i18n.isRtl() ? "נקודה-פסיק ;" : "Semicolons ;"],
      ["dashes", i18n.isRtl() ? "מקפים – — -" : "Dashes – — -"],
      ["question_exclaim", "? !"],
    ]);

    this._addSection(i18n.isRtl() ? "❞  גרשיים" : "Quotes", [
      ["quotes", i18n.isRtl() ? "גרשיים \" '" : "Quotes \" '"],
      ["hebrew_geresh", i18n.isRtl() ? "גרשיים עבריים ׳ ״" : "Heb. quotes"],
      ["maqaf", i18n.isRtl() ? "מקף עברי ־" : "Heb. maqaf"],
    ]);

    this._addSection(i18n.isRtl() ? "◐  סוגריים" : "Brackets", [
      ["round_brackets", "( )"],
      ["square_brackets", "[ ]"],
      ["curly_brackets", "{ }"],
      ["angle_brackets", "< >"],
    ]);

    this._addSection(i18n.isRtl() ? "※  תווים מיוחדים" : "Special", [
      ["digits", "0-9"],
      ["latin_letters", "A-Z"],
      ["at_markers", "@06 @16"],
      ["asterisks", "*"],
      ["hashes", "#"],
    ]);

    this._addSection(i18n.isRtl() ? "↔  רווחים" : "Spaces", [
      ["extra_spaces", i18n.isRtl() ? "רווחים כפולים" : "Extra spaces"],
      ["line_breaks", i18n.isRtl() ? "ירידות שורה" : "Line breaks"],
    ]);

    // boolean section — גמישות מתקדמת
    const ktivLabel = i18n.isRtl()
      ? "התעלם מחסר/מלא (כתיב גמיש)"
      : "Ignore chaser/malei (flexible spelling)";
    const ktivTip = i18n.isRtl()
      ? "כשדלוק: מילה כמו 'דוד' תתאים ל'דויד' (השוואה לפי שלד — ו'/י' אמצעיות מתעלמים). כבוי = השוואה מדויקת לתו."
      : "When ON: words like 'dvd' match 'dvyd' (skeleton match — internal vav/yud ignored). OFF = exact letter match.";
    this._addBoolSection(i18n.isRtl() ? "✦  גמישות" : "Advanced", [
      ["flexible_ktiv", ktivLabel, ktivTip],
      ["case_insensitive_latin", "A=a", null],
    ]);
  }

  _helpText() {
    if (i18n.isRtl()) {
      return "לכל סוג תווים יש 4 מצבים:\n" +
             "• כבוי — נשאר בשניהם\n" +
             "• מנוקד — מוסר מהמנוקד בלבד\n" +
             "• מוגה — מוסר מהמוגה בלבד\n" +
             "• שניהם — מוסר משניהם";
    }
    return "Each char type has 4 modes:\n" +
           "• Off — kept in both\n" +
           "• Vocalized — removed from vocalized only\n" +
           "• Clean — removed from clean only\n" +
           "• Both — removed from both";
  }

  _addSection(title, items) {
    const card = el("div", { cls: "filter-section frame-panel" }, [
      el("div", { cls: "section-title", text: title }),
    ]);
    for (const [fieldKey, labelText] of items) {
      const row = el("div", { cls: "filter-row" });
      row.appendChild(el("span", { cls: "row-label", text: labelText }));
      const combo = el("select", { cls: "combo" });
      for (const s of SCOPE_VALUES) {
        combo.appendChild(el("option", { value: s, text: scopeLabel(s) }));
      }
      const current = this.config[fieldKey] !== undefined ? this.config[fieldKey] : SCOPE_OFF;
      combo.value = SCOPE_VALUES.includes(current) ? current : SCOPE_OFF;
      combo.addEventListener("change", () => this._onScopeChange(fieldKey, combo.value));
      this._dropdowns[fieldKey] = combo;
      row.appendChild(combo);
      card.appendChild(row);
    }
    this.root.appendChild(card);
  }

  _addBoolSection(title, items) {
    const card = el("div", { cls: "filter-section frame-panel" }, [
      el("div", { cls: "section-title", text: title }),
    ]);
    for (const item of items) {
      const key = item[0];
      const label = item[1];
      const tip = item[2];
      const cb = el("input", { type: "checkbox" });
      cb.checked = !!this.config[key];
      cb.addEventListener("change", () => this._onBoolChange(key, cb.checked));
      this._boolChecks[key] = cb;
      const lbl = el("label", { cls: "checkbox bool-row" }, [cb, document.createTextNode(label)]);
      if (tip) lbl.title = tip;
      card.appendChild(lbl);
    }
    this.root.appendChild(card);
  }

  _onScopeChange(fieldKey, scope) {
    this.config[fieldKey] = scope;
    this._emit("configChanged", this.config);
  }

  _onBoolChange(key, val) {
    this.config[key] = !!val;
    this._emit("configChanged", this.config);
  }

  _applyPreset(preset) {
    this.config = preset;
    for (const [key, combo] of Object.entries(this._dropdowns)) {
      const s = preset[key] !== undefined ? preset[key] : SCOPE_OFF;
      combo.value = SCOPE_VALUES.includes(s) ? s : SCOPE_OFF;
    }
    for (const [key, cb] of Object.entries(this._boolChecks)) {
      cb.checked = !!preset[key];
    }
    this._emit("configChanged", this.config);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  DiffView
// ═══════════════════════════════════════════════════════════════════════════

export class DiffView {
  constructor() {
    this.currentResult = null;
    this._hideSpelling = false;
    this._listeners = [];
    this.root = el("div", { cls: "diff-view frame-card accent-result" });
    this._buildUi();
  }

  on(event, fn) { this._listeners.push([event, fn]); }
  _emit(event, ...args) {
    for (const [e, fn] of this._listeners) if (e === event) try { fn(...args); } catch (_) {}
  }

  _buildUi() {
    const header = el("div", { cls: "header-row" });
    const title = el("span", { cls: "title", text: i18n.t("result_label") });
    this.statsLabel = el("span", { cls: "stats-label", text: "" });

    const nav = el("div", { cls: "nav-row" });
    for (const [icon, fn] of [
      ["⏮", () => this.gotoFirst()],
      ["◀", () => this.gotoPrev()],
      ["▶", () => this.gotoNext()],
      ["⏭", () => this.gotoLast()],
    ]) {
      nav.appendChild(el("button", { type: "button", text: icon, on: { click: fn } }));
    }
    header.appendChild(title);
    header.appendChild(this.statsLabel);
    header.appendChild(nav);
    this.root.appendChild(header);

    this.text = el("div", {
      cls: "result-text",
      attrs: { contenteditable: "true", dir: "rtl", spellcheck: "false" },
    });
    this.root.appendChild(this.text);

    this._actionButtons = [];

    // row 1
    const row1 = el("div", { cls: "actions-row" });
    for (const [key, fn, accent] of [
      ["accept_all", () => this.acceptAll(), "green"],
      ["reject_all", () => this.rejectAll(), "red"],
      ["accept_spelling", () => this.acceptSpelling(), "purple"],
      ["toggle_hide", () => this.toggleHideSpelling(), null],
    ]) {
      const b = el("button", { type: "button", text: i18n.t(key), on: { click: fn } });
      if (accent) b.setAttribute("data-accent", accent);
      b.disabled = true;
      this._actionButtons.push(b);
      row1.appendChild(b);
    }
    this.root.appendChild(row1);

    // row 2
    const row2 = el("div", { cls: "actions-row" });
    for (const [key, fn, accent] of [
      ["accept_selected", () => this.acceptSelected(), "cyan"],
      ["reject_selected", () => this.rejectSelected(), null],
      ["copy_all", () => this.copyResult(), null],
      ["to_master", () => this.appendToMaster(), null],
    ]) {
      const b = el("button", { type: "button", text: i18n.t(key), on: { click: fn } });
      if (accent) b.setAttribute("data-accent", accent);
      b.disabled = true;
      this._actionButtons.push(b);
      row2.appendChild(b);
    }
    this.root.appendChild(row2);

    // row 3 — export
    const row3 = el("div", { cls: "actions-row" });
    row3.appendChild(el("span", { cls: "export-label", text: i18n.t("export_label") }));
    for (const [key, fn, accent] of [
      ["export_word", () => this.exportWord(), "blue"],
      ["export_html", () => this.exportHtml(), null],
      ["export_txt", () => this.exportPlain(), null],
    ]) {
      const b = el("button", { type: "button", text: i18n.t(key), on: { click: fn } });
      if (accent) b.setAttribute("data-accent", accent);
      b.disabled = true;
      this._actionButtons.push(b);
      row3.appendChild(b);
    }
    this.root.appendChild(row3);
  }

  // API
  clear() {
    this.text.replaceChildren();
    this.statsLabel.textContent = "";
    this.currentResult = null;
    for (const b of this._actionButtons) b.disabled = true;
  }

  setStatus(t) { this.statsLabel.textContent = t; }

  displayResult(result) {
    this.currentResult = result;
    this.text.replaceChildren();
    this._renderSegments();

    if (result.stopped) {
      this.statsLabel.textContent = i18n.t("stopped_partial", { n: result.matchCount });
    } else {
      const ratio = Math.round(result.matchRatio * 1000) / 10; // 1 decimal
      this.statsLabel.textContent = i18n.t("done", {
        m: result.matchCount, t: result.cleanWordCount,
        p: ratio, v: result.vocWordCount,
      });
    }

    for (const b of this._actionButtons) b.disabled = false;
  }

  _renderSegments() {
    if (!this.currentResult) return;
    const frag = document.createDocumentFragment();
    for (const seg of this.currentResult.segments) {
      if (seg.kind === SegmentKind.PASSTHROUGH) {
        frag.appendChild(this._span("seg-passthrough", seg.text));
      } else if (seg.kind === SegmentKind.UNCHANGED) {
        frag.appendChild(this._span("seg-unchanged", seg.text));
      } else if (seg.kind === SegmentKind.INSERTED) {
        frag.appendChild(this._span("seg-inserted", seg.text));
      } else if (seg.kind === SegmentKind.DELETED) {
        if (!this._hideSpelling) frag.appendChild(this._span("seg-deleted", seg.text));
      } else if (seg.kind === SegmentKind.SPELLING_DIFF) {
        if (this._hideSpelling) {
          frag.appendChild(this._span("seg-unchanged", seg.text));
        } else {
          frag.appendChild(this._span("seg-spell-old", seg.original));
          frag.appendChild(this._span("seg-spell-new", seg.text));
        }
      }
    }
    this.text.appendChild(frag);
  }

  _span(cls, text) {
    return el("span", { cls, text });
  }

  acceptAll() {
    if (!this.currentResult) return;
    this.text.replaceChildren(document.createTextNode(renderAsPlain(this.currentResult, true)));
  }

  rejectAll() {
    if (!this.currentResult) return;
    this.text.replaceChildren(document.createTextNode(renderAsPlain(this.currentResult, false)));
  }

  acceptSpelling() {
    if (!this.currentResult) return;
    this.text.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const seg of this.currentResult.segments) {
      if (seg.kind === SegmentKind.PASSTHROUGH ||
          seg.kind === SegmentKind.UNCHANGED ||
          seg.kind === SegmentKind.SPELLING_DIFF) {
        frag.appendChild(this._span("seg-unchanged", seg.text));
      } else if (seg.kind === SegmentKind.INSERTED) {
        frag.appendChild(this._span("seg-inserted", seg.text));
      } else if (seg.kind === SegmentKind.DELETED) {
        frag.appendChild(this._span("seg-deleted", seg.text));
      }
    }
    this.text.appendChild(frag);
  }

  toggleHideSpelling() {
    this._hideSpelling = !this._hideSpelling;
    this.text.replaceChildren();
    this._renderSegments();
  }

  acceptSelected() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!this.text.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== this.text) return;
    // המרה ל-text רגיל
    const text = sel.toString();
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    sel.removeAllRanges();
  }

  rejectSelected() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!this.text.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== this.text) return;
    range.deleteContents();
    sel.removeAllRanges();
  }

  copyResult() {
    const text = this.text.innerText || "";
    try { navigator.clipboard.writeText(text); }
    catch (_) {
      const range = document.createRange();
      range.selectNodeContents(this.text);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      try { document.execCommand("copy"); } catch (_) {}
      sel.removeAllRanges();
    }
  }

  appendToMaster() {
    this._emit("appendToMaster", this.text.innerText || "");
  }

  gotoNext() { /* placeholder — תואם למקור */ }
  gotoPrev() { /* placeholder */ }
  gotoFirst() {
    this.text.scrollTop = 0;
    const sel = window.getSelection(); sel.removeAllRanges();
    const range = document.createRange();
    range.setStart(this.text, 0); range.collapse(true);
    sel.addRange(range);
  }
  gotoLast() {
    this.text.scrollTop = this.text.scrollHeight;
    const sel = window.getSelection(); sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(this.text);
    range.collapse(false);
    sel.addRange(range);
  }

  _defaultExportName(ext) {
    const baseName = "מיזוג מרב טקסט לוורד";
    return `${baseName}.${ext}`;
  }

  _saveFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = el("a", { attrs: { href: url, download: filename } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  exportWord() {
    if (!this.currentResult) return;
    const htmlBody = renderAsHtml(this.currentResult).replace(/\n/g, "<br>");
    const html =
      "<html xmlns:w='urn:schemas-microsoft-com:office:word' " +
      "xmlns='http://www.w3.org/TR/REC-html40'>" +
      "<head><meta charset='utf-8'><style>" +
      "body { font-family: David, sans-serif; direction: rtl; font-size: 14pt; }" +
      "ins { background: #e6ffe6; border-bottom: 2px solid green; }" +
      "del { background: #ffe6e6; color: #b00; }" +
      "</style></head><body>" + htmlBody + "</body></html>";
    this._saveFile(this._defaultExportName("doc"), html, "application/msword");
  }

  exportHtml() {
    if (!this.currentResult) return;
    const htmlBody = renderAsHtml(this.currentResult).replace(/\n/g, "<br>");
    const html =
      "<!DOCTYPE html><html dir='rtl' lang='he'><head><meta charset='utf-8'>" +
      "<style>body { font-family: David, Narkisim, serif; direction: rtl; " +
      "font-size: 16pt; max-width: 900px; margin: 2em auto; }" +
      "ins { background: #e6ffe6; border-bottom: 2px solid green; }" +
      "del { background: #ffe6e6; color: #b00; }" +
      "h1 { color: #c9a84c; text-align: center; }</style></head>" +
      `<body><h1>תוצאת מיזוג</h1>${htmlBody}</body></html>`;
    this._saveFile(this._defaultExportName("html"), html, "text/html;charset=utf-8");
  }

  exportPlain() {
    if (!this.currentResult) return;
    const text = renderAsPlain(this.currentResult, true);
    this._saveFile(this._defaultExportName("txt"), text, "text/plain;charset=utf-8");
  }
}
