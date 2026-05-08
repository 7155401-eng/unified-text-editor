// חלון ראשי עם סרגל טאבים בצד ימין — מימוש HTML/JS verbatim של main_window.py.

import { getTheme, getFont } from "./torah_transcription_theme.js";
import {
  GasClient,
  GasServerError,
  GasNetworkError,
  GasTimeoutError,
  GasCancelledError,
  detectFileType,
} from "./torah_transcription_gas.js";
import { friendlyError } from "./torah_transcription_errors.js";

const CONFIG_KEY = "ravtext.torah_transcription.config";

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (e) {
    return {};
  }
}

function saveConfig(data) {
  try {
    const existing = loadConfig();
    Object.assign(existing, data);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(existing));
  } catch (e) {
    /* swallow */
  }
}

function log(msg, level = "INFO") {
  try {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    console.log(`[${ts}] [${level}] ${msg}`);
  } catch (e) {
    /* swallow */
  }
}

function logExc(prefix, err) {
  try {
    log(`${prefix}\n${err && err.stack ? err.stack : err}`, "ERROR");
  } catch (e) {
    /* swallow */
  }
}

// === רשימת השלבים ===
const STEPS = [
  ["account",      "1. חשבון"],
  ["file",         "2. קובץ לתמלול"],
  ["options",      "3. הגדרות תמלול"],
  ["ocr",          "4. דוגמאות OCR"],
  ["custom",       "5. הוראות נוספות"],
  ["judge",        "6. בחירת דיין"],
  ["run",          "7. הפעלה"],
  ["output",       "8. הצגת פלט"],
  ["torah_style",  "9. סגנון תורני"],
];

// helpers
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "style") e.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "html") {
      e.innerHTML = v;
    } else if (v != null) {
      e.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    if (Array.isArray(c)) {
      for (const cc of c) {
        if (cc == null) continue;
        e.appendChild(typeof cc === "string" ? document.createTextNode(cc) : cc);
      }
    } else {
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return e;
}

function basename(name) {
  const s = String(name || "");
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i >= 0 ? s.slice(i + 1) : s;
}

function suffixLower(name) {
  const s = String(name || "");
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i).toLowerCase() : "";
}

// אישור / הודעה במקום messagebox
function showMessage(title, msg) {
  try {
    window.alert(`${title}\n\n${msg}`);
  } catch (e) {
    /* swallow */
  }
}

// סוג שלב — האם נראה בסיידבר (ocr נראה רק במצב ocr)
function visibleSteps(state) {
  if (state.mode === "ocr") return STEPS;
  return STEPS.filter(([k]) => k !== "ocr");
}

// ============================================================================
// MainWindow
// ============================================================================

export class TranscriptionWindow {
  constructor(opts = {}) {
    this.theme = getTheme();
    this.onResult = opts.onResult || null; // callback(transcriptText) → להוסיף לעורך
    this.config = loadConfig();

    // === מצב הריצה ===
    this.appState = {
      use_premium: !!this.config.use_premium,
      access_code: this.config.access_code || "",
      gemini_api_key: this.config.gemini_api_key != null ? this.config.gemini_api_key : "",
      claude_api_key: this.config.claude_api_key || "",
      elevenlabs_api_key: this.config.elevenlabs_api_key || "",
      gemini_only: !!this.config.gemini_only,
      file_path: "",
      file_blob: null,
      file_name: "",
      mode: "transcription", // transcription / ocr
      n_runs: 3,
      torah_mode: true,
      ashkenazi: false,
      ocr_examples: [], // [{handwriting:File, typed:File}]
      custom_prompt: "",
      // שלב 6 — דיין מכריע
      judge_mode: this.config.gemini_only ? "gemini_only" : "claude",
      // שלב 9 — סגנון תורני (לאחר קבלת המהדורה)
      torah_style: this.config.torah_style || "combined",
      // מהדורות חיצוניות שהמשתמש מעלה (למשל פלט ABBYY) — מצטרפות
      // לעדי הנוסח לפני הכרעת הדיין. כל פריט: {name: str, text: str}
      external_editions: [],
      // ElevenLabs — תמלול נוסף לאודיו/וידאו דרך GAS
      elevenlabs_runs: 0,
      // שפת תמלול ב-ElevenLabs (קוד ISO 639-3 — heb=עברית, eng=אנגלית וכו')
      elevenlabs_language: this.config.elevenlabs_language || "heb",
      // מודל מועדף לדיון בשוויון — ברירת מחדל = השירות החדש (ElevenLabs)
      preferred_engine: "elevenlabs",
      result: null,
    };

    this.currentStep = 0;
    this.tabButtons = {}; // {key: button}
    this.frames = {};      // {key: container}

    this._buildUi();
    this._showStep(0);
  }

  _buildUi() {
    const overlay = el("div", { class: "tt-modal-overlay" });
    const modal = el("div", { class: "tt-modal" });
    overlay.appendChild(modal);
    this.overlay = overlay;
    this.modal = modal;

    // === Header ===
    const header = el(
      "div",
      { class: "tt-header" },
      el("div", { class: "tt-header-title" }, "מערכת תמלול והכרעת נוסח"),
      el(
        "button",
        {
          class: "tt-close-btn",
          title: "סגור",
          onclick: () => this.close(),
        },
        "✕"
      )
    );
    modal.appendChild(header);

    // === Body: סרגל ימני + תוכן ===
    const body = el("div", { class: "tt-body" });
    modal.appendChild(body);

    const contentWrap = el("div", { class: "tt-content-wrap" });
    body.appendChild(contentWrap);

    // אזור התוכן
    this.contentArea = el("div", { class: "tt-content-area" });
    contentWrap.appendChild(this.contentArea);

    // פוטר עם כפתורי ניווט
    const nav = el("div", { class: "tt-nav" });
    contentWrap.appendChild(nav);

    this.nextBtn = el(
      "button",
      {
        class: "tt-btn tt-btn-primary",
        onclick: () => this._onNext(),
      },
      "המשך ←"
    );
    nav.appendChild(this.nextBtn);

    this.backBtn = el(
      "button",
      {
        class: "tt-btn tt-btn-secondary",
        onclick: () => this._onBack(),
      },
      "→ חזור"
    );
    nav.appendChild(this.backBtn);

    // סרגל טאבים בצד ימין (RTL)
    const sidebar = el("div", { class: "tt-sidebar" });
    body.appendChild(sidebar);

    sidebar.appendChild(el("div", { class: "tt-sidebar-title" }, "שלבים"));

    for (let i = 0; i < STEPS.length; i++) {
      const [key, label] = STEPS[i];
      const idx = i;
      const btn = el(
        "button",
        {
          class: "tt-tab-btn",
          onclick: () => this._showStep(idx),
        },
        label
      );
      sidebar.appendChild(btn);
      this.tabButtons[key] = btn;
    }

    // === בנייה של כל הפריימים מראש ===
    this._buildAccountFrame();
    this._buildFileFrame();
    this._buildOptionsFrame();
    this._buildOcrFrame();
    this._buildCustomFrame();
    this._buildJudgeFrame();
    this._buildRunFrame();
    this._buildOutputFrame();
    this._buildTorahStyleFrame();

    // close on Escape
    overlay.tabIndex = 0;
    overlay.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.close();
    });
  }

  _newFrame(key) {
    const f = el("div", { class: "tt-frame", style: "display:none;" });
    this.frames[key] = f;
    this.contentArea.appendChild(f);
    return f;
  }

  // === שלב 1: חשבון ===
  _buildAccountFrame() {
    const f = this._newFrame("account");

    f.appendChild(el("div", { class: "tt-h1" }, "איך אתה משתמש בתוכנה?"));
    f.appendChild(el(
      "div",
      { class: "tt-info" },
      "בחר אחת מהאפשרויות. אפשר לשנות בעתיד."
    ));

    // === פרמיום ===
    const prem = el("div", { class: "tt-card tt-card-gold" });
    f.appendChild(prem);

    const premRadioRow = el(
      "label",
      { class: "tt-radio-row" },
      el(
        "span",
        { class: "tt-radio-label", style: "color:#f4d35e;font-weight:bold;font-size:16px;" },
        "⭐  פרמיום (תשלום לפי שימוש דרך השרת שלנו)"
      ),
      el("input", {
        type: "radio",
        name: "tt-usage",
        value: "premium",
        ...(this.appState.use_premium ? { checked: "checked" } : {}),
        onchange: () => this._onUsageChange(),
      })
    );
    prem.appendChild(premRadioRow);

    prem.appendChild(el(
      "div",
      { class: "tt-note", style: "padding:0 25px;" },
      "אין צורך במפתחות API. תשלום לפי נקודות שנרכשו אצלנו."
    ));
    prem.appendChild(el(
      "div",
      { class: "tt-label", style: "padding:6px 25px 0 0;" },
      "קוד גישה:"
    ));
    this.accessEntry = el("input", {
      type: "password",
      class: "tt-input",
      placeholder: "הדבק כאן את קוד הגישה שקיבלת",
      style: "width:calc(100% - 50px); margin: 0 25px 14px 25px;",
      value: this.appState.access_code,
    });
    prem.appendChild(this.accessEntry);

    // === אישי ===
    const pers = el("div", { class: "tt-card" });
    f.appendChild(pers);

    const persRadioRow = el(
      "label",
      { class: "tt-radio-row" },
      el(
        "span",
        { class: "tt-radio-label", style: "font-weight:bold;font-size:16px;" },
        "🔐  מפתחות אישיים (תשלום ישיר לספקי הבינה)"
      ),
      el("input", {
        type: "radio",
        name: "tt-usage",
        value: "personal",
        ...(this.appState.use_premium ? {} : { checked: "checked" }),
        onchange: () => this._onUsageChange(),
      })
    );
    pers.appendChild(persRadioRow);

    pers.appendChild(el(
      "div",
      { class: "tt-note", style: "padding:0 25px;" },
      "Gemini תמיד נדרש (הוא עושה את התמלול). Claude — רק לשלב הכרעת הנוסח."
    ));

    pers.appendChild(el(
      "div",
      { class: "tt-label", style: "padding:8px 25px 0 0;" },
      "מפתח Gemini (תמיד נדרש):"
    ));
    this.geminiEntry = el("input", {
      type: "password",
      class: "tt-input",
      placeholder: "AIza...",
      style: "width:calc(100% - 50px); margin: 0 25px 8px 25px;",
      value: this.appState.gemini_api_key,
    });
    pers.appendChild(this.geminiEntry);

    pers.appendChild(el(
      "div",
      { class: "tt-label", style: "padding:0 25px 0 0;" },
      "מפתח Claude (לשלב הכרעת הנוסח):"
    ));
    this.claudeEntry = el("input", {
      type: "password",
      class: "tt-input",
      placeholder: "sk-ant-...",
      style: "width:calc(100% - 50px); margin: 0 25px 12px 25px;",
      value: this.appState.claude_api_key,
    });
    pers.appendChild(this.claudeEntry);

    pers.appendChild(el(
      "div",
      { class: "tt-label", style: "padding:0 25px 0 0;" },
      "מפתח ElevenLabs (לתמלול אודיו/וידאו נוסף — אופציונלי):"
    ));
    this.elevenlabsEntry = el("input", {
      type: "password",
      class: "tt-input",
      placeholder: "sk_...",
      style: "width:calc(100% - 50px); margin: 0 25px 12px 25px;",
      value: this.appState.elevenlabs_api_key,
    });
    pers.appendChild(this.elevenlabsEntry);

    this.geminiOnlyCheck = el("input", {
      type: "checkbox",
      ...(this.appState.gemini_only ? { checked: "checked" } : {}),
    });
    const geminiOnlyRow = el(
      "label",
      { class: "tt-check-row", style: "padding-right:25px;" },
      el(
        "span",
        { class: "tt-radio-label" },
        "להשתמש רק ב-Gemini, בלי Claude (זול יותר; מפתח Claude לא נחוץ)"
      ),
      this.geminiOnlyCheck
    );
    pers.appendChild(geminiOnlyRow);
  }

  _onUsageChange() {
    // אין מה לעשות חוץ מלשמור — הוולידציה תקרה ב-_onNext
  }

  _getUsageMode() {
    const radios = this.modal.querySelectorAll('input[name="tt-usage"]');
    for (const r of radios) {
      if (r.checked) return r.value;
    }
    return "personal";
  }

  // === שלב 2: קובץ ===
  _buildFileFrame() {
    const f = this._newFrame("file");

    f.appendChild(el("div", { class: "tt-h1" }, "איזה קובץ לתמלל?"));
    f.appendChild(el(
      "div",
      { class: "tt-info" },
      "תמונה, PDF, אודיו או וידאו. מומלץ להתחיל עם קובץ קטן לבדיקה."
    ));

    const row = el("div", { class: "tt-card" });
    f.appendChild(row);

    const fileInput = el("input", {
      type: "file",
      style: "display:none;",
      accept: ".jpg,.jpeg,.png,.webp,.pdf,.mp3,.wav,.m4a,.mp4,.mov,.ogg,.flac,.avi,.mkv,.aac,.tif,.tiff,.bmp",
      onchange: (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (file) this._setFile(file);
      },
    });
    row.appendChild(fileInput);
    this.fileInput = fileInput;

    this.fileLabel = el(
      "div",
      { class: "tt-file-name muted" },
      "(לא נבחר קובץ)"
    );

    const fileRow = el(
      "div",
      { class: "tt-file-row" },
      el(
        "button",
        {
          class: "tt-btn tt-btn-primary",
          style: "min-width:160px;",
          onclick: () => fileInput.click(),
        },
        "בחר קובץ..."
      ),
      this.fileLabel
    );
    row.appendChild(fileRow);

    // שורת אזהרה / המרה — נראית רק לקובץ אודיו/וידאו גדול
    this.fileWarnFrame = el("div", { class: "tt-card-warn", style: "display:none;" });
    this.fileWarnLabel = el("div", { style: "flex:1;text-align:right;" }, "");
    this.fileWarnFrame.appendChild(this.fileWarnLabel);
    f.appendChild(this.fileWarnFrame);
  }

  _setFile(file) {
    // file הוא File object
    this.appState.file_blob = file;
    this.appState.file_name = file.name;
    this.appState.file_path = file.name; // התואמה: בקוד המקורי file_path הוא נתיב; ב-JS השם בלבד
    const sizeMb = file.size / (1024 * 1024);
    this.fileLabel.classList.remove("muted");
    this.fileLabel.textContent = `${file.name}   ·   ${sizeMb.toFixed(1)} MB`;
    log(`file selected: ${file.name} size=${sizeMb.toFixed(1)}MB`);
    this._refreshFileWarning();
  }

  _refreshFileWarning() {
    const file = this.appState.file_blob;
    const sizeMb = file ? file.size / (1024 * 1024) : 0;
    const ext = suffixLower(this.appState.file_name);
    const isAudio = [".wav", ".m4a", ".flac", ".aac", ".ogg"].includes(ext);
    const isVideo = [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(ext);
    // קבצים מודפסים/PDF/MP3 — לא מציגים אזהרה
    const tooBig = sizeMb >= 10 && (isAudio || isVideo);
    if (!tooBig) {
      this.fileWarnFrame.style.display = "none";
      return;
    }
    const msg =
      `⚠  הקובץ במשקל ${sizeMb.toFixed(1)} MB. ` +
      `קבצי ${ext.toUpperCase().slice(1)} כבדים נוטים לפסול את הבקשה לשרת או לקחת זמן רב. ` +
      "מומלץ להמיר ל-MP3 — הגודל יורד פי 5-10 והאיכות לתמלול נשמרת.\n" +
      "(להמיר ידנית בכל ממיר אונליין.)";
    this.fileWarnLabel.textContent = msg;
    this.fileWarnFrame.style.display = "flex";
  }

  // === שלב 3: הגדרות תמלול ===
  _buildOptionsFrame() {
    const f = this._newFrame("options");

    f.appendChild(el("div", { class: "tt-h1" }, "איזה סוג תמלול?"));

    // מצב: רגיל / OCR
    const modeCard = el("div", { class: "tt-card" });
    f.appendChild(modeCard);

    modeCard.appendChild(el("div", { class: "tt-h2" }, "מצב תמלול:"));

    this.modeTrans = el("input", {
      type: "radio",
      name: "tt-mode",
      value: "transcription",
      ...(this.appState.mode === "transcription" ? { checked: "checked" } : {}),
    });
    modeCard.appendChild(el(
      "label",
      { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, "תמלול רגיל (טקסט מודפס / אודיו / וידאו)"),
      this.modeTrans
    ));

    this.modeOcr = el("input", {
      type: "radio",
      name: "tt-mode",
      value: "ocr",
      ...(this.appState.mode === "ocr" ? { checked: "checked" } : {}),
    });
    modeCard.appendChild(el(
      "label",
      { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, "OCR (כתב יד או דפוס; אפשר להוסיף דוגמאות בשלב הבא)"),
      this.modeOcr
    ));

    // סוג תמלול תורני / רגיל (רק לאודיו)
    const torahCard = el("div", { class: "tt-card" });
    f.appendChild(torahCard);

    torahCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "סוג תמלול אודיו (רק אם הקובץ הוא הקלטה):"
    ));

    this.audioTorah = el("input", {
      type: "radio",
      name: "tt-audio",
      value: "torah",
      ...(this.appState.torah_mode ? { checked: "checked" } : {}),
    });
    torahCard.appendChild(el(
      "label",
      { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, "תורני / ישיבתי"),
      this.audioTorah
    ));

    this.audioRegular = el("input", {
      type: "radio",
      name: "tt-audio",
      value: "regular",
      ...(this.appState.torah_mode ? {} : { checked: "checked" }),
    });
    torahCard.appendChild(el(
      "label",
      { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, "רגיל"),
      this.audioRegular
    ));

    this.ashkenaziCheck = el("input", {
      type: "checkbox",
      ...(this.appState.ashkenazi ? { checked: "checked" } : {}),
    });
    torahCard.appendChild(el(
      "label",
      { class: "tt-check-row" },
      el("span", { class: "tt-radio-label" }, "ההקלטה כוללת הברה אשכנזית"),
      this.ashkenaziCheck
    ));

    // מספר מחזורים
    const runsCard = el("div", { class: "tt-card" });
    f.appendChild(runsCard);

    runsCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "מספר מחזורי תמלול מ-Gemini (3 – 10):"
    ));

    this.runsValueLabel = el(
      "div",
      { class: "tt-slider-value" },
      String(this.appState.n_runs)
    );
    this.runsSlider = el("input", {
      type: "range",
      class: "tt-slider",
      min: "3",
      max: "10",
      step: "1",
      value: String(this.appState.n_runs),
      oninput: (ev) => {
        this.runsValueLabel.textContent = ev.target.value;
      },
    });
    runsCard.appendChild(el(
      "div",
      { class: "tt-slider-row" },
      this.runsValueLabel,
      this.runsSlider
    ));

    runsCard.appendChild(el(
      "div",
      { class: "tt-note" },
      "3 = דיוק בסיסי. 10 = דיוק גבוה לעבודות עסקיות. במקרה של סתירה — הרוב קובע."
    ));

    // === שורת עדים נוספת — שירות + כמות (נחשפת אחרי לחיצה על "+") ===
    this.elevenCard = el("div", { class: "tt-card", style: "display:none;" });
    f.appendChild(this.elevenCard);

    const elevenHeader = el(
      "div",
      { class: "tt-card-header" },
      el(
        "div",
        { class: "tt-h2", style: "margin:0;" },
        "שירות נוסף לתמלול (אודיו/וידאו):"
      ),
      el(
        "button",
        {
          class: "tt-remove-service-btn",
          onclick: () => this._onRemoveExtraService(),
        },
        "✕"
      )
    );
    this.elevenCard.appendChild(elevenHeader);

    this.extraServiceSelect = el(
      "select",
      { class: "tt-input" },
      el("option", { value: "ElevenLabs" }, "ElevenLabs")
    );
    this.elevenCard.appendChild(this.extraServiceSelect);

    this.elevenCard.appendChild(el(
      "div",
      { class: "tt-h2", style: "margin-top:12px;" },
      "כמות עדים מהשירות הזה:"
    ));

    this.elevenRunsValue = el(
      "div",
      { class: "tt-slider-value" },
      String(Math.max(1, this.appState.elevenlabs_runs || 1))
    );
    this.elevenRunsSlider = el("input", {
      type: "range",
      class: "tt-slider",
      min: "1",
      max: "3",
      step: "1",
      value: String(Math.max(1, this.appState.elevenlabs_runs || 1)),
      oninput: (ev) => {
        this.elevenRunsValue.textContent = ev.target.value;
      },
    });
    this.elevenCard.appendChild(el(
      "div",
      { class: "tt-slider-row" },
      this.elevenRunsValue,
      this.elevenRunsSlider
    ));

    this.elevenCard.appendChild(el(
      "div",
      { class: "tt-note" },
      "1-3 = מספר עדי נוסח נוספים מהשירות הזה לדיין."
    ));

    // שפת התמלול — ברירת מחדל עברית
    this.elevenCard.appendChild(el(
      "div",
      { class: "tt-h2", style: "margin-top:12px;" },
      "שפת התמלול:"
    ));

    this._eleven_lang_options = [
      "עברית", "English", "אידיש", "ערבית", "ארמית",
      "ספרדית", "צרפתית", "רוסית", "אוטומטי (זיהוי אוטומטי)",
    ];
    this._eleven_lang_to_code = {
      "עברית": "heb",
      "English": "eng",
      "אידיש": "yid",
      "ערבית": "ara",
      "ארמית": "arc",
      "ספרדית": "spa",
      "צרפתית": "fra",
      "רוסית": "rus",
      "אוטומטי (זיהוי אוטומטי)": "",
    };
    const savedCode = (this.appState.elevenlabs_language || "heb").trim();
    let defaultLabel = "עברית";
    let foundLabel = false;
    for (const [label, code] of Object.entries(this._eleven_lang_to_code)) {
      if (code === savedCode) {
        defaultLabel = label;
        foundLabel = true;
        break;
      }
    }
    if (!foundLabel && savedCode &&
        !Object.values(this._eleven_lang_to_code).includes(savedCode)) {
      defaultLabel = savedCode;
    }

    this.elevenLangInput = el("input", {
      type: "text",
      class: "tt-input",
      list: "tt-eleven-lang-list",
      value: defaultLabel,
    });
    const dataList = el("datalist", { id: "tt-eleven-lang-list" });
    for (const label of this._eleven_lang_options) {
      dataList.appendChild(el("option", { value: label }));
    }
    this.elevenCard.appendChild(this.elevenLangInput);
    this.elevenCard.appendChild(dataList);

    this.elevenCard.appendChild(el(
      "div",
      { class: "tt-note" },
      "בחר מהרשימה או הקלד קוד שפה (לדוגמה: heb, eng, yid)."
    ));

    // === כפתור "+ הוסף עדים מ-ElevenLabs" ===
    this.addServiceBtn = el(
      "button",
      {
        class: "tt-add-service-btn",
        onclick: () => this._onAddExtraService(),
      },
      "+ הוסף עדים מ-ElevenLabs"
    );
    f.appendChild(this.addServiceBtn);

    // === מודל מועדף — נחשף רק כשנבחרו שני מנועים ===
    this.prefCard = el("div", { class: "tt-card", style: "display:none;" });
    f.appendChild(this.prefCard);

    this.prefCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "מי החשוב? (קובע רק במקרה שוויון בין הנוסחים):"
    ));

    this.prefElevenRadio = el("input", {
      type: "radio",
      name: "tt-pref-engine",
      value: "elevenlabs",
      ...(this.appState.preferred_engine === "elevenlabs" ? { checked: "checked" } : {}),
    });
    this.prefCard.appendChild(el(
      "label",
      { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, "ElevenLabs"),
      this.prefElevenRadio
    ));

    this.prefGeminiRadio = el("input", {
      type: "radio",
      name: "tt-pref-engine",
      value: "gemini",
      ...(this.appState.preferred_engine === "gemini" ? { checked: "checked" } : {}),
    });
    this.prefCard.appendChild(el(
      "label",
      { class: "tt-radio-row" },
      el("span", { class: "tt-radio-label" }, "Gemini"),
      this.prefGeminiRadio
    ));

    if (this.appState.elevenlabs_runs > 0) {
      this._showExtraServiceCard();
    } else {
      this._hideExtraServiceCard();
    }
  }

  _showExtraServiceCard() {
    this.elevenCard.style.display = "";
    this.prefCard.style.display = "";
    this.addServiceBtn.style.display = "none";
  }
  _hideExtraServiceCard() {
    this.elevenCard.style.display = "none";
    this.prefCard.style.display = "none";
    this.addServiceBtn.style.display = "";
  }

  _onAddExtraService() {
    let cur = parseInt(this.elevenRunsSlider.value, 10);
    if (!cur || cur < 1) {
      this.elevenRunsSlider.value = "1";
      this.elevenRunsValue.textContent = "1";
    }
    this._showExtraServiceCard();
  }

  _onRemoveExtraService() {
    this.elevenRunsSlider.value = "0";
    this.elevenRunsValue.textContent = "0";
    this.appState.elevenlabs_runs = 0;
    this._hideExtraServiceCard();
  }

  // === שלב 4: דוגמאות OCR ===
  _buildOcrFrame() {
    const f = this._newFrame("ocr");

    f.appendChild(el("div", { class: "tt-h1" }, "דוגמאות OCR (תמונה ↔ הקלדה)"));
    f.appendChild(el(
      "div",
      { class: "tt-info" },
      "אופציונלי. שייך לכל מצב OCR — כתב יד או דפוס. הוסף זוגות תמונות " +
      "(תמונת המקור + הטקסט המוקלד הנכון) כדי לשפר את הזיהוי. אפשר לדלג."
    ));

    const btnRow = el("div", { class: "tt-row-flex", style: "margin-bottom:10px;" });
    f.appendChild(btnRow);

    btnRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-primary",
        style: "min-width:auto;height:42px;",
        onclick: () => this._addOcrExample(),
      },
      "הוסף דוגמה (תמונה + הקלדה)"
    ));

    btnRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-secondary",
        style: "min-width:120px;",
        onclick: () => this._clearOcrExamples(),
      },
      "נקה הכל"
    ));

    this.ocrList = el("textarea", {
      class: "tt-textarea",
      readonly: "readonly",
      style: "min-height:300px;",
    });
    f.appendChild(this.ocrList);
    this._refreshOcrList();
  }

  _addOcrExample() {
    const inputHw = el("input", {
      type: "file",
      accept: ".jpg,.jpeg,.png,.webp",
      onchange: (ev) => {
        const hw = ev.target.files && ev.target.files[0];
        if (!hw) return;
        const inputTyped = el("input", {
          type: "file",
          accept: ".jpg,.jpeg,.png,.webp",
          onchange: (ev2) => {
            const typed = ev2.target.files && ev2.target.files[0];
            if (!typed) return;
            this.appState.ocr_examples.push({ handwriting: hw, typed });
            this._refreshOcrList();
          },
        });
        inputTyped.click();
      },
    });
    inputHw.click();
  }

  _clearOcrExamples() {
    this.appState.ocr_examples = [];
    this._refreshOcrList();
  }

  _refreshOcrList() {
    if (!this.ocrList) return;
    if (this.appState.ocr_examples.length === 0) {
      this.ocrList.value = "(לא נוספו דוגמאות. אפשר לדלג לשלב הבא.)";
    } else {
      const lines = this.appState.ocr_examples.map(
        (ex, i) => `${i + 1}.   ${basename(ex.handwriting.name)}   ↔   ${basename(ex.typed.name)}`
      );
      this.ocrList.value = lines.join("\n");
    }
  }

  // === שלב 5: הוראות נוספות ===
  _buildCustomFrame() {
    const f = this._newFrame("custom");

    f.appendChild(el("div", { class: "tt-h1" }, "הוראות נוספות (אופציונלי)"));
    f.appendChild(el(
      "div",
      { class: "tt-info" },
      "כל מה שתכתוב כאן יישלח לבינה לפני הוראות המערכת ויקבל עדיפות גבוהה יותר. " +
      "לדוגמה: סגנון מסוים, ניקוד, מבנה הפלט, שמירת ביטויים מסוימים."
    ));

    this.customText = el("textarea", {
      class: "tt-textarea",
      style: "min-height:320px;",
    });
    this.customText.value = this.appState.custom_prompt || "";
    f.appendChild(this.customText);
  }

  // === שלב 6: בחירת דיין מכריע ===
  _buildJudgeFrame() {
    const f = this._newFrame("judge");

    f.appendChild(el("div", { class: "tt-h1" }, "בחירת הדיין המכריע"));
    f.appendChild(el(
      "div",
      { class: "tt-info" },
      "כאן בוחרים מי הוא הדיין שמכריע בין עדי הנוסח של Gemini ושולח לתמלול הסופי."
    ));

    // === כרטיס: בחירת הדיין המכריע ===
    const judgeCard = el("div", { class: "tt-card tt-card-gold-light" });
    f.appendChild(judgeCard);

    judgeCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "🎯  בחירת הדיין המכריע"
    ));

    judgeCard.appendChild(el(
      "div",
      { class: "tt-note" },
      "Gemini תמיד עושה את התמלול עצמו. הדיין הוא מי שבוחר את הנוסח " +
      "הסופי מתוך עדי הנוסח שיצאו ממחזורי התמלול."
    ));

    const opts = [
      ["claude",
       "🤖  Claude מכריע  ·  איכות גבוהה (מומלץ)",
       "מודל Claude נפרד משווה את עדי הנוסח ובוחר את הקריאה הטובה ביותר. " +
       "הזיות מודלים נוטות להיות יחידאיות, ולכן דיין נפרד מסנן אותן יעיל."],
      ["gemini_only",
       "⚡  רק Gemini  ·  זול יותר, איכות מעט נמוכה",
       "Gemini עצמו עושה גם את התמלול וגם את ההכרעה. בלי מפתח Claude. " +
       "מתאים לבדיקות מהירות וכשאין יתרת קרדיט אצל Anthropic."],
    ];
    this.judgeRadios = {};
    for (const [value, label, desc] of opts) {
      const radio = el("input", {
        type: "radio",
        name: "tt-judge",
        value: value,
        ...(this.appState.judge_mode === value ? { checked: "checked" } : {}),
      });
      this.judgeRadios[value] = radio;
      judgeCard.appendChild(el(
        "label",
        { class: "tt-radio-row" },
        el("span", { class: "tt-radio-label" }, label),
        radio
      ));
      judgeCard.appendChild(el(
        "div",
        { class: "tt-note", style: "padding-right:28px;" },
        desc
      ));
    }

    judgeCard.appendChild(el(
      "div",
      { class: "tt-note", style: "color:#f4d35e;margin-top:6px;" },
      "ℹ  ההנחיות עצמן נשמרות בשרת מרוחק (Google Apps Script) ומתעדכנות אצל כולם בו-זמנית."
    ));

    // === כרטיס: מהדורות חיצוניות (אופציונלי) ===
    const extCard = el("div", { class: "tt-card tt-card-gold-light" });
    f.appendChild(extCard);

    extCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "📥  מהדורות חיצוניות (אופציונלי)"
    ));

    extCard.appendChild(el(
      "div",
      { class: "tt-note" },
      "כאן אפשר לצרף מהדורות תמלול שכבר הופקו בתוכנות אחרות " +
      "(למשל ABBYY) — הן יצורפו לעדי הנוסח של Gemini ויישלחו " +
      "לדיין יחד איתם. תומך בקבצי TXT."
    ));

    extCard.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-secondary",
        style: "min-width:auto;height:36px;margin-top:8px;",
        onclick: () => this._onAddExternalEdition(),
      },
      "➕ הוסף מהדורה חיצונית"
    ));

    this.extListFrame = el("div", { style: "margin-top:8px;" });
    extCard.appendChild(this.extListFrame);
    this._renderExternalEditionsList();
  }

  _onAddExternalEdition() {
    const input = el("input", {
      type: "file",
      multiple: "multiple",
      accept: ".txt,.docx,.pdf",
      onchange: async (ev) => {
        const files = Array.from(ev.target.files || []);
        if (!files.length) return;
        let added = 0;
        const failed = [];
        for (const p of files) {
          try {
            const text = await this._loadExternalText(p);
            if (!text.trim()) {
              failed.push(`${p.name}: ריק`);
              continue;
            }
            this.appState.external_editions.push({ name: p.name, text });
            added += 1;
          } catch (e) {
            failed.push(`${p.name}: ${e && e.message ? e.message : e}`);
            logExc(`external edition load failed: ${p.name}`, e);
          }
        }
        this._renderExternalEditionsList();
        if (failed.length) {
          showMessage(
            "חלק מהקבצים לא נטענו",
            `נוספו: ${added}\nנכשלו:\n${failed.join("\n")}`
          );
        }
      },
    });
    input.click();
  }

  async _loadExternalText(file) {
    const ext = suffixLower(file.name);
    if (ext === ".txt") {
      // נסיון עברית UTF-8 → CP1255 fallback
      const buf = await file.arrayBuffer();
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch (e) {
        try {
          return new TextDecoder("windows-1255").decode(buf);
        } catch (e2) {
          return new TextDecoder("utf-8").decode(buf);
        }
      }
    }
    // docx/pdf — לא נתמך בלקוח טהור, יידרש שרת. הצג הודעה ברורה.
    if (ext === ".docx" || ext === ".pdf") {
      throw new Error(`סוג קובץ לא נתמך בלקוח (רק TXT): ${ext}`);
    }
    throw new Error(`סוג קובץ לא נתמך: ${ext}`);
  }

  _removeExternalEdition(idx) {
    this.appState.external_editions.splice(idx, 1);
    this._renderExternalEditionsList();
  }

  _renderExternalEditionsList() {
    if (!this.extListFrame) return;
    this.extListFrame.replaceChildren();
    const items = this.appState.external_editions || [];
    if (!items.length) {
      this.extListFrame.appendChild(el(
        "div",
        { class: "tt-note" },
        "(לא נוספו מהדורות חיצוניות — אופציונלי)"
      ));
      return;
    }
    items.forEach((item, i) => {
      const chars = (item.text || "").length;
      const row = el(
        "div",
        { class: "tt-ext-row" },
        el(
          "button",
          {
            class: "tt-ext-remove",
            onclick: () => this._removeExternalEdition(i),
          },
          "✕"
        ),
        el(
          "div",
          { class: "tt-ext-name" },
          `📄 ${item.name}  ·  ${chars.toLocaleString("he-IL")} תווים`
        )
      );
      this.extListFrame.appendChild(row);
    });
  }

  // === שלב 9: סגנון תורני (אחרי הצגת פלט) ===
  _buildTorahStyleFrame() {
    const f = this._newFrame("torah_style");

    f.appendChild(el("div", { class: "tt-h1" }, "עיבוד בסגנון תורני"));
    f.appendChild(el(
      "div",
      { class: "tt-info" },
      "לאחר שהתקבלה המהדורה, אפשר להריץ עליה עיבוד נוסף " +
      "כדי לקבל עותק בסגנון לשון תורנית. בוחרים סגנון, " +
      "לוחצים על הכפתור — וזהו."
    ));

    // === כרטיס: בחירת סגנון ===
    const styleCard = el("div", { class: "tt-card tt-card-gold-light" });
    f.appendChild(styleCard);

    styleCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "🖋  בחירת סגנון"
    ));

    const styleOpts = [
      ["ancient", "📜  כסגנון הראשונים (עתיק)",
       'לשון של רש"י, רמב"ן, ראשונים — שפה גבוהה ועתיקה.'],
      ["modern", "✍  כתלמידי חכמים בני זמננו (עכשווי)",
       "לשון תורנית עכשווית, כפי שמדברים תלמידי חכמים היום."],
      ["combined", "🎭  שילוב של שניהם (מומלץ)",
       "מאוזן בין סגנון עתיק לעכשווי — מתאים לרוב המקרים."],
    ];
    this.torahStyleRadios = {};
    for (const [value, label, desc] of styleOpts) {
      const radio = el("input", {
        type: "radio",
        name: "tt-torah-style",
        value: value,
        ...(this.appState.torah_style === value ? { checked: "checked" } : {}),
      });
      this.torahStyleRadios[value] = radio;
      styleCard.appendChild(el(
        "label",
        { class: "tt-radio-row" },
        el("span", { class: "tt-radio-label" }, label),
        radio
      ));
      styleCard.appendChild(el(
        "div",
        { class: "tt-note", style: "padding-right:28px;" },
        desc
      ));
    }
    styleCard.appendChild(el(
      "div",
      { class: "tt-note", style: "color:#f4d35e;margin-top:6px;" },
      "ℹ  ההנחיות לכל סגנון יושבות ב-Google Apps Script " +
      "(torah_style_ancient / torah_style_modern / torah_style_combined)."
    ));

    // === פעולה ===
    const actionRow = el("div", { class: "tt-row-flex", style: "margin-top:8px;" });
    f.appendChild(actionRow);

    this.torahStyleBtn = el(
      "button",
      {
        class: "tt-style-btn",
        onclick: () => this._onRunTorahStyle(),
      },
      "▶  עבד את המהדורה לסגנון תורני"
    );
    actionRow.appendChild(this.torahStyleBtn);

    this.torahStyleCancelBtn = el(
      "button",
      {
        class: "tt-style-cancel-btn",
        style: "display:none;",
        onclick: () => this._onCancelTorahStyle(),
      },
      "✕ בטל"
    );
    actionRow.appendChild(this.torahStyleCancelBtn);

    this.torahStyleStatus = el(
      "div",
      { class: "tt-status" },
      "ממתין לבחירה…"
    );
    f.appendChild(this.torahStyleStatus);

    this.torahStyleProgress = el("div", { class: "tt-progress" });
    this.torahStyleProgressFill = el("div", { class: "tt-progress-fill" });
    this.torahStyleProgress.appendChild(this.torahStyleProgressFill);
    f.appendChild(this.torahStyleProgress);

    // === תיבת תוצאה ===
    const resultCard = el("div", { class: "tt-card" });
    f.appendChild(resultCard);

    resultCard.appendChild(el(
      "div",
      { class: "tt-h2" },
      "📄  תוצאה"
    ));

    this.torahStyleBox = el("textarea", {
      class: "tt-textarea",
      style: "min-height:200px;",
    });
    resultCard.appendChild(this.torahStyleBox);

    const saveRow = el("div", { class: "tt-row-flex", style: "margin-top:6px;" });
    saveRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-secondary",
        onclick: () => this._saveText("torah_style"),
      },
      "💾 שמור סגנון תורני"
    ));
    saveRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-primary",
        onclick: () => this._insertToEditor("torah_style"),
      },
      "📥 הכנס לעורך"
    ));
    resultCard.appendChild(saveRow);
  }

  // === שלב 7: הפעלה ===
  _buildRunFrame() {
    const f = this._newFrame("run");

    f.appendChild(el("div", { class: "tt-h1" }, "הפעלה"));

    this.summaryLabel = el(
      "div",
      { class: "tt-info", style: "white-space:pre-line;" },
      ""
    );
    f.appendChild(this.summaryLabel);

    // שורה אחת עם שני כפתורים: הפעל + בטל. הכפתור "בטל" מוסתר עד שמתחילה ריצה.
    const btnRow = el("div", { class: "tt-row-flex", style: "margin-bottom:16px;" });
    f.appendChild(btnRow);

    this.runBtn = el(
      "button",
      {
        class: "tt-run-btn",
        onclick: () => this._onRun(),
      },
      "▶  הפעל תמלול והכרעה"
    );
    btnRow.appendChild(this.runBtn);

    this.cancelBtn = el(
      "button",
      {
        class: "tt-cancel-btn",
        style: "display:none;",
        onclick: () => this._onCancelRun(),
      },
      "✕ בטל"
    );
    btnRow.appendChild(this.cancelBtn);

    this.statusLabel = el(
      "div",
      { class: "tt-status" },
      "מוכן להפעלה"
    );
    f.appendChild(this.statusLabel);

    this.progressBar = el("div", { class: "tt-progress" });
    this.progressFill = el("div", { class: "tt-progress-fill" });
    this.progressBar.appendChild(this.progressFill);
    f.appendChild(this.progressBar);
  }

  _refreshRunSummary() {
    const s = this.appState;
    const lines = [];
    lines.push(`חשבון: ${s.use_premium ? "פרמיום" : "מפתחות אישיים"}`);
    if (s.file_name) lines.push(`קובץ: ${s.file_name}`);
    lines.push(`מצב: ${s.mode === "transcription" ? "תמלול רגיל" : "OCR"}`);
    if (s.mode === "transcription") {
      lines.push(`סוג: ${s.torah_mode ? "תורני" : "רגיל"}`);
      if (s.torah_mode && s.ashkenazi) lines.push("הברה: אשכנזית");
    }
    lines.push(`מחזורי תמלול: ${s.n_runs}`);
    if (s.mode === "ocr") lines.push(`דוגמאות OCR: ${s.ocr_examples.length}`);
    if (s.custom_prompt) lines.push(`הוראות נוספות: ${s.custom_prompt.length} תווים`);
    if (s.judge_mode === "gemini_only") {
      lines.push("דיין מכריע: Gemini בלבד (בלי Claude)");
    } else {
      lines.push("דיין מכריע: Claude (איכות גבוהה)");
    }
    lines.push("(עיבוד בסגנון תורני זמין בשלב 9 לאחר קבלת המהדורה)");
    this.summaryLabel.textContent = lines.map((l) => "• " + l).join("\n");
  }

  // === שלב 8: הצגת פלט ===
  _buildOutputFrame() {
    const f = this._newFrame("output");

    const headCard = el("div", { class: "tt-card tt-card-gold-light" });
    f.appendChild(headCard);

    headCard.appendChild(el("div", { class: "tt-h1" }, "📄  הצגת פלט"));
    headCard.appendChild(el(
      "div",
      { class: "tt-note" },
      "המהדורה היא הנוסח הסופי לאחר הכרעה. עדי הנוסח הם תוצאות מחזורי " +
      "התמלול הגולמיים. אם הופעלה עריכה תורנית — היא תופיע בלשונית נפרדת."
    ));

    // tabview
    const tabview = el("div", { class: "tt-tabview" });
    f.appendChild(tabview);
    this.outputTabview = tabview;

    const headers = el("div", { class: "tt-tabview-headers" });
    const content = el("div", { class: "tt-tabview-content" });
    tabview.appendChild(headers);
    tabview.appendChild(content);

    const editionTab = el("div", { class: "tt-tabview-pane active" });
    const witnessesTab = el("div", { class: "tt-tabview-pane" });

    this.editionBox = el("textarea", {
      class: "tt-textarea",
      style: "flex:1;min-height:240px;",
    });
    editionTab.appendChild(this.editionBox);

    this.witnessesBox = el("textarea", {
      class: "tt-textarea",
      style: "flex:1;min-height:240px;font-size:12px;",
    });
    witnessesTab.appendChild(this.witnessesBox);

    const editionHeader = el(
      "button",
      {
        class: "tt-tabview-tab active",
        onclick: () => {
          editionHeader.classList.add("active");
          witnessesHeader.classList.remove("active");
          editionTab.classList.add("active");
          witnessesTab.classList.remove("active");
        },
      },
      "מהדורה (הכרעת נוסח)"
    );
    const witnessesHeader = el(
      "button",
      {
        class: "tt-tabview-tab",
        onclick: () => {
          witnessesHeader.classList.add("active");
          editionHeader.classList.remove("active");
          witnessesTab.classList.add("active");
          editionTab.classList.remove("active");
        },
      },
      "עדי נוסח"
    );
    headers.appendChild(editionHeader);
    headers.appendChild(witnessesHeader);

    content.appendChild(editionTab);
    content.appendChild(witnessesTab);

    const saveRow = el("div", { class: "tt-row-flex", style: "margin-top:10px;" });
    f.appendChild(saveRow);

    saveRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-secondary",
        onclick: () => this._saveText("edition"),
      },
      "💾 שמור מהדורה"
    ));

    saveRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-secondary",
        onclick: () => this._saveText("witnesses"),
      },
      "💾 שמור עדי נוסח"
    ));

    saveRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-primary",
        onclick: () => this._insertToEditor("edition"),
      },
      "📥 הכנס לעורך"
    ));

    saveRow.appendChild(el(
      "button",
      {
        class: "tt-btn tt-btn-primary",
        onclick: () => {
          const idx = STEPS.findIndex(([k]) => k === "torah_style");
          this._showStep(idx >= 0 ? idx : STEPS.length - 1);
        },
      },
      "המשך לסגנון תורני ←"
    ));
  }

  _saveText(kind) {
    let text = "";
    if (kind === "edition") text = (this.editionBox.value || "").trim();
    else if (kind === "witnesses") text = (this.witnessesBox.value || "").trim();
    else if (kind === "torah_style") text = (this.torahStyleBox.value || "").trim();

    if (!text) {
      showMessage("ריק", "אין טקסט לשמור.");
      return;
    }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const fname = ({
      edition: "מהדורה.txt",
      witnesses: "עדי-נוסח.txt",
      torah_style: "סגנון-תורני.txt",
    })[kind];
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { URL.revokeObjectURL(a.href); } catch (e) {}
      try { a.remove(); } catch (e) {}
    }, 100);
  }

  _insertToEditor(kind) {
    let text = "";
    if (kind === "edition") text = (this.editionBox.value || "").trim();
    else if (kind === "witnesses") text = (this.witnessesBox.value || "").trim();
    else if (kind === "torah_style") text = (this.torahStyleBox.value || "").trim();
    if (!text) {
      showMessage("ריק", "אין טקסט להכניס.");
      return;
    }
    if (typeof this.onResult === "function") {
      try {
        this.onResult(text, kind);
        this.close();
        return;
      } catch (e) {
        logExc("onResult error", e);
      }
    }
    showMessage("שגיאה", "לא הצלחתי להכניס לעורך.");
  }

  // ============= NAVIGATION =============

  _showStep(idx) {
    // ולידציה לפני מעבר קדימה
    if (idx > this.currentStep) {
      const err = this._validateStep(this.currentStep);
      if (err) {
        showMessage("חסר משהו", err);
        return;
      }
    }

    // שמירת ערכים מהשלב הנוכחי
    this._saveCurrentStepState();

    // דלג על שלב OCR אם לא במצב OCR
    if (STEPS[idx][0] === "ocr" && this.appState.mode !== "ocr") {
      if (idx > this.currentStep) idx += 1;
      else idx -= 1;
      if (idx >= STEPS.length || idx < 0) return;
    }

    this.currentStep = idx;
    const key = STEPS[idx][0];

    // עדכון סרגל
    for (const [k, btn] of Object.entries(this.tabButtons)) {
      if (k === key) btn.classList.add("active");
      else btn.classList.remove("active");
    }

    // החלפת תוכן
    for (const f of Object.values(this.frames)) {
      f.style.display = "none";
    }
    this.frames[key].style.display = "block";

    // עדכון כפתורי ניווט
    this.backBtn.disabled = idx === 0;
    if (key === "run") {
      this._refreshRunSummary();
      this.nextBtn.textContent = "הבא ←";
      this.nextBtn.disabled = true;
    } else if (key === "torah_style") {
      this.nextBtn.textContent = "סיום";
      this.nextBtn.disabled = false;
    } else if (key === "output") {
      this.nextBtn.textContent = "המשך לסגנון תורני ←";
      this.nextBtn.disabled = false;
    } else {
      this.nextBtn.textContent = "המשך ←";
      this.nextBtn.disabled = false;
    }
  }

  _validateStep(idx) {
    const key = STEPS[idx][0];
    if (key === "account") {
      const mode = this._getUsageMode();
      if (mode === "premium") {
        const code = (this.accessEntry.value || "").trim();
        if (!code) return "חסר קוד גישה לפרמיום.";
      } else {
        if (!(this.geminiEntry.value || "").trim()) {
          return "חסר מפתח Gemini (תמיד נדרש לתמלול).";
        }
      }
    } else if (key === "file") {
      if (!this.appState.file_blob) return "לא נבחר קובץ.";
    } else if (key === "judge") {
      const mode = this._getUsageMode();
      if (mode !== "premium") {
        const judge =
          (this.judgeRadios && this.judgeRadios.claude && this.judgeRadios.claude.checked)
            ? "claude"
            : "gemini_only";
        if (judge === "claude" && !(this.claudeEntry.value || "").trim()) {
          return (
            "בחרת Claude כדיין מכריע, אבל לא הוזן מפתח Claude.\n" +
            "חזור לשלב 1 והוסף מפתח, או בחר כאן 'רק Gemini'."
          );
        }
      }
    }
    return "";
  }

  _saveCurrentStepState() {
    const key = STEPS[this.currentStep][0];
    if (key === "account") {
      const mode = this._getUsageMode();
      this.appState.use_premium = (mode === "premium");
      this.appState.access_code = (this.accessEntry.value || "").trim();
      this.appState.gemini_api_key = (this.geminiEntry.value || "").trim();
      this.appState.claude_api_key = (this.claudeEntry.value || "").trim();
      this.appState.elevenlabs_api_key = (this.elevenlabsEntry.value || "").trim();
      this.appState.gemini_only = !!this.geminiOnlyCheck.checked;
      saveConfig({
        use_premium: this.appState.use_premium,
        access_code: this.appState.access_code,
        gemini_api_key: this.appState.gemini_api_key,
        claude_api_key: this.appState.claude_api_key,
        elevenlabs_api_key: this.appState.elevenlabs_api_key,
        gemini_only: this.appState.gemini_only,
      });
    } else if (key === "options") {
      this.appState.mode = this.modeOcr.checked ? "ocr" : "transcription";
      this.appState.torah_mode = !!this.audioTorah.checked;
      this.appState.ashkenazi = !!this.ashkenaziCheck.checked;
      this.appState.n_runs = parseInt(this.runsSlider.value, 10) || 3;
      try {
        this.appState.elevenlabs_runs = parseInt(this.elevenRunsSlider.value, 10) || 0;
      } catch (e) {
        this.appState.elevenlabs_runs = 0;
      }
      // אם השדה מוסתר → 0 (כפי שהקוד המקורי עושה דרך _on_remove_extra_service)
      if (this.elevenCard.style.display === "none") {
        this.appState.elevenlabs_runs = 0;
      }
      try {
        const radios = this.modal.querySelectorAll('input[name="tt-pref-engine"]');
        for (const r of radios) {
          if (r.checked) {
            this.appState.preferred_engine = r.value || "gemini";
            break;
          }
        }
      } catch (e) {
        this.appState.preferred_engine = "gemini";
      }
      try {
        const langLabel = (this.elevenLangInput.value || "").trim();
        // אם זו תווית שאנחנו מכירים — תרגם לקוד; אחרת — הקלדה ידנית, קח כפי שהיא
        const langCode = (this._eleven_lang_to_code[langLabel] != null
          ? this._eleven_lang_to_code[langLabel]
          : langLabel
        ).trim();
        this.appState.elevenlabs_language = langCode || "heb";
        saveConfig({ elevenlabs_language: this.appState.elevenlabs_language });
      } catch (e) {
        this.appState.elevenlabs_language = "heb";
      }
    } else if (key === "custom") {
      this.appState.custom_prompt = (this.customText.value || "").trim();
    } else if (key === "judge") {
      const radios = this.modal.querySelectorAll('input[name="tt-judge"]');
      for (const r of radios) {
        if (r.checked) {
          this.appState.judge_mode = r.value;
          break;
        }
      }
      // backward-compat: gemini_only עדיין נשמר ב-config
      this.appState.gemini_only = (this.appState.judge_mode === "gemini_only");
      saveConfig({ gemini_only: this.appState.gemini_only });
    } else if (key === "torah_style") {
      try {
        const radios = this.modal.querySelectorAll('input[name="tt-torah-style"]');
        for (const r of radios) {
          if (r.checked) {
            this.appState.torah_style = r.value;
            break;
          }
        }
        saveConfig({ torah_style: this.appState.torah_style });
      } catch (e) {
        /* swallow */
      }
    }
  }

  _onNext() {
    const idx = this.currentStep + 1;
    if (idx >= STEPS.length) {
      // סיום — סגור
      this.close();
      return;
    }
    this._showStep(idx);
  }

  _onBack() {
    if (this.currentStep <= 0) return;
    this._showStep(this.currentStep - 1);
  }

  // ============= RUN =============

  _onRun() {
    log("--- _onRun clicked ---");
    const s = this.appState;
    log(`state: mode=${s.mode} torah_mode=${s.torah_mode} ` +
        `n_runs=${s.n_runs} judge_mode=${s.judge_mode} ` +
        `premium=${s.use_premium} file=${s.file_name}`);
    this.runBtn.disabled = true;
    this.runBtn.textContent = "עובד...";
    this.cancelBtn.style.display = "";
    this.statusLabel.textContent = "שולח לשרת...";
    this.progressFill.style.width = "10%";
    this._runClient = new GasClient();
    this._doRun(this._runClient);
  }

  _onCancelRun() {
    log("--- _onCancelRun clicked ---");
    const c = this._runClient;
    if (c) {
      try { c.cancel(); } catch (e) {}
    }
    this.cancelBtn.disabled = true;
    this.cancelBtn.textContent = "מבטל…";
    this.statusLabel.textContent = "ממתין לסיום הקריאה הנוכחית…";
  }

  async _doRun(client) {
    log("_doRun start");
    try {
      const s = this.appState;

      // קביעת prompt_type לפי סוג קובץ + מצב
      const ftype = detectFileType(s.file_name);
      let prompt_type;
      if (ftype === "audio" || ftype === "video") {
        prompt_type = s.torah_mode ? "audio_torah" : "audio_regular";
      } else if (s.mode === "ocr") {
        prompt_type = "ocr_handwriting";
      } else {
        prompt_type = "printed";
      }

      // מודל Gemini לתמלול
      const model_gemini = "gemini-3.1-pro-preview";

      // callback להעברת סטטוס מהקליינט (למשל המתנה אחרי מכסה) ל-UI
      const _statusCb = (msg) => {
        try { this.statusLabel.textContent = msg; } catch (e) {}
      };

      // במצב OCR עם PDF — בלקוח לא נריאלי לרסטר; שולחים את ה-PDF כמו שהוא ל-GAS
      const filesToSend = [s.file_blob];

      log(`prompt_type=${prompt_type} model=${model_gemini} ` +
          `file=${s.file_name} send_count=${filesToSend.length}`);

      // תמלול N פעמים, עם דחייה קצרה בין מחזורים
      const witnesses = [];
      const INTER_CYCLE_DELAY_SEC = 6;
      for (let i = 0; i < s.n_runs; i++) {
        if (client._cancelled) {
          log(`cancelled before cycle ${i + 1}`);
          throw new GasCancelledError("בוטל בין מחזורים");
        }
        this.statusLabel.textContent = `תמלול ${i + 1} מתוך ${s.n_runs}...`;
        this.progressFill.style.width = `${(0.1 + 0.7 * (i / s.n_runs)) * 100}%`;

        log(`cycle ${i + 1}/${s.n_runs}: POST start`);
        const resp = await client.call({
          prompt_type,
          model: model_gemini,
          access_code: s.use_premium ? s.access_code : null,
          api_key: !s.use_premium ? s.gemini_api_key : null,
          files: filesToSend,
          ocr_examples: s.ocr_examples.length ? s.ocr_examples : null,
          custom_prompt: s.custom_prompt || null,
          torah_mode: s.torah_mode,
          ashkenazi: s.ashkenazi,
          status_callback: _statusCb,
        });
        const result_len = (resp.result || "").length;
        log(`cycle ${i + 1}/${s.n_runs}: POST done, result chars=${result_len}`);
        witnesses.push(resp.result || "");

        // דחייה קצרה לפני המחזור הבא (לא לפני האחרון)
        if (i < s.n_runs - 1) {
          for (let sec = 0; sec < INTER_CYCLE_DELAY_SEC; sec++) {
            if (client._cancelled) throw new GasCancelledError("בוטל בין מחזורים");
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      // === עדים נוספים מ-ElevenLabs (רק לאודיו/וידאו) ===
      const elevenlabs_witnesses = [];
      const elevenlabs_runs = parseInt(s.elevenlabs_runs, 10) || 0;
      if (elevenlabs_runs > 0 && (ftype === "audio" || ftype === "video")) {
        log(`elevenlabs: starting ${elevenlabs_runs} runs`);
        for (let i = 0; i < elevenlabs_runs; i++) {
          if (client._cancelled) {
            log(`cancelled before elevenlabs cycle ${i + 1}`);
            throw new GasCancelledError("בוטל בין מחזורי ElevenLabs");
          }
          this.statusLabel.textContent = `ElevenLabs ${i + 1} מתוך ${elevenlabs_runs}...`;
          this.progressFill.style.width = `${(0.78 + 0.05 * (i / Math.max(elevenlabs_runs, 1))) * 100}%`;
          log(`elevenlabs cycle ${i + 1}/${elevenlabs_runs}: POST start`);
          // ElevenLabs לא מקבל פרומפט/הנחיות, רק language_code.
          // אין מסלול פרמיום — המפתח האישי של המשתמש נשלח תמיד.
          const resp_eleven = await client.call({
            prompt_type: "elevenlabs_transcribe",
            model: "elevenlabs-scribe-v1",
            access_code: null,
            api_key: s.elevenlabs_api_key,
            files: [s.file_blob],
            torah_mode: s.torah_mode,
            ashkenazi: s.ashkenazi,
            status_callback: _statusCb,
            language_code: s.elevenlabs_language || "heb",
          });
          const eleven_text = resp_eleven.result || "";
          log(`elevenlabs cycle ${i + 1}: chars=${eleven_text.length}`);
          elevenlabs_witnesses.push(eleven_text);
        }
      }

      // מהדורות חיצוניות
      const externals = (s.external_editions || []).slice();
      log(`external_editions: count=${externals.length}`);

      // הכרעת נוסח
      this.statusLabel.textContent = "הכרעת נוסח...";
      this.progressFill.style.width = "85%";

      // מודל להכרעה: gemini_only מכריע על המודל הזה ללא קשר לפרמיום
      const edition_model = s.gemini_only ? "gemini-3.1-pro-preview" : "claude-opus-4-7";
      const edition_api_key = s.use_premium
        ? null
        : (s.gemini_only ? s.gemini_api_key : s.claude_api_key);
      log(`edition: model=${edition_model} gemini_only=${s.gemini_only} ` +
          `premium=${s.use_premium} key_present=${!!edition_api_key}`);

      const payload_parts = witnesses.map(
        (w, i) => `--- עד נוסח ${i + 1} [Gemini] ---\n${w}`
      );
      elevenlabs_witnesses.forEach((w, k) => {
        payload_parts.push(`--- עד נוסח ElevenLabs ${k + 1} ---\n${w}`);
      });
      externals.forEach((ext, j) => {
        const label = ext.name || `חיצוני ${j + 1}`;
        payload_parts.push(`--- מהדורה חיצונית: ${label} ---\n${ext.text || ""}`);
      });

      const engines_used = [];
      if (witnesses.length) engines_used.push("gemini");
      if (elevenlabs_witnesses.length) engines_used.push("elevenlabs");
      let preferred_engine_for_judge = null;
      if (engines_used.length >= 2) {
        preferred_engine_for_judge = s.preferred_engine || "gemini";
      }
      log(`judge: engines_used=${engines_used.join(",")} ` +
          `preferred_engine=${preferred_engine_for_judge}`);

      const edition_resp = await client.call({
        prompt_type: "claude_edition",
        model: edition_model,
        access_code: s.use_premium ? s.access_code : null,
        api_key: edition_api_key,
        text_payload: payload_parts.join("\n\n"),
        custom_prompt: s.custom_prompt || null,
        status_callback: _statusCb,
        engines_used,
        preferred_engine: preferred_engine_for_judge,
      });
      const edition = edition_resp.result || "";

      this.appState.result = {
        witnesses,
        elevenlabs_witnesses,
        externals: externals.map((e) => ({ name: e.name || "", text: e.text || "" })),
        edition,
      };
      this.progressFill.style.width = "100%";
      this.statusLabel.textContent = "הסתיים בהצלחה";
      this._showResult();

    } catch (e) {
      if (e instanceof GasCancelledError) {
        log("_doRun cancelled by user");
        this.statusLabel.textContent = "הופסק על ידי המשתמש.";
        this.progressFill.style.width = "0%";
      } else if (e instanceof GasServerError ||
                 e instanceof GasNetworkError ||
                 e instanceof GasTimeoutError) {
        logExc("_doRun server/network error", e);
        const fe = friendlyError(String(e.message || e));
        showMessage(fe.title, fe.message);
      } else {
        logExc("_doRun unexpected error", e);
        const fe = friendlyError(String(e && e.message ? e.message : e));
        showMessage(fe.title, fe.message);
      }
    } finally {
      log("_doRun finally — reset UI");
      try {
        this.runBtn.disabled = false;
        this.runBtn.textContent = "▶  הפעל תמלול והכרעה";
      } catch (e) {}
      try {
        this.cancelBtn.disabled = false;
        this.cancelBtn.textContent = "✕ בטל";
        this.cancelBtn.style.display = "none";
      } catch (e) {}
    }
  }

  _showResult() {
    const r = this.appState.result;
    if (!r) return;
    this.editionBox.value = r.edition || "";

    const sections = r.witnesses.map((w, i) =>
      `${"=".repeat(60)}\nעד נוסח ${i + 1}\n${"=".repeat(60)}\n${w}`
    );
    for (const ext of r.externals || []) {
      const label = ext.name || "מהדורה חיצונית";
      sections.push(
        `${"=".repeat(60)}\nמהדורה חיצונית: ${label}\n${"=".repeat(60)}\n${ext.text || ""}`
      );
    }
    this.witnessesBox.value = sections.join("\n\n");

    // מעבר אוטומטי לשלב התוצאה (output)
    const out_idx = STEPS.findIndex(([k]) => k === "output");
    this.currentStep = out_idx - 1;
    this._showStep(out_idx);
  }

  _onRunTorahStyle() {
    log("--- _onRunTorahStyle clicked ---");
    // שלב 9 — מפעיל קריאה ל-GAS עם prompt_type=torah_style_<style>
    const r = this.appState.result;
    const edition = ((r || {}).edition || "").trim();
    if (!edition) {
      showMessage(
        "אין מהדורה",
        "צריך קודם להריץ תמלול והכרעת נוסח (שלב 7) " +
        "כדי שתהיה מהדורה לעבד."
      );
      return;
    }

    this.torahStyleBtn.disabled = true;
    this.torahStyleBtn.textContent = "עובד…";
    this.torahStyleCancelBtn.style.display = "";
    this.torahStyleStatus.textContent = "שולח לשרת לעיבוד תורני…";
    this.torahStyleProgressFill.style.width = "20%";
    this._torahClient = new GasClient();
    this._doRunTorahStyle(edition, this._torahClient);
  }

  _onCancelTorahStyle() {
    const c = this._torahClient;
    if (c) {
      try { c.cancel(); } catch (e) {}
    }
    this.torahStyleCancelBtn.disabled = true;
    this.torahStyleCancelBtn.textContent = "מבטל…";
    this.torahStyleStatus.textContent = "ממתין לסיום הקריאה הנוכחית…";
  }

  async _doRunTorahStyle(edition, client) {
    log("_doRunTorahStyle start");
    try {
      const s = this.appState;
      let style_name = "combined";
      const radios = this.modal.querySelectorAll('input[name="tt-torah-style"]');
      for (const r of radios) {
        if (r.checked) { style_name = r.value; break; }
      }
      log(`torah_style: style=${style_name} edition_chars=${edition.length}`);
      const edition_model = s.gemini_only ? "gemini-3.1-pro-preview" : "claude-opus-4-7";
      const edition_api_key = s.use_premium
        ? null
        : (s.gemini_only ? s.gemini_api_key : s.claude_api_key);

      this.torahStyleProgressFill.style.width = "50%";
      const _tsStatusCb = (msg) => {
        try { this.torahStyleStatus.textContent = msg; } catch (e) {}
      };
      const resp = await client.call({
        prompt_type: `torah_style_${style_name}`,
        model: edition_model,
        access_code: s.use_premium ? s.access_code : null,
        api_key: edition_api_key,
        text_payload: edition,
        custom_prompt: s.custom_prompt || null,
        status_callback: _tsStatusCb,
      });
      const text = resp.result || "";
      if (!this.appState.result) this.appState.result = {};
      this.appState.result.torah_style = text;
      this.appState.result.torah_style_name = style_name;

      try { this.torahStyleBox.value = text; } catch (e) {}
      this.torahStyleProgressFill.style.width = "100%";
      this.torahStyleStatus.textContent = `הסתיים — סגנון ${style_name}.`;

    } catch (e) {
      if (e instanceof GasCancelledError) {
        this.torahStyleStatus.textContent = "הופסק על ידי המשתמש.";
        this.torahStyleProgressFill.style.width = "0%";
      } else if (e instanceof GasServerError ||
                 e instanceof GasNetworkError ||
                 e instanceof GasTimeoutError) {
        const fe = friendlyError(String(e.message || e));
        showMessage(fe.title, fe.message);
        this.torahStyleStatus.textContent = "נכשל — נסה שוב.";
        this.torahStyleProgressFill.style.width = "0%";
      } else {
        const fe = friendlyError(String(e && e.message ? e.message : e));
        showMessage(fe.title, fe.message);
        this.torahStyleStatus.textContent = "נכשל — נסה שוב.";
        this.torahStyleProgressFill.style.width = "0%";
      }
    } finally {
      try {
        this.torahStyleBtn.disabled = false;
        this.torahStyleBtn.textContent = "▶  עבד את המהדורה לסגנון תורני";
      } catch (e) {}
      try {
        this.torahStyleCancelBtn.disabled = false;
        this.torahStyleCancelBtn.textContent = "✕ בטל";
        this.torahStyleCancelBtn.style.display = "none";
      } catch (e) {}
    }
  }

  // === public ===
  open(parent = document.body) {
    parent.appendChild(this.overlay);
    try { this.overlay.focus(); } catch (e) {}
  }

  close() {
    try {
      // ביטול ריצות תלויות אם קיימות
      if (this._runClient) { try { this._runClient.cancel(); } catch (e) {} }
      if (this._torahClient) { try { this._torahClient.cancel(); } catch (e) {} }
    } catch (e) {}
    try {
      this.overlay.remove();
    } catch (e) {}
  }
}
