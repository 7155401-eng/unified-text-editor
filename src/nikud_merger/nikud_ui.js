// nikud_ui.js
// ============
// תרגום של ui/main_view_qt.py + ui/merger_tab_qt.py:
//   • MergerTab — חלון מיזוג עם מוגה + מקורות + סינון + תוצאה
//   • MainView  — המסגרת: סרגל פרויקט + שפה + thema + טקסט מוכן

import {
  FilterConfig, SCOPE_OFF,
  merge, mergeAllSources, SegmentKind, makeSegment,
  checkText, summarizeIssues,
  saveProject, loadProject, autosave, loadAutosave,
  makeProjectData, makeTabData,
} from "./nikud_engine.js";
import * as i18n from "./nikud_i18n.js";
import * as theme from "./nikud_theme.js";
import { HebrewTextBox, FilterPanel, DiffView } from "./nikud_widgets.js";


function el(tag, opts = {}, children = []) {
  const e = document.createElement(tag);
  if (opts.cls) e.className = opts.cls;
  if (opts.id) e.id = opts.id;
  if (opts.title) e.title = opts.title;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.html !== undefined) e.innerHTML = opts.html;
  if (opts.type) e.type = opts.type;
  if (opts.value !== undefined) e.value = opts.value;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.css) for (const [k, v] of Object.entries(opts.css)) e.style.setProperty(k, v);
  if (opts.on) for (const [ev, fn] of Object.entries(opts.on)) e.addEventListener(ev, fn);
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else e.appendChild(c);
  }
  return e;
}


// ═══════════════════════════════════════════════════════════════════════════
//  MergerTab
// ═══════════════════════════════════════════════════════════════════════════

const FILTER_FIELDS_FOR_SUMMARY = [
  "nikud", "taamim", "periods", "commas", "colons", "semicolons",
  "dashes", "question_exclaim", "quotes", "hebrew_geresh", "maqaf",
  "round_brackets", "square_brackets", "curly_brackets",
  "angle_brackets", "digits", "latin_letters", "at_markers",
  "asterisks", "hashes", "extra_spaces", "line_breaks",
];

export class MergerTab {
  constructor() {
    this._listeners = [];
    this.stopFlag = null;
    this.filterConfig = new FilterConfig();
    this._sources = [];        // {tb: HebrewTextBox, wrapper: HTMLElement, name: string, closeBtn: HTMLElement|null}
    this._sourceCounter = 0;
    this._orientation = "horizontal";
    this._showFilters = false;
    this.filterPanel = null;
    this._mergeMode = "word";  // word / char

    this.root = el("div", { cls: "merger-tab frame-panel" });
    this._buildUi();
  }

  on(event, fn) { this._listeners.push([event, fn]); }
  _emit(event, ...args) {
    for (const [e, fn] of this._listeners) if (e === event) try { fn(...args); } catch (_) {}
  }

  _tAddSource() { return i18n.isRtl() ? "➕ הוסף מקור" : "➕ Add Source"; }
  _tOrient() {
    if (i18n.isRtl()) return this._orientation === "horizontal" ? "⇄ אופקי" : "⇅ אנכי";
    return this._orientation === "horizontal" ? "⇄ Horizontal" : "⇅ Vertical";
  }
  _tModeBtn() {
    if (i18n.isRtl()) return this._mergeMode === "word" ? "🔤 רמת מילה" : "🔠 רמת תו";
    return this._mergeMode === "word" ? "🔤 Word level" : "🔠 Char level";
  }

  _buildUi() {
    // mode bar
    const modeBar = el("div", { cls: "mode-bar" });

    this.addSourceBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "blue" },
      text: this._tAddSource(),
      on: { click: () => this._addSource() },
    });
    this.orientBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "cyan" },
      text: this._tOrient(),
      on: { click: () => this._toggleOrientation() },
    });
    this.modeBtn = el("button", {
      cls: "mode-btn",
      type: "button",
      text: this._tModeBtn(),
      on: { click: () => this._toggleMergeMode() },
    });
    this.filterToggleBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "purple" },
      text: i18n.t("filter_settings"),
      on: { click: () => this._toggleFilterPanel() },
    });
    this.qualityBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "green" },
      text: i18n.t("check_quality"),
      on: { click: () => this._checkQuality() },
    });

    this.filterSummary = el("span", { cls: "filter-summary", text: "" });

    modeBar.appendChild(this.addSourceBtn);
    modeBar.appendChild(this.orientBtn);
    modeBar.appendChild(this.modeBtn);
    modeBar.appendChild(this.filterToggleBtn);
    modeBar.appendChild(this.qualityBtn);
    modeBar.appendChild(this.filterSummary);
    this.root.appendChild(modeBar);

    // body row: input area | (filter panel)
    this.bodyRow = el("div", { cls: "body-row" });

    this.inputArea = el("div", { cls: "input-area horizontal" });

    this.cleanBox = new HebrewTextBox({
      label: i18n.t("clean_label"),
      accentClass: "accent-clean",
    });
    this.cleanBox.root.style.flex = "1 1 0";

    this.sourcesContainer = el("div", { cls: "sources-container horizontal" });
    this.inputArea.appendChild(this.cleanBox.root);
    this.inputArea.appendChild(this.sourcesContainer);

    this._addSource();  // מקור ראשון

    this.bodyRow.appendChild(this.inputArea);
    this.root.appendChild(this.bodyRow);

    // control bar
    const control = el("div", { cls: "control-bar frame-card" });
    this.mergeBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "gold" },
      text: i18n.t("merge"),
      on: { click: () => this.startMerge(false) },
    });
    this.mergeCursorBtn = el("button", {
      type: "button",
      text: i18n.t("merge_from_cursor"),
      on: { click: () => this.startMerge(true) },
    });
    this.stopBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "red" },
      text: i18n.t("stop"),
      on: { click: () => this.stopMerge() },
    });
    this.stopBtn.disabled = true;

    this.progressBar = el("progress", { cls: "progress-bar", attrs: { value: "0", max: "100" } });

    control.appendChild(this.mergeBtn);
    control.appendChild(this.mergeCursorBtn);
    control.appendChild(this.stopBtn);
    control.appendChild(this.progressBar);
    this.root.appendChild(control);

    // diff view
    this.diffView = new DiffView();
    this.diffView.on("appendToMaster", (txt) => this._emit("appendToMaster", txt));
    this.root.appendChild(this.diffView.root);

    this._updateFilterSummary();
  }

  _toggleMergeMode() {
    this._mergeMode = this._mergeMode === "word" ? "char" : "word";
    this.modeBtn.textContent = this._tModeBtn();
    this.modeBtn.classList.toggle("checked", this._mergeMode === "char");
  }

  _addSource() {
    this._sourceCounter += 1;
    const name = i18n.isRtl()
      ? `מקור ${this._sourceCounter}`
      : `Source ${this._sourceCounter}`;

    const wrapper = el("div", { cls: "source-wrapper" });

    const tb = new HebrewTextBox({
      label: `  ☆  ${name}`,
      accentClass: "accent-source",
    });
    wrapper.appendChild(tb.root);

    let closeBtn = null;
    if (this._sources.length > 0) {
      closeBtn = el("button", {
        cls: "source-close-btn",
        type: "button",
        text: "✕",
        on: { click: () => this._closeSource(wrapper) },
      });
      wrapper.appendChild(closeBtn);
    }

    this._sources.push({ tb, wrapper, name, closeBtn });
    this.sourcesContainer.appendChild(wrapper);
    return tb;
  }

  _closeSource(wrapper) {
    const idx = this._sources.findIndex(s => s.wrapper === wrapper);
    if (idx <= 0) return;  // המקור הראשון לא נמחק
    wrapper.remove();
    this._sources.splice(idx, 1);
  }

  _toggleOrientation() {
    this._orientation = this._orientation === "horizontal" ? "vertical" : "horizontal";
    this.orientBtn.textContent = this._tOrient();
    this.inputArea.classList.toggle("horizontal", this._orientation === "horizontal");
    this.inputArea.classList.toggle("vertical", this._orientation === "vertical");
    this.sourcesContainer.classList.toggle("horizontal", this._orientation === "horizontal");
    this.sourcesContainer.classList.toggle("vertical", this._orientation === "vertical");
  }

  _toggleFilterPanel() {
    this._showFilters = !this._showFilters;
    if (this._showFilters) {
      if (!this.filterPanel) {
        this.filterPanel = new FilterPanel(this.filterConfig);
        this.filterPanel.on("configChanged", (cfg) => this._onFilterChange(cfg));
        const wrap = el("div", { cls: "filter-panel-wrap" });
        wrap.appendChild(this.filterPanel.root);
        this._filterPanelWrap = wrap;
      }
      this.bodyRow.appendChild(this._filterPanelWrap);
      this.bodyRow.classList.add("has-filters");
      this.filterToggleBtn.textContent = i18n.t("close_filters");
    } else {
      if (this._filterPanelWrap && this._filterPanelWrap.parentNode) {
        this._filterPanelWrap.parentNode.removeChild(this._filterPanelWrap);
      }
      this.bodyRow.classList.remove("has-filters");
      this.filterToggleBtn.textContent = i18n.t("filter_settings");
    }
  }

  _onFilterChange(config) {
    this.filterConfig = config;
    this._updateFilterSummary();
  }

  _updateFilterSummary() {
    const c = this.filterConfig;
    let active = 0;
    for (const f of FILTER_FIELDS_FOR_SUMMARY) {
      const v = c[f] !== undefined ? c[f] : SCOPE_OFF;
      if (v !== SCOPE_OFF) active += 1;
    }
    this.filterSummary.textContent = i18n.t("filter_summary", { n: active });
  }

  _checkQuality() {
    if (this._sources.length === 0) return;
    const text = this._sources[0].tb.getContent();
    if (!text.trim()) return;
    const issues = checkText(text);
    const summary = summarizeIssues(issues);
    if (summary.total === 0) {
      alert(i18n.isRtl() ? "לא נמצאו בעיות ניקוד." : "No nikud issues.");
      return;
    }
    const lines = [];
    if (i18n.isRtl()) {
      lines.push(`נמצאו ${summary.total} בעיות:`);
      lines.push(`• ללא ניקוד: ${summary.no_nikud}`);
      lines.push(`• חלקי: ${summary.partial_nikud}`);
    } else {
      lines.push(`${summary.total} issues:`);
      lines.push(`• No nikud: ${summary.no_nikud}`);
      lines.push(`• Partial: ${summary.partial_nikud}`);
    }
    for (const issue of issues.slice(0, 15)) lines.push(`  ${issue.word}`);
    alert(lines.join("\n"));
  }

  // === מצב ===
  getState() {
    return {
      clean_text: this.cleanBox.getContent(),
      vocalized_sources: this._sources.map(s => ({ name: s.name, text: s.tb.getContent() })),
      filter_config: this.filterConfig.toDict(),
      orientation: this._orientation,
    };
  }

  setState(state) {
    this.cleanBox.setContent(state.clean_text || "");
    const sources = state.vocalized_sources || [];
    // מחיקת קיימים
    for (const s of this._sources) s.wrapper.remove();
    this._sources = [];
    this._sourceCounter = 0;
    for (const s of sources) {
      const tb = this._addSource();
      tb.setContent(s.text || "");
    }
    if (sources.length === 0) this._addSource();

    if (state.filter_config) {
      this.filterConfig = FilterConfig.fromDict(state.filter_config);
      this._updateFilterSummary();
    }
    const orient = state.orientation || "horizontal";
    if (orient !== this._orientation) {
      this._orientation = orient;
      this.orientBtn.textContent = this._tOrient();
      this.inputArea.classList.toggle("horizontal", this._orientation === "horizontal");
      this.inputArea.classList.toggle("vertical", this._orientation === "vertical");
      this.sourcesContainer.classList.toggle("horizontal", this._orientation === "horizontal");
      this.sourcesContainer.classList.toggle("vertical", this._orientation === "vertical");
    }
  }

  // === מיזוג ===
  startMerge(fromCursor = false) {
    let clean = this.cleanBox.getContent();
    if (!clean.trim()) {
      alert(i18n.t("empty_clean"));
      return;
    }
    const allSources = this._sources.map(s => [s.name, s.tb.getContent()]);
    let sources = allSources.filter(([, t]) => t.trim());

    const diag = i18n.isRtl()
      ? `מקורות מחוברים: ${this._sources.length}, עם תוכן: ${sources.length} | מצב: ${this._mergeMode}`
      : `Sources connected: ${this._sources.length}, with content: ${sources.length} | mode: ${this._mergeMode}`;
    this.diffView.setStatus(diag);

    if (sources.length === 0) {
      alert(i18n.t("empty_voc"));
      return;
    }

    if (fromCursor) {
      if (sources.length > 1) {
        alert(i18n.isRtl() ? "מיזוג מהסמן רק עם מקור יחיד." : "Cursor merge only works with a single source.");
        return;
      }
      const cOff = this.cleanBox.getCursorOffset();
      const vOff = this._sources[0].tb.getCursorOffset();
      clean = clean.slice(cOff);
      const voc = sources[0][1].slice(vOff);
      if (!clean.trim() || !voc.trim()) {
        alert(i18n.t("cursor_msg"));
        return;
      }
      sources = [[sources[0][0], voc]];
    }

    this.mergeBtn.disabled = true;
    this.mergeCursorBtn.disabled = true;
    this.stopBtn.disabled = false;
    this.progressBar.value = 0;
    this.diffView.clear();
    this.diffView.setStatus(i18n.t("processing"));

    this.stopFlag = { stop: false };

    // הפעלה אסינכרונית — לא חוסמת UI
    setTimeout(() => this._runMerge(clean, sources), 10);
  }

  _runMerge(clean, sources) {
    try {
      const onProgress = (pct) => {
        this.progressBar.value = pct;
      };
      let result;
      if (sources.length === 1) {
        result = merge(clean, sources[0][1], {
          config: this.filterConfig,
          progressCallback: onProgress,
          stopFlag: this.stopFlag,
          mode: this._mergeMode,
        });
      } else {
        const mr = mergeAllSources(clean, sources, {
          config: this.filterConfig,
          progressCallback: onProgress,
          stopFlag: this.stopFlag,
          mode: this._mergeMode,
        });
        const segments = [];
        let matchCount = 0;
        for (const seg of mr.segments) {
          segments.push(makeSegment(seg.kind, seg.text, seg.original));
          if (seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF) {
            matchCount += 1;
          }
        }
        const cleanWordCount = clean.split(/\s+/).filter(Boolean).length;
        let vocWordCount = 0;
        for (const [, t] of sources) vocWordCount += t.split(/\s+/).filter(Boolean).length;
        result = {
          segments, matchCount, cleanWordCount, vocWordCount, stopped: false,
          get matchRatio() { return this.matchCount / Math.max(1, this.cleanWordCount); },
        };
        result._sourceStats = mr.statsPerSource;
      }
      this._onDone(result);
    } catch (err) {
      this._onError(String(err && err.message || err));
    }
  }

  _onDone(result) {
    this.progressBar.value = 100;
    this.diffView.displayResult(result);
    if (result._sourceStats) {
      const statsText = result._sourceStats
        .map(s => `${s.source}: ${s.matched}`)
        .join(" | ");
      const current = this.diffView.statsLabel.textContent;
      this.diffView.statsLabel.textContent = `${current}  ◆  ${statsText}`;
    }
    this.mergeBtn.disabled = false;
    this.mergeCursorBtn.disabled = false;
    this.stopBtn.disabled = true;
  }

  _onError(msg) {
    alert(`${i18n.t("error")}: ${msg}`);
    this.mergeBtn.disabled = false;
    this.mergeCursorBtn.disabled = false;
    this.stopBtn.disabled = true;
  }

  stopMerge() {
    if (this.stopFlag) this.stopFlag.stop = true;
    this.diffView.setStatus(i18n.t("stopping"));
  }

  refreshLanguage() {
    // עדכון טקסטים שנקבעו בעבר
    this.addSourceBtn.textContent = this._tAddSource();
    this.orientBtn.textContent = this._tOrient();
    this.modeBtn.textContent = this._tModeBtn();
    this.filterToggleBtn.textContent = this._showFilters
      ? i18n.t("close_filters") : i18n.t("filter_settings");
    this.qualityBtn.textContent = i18n.t("check_quality");
    this.mergeBtn.textContent = i18n.t("merge");
    this.mergeCursorBtn.textContent = i18n.t("merge_from_cursor");
    this.stopBtn.textContent = i18n.t("stop");
    this._updateFilterSummary();
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  MainView
// ═══════════════════════════════════════════════════════════════════════════

const AUTOSAVE_INTERVAL_MS = 60_000;

export class MainView {
  constructor() {
    this._currentProjectName = "";
    this.root = el("div", { cls: `nikud-merger theme-${theme.currentMode()}` });
    this._buildUi();
    this._applyThemeInline();

    i18n.registerListener(() => this._refreshLanguage());

    // autosave
    this._autosaveTimer = setInterval(() => this._doAutosave(), AUTOSAVE_INTERVAL_MS);

    // קיצורי מקלדת על המודאל
    this.root.addEventListener("keydown", (ev) => this._onKeyDown(ev));
    this.root.tabIndex = 0;
  }

  _onKeyDown(ev) {
    if (ev.ctrlKey || ev.metaKey) {
      if (ev.key === "n" || ev.key === "N") { ev.preventDefault(); this.newProject(); return; }
      if (ev.key === "o" || ev.key === "O") { ev.preventDefault(); this.openProject(); return; }
      if (ev.key === "s" || ev.key === "S") { ev.preventDefault(); this.saveProject(); return; }
      if (ev.key === "l" || ev.key === "L") { ev.preventDefault(); this._toggleLanguage(); return; }
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      this._emit("close");
    }
  }

  _listeners = [];
  on(event, fn) { this._listeners.push([event, fn]); }
  _emit(event, ...args) {
    for (const [e, fn] of this._listeners) if (e === event) try { fn(...args); } catch (_) {}
  }

  _buildUi() {
    // Toolbar
    this.toolbar = el("div", { cls: "toolbar-top" });

    this.newBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "gold" },
      text: i18n.t("new_project"),
      on: { click: () => this.newProject() },
    });
    this.openBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "blue" },
      text: i18n.t("open_project"),
      on: { click: () => this.openProject() },
    });
    this.saveBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "green" },
      text: i18n.t("save_project"),
      on: { click: () => this.saveProject() },
    });
    this.saveAsBtn = el("button", {
      type: "button",
      text: i18n.t("save_as"),
      on: { click: () => this.saveProjectAs() },
    });

    this.projectLabel = el("span", { cls: "label", text: i18n.t("untitled_project") });

    this.langBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "purple" },
      text: i18n.t("lang_toggle"),
      on: { click: () => this._toggleLanguage() },
    });

    this.themeBtn = el("button", {
      type: "button",
      text: this._themeBtnText(),
      on: { click: () => this._toggleTheme() },
    });
    this.themeBtn.style.cssText = this._themeBtnStyle();

    this.closeBtn = el("button", {
      cls: "close-modal-btn",
      type: "button",
      text: "✕",
      title: i18n.isRtl() ? "סגור חלון" : "Close",
      on: { click: () => this._emit("close") },
    });

    for (const b of [this.newBtn, this.openBtn, this.saveBtn, this.saveAsBtn]) this.toolbar.appendChild(b);
    this.toolbar.appendChild(this.projectLabel);
    this.toolbar.appendChild(el("span", { cls: "spacer" }));
    this.toolbar.appendChild(this.themeBtn);
    this.toolbar.appendChild(this.langBtn);
    this.toolbar.appendChild(this.closeBtn);
    this.root.appendChild(this.toolbar);

    // Title
    this.titleFrame = el("div", { cls: "title-frame" });
    this.titleLbl = el("span", { cls: "label label-title title-lbl", text: `✧  ${i18n.t("app_title")}  ✧` });
    this.subtitleLbl = el("span", { cls: "label subtitle-lbl", text: i18n.t("app_subtitle") });
    this.titleFrame.appendChild(this.titleLbl);
    this.titleFrame.appendChild(this.subtitleLbl);
    this.root.appendChild(this.titleFrame);

    // Merger inside scroll area
    this.scroll = el("div", { cls: "scroll-area" });
    this.merger = new MergerTab();
    this.merger.on("appendToMaster", (t) => this._appendToMaster(t));
    this.scroll.appendChild(this.merger.root);
    this.root.appendChild(this.scroll);

    // Master text section
    this._buildMasterSection();
  }

  _buildMasterSection() {
    this.masterCard = el("div", { cls: "master-section" });

    const header = el("div", { cls: "header-row" });
    this.masterTitle = el("span", { cls: "label title", text: "📜 " + i18n.t("master_label") });

    this.masterCopyBtn = el("button", {
      type: "button",
      text: i18n.t("master_copy"),
      on: { click: () => this._copyMaster() },
    });
    this.masterSaveBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "green" },
      text: i18n.t("master_save"),
      on: { click: () => this._saveMaster() },
    });
    this.masterClearBtn = el("button", {
      type: "button",
      attrs: { "data-accent": "red" },
      text: i18n.t("master_clear"),
      on: { click: () => this._clearMaster() },
    });

    header.appendChild(this.masterTitle);
    header.appendChild(el("span", { css: { flex: "1" } }));
    header.appendChild(this.masterCopyBtn);
    header.appendChild(this.masterSaveBtn);
    header.appendChild(this.masterClearBtn);
    this.masterCard.appendChild(header);

    this.masterText = el("textarea", {
      cls: "master-text text-area",
      attrs: { dir: "rtl", spellcheck: "false" },
    });
    this.masterCard.appendChild(this.masterText);

    this.root.appendChild(this.masterCard);
  }

  // ── theme ──
  _themeBtnText() {
    if (theme.currentMode() === "dark") return i18n.isRtl() ? "מצב בהיר" : "Light Mode";
    return i18n.isRtl() ? "מצב כהה" : "Dark Mode";
  }
  _themeBtnStyle() {
    // משה 2026-05-08: כפתור החלפת מצב משתמש בצבעי האתר (var(--gold) וכו').
    return `background:var(--gold);color:var(--panel);border:2px solid var(--gold);border-radius:7px;padding:4px 12px;font-weight:bold;`;
  }
  _toggleTheme() {
    // משה 2026-05-08: מעבר ערכת נושא בכלי = מעבר ערכת נושא של האתר כולו.
    // כך הכלי תמיד מסונכרן עם האתר, וכל שינוי כאן או באתר חל בכל מקום.
    const newMode = theme.currentMode() === "dark" ? "light" : "dark";
    theme.setMode(newMode);
    if (typeof document !== "undefined" && document.body) {
      document.body.classList.toggle("light-theme", newMode === "light");
    }
    this.root.classList.toggle("theme-dark", newMode === "dark");
    this.root.classList.toggle("theme-light", newMode === "light");
    this.themeBtn.textContent = this._themeBtnText();
    this.themeBtn.style.cssText = this._themeBtnStyle();
    this._applyThemeInline();
  }
  _applyThemeInline() {
    // משה 2026-05-08: inline styles הוסרו — מסתמכים על משתני CSS של האתר
    // (--bg, --panel, --gold וכו') שמתחלפים אוטומטית עם body.light-theme.
    // אם בעתיד נצטרך התאמה מקומית, עדיף לעשותה ב-CSS עם class, לא inline.
    this.titleLbl.style.fontSize = "22pt";
    this.titleLbl.style.fontWeight = "bold";
    this.subtitleLbl.style.fontSize = "10pt";
  }

  // ── language ──
  _toggleLanguage() {
    const newLang = i18n.currentLanguage() === "he" ? "en" : "he";
    i18n.setLanguage(newLang);
  }
  _refreshLanguage() {
    this.titleLbl.textContent = `✧  ${i18n.t("app_title")}  ✧`;
    this.subtitleLbl.textContent = i18n.t("app_subtitle");
    this.newBtn.textContent = i18n.t("new_project");
    this.openBtn.textContent = i18n.t("open_project");
    this.saveBtn.textContent = i18n.t("save_project");
    this.saveAsBtn.textContent = i18n.t("save_as");
    this.langBtn.textContent = i18n.t("lang_toggle");
    this.themeBtn.textContent = this._themeBtnText();
    this.masterTitle.textContent = "📜 " + i18n.t("master_label");
    this.masterCopyBtn.textContent = i18n.t("master_copy");
    this.masterSaveBtn.textContent = i18n.t("master_save");
    this.masterClearBtn.textContent = i18n.t("master_clear");
    this.merger.refreshLanguage();
    this.root.dir = i18n.isRtl() ? "rtl" : "ltr";
  }

  // ── project ──
  _collectProject() {
    const p = makeProjectData();
    const state = this.merger.getState();
    p.tabs.push(makeTabData({
      name: "פרויקט",
      clean_text: state.clean_text || "",
      vocalized_sources: (state.vocalized_sources || []).map(s => `${s.name || ""}|||${s.text || ""}`),
      filter_config: state.filter_config || {},
    }));
    p.master_text = this.masterText.value || "";
    return p;
  }

  _loadProject(p) {
    if (!p.tabs || p.tabs.length === 0) return;
    const td = p.tabs[0];
    const sources = [];
    for (const sStr of (td.vocalized_sources || [])) {
      if (sStr.includes("|||")) {
        const parts = sStr.split("|||");
        sources.push({ name: parts[0], text: parts.slice(1).join("|||") });
      } else {
        sources.push({ name: "מקור", text: sStr });
      }
    }
    this.merger.setState({
      clean_text: td.clean_text || "",
      vocalized_sources: sources,
      filter_config: td.filter_config || {},
    });
    this.masterText.value = p.master_text || "";
  }

  newProject() {
    const msg = i18n.isRtl()
      ? "פרויקט חדש יסגור את הקיים. להמשיך?"
      : "New project will close current. Continue?";
    if (!confirm(msg)) return;
    this.merger.setState({ clean_text: "", vocalized_sources: [], filter_config: {} });
    this.masterText.value = "";
    this._currentProjectName = "";
    this.projectLabel.textContent = i18n.t("untitled_project");
  }

  openProject() {
    // קבצים: בדפדפן, נפתח קובץ JSON של פרויקט
    const input = el("input", { type: "file", attrs: { accept: ".nikmrg,.json,application/json" } });
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return;
      try {
        const text = await f.text();
        const data = JSON.parse(text);
        const p = makeProjectData(data);
        this._loadProject(p);
        this._currentProjectName = f.name || "";
        this.projectLabel.textContent = `◆  ${this._currentProjectName}`;
      } catch (err) {
        alert(`${i18n.t("error")}: ${err && err.message || err}`);
      }
    });
    input.click();
  }

  saveProject() {
    // ב-Web נשמר ל-localStorage. אם יש שם פעיל — תחתיו; אחרת saveProjectAs.
    const p = this._collectProject();
    if (this._currentProjectName) {
      saveProject(p, `ravtext.nikud_merger.project.${this._currentProjectName}`);
      alert(i18n.t("saved"));
    } else {
      this.saveProjectAs();
    }
  }

  saveProjectAs() {
    // הורדת קובץ .nikmrg
    const p = this._collectProject();
    p.modified = new Date().toISOString();
    if (!p.created) p.created = p.modified;
    const json = JSON.stringify(p, null, 2);
    const fname = (i18n.isRtl() ? "פרויקט מיזוג" : "merge-project") + ".nikmrg";
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { attrs: { href: url, download: fname } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    // גם ב-localStorage
    saveProject(p);
    this._currentProjectName = fname;
    this.projectLabel.textContent = `◆  ${fname}`;
  }

  _doAutosave() {
    try { autosave(this._collectProject()); } catch (_) {}
  }

  // ── master ──
  _appendToMaster(content) {
    const cur = (this.masterText.value || "").trim();
    if (cur) this.masterText.value = cur + "\n" + "─".repeat(40) + "\n" + content;
    else this.masterText.value = content;
  }
  _copyMaster() {
    const content = this.masterText.value || "";
    if (!content.trim()) return;
    try { navigator.clipboard.writeText(content); }
    catch (_) {
      this.masterText.select();
      try { document.execCommand("copy"); } catch (_) {}
    }
    alert(i18n.t("copied_msg"));
  }
  _saveMaster() {
    const content = this.masterText.value || "";
    if (!content.trim()) return;
    const fname = (i18n.isRtl() ? "טקסט מוכן" : "master-text") + ".txt";
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { attrs: { href: url, download: fname } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
  }
  _clearMaster() {
    if (!(this.masterText.value || "").trim()) return;
    const msg = i18n.isRtl() ? "לנקות את הטקסט המוכן?" : "Clear master text?";
    if (confirm(msg)) this.masterText.value = "";
  }

  destroy() {
    if (this._autosaveTimer) clearInterval(this._autosaveTimer);
    this._autosaveTimer = null;
  }
}
