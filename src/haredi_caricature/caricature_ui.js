// חלון ראשי לבוט יוצר קריקטורות חרדיות — Verbatim port (semantically) של main_window.py + qt_main.py.
//
// תכונות:
// - שדה הוראה כעיקר (Quill ב-iframe, RTL מובנה, ללא toolbar)
// - סגנון, יחס, כמות, "מה לא לכלול"
// - מחוון שפה עברית/אנגלית — מחליף RTL/LTR ואת כל כיתובי ה-UI
// - גלריה: כל התמונות שנוצרו (נשמרות ב-IndexedDB/localStorage)
// - מכסה: 1 ל-24 שעות בחינם, ללא הגבלה ברישיון
// - דיאלוג מפתחות API
// - ההנחיות עצמן ב-Apps Script (כולל "ללא נשים" + "Warm not cynical")
//
// ההנחיות (system prompt + hard rules + styles) **אינן** אצל המשתמש כלל —
// הן יושבות רק על ה-Apps Script של Moshe.

import { tr } from "./caricature_i18n.js";
import { ASPECTS, CARICATURE_STYLE_LABELS, QUICK_SCENES } from "./caricature_presets.js";
import { generateCaricatures, isConfigured, loadUserApiKeys, outputDir, saveImage, saveUserApiKey } from "./caricature_gas.js";
import { canGenerate, humanize, markUsed } from "./caricature_quota.js";
import { attachContextMenu, setDirection } from "./caricature_widgets.js";

// IndexedDB key for gallery (persistent in browser).
const DB_NAME = "ravtext_caricature_gallery";
const STORE = "images";
const DB_VERSION = 1;

let _galleryDb = null;
function openDb() {
  if (_galleryDb) return Promise.resolve(_galleryDb);
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    req.onsuccess = (e) => { _galleryDb = e.target.result; resolve(_galleryDb); };
    req.onerror = () => resolve(null);
  });
}

async function dbPut(record) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

async function dbAll() {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const arr = req.result || [];
        arr.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        resolve(arr);
      };
      req.onerror = () => resolve([]);
    } catch (e) { resolve([]); }
  });
}

async function dbDelete(name) {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) { resolve(); }
  });
}

// ── State helpers ─────────────────────────────────────────────────
function readGlobalLangPref() {
  try {
    const v = (localStorage.getItem("ravtext.lang") || "").toLowerCase();
    return v === "en" ? "en" : "he";
  } catch (e) { return "he"; }
}
function readGlobalThemePref() {
  // Dark only (matches qt_main.py — newer flow). main_window.py supported light too;
  // we follow the qt_main "dark only" path which is the newer behavior in this app.
  return "dark";
}
function writeLangPref(lang) {
  try { localStorage.setItem("ravtext.lang", lang); } catch (e) {}
}

// ── Caricature window ─────────────────────────────────────────────
export class CaricatureWindow {
  constructor(opts = {}) {
    this.licensed = Boolean(opts.licensed);
    this.lang = readGlobalLangPref();
    this.themeMode = readGlobalThemePref();
    this._labels = {};      // i18n callbacks
    this._dirWidgets = [];  // widgets to flip RTL/LTR
    this._sceneDeck = [];
    this._quotaTimer = null;
    this._busy = false;
    this._lastRequest = null;
    this._onInsertImage = opts.onInsertImage || null;
    this._open();
  }

  _open() {
    this.overlay = document.createElement("div");
    this.overlay.className = "hc-overlay";
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });

    this.win = document.createElement("div");
    this.win.className = "hc-window";
    this.overlay.appendChild(this.win);

    this._buildTopbar();
    this._buildQuotaBar();
    this._buildBody();
    this._buildFooter();

    document.body.appendChild(this.overlay);
    this._refreshQuota();
    this._reloadGallery();
    this._restartQuotaTimer();
  }

  close() {
    if (this._quotaTimer) {
      clearInterval(this._quotaTimer);
      this._quotaTimer = null;
    }
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
  }

  _registerLabel(widget, key, kw) {
    const update = () => {
      try { widget.textContent = tr(key, this.lang, kw || {}); } catch (e) {}
    };
    this._labels[Math.random().toString(36).slice(2)] = update;
    update();
    return update;
  }

  _registerCustom(updater) {
    const id = Math.random().toString(36).slice(2);
    this._labels[id] = updater;
    updater();
  }

  _setTitle() {
    document.title = tr("title", this.lang);
    if (this.titleLbl) this.titleLbl.textContent = tr("title", this.lang);
  }

  _restyle() {
    this._setTitle();
    for (const cb of Object.values(this._labels)) {
      try { cb(); } catch (e) {}
    }
    const direction = this.lang === "he" ? "rtl" : "ltr";
    for (const w of this._dirWidgets) setDirection(w, direction);
    this.win.style.direction = direction;
  }

  _toggleLang() {
    this.lang = this.lang === "he" ? "en" : "he";
    writeLangPref(this.lang);
    this._restyle();
  }

  _buildTopbar() {
    const top = document.createElement("div");
    top.className = "hc-topbar";

    this.titleLbl = document.createElement("div");
    this.titleLbl.className = "hc-title";
    top.appendChild(this.titleLbl);
    this._registerLabel(this.titleLbl, "title");

    this.langBtn = document.createElement("button");
    this.langBtn.addEventListener("click", () => this._toggleLang());
    top.appendChild(this.langBtn);
    this._registerLabel(this.langBtn, "lang_btn");

    this.keyBtn = document.createElement("button");
    this.keyBtn.addEventListener("click", () => this._openKeyDialog());
    top.appendChild(this.keyBtn);
    this._registerLabel(this.keyBtn, "key_btn");

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "סגור";
    closeBtn.addEventListener("click", () => this.close());
    top.appendChild(closeBtn);

    this.win.appendChild(top);
    this._setTitle();
  }

  _buildQuotaBar() {
    this.quotaBar = document.createElement("div");
    this.quotaBar.className = "hc-quota";
    this.win.appendChild(this.quotaBar);
  }

  _buildBody() {
    const body = document.createElement("div");
    body.className = "hc-body";
    this.win.appendChild(body);

    // Right column = controls
    const controls = document.createElement("div");
    controls.className = "hc-card hc-controls";
    this._buildControls(controls);

    // Left column = gallery
    const gallery = document.createElement("div");
    gallery.className = "hc-card hc-gallery";
    this._buildGalleryPanel(gallery);

    // RTL: in flex+RTL, first child appears on right naturally
    body.appendChild(gallery);
    body.appendChild(controls);
  }

  _buildControls(parent) {
    const sceneLbl = document.createElement("div");
    sceneLbl.className = "hc-section";
    parent.appendChild(sceneLbl);
    this._registerLabel(sceneLbl, "scene_label");

    const sceneFrame = document.createElement("div");
    sceneFrame.className = "hc-scene-frame";
    this.sceneFrame = sceneFrame;
    this.sceneInput = document.createElement("textarea");
    this.sceneInput.className = "hc-scene-input";
    this.sceneInput.addEventListener("input", () => {
      this._lastSceneText = this.sceneInput.value || "";
    });
    attachContextMenu(this.sceneInput, this.lang);
    sceneFrame.appendChild(this.sceneInput);
    parent.appendChild(sceneFrame);

    // Listen for text updates from the scene iframe only.
    this._lastSceneText = "";
    window.addEventListener("message", (ev) => {
      const d = ev.data || {};
      if (!["hc-quill-text", "hc-quill-response", "hc-quill-get-text-response", "hc-scene-text"].includes(d.type)) return;

      // Privacy guard: accept text only from the scene iframe owned by this window.
      const frames = this._findSceneIframes();
      if (!frames.some((f) => f.contentWindow === ev.source)) return;

      const text = d.text ?? d.scene_text ?? d.sceneText ?? "";
      this._lastSceneText = this._normalizeSceneText(text);
    });

    // Random + clear row
    const rrow = document.createElement("div");
    rrow.className = "hc-row";
    this.randomBtn = document.createElement("button");
    this.randomBtn.className = "hc-button";
    this.randomBtn.addEventListener("click", () => this._fillRandom());
    rrow.appendChild(this.randomBtn);
    this._registerLabel(this.randomBtn, "random_btn");

    const clrBtn = document.createElement("button");
    clrBtn.className = "hc-button hc-mini";
    clrBtn.textContent = "🧹";
    clrBtn.addEventListener("click", () => {
      this._lastSceneText = "";
      this._postToScene({ type: "hc-quill-clear" });
    });
    rrow.appendChild(clrBtn);
    parent.appendChild(rrow);

    // Style
    const styleLbl = document.createElement("div");
    styleLbl.className = "hc-section";
    parent.appendChild(styleLbl);
    this._registerLabel(styleLbl, "style_label");

    this.styleSel = document.createElement("select");
    for (const v of CARICATURE_STYLE_LABELS) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      this.styleSel.appendChild(o);
    }
    parent.appendChild(this.styleSel);
    this._dirWidgets.push(this.styleSel);

    // Aspect + count row
    const arRow = document.createElement("div");
    arRow.className = "hc-row";

    const aWrap = document.createElement("div");
    const aLbl = document.createElement("div");
    aLbl.className = "hc-section";
    aWrap.appendChild(aLbl);
    this._registerLabel(aLbl, "aspect_label");
    this.aspectSel = document.createElement("select");
    for (const k of Object.keys(ASPECTS)) {
      const o = document.createElement("option");
      o.value = k;
      o.textContent = k;
      this.aspectSel.appendChild(o);
    }
    aWrap.appendChild(this.aspectSel);
    arRow.appendChild(aWrap);
    this._dirWidgets.push(this.aspectSel);

    const cWrap = document.createElement("div");
    const cLbl = document.createElement("div");
    cLbl.className = "hc-section";
    cWrap.appendChild(cLbl);
    this._registerLabel(cLbl, "count_label");
    this.countSel = document.createElement("select");
    for (const v of ["1", "2", "3", "4"]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      this.countSel.appendChild(o);
    }
    this.countSel.value = "2";
    cWrap.appendChild(this.countSel);
    arRow.appendChild(cWrap);
    this._dirWidgets.push(this.countSel);

    parent.appendChild(arRow);

    // Negative
    const negLbl = document.createElement("div");
    negLbl.className = "hc-section";
    parent.appendChild(negLbl);
    this._registerLabel(negLbl, "negative_label");
    this.negInput = document.createElement("input");
    this.negInput.type = "text";
    parent.appendChild(this.negInput);
    attachContextMenu(this.negInput, this.lang);
    this._dirWidgets.push(this.negInput);
    this._registerCustom(() => {
      this.negInput.placeholder = tr("negative_ph", this.lang);
    });

    // Polish checkbox
    const polishWrap = document.createElement("label");
    polishWrap.className = "hc-checkbox";
    this.polishChk = document.createElement("input");
    this.polishChk.type = "checkbox";
    polishWrap.appendChild(this.polishChk);
    const polishText = document.createElement("span");
    polishWrap.appendChild(polishText);
    parent.appendChild(polishWrap);
    this._registerLabel(polishText, "polish");

    const polishHelp = document.createElement("div");
    polishHelp.className = "hc-muted";
    parent.appendChild(polishHelp);
    this._registerLabel(polishHelp, "polish_tooltip");

    // Go
    this.goBtn = document.createElement("button");
    this.goBtn.className = "hc-button go";
    this.goBtn.addEventListener("click", () => this._onGenerate());
    parent.appendChild(this.goBtn);
    this._registerLabel(this.goBtn, "go_btn");

    this.statusLbl = document.createElement("div");
    this.statusLbl.className = "hc-status";
    parent.appendChild(this.statusLbl);
    this._registerLabel(this.statusLbl, "ready");

    // Folder button (just shows logical path; in browser there is no folder)
    this.folderBtn = document.createElement("button");
    this.folderBtn.className = "hc-button";
    this.folderBtn.addEventListener("click", () => this._openFolder());
    parent.appendChild(this.folderBtn);
    this._registerLabel(this.folderBtn, "open_folder");

    const pathLbl = document.createElement("div");
    pathLbl.className = "hc-muted";
    pathLbl.textContent = outputDir();
    parent.appendChild(pathLbl);
  }

  _buildGalleryPanel(parent) {
    const head = document.createElement("div");
    head.className = "hc-gallery-title";
    parent.appendChild(head);
    this._registerLabel(head, "gallery");

    this.galleryGrid = document.createElement("div");
    this.galleryGrid.className = "hc-gallery-grid";
    parent.appendChild(this.galleryGrid);
  }

  _buildFooter() {
    const footer = document.createElement("div");
    footer.className = "hc-footer";
    footer.textContent =
      "יש להשתמש בתוכנה אך ורק למטרות ערכיות בלבד. " +
      "השירות נסיוני ואין התחייבות שהוא יפעל לנצח.";
    this.win.appendChild(footer);
  }

  _postToScene(msg) {
    try {
      if (this.sceneInput) {
        if (msg.type === "hc-quill-clear") this.sceneInput.value = "";
        if (msg.type === "hc-quill-set") this.sceneInput.value = msg.text || "";
        this._lastSceneText = this.sceneInput.value || "";
      }
      if (this.sceneIframe && this.sceneIframe.contentWindow) {
        this.sceneIframe.contentWindow.postMessage(msg, "*");
      }
    } catch (e) {}
  }

  _normalizeSceneText(value) {
    return String(value || "")
      .replace(/\u200B/g, "")
      .replace(/\u00A0/g, " ")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  _readSceneTextFromDocument(doc) {
    if (!doc) return "";

    // Privacy guard: read only the dedicated scene editor.
    // Do not scan arbitrary textarea/input/contenteditable fields.
    const selectors = [
      ".ql-editor",
      ".hc-scene-input",
      "#hc-scene-input",
      "[data-hc-scene-input]",
      "[data-hc-scene-text]",
    ];

    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (!el) continue;
      const raw = ("value" in el) ? el.value : (el.innerText || el.textContent || "");
      const text = this._normalizeSceneText(raw);
      if (text) return text;
    }

    return "";
  }

  _findSceneIframes() {
    const out = [];
    const add = (node) => {
      if (!node) return;
      if (node.tagName && String(node.tagName).toLowerCase() === "iframe") {
        out.push(node);
      } else if (node.querySelectorAll) {
        out.push(...node.querySelectorAll("iframe"));
      }
    };

    // Privacy guard: search only inside this caricature window/scene frame.
    // Do not scan every iframe on the page.
    add(this.sceneIframe);
    add(this.sceneFrame);
    add(this.win && this.win.querySelector(".hc-scene-frame"));
    add(this.win && this.win.querySelector("iframe.hc-scene-iframe"));
    add(this.win);

    return [...new Set(out)].filter((iframe) => iframe && iframe.contentWindow);
  }

  _readSceneTextFromIframe(iframeElement) {
    if (!iframeElement) return "";

    try {
      const cw = iframeElement.contentWindow;
      if (cw && typeof cw.getText === "function") {
        const text = this._normalizeSceneText(cw.getText());
        if (text) return text;
      }
      if (cw && typeof cw.getSceneText === "function") {
        const text = this._normalizeSceneText(cw.getSceneText());
        if (text) return text;
      }
      if (cw && cw.quill && typeof cw.quill.getText === "function") {
        const text = this._normalizeSceneText(cw.quill.getText());
        if (text) return text;
      }
    } catch (e) {
      // Cross-origin iframe: direct access is blocked. Use postMessage cache/request below.
    }

    try {
      const doc = iframeElement.contentDocument ||
                  (iframeElement.contentWindow && iframeElement.contentWindow.document);
      const text = this._readSceneTextFromDocument(doc);
      if (text) return text;
    } catch (e) {
      // Cross-origin iframe or not fully loaded.
    }

    return "";
  }

  _requestSceneTextFromIframes(timeoutMs = 500) {
    const frames = this._findSceneIframes();
    if (!frames.length) return Promise.resolve("");

    return new Promise((resolve) => {
      let done = false;
      const finish = (text) => {
        if (done) return;
        const normalized = this._normalizeSceneText(text);
        if (!normalized) return;
        done = true;
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        this._lastSceneText = normalized;
        resolve(normalized);
      };
      const frameWindows = new Set(frames.map((f) => f.contentWindow).filter(Boolean));
      const onMessage = (ev) => {
        if (!frameWindows.has(ev.source)) return;
        const d = ev.data || {};
        if (!["hc-quill-text", "hc-quill-response", "hc-quill-get-text-response", "hc-scene-text"].includes(d.type)) return;
        finish(d.text ?? d.scene_text ?? d.sceneText ?? "");
      };
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener("message", onMessage);
        resolve("");
      }, timeoutMs);

      window.addEventListener("message", onMessage);
      for (const iframe of frames) {
        try {
          iframe.contentWindow.postMessage({ type: "hc-quill-get-text" }, "*");
          iframe.contentWindow.postMessage({ type: "hc-quill-request-text" }, "*");
          iframe.contentWindow.postMessage({ type: "hc-scene-get-text" }, "*");
        } catch (e) {}
      }
    });
  }

  async _readSceneText() {
    // Preferred: read Quill directly from same-origin iframe.
    for (const iframeElement of this._findSceneIframes()) {
      const text = this._readSceneTextFromIframe(iframeElement);
      if (text) {
        this._lastSceneText = text;
        return text;
      }
    }

    // If direct access failed, ask the iframe to send the current text now.
    const iframeText = await this._requestSceneTextFromIframes(500);
    if (iframeText) return iframeText;

    // Fallback: inline textarea, if this build uses it instead of iframe.
    const inlineText = this._normalizeSceneText(this.sceneInput && this.sceneInput.value);
    if (inlineText) {
      this._lastSceneText = inlineText;
      return inlineText;
    }

    // Last fallback: latest text received from postMessage input events.
    return this._normalizeSceneText(this._lastSceneText);
  }

  _setStatus(key, kind = "acc", kw = {}) {
    if (!this.statusLbl) return;
    this.statusLbl.classList.remove("ok", "err");
    if (kind === "ok") this.statusLbl.classList.add("ok");
    else if (kind === "err") this.statusLbl.classList.add("err");
    this.statusLbl.textContent = tr(key, this.lang, kw);
  }

  _setStatusRaw(text, kind = "acc") {
    if (!this.statusLbl) return;
    this.statusLbl.classList.remove("ok", "err");
    if (kind === "ok") this.statusLbl.classList.add("ok");
    else if (kind === "err") this.statusLbl.classList.add("err");
    this.statusLbl.textContent = text;
  }

  // ── Quota ──────────────────────────────────────────────────
  _refreshQuota() {
    const { ok, wait } = canGenerate(this.licensed);
    this.quotaBar.classList.remove("ok", "acc", "wait");
    if (this.licensed) {
      this.quotaBar.textContent = tr("quota_unlimited", this.lang);
      this.quotaBar.classList.add("ok");
    } else if (ok) {
      this.quotaBar.textContent = tr("quota_ready", this.lang);
      this.quotaBar.classList.add("acc");
    } else {
      this.quotaBar.textContent = tr("quota_wait", this.lang, { wait: humanize(wait) });
      this.quotaBar.classList.add("wait");
    }
  }

  _restartQuotaTimer() {
    if (this._quotaTimer) clearInterval(this._quotaTimer);
    this._quotaTimer = setInterval(() => this._refreshQuota(), 60_000);
  }

  // ── Random scene ──────────────────────────────────────────
  _fillRandom() {
    if (!this._sceneDeck.length) {
      this._sceneDeck = QUICK_SCENES.slice();
      // Shuffle
      for (let i = this._sceneDeck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = this._sceneDeck[i];
        this._sceneDeck[i] = this._sceneDeck[j];
        this._sceneDeck[j] = t;
      }
    }
    const scene = this._sceneDeck.pop();
    this._lastSceneText = scene;
    this._postToScene({ type: "hc-quill-set", text: scene });
    const total = QUICK_SCENES.length;
    const used = total - this._sceneDeck.length;
    this._setStatus("deck_progress", "acc", { i: used, n: total });
  }

  // ── Open folder (browser: list saved blobs) ───────────────
  _openFolder() {
    // אין תיקייה בדפדפן — מציגים את שמירות הגלריה בלבד.
    alert(tr("open_folder", this.lang) + "\n" + outputDir());
  }

  // ── Key dialog ────────────────────────────────────────────
  _openKeyDialog() {
    const overlay = document.createElement("div");
    overlay.className = "hc-keydlg";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    const inner = document.createElement("div");
    inner.className = "hc-keydlg-inner";
    overlay.appendChild(inner);

    const title = document.createElement("div");
    title.className = "hc-section";
    title.textContent = this.lang === "he"
      ? "הזן מפתח/ות Gemini API (שורה לכל מפתח):"
      : "Enter Gemini API key(s) (one per line):";
    inner.appendChild(title);

    const ta = document.createElement("textarea");
    ta.value = loadUserApiKeys().join("\n");
    inner.appendChild(ta);
    attachContextMenu(ta, this.lang);

    const hint = document.createElement("div");
    hint.className = "hc-muted";
    hint.textContent = this.lang === "he"
      ? "מפתח חינמי בכתובת aistudio.google.com/apikey"
      : "Free key at aistudio.google.com/apikey";
    inner.appendChild(hint);

    const row = document.createElement("div");
    row.className = "hc-keydlg-row";
    const saveBtn = document.createElement("button");
    saveBtn.className = "hc-button go";
    saveBtn.textContent = this.lang === "he" ? "שמור" : "Save";
    saveBtn.addEventListener("click", () => {
      const keys = ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (saveUserApiKey(keys)) {
        document.body.removeChild(overlay);
        this._setStatusRaw(
          (this.lang === "he" ? "נשמרו " : "Saved ") + keys.length,
          "ok");
      } else {
        alert(this.lang === "he" ? "לא הצלחתי לשמור את המפתחות."
                                  : "Failed to save keys.");
      }
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "hc-button";
    cancelBtn.textContent = this.lang === "he" ? "ביטול" : "Cancel";
    cancelBtn.addEventListener("click", () => document.body.removeChild(overlay));
    row.appendChild(cancelBtn);
    row.appendChild(saveBtn);
    inner.appendChild(row);

    document.body.appendChild(overlay);
    ta.focus();
  }

  // ── Generate ──────────────────────────────────────────────
  async _onGenerate() {
    if (this._busy) return;
    const { ok, wait } = canGenerate(this.licensed);
    if (!ok) {
      alert(tr("quota_block_title", this.lang) + "\n\n" +
            tr("quota_block_msg", this.lang, { wait: humanize(wait) }));
      return;
    }
    if (!isConfigured()) {
      alert(this.lang === "he"
        ? "כתובת ה-Apps Script של בוט הקריקטורות לא הוגדרה.\nפנה לתמיכה כדי לקבל את הכתובת."
        : "Caricature Apps Script URL is not configured.\nContact support.");
      return;
    }

    // Pull current scene text robustly.
    // Order: Quill inside iframe -> iframe postMessage response -> inline textarea -> cached postMessage text.
    const sceneText = await this._readSceneText();
    console.log("[caricature] scene text length:", sceneText.length);

    if (!sceneText) {
      alert(tr("no_text", this.lang) + "

" + tr("no_text_msg", this.lang));
      return;
    }

    const aspectLabel = this.aspectSel.value;
    const aspect = ASPECTS[aspectLabel] || "1:1";
    const count = parseInt(this.countSel.value, 10) || 1;
    const styleKey = this.styleSel.value;
    const negative = this.negInput.value;
    const polish = this.polishChk.checked;

    this._busy = true;
    this.goBtn.disabled = true;
    const origGoText = this.goBtn.textContent;
    this.goBtn.textContent = "⏳";
    this._setStatus(polish ? "polishing" : "sending", "acc");

    this._lastRequest = {
      scene: sceneText,
      style: styleKey,
      aspect_label: aspectLabel,
      aspect,
      negative,
      polish,
    };

    let result;
    try {
      result = await generateCaricatures({
        scene_text: sceneText,
        style_key: styleKey,
        aspect,
        count,
        negative,
        polish,
      });
    } catch (e) {
      result = { images: [], error: String(e && e.message ? e.message : e) };
    }

    this._busy = false;
    this.goBtn.disabled = false;
    this.goBtn.textContent = tr("go_btn", this.lang);

    const { images, error } = result;
    if (!images || !images.length) {
      this._setStatus("fail", "err");
      this._setStatusRaw(`${tr("fail", this.lang)}\n${error || ""}`, "err");
      return;
    }

    if (!this.licensed) markUsed();
    this._refreshQuota();

    // Save each image and persist into IndexedDB for gallery
    let i = 0;
    for (const img of images) {
      i++;
      const meta = this._lastRequest || {};
      const name = saveImage(img, sceneText, {
        idx: i,
        style: meta.style,
        aspect: meta.aspect_label,
        negative: meta.negative,
        polish: meta.polish,
      });
      const sidecar = [
        `תאריך: ${new Date().toLocaleString("he-IL")}`,
        `סצנה: ${sceneText || ""}`,
        meta.style ? `סגנון: ${meta.style}` : null,
        meta.aspect_label ? `יחס מימדים: ${meta.aspect_label}` : null,
        meta.negative ? `מה לא לכלול: ${meta.negative}` : null,
        meta.polish ? "שיפור פרומפט אוטומטי: כן" : null,
      ].filter(Boolean).join("\n");

      await dbPut({
        name,
        ts: Date.now(),
        dataUrl: img.dataUrl,
        sidecar,
      });
    }
    this._setStatusRaw(
      tr("saved", this.lang, { n: images.length, path: outputDir() }),
      "ok");
    this._reloadGallery();

    // Optional: also push first image to host editor (insert hook)
    if (typeof this._onInsertImage === "function" && images[0]) {
      try {
        this._onInsertImage({
          dataUrl: images[0].dataUrl,
          alt: sceneText,
        });
      } catch (e) {}
    }
  }

  // ── Gallery ───────────────────────────────────────────────
  async _reloadGallery() {
    if (!this.galleryGrid) return;
    this.galleryGrid.replaceChildren();
    const items = await dbAll();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "hc-empty";
      empty.textContent = tr("placeholder", this.lang);
      this.galleryGrid.appendChild(empty);
      return;
    }
    for (const it of items) this._addGalleryCard(it);
  }

  _addGalleryCard(record) {
    const card = document.createElement("div");
    card.className = "hc-gallery-card";

    const iconRow = document.createElement("div");
    iconRow.className = "hc-icon-row";
    const zoom = document.createElement("button");
    zoom.className = "hc-icon-btn";
    zoom.textContent = "🔍";
    zoom.title = "פתח בגודל מלא";
    zoom.addEventListener("click", () => this._openImage(record));
    iconRow.appendChild(zoom);

    const copyImg = document.createElement("button");
    copyImg.className = "hc-icon-btn";
    copyImg.textContent = "🖼";
    copyImg.title = "העתק תמונה";
    copyImg.addEventListener("click", () => this._copyImage(record));
    iconRow.appendChild(copyImg);

    if (this._onInsertImage) {
      const insert = document.createElement("button");
      insert.className = "hc-icon-btn";
      insert.textContent = "📥";
      insert.title = "הכנס לעורך";
      insert.addEventListener("click", () => {
        try { this._onInsertImage({ dataUrl: record.dataUrl, alt: record.name }); } catch (e) {}
      });
      iconRow.appendChild(insert);
    }

    const del = document.createElement("button");
    del.className = "hc-icon-btn";
    del.textContent = "🗑";
    del.title = "מחק תמונה";
    del.addEventListener("click", async () => {
      await dbDelete(record.name);
      this._reloadGallery();
    });
    iconRow.appendChild(del);

    card.appendChild(iconRow);

    const img = document.createElement("img");
    img.src = record.dataUrl;
    img.alt = record.name;
    img.addEventListener("click", () => this._openImage(record));
    card.appendChild(img);

    const name = document.createElement("div");
    name.className = "hc-name";
    name.textContent = record.name;
    card.appendChild(name);

    const textActions = document.createElement("div");
    textActions.className = "hc-icon-row";
    const copyText = document.createElement("button");
    copyText.className = "hc-icon-btn";
    copyText.textContent = "📋";
    copyText.title = "העתק הנחיה";
    copyText.addEventListener("click", () => {
      try {
        navigator.clipboard.writeText(record.sidecar || "");
        this._setStatusRaw("ההנחיות הועתקו ללוח", "ok");
      } catch (e) {}
    });
    textActions.appendChild(copyText);
    card.appendChild(textActions);

    const history = document.createElement("div");
    history.className = "hc-history";
    history.textContent = record.sidecar || "(אין הנחיות שמורות לתמונה זו)";
    card.appendChild(history);

    this.galleryGrid.appendChild(card);
  }

  _openImage(record) {
    try {
      const w = window.open();
      if (w) {
        w.document.write(
          `<title>${record.name}</title>` +
          `<body style="margin:0;background:#000;display:flex;align-items:center;justify-content:center;">` +
          `<img src="${record.dataUrl}" style="max-width:100%;max-height:100vh;">` +
          `</body>`);
      }
    } catch (e) {}
  }

  async _copyImage(record) {
    try {
      const blob = await (await fetch(record.dataUrl)).blob();
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob }),
        ]);
        this._setStatusRaw("התמונה הועתקה ללוח", "ok");
        return;
      }
    } catch (e) {}
    this._setStatusRaw("העתקת תמונה לא נתמכת בדפדפן זה", "err");
  }
}

export function openCaricatureWindow(opts) {
  return new CaricatureWindow(opts || {});
}
