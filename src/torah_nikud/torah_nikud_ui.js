// torah_nikud_ui.js — full UI port from main_window.py + widgets.py +
// webview_app.py + ui.html. Renders a modal with the same 3-step flow:
// (1) load material  (2) warnings  (3) send & result.
//
// The Python original ran in pywebview with a Python `Api` exposed to JS;
// here the same orchestration runs entirely in the browser. AI calls go
// through GAS per Moshe's "All AI through GAS" rule. Dicta is non-LLM.
//
// Public API: openTorahNikudModal({ initialText, onResult }).

import { STRINGS, t } from "./torah_nikud_i18n.js";
import { extractText } from "./torah_nikud_engine.js";
import {
  NikudGasClient,
  GasServerError, GasNetworkError, GasTimeoutError, GasCancelledError,
} from "./torah_nikud_gas.js";
import {
  NikudDictaClient,
  DictaServerError, DictaNetworkError, DictaTimeoutError, DictaCancelledError,
} from "./torah_nikud_dicta.js";
import {
  DAILY_FREE_CHARS, usedToday, canSend, recordUsage,
} from "./torah_nikud_quota.js";
import { hasCurrentAppLicense } from "../current_license.js";
import {
  getSyncedClaudeApiKey,
  getSyncedGeminiApiKey,
  saveSyncedClaudeApiKey,
  saveSyncedGeminiApiKey,
} from "../ai_key_sync.js";

const SETTINGS_KEY = "ravtext.torah_nikud.settings";
const RECENT_KEY = "ravtext.torah_nikud.recent";

// ---------- settings persistence (replaces config.json on Python side) ----------

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) || {} : {};
  } catch (e) { return {}; }
}
function saveSettings(d) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(d)); }
  catch (e) { /* noop */ }
}
function saveSetting(key, value) {
  const cfg = loadSettings();
  cfg[key] = value;
  saveSettings(cfg);
}
function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) || [] : [];
  } catch (e) { return []; }
}
function saveRecent(list) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list || [])); }
  catch (e) { /* noop */ }
}
function pushRecent(name) {
  const list = loadRecent().filter(p => p !== name);
  list.unshift(name);
  saveRecent(list.slice(0, 8));
}
function clearRecent() { saveRecent([]); }

function isPaidUser() {
  // Original Python uses license_manager.addons_allowed(). In the browser
  // we cannot verify the license cryptographically — assume free unless
  // explicitly flagged. Consumers can override via window.tnkIsPaid().
  try {
    if (hasCurrentAppLicense()) return true;
    if (typeof window !== "undefined" && typeof window.tnkIsPaid === "function") {
      return !!window.tnkIsPaid();
    }
  } catch (e) { /* noop */ }
  return false;
}

function useLegacyPremiumMode(apiMode) {
  return !hasCurrentAppLicense() && apiMode === "premium";
}

// Strip BiDi marks (mirrors webview_app.Api.get_settings._strip)
function stripBidi(s) {
  if (!s) return "";
  for (const ch of ["‎","‏","‪","‫","‬","‭","‮","⁦","⁧","⁨","⁩"]) {
    s = s.split(ch).join("");
  }
  return s.trim();
}

// ---------- modal state ----------

let modalEl = null;
let cssInjected = false;
let lang = "he";
let appearance = readHostAppearance();
let extEditions = [];          // {name, text}
let currentStep = 1;
let gasClient = null;
let dictaClient = null;
let cancelFlag = false;
let onResultCb = null;

function readHostAppearance() {
  try {
    const hostTheme = (document.body?.dataset?.theme || document.documentElement?.dataset?.theme || "").toLowerCase();
    if (hostTheme === "dark" || hostTheme === "royal") return "dark";
    if (document.body?.classList?.contains("dark-theme")) return "dark";
    return "light";
  } catch (_) {
    return "light";
  }
}

// ---------- modal creation ----------

async function injectCss() {
  if (cssInjected) return;
  try {
    // Vite raw CSS import
    const mod = await import("./torah_nikud_modal.css?raw");
    const style = document.createElement("style");
    style.id = "tnk-modal-style";
    style.textContent = mod.default || mod;
    document.head.appendChild(style);
  } catch (e) {
    // Fallback: try fetching via URL import
    try {
      const url = new URL("./torah_nikud_modal.css", import.meta.url).toString();
      const r = await fetch(url);
      const txt = await r.text();
      const style = document.createElement("style");
      style.id = "tnk-modal-style";
      style.textContent = txt;
      document.head.appendChild(style);
    } catch (e2) { /* css already in DOM somewhere */ }
  }
  cssInjected = true;
}

function html() {
  // Verbatim port of ui.html body, scoped under .tnk-root.
  return `
    <div class="header">
      <div class="left">
        <button id="tnk-btn-close" class="close-x" title="סגור">×</button>
        <button id="tnk-btn-lang">EN</button>
        <button id="tnk-btn-theme">☀</button>
      </div>
      <div class="title-block">
        <div class="title" id="tnk-app-title">ניקוד מדוייק (AI) — RavText</div>
        <div class="subtitle" id="tnk-marketing">תוכנת הניקוד מהמדויקות בעולם — בערך 100% דיוק.</div>
      </div>
    </div>

    <div class="step-bar">
      <div class="step active" data-step="1" id="tnk-step1">1. טעינת החומר</div>
      <div class="step" data-step="2" id="tnk-step2">2. אזהרות לפני שליחה</div>
      <div class="step" data-step="3" id="tnk-step3">3. שליחה ותוצאה</div>
    </div>

    <div class="quota-bar" id="tnk-quota-bar">—</div>

    <div class="content">

      <div class="step visible" data-step="1">
        <div class="row">
          <button id="tnk-btn-load-file" class="gold">📁 בחר קובץ…</button>
          <span class="file-status" id="tnk-file-status">txt / docx / rtf / md</span>
        </div>
        <div class="recent-row" id="tnk-recent-row" style="display:none;"></div>

        <div class="card">
          <div class="section-title" id="tnk-input-section">מקור הטקסט</div>
          <textarea id="tnk-text-box" class="tnk-text-box" placeholder="הדבק כאן את הטקסט לניקוד…"></textarea>
          <div class="live-counter" id="tnk-live-counter">אורך הטקסט: 0 תווים</div>
        </div>

        <div class="card">
          <div class="section-title" id="tnk-options-section">אפשרויות ניקוד</div>
          <label><input type="radio" name="tnk-nikud-mode" value="torah" checked>
            <span id="tnk-mode-torah">ניקוד תורני (מדוייק לפי הקשר תורני, ציטוטי תנ"ך, מינוח קדום)</span>
          </label>
          <label><input type="radio" name="tnk-nikud-mode" value="regular">
            <span id="tnk-mode-regular">ניקוד עברית עכשווית (דקדוק עכשווי)</span>
          </label>
          <hr>
          <label><input type="checkbox" id="tnk-cb-preserve-spelling">
            <span id="tnk-preserve">לא לשנות כתיב מלא/חסר (נסיוני)</span>
          </label>
        </div>

        <div class="card">
          <div class="section-title" id="tnk-provider-section">ספק הבינה (לעתק יחיד)</div>
          <label><input type="radio" name="tnk-provider" value="gemini" checked>
            <span id="tnk-prov-gemini">Gemini 3.1 Pro Preview · זול יותר</span>
          </label>
          <label><input type="radio" name="tnk-provider" value="claude">
            <span id="tnk-prov-claude">Claude Opus 4.7 · לשימוש עסקי</span>
          </label>
          <label><input type="radio" name="tnk-provider" value="dicta">
            <span id="tnk-prov-dicta">דיקטה · חינם, מהיר, ללא LLM</span>
          </label>
        </div>

        <div class="card">
          <div class="section-title" id="tnk-multi-section">ריבוי העתקים ודיין מכריע</div>
          <label><input type="checkbox" id="tnk-cb-multi">
            <span id="tnk-multi-enable">ניקוד עם ריבוי העתקים ודיין מכריע (איכות גבוהה יותר)</span>
          </label>
          <div class="note" id="tnk-multi-explain">המנקד יריץ את הטקסט כמה פעמים, וכל ריצה תפיק העתק עצמאי באותן אותיות עם ניקוד שלה. הדיין יבחר עבור כל אות את הניקוד לפי רוב מבין ההעתקים — ובתיקו לפי הקשר ודקדוק.</div>

          <div class="multi-body" id="tnk-multi-body">
            <hr>
            <div class="section-title" id="tnk-copies-label">מספר העתקים (3 – 10):</div>
            <div class="slider-row">
              <input type="range" id="tnk-copies-slider" min="3" max="10" step="1" value="3">
              <div class="num" id="tnk-copies-num">3</div>
            </div>
            <div class="note" id="tnk-copies-note">3 = דיוק בסיסי. 10 = דיוק גבוה לעבודות עסקיות. במקרה של סתירה — הרוב קובע.</div>

            <hr>
            <div class="section-title" id="tnk-engine-card">✏  בחירת המנקד</div>
            <div class="note" id="tnk-engine-top">המנקד הוא מי שמייצר את ההעתקים — כל ריצה היא ניקוד עצמאי של אותו טקסט.</div>

            <label style="display:block; margin: 8px 0;"><input type="checkbox" id="tnk-cb-mix">
              <span id="tnk-mix-enable">מצב מעורב — לקבל עדים מספקים שונים</span>
            </label>

            <div id="tnk-engine-single">
              <label><input type="radio" name="tnk-engine" value="gemini" checked>
                <span id="tnk-engine-gemini-label">⚡ Gemini מנקד · זול יותר</span>
              </label>
              <div class="note" style="margin-right:24px;" id="tnk-engine-gemini-desc">Gemini מבצע ניקוד מהיר ומדוייק. ברירת המחדל למנקד.</div>
              <label><input type="radio" name="tnk-engine" value="claude">
                <span id="tnk-engine-claude-label">🤖 Claude מנקד · איכות גבוהה יותר</span>
              </label>
              <div class="note" style="margin-right:24px;" id="tnk-engine-claude-desc">Claude מבצע ניקוד איכותי במיוחד. עולה יותר.</div>
              <label><input type="radio" name="tnk-engine" value="dicta">
                <span id="tnk-engine-dicta-label">📚 דיקטה מנקדת · חינם</span>
              </label>
              <div class="note" style="margin-right:24px;" id="tnk-engine-dicta-desc">ניקוד אלגוריתמי. מהיר ועקבי. דטרמיניסטי — ריצה אחת מספיקה.</div>
            </div>

            <div id="tnk-engine-mix" style="display:none;">
              <div class="note" id="tnk-mix-top">במצב מעורב הדיין יקבל עדים מכמה ספקים יחד. אפשר 0 עד 5 עדים מכל ספק. דיקטה דטרמיניסטית, אז יותר מ-1 שלה לא יוסיף דיוק.</div>
              <div class="slider-row" style="margin-top:8px;">
                <span style="min-width:80px;" id="tnk-mix-gemini">Gemini:</span>
                <input type="range" id="tnk-mix-gemini-slider" min="0" max="5" step="1" value="1">
                <div class="num" id="tnk-mix-gemini-num">1</div>
              </div>
              <div class="slider-row">
                <span style="min-width:80px;" id="tnk-mix-claude">Claude:</span>
                <input type="range" id="tnk-mix-claude-slider" min="0" max="5" step="1" value="1">
                <div class="num" id="tnk-mix-claude-num">1</div>
              </div>
              <div class="slider-row">
                <span style="min-width:80px;" id="tnk-mix-dicta">דיקטה:</span>
                <input type="range" id="tnk-mix-dicta-slider" min="0" max="1" step="1" value="1">
                <div class="num" id="tnk-mix-dicta-num">1</div>
              </div>
              <div class="note" id="tnk-mix-total" style="text-align:left; margin-top:6px;">סך עדים: 3</div>
            </div>

            <hr>
            <div class="section-title" id="tnk-judge-card">🎯  בחירת הדיין המכריע</div>
            <div class="note" id="tnk-judge-top">הדיין הוא מי שבוחר את הניקוד הסופי מתוך ההעתקים. אות-מול-אות, לפי רוב; ובתיקו לפי דקדוק וההקשר.</div>
            <label><input type="radio" name="tnk-judge" value="claude" checked>
              <span id="tnk-judge-claude-label">🤖 Claude מכריע · איכות גבוהה</span>
            </label>
            <div class="note" style="margin-right:24px;" id="tnk-judge-claude-desc">מודל Claude נפרד משווה את ההעתקים. הזיות מודלים נוטות להיות יחידאיות, ולכן דיין נפרד מסנן אותן יעיל.</div>
            <label><input type="radio" name="tnk-judge" value="gemini">
              <span id="tnk-judge-gemini-label">⚡ רק Gemini מכריע · זול יותר</span>
            </label>
            <div class="note" style="margin-right:24px;" id="tnk-judge-gemini-desc">Gemini עצמו עושה גם את הניקוד וגם את ההכרעה.</div>

            <hr>
            <div class="note" id="tnk-gas-note">ℹ ההנחיות עצמן נשמרות בשרת מרוחק (Google Apps Script) ומתעדכנות אצל כולם בו-זמנית.</div>

            <hr>
            <div class="section-title" id="tnk-ext-title">📥 מהדורות ניקוד חיצוניות (אופציונלי)</div>
            <div class="note" id="tnk-ext-desc">אפשר לצרף קבצי טקסט מנוקדים שכבר הופקו בכלים אחרים — הם יצורפו לעדי-הנוסח של המנקד וישלחו לדיין יחד איתם.</div>
            <button id="tnk-btn-add-ext">➕ הוסף מהדורה חיצונית</button>
            <div class="ext-list" id="tnk-ext-list"></div>
          </div>
        </div>

        <div class="card">
          <div class="section-title" id="tnk-api-section">חשבון ומפתחות בינה</div>
          <div class="note" id="tnk-api-inherit">המפתחות מסונכרנים אוטומטית עם כלי התמלול של רב טקסט.</div>
          <label><input type="radio" name="tnk-api-mode" value="premium">
            <span id="tnk-api-premium">⭐ פרמיום (תשלום לפי שימוש דרך השרת שלנו)</span>
          </label>
          <div style="margin-right:24px;">
            <div class="note" id="tnk-api-premium-note">אין צורך במפתחות API. תשלום לפי נקודות שנרכשו אצלנו.</div>
            <input type="password" dir="ltr" id="tnk-access-code" placeholder="קוד גישה">
          </div>
          <label style="margin-top:12px;"><input type="radio" name="tnk-api-mode" value="personal" checked>
            <span id="tnk-api-personal">🔐 מפתחות אישיים (תשלום ישיר לספקי הבינה)</span>
          </label>
          <div style="margin-right:24px;">
            <div class="info" id="tnk-api-gemini-label">מפתח Gemini:</div>
            <input type="password" dir="ltr" id="tnk-gemini-key" placeholder="AIza...">
            <div><a id="tnk-link-gemini" data-url="https://aistudio.google.com/apikey">🔗 קבל מפתח Gemini בחינם (Google AI Studio)</a></div>
            <div class="info" id="tnk-api-claude-label" style="margin-top:8px;">מפתח Claude:</div>
            <input type="password" dir="ltr" id="tnk-claude-key" placeholder="sk-ant-...">
            <div><a id="tnk-link-claude" data-url="https://console.anthropic.com/settings/keys">🔗 קבל מפתח Claude (Anthropic Console)</a></div>
          </div>
        </div>

        <div class="nav-row">
          <button class="gold big full" id="tnk-btn-next-warn">המשך לאזהרות ←</button>
        </div>
      </div>

      <div class="step" data-step="2">
        <div class="card warn">
          <div class="warn-title" id="tnk-warn-title">⚠ חשוב מאוד</div>
          <div class="info" id="tnk-warn-body">חובה לאחר הניקוד להשוות את הטקסט המקורי לטקסט המנוקד.</div>
        </div>

        <div class="card">
          <div class="section-title" id="tnk-warn-general">מה כדאי לדעת לפני השליחה</div>
          <div class="info">⚠ <span id="tnk-warn-short">מומלץ להתחיל עם טקסט קצר.</span></div>
          <div class="info">⚠ <span id="tnk-warn-net">צריך חיבור פעיל לאינטרנט.</span></div>
          <div class="info">⚠ <span id="tnk-warn-quota">השימוש נספר רק אחרי תשובה מוצלחת.</span></div>
          <div class="info">⚠ <span id="tnk-warn-prov">Gemini זול יותר; Claude איכותי יותר.</span></div>
          <div class="info">⚠ <span id="tnk-warn-pricing">השימוש מחושב לפי תווי קלט+פלט.</span></div>
          <div class="info">⚠ <span id="tnk-warn-no-email">התוצאה לא נשלחת לאף אחד אחר.</span></div>
          <div class="info">⚠ <span id="tnk-warn-first">הריצה הראשונה לפעמים איטית יותר.</span></div>
        </div>

        <div class="card" id="tnk-warn-summary"></div>

        <div class="nav-row">
          <button id="tnk-btn-back-load">→ חזרה לטעינה</button>
          <button class="gold grow big" id="tnk-btn-approve-send">אישרתי — שלח לבינה ▶</button>
        </div>
      </div>

      <div class="step" data-step="3">
        <div class="status" id="tnk-status">מוכן</div>
        <div class="progress"><div class="progress-fill" id="tnk-progress-fill"></div></div>
        <button class="danger" id="tnk-btn-cancel" style="display:none;">✕ בטל</button>

        <div class="card">
          <div class="section-title">תוצאה</div>
          <div class="note" id="tnk-output-help">המהדורה היא הניקוד הסופי. עדי-הנוסח הם ההעתקים הגולמיים. כל עד בלשונית נפרדת.</div>

          <div class="tabs" id="tnk-tabs">
            <div class="tab active" data-tab="edition" id="tnk-tab-edition">מהדורה (הכרעת הדיין)</div>
          </div>
          <div class="tab-content visible" data-tab-content="edition">
            <textarea class="result" id="tnk-edition-box"></textarea>
          </div>
          <div id="tnk-extra-tabs"></div>
        </div>

        <div class="nav-row">
          <button id="tnk-btn-back-warn">→ חזרה לאזהרות</button>
          <button id="tnk-btn-restart">↻ ניקוד חדש</button>
          <button id="tnk-btn-copy">📋 העתק</button>
          <button id="tnk-btn-save">💾 שמור</button>
          <button class="gold" id="tnk-btn-replace" title="החלף את הטקסט בעורך בטקסט המנוקד">⤵ החלף בעורך</button>
        </div>
      </div>

    </div>
  `;
}

// ---------- translation helpers ----------

function $(id) { return modalEl ? modalEl.querySelector("#" + id) : null; }
function $$(sel) { return modalEl ? modalEl.querySelectorAll(sel) : []; }

function applyTranslations() {
  if (!modalEl) return;
  modalEl.dir = lang === "he" ? "rtl" : "ltr";
  // map of element-id -> i18n key
  const map = {
    "tnk-app-title": "app_title",
    "tnk-marketing": "marketing",
    "tnk-step1": "step_load",
    "tnk-step2": "step_warn",
    "tnk-step3": "step_send",
    "tnk-input-section": "input_section",
    "tnk-options-section": "options_section",
    "tnk-mode-torah": "torah_mode",
    "tnk-mode-regular": "regular_mode_note",
    "tnk-preserve": "preserve_spelling",
    "tnk-provider-section": "provider_section",
    "tnk-prov-gemini": "provider_gemini",
    "tnk-prov-claude": "provider_claude",
    "tnk-prov-dicta": "provider_dicta",
    "tnk-multi-enable": "multi_enable",
    "tnk-multi-explain": "multi_explain",
    "tnk-copies-label": "multi_copies_label",
    "tnk-copies-note": "multi_copies_note",
    "tnk-engine-card": "multi_engine_card",
    "tnk-engine-top": "multi_engine_top",
    "tnk-mix-enable": "multi_mix_enable",
    "tnk-mix-top": "multi_mix_top",
    "tnk-mix-gemini": "multi_mix_gemini",
    "tnk-mix-claude": "multi_mix_claude",
    "tnk-mix-dicta": "multi_mix_dicta",
    "tnk-engine-gemini-label": "engine_gemini_label",
    "tnk-engine-gemini-desc": "engine_gemini_desc",
    "tnk-engine-claude-label": "engine_claude_label",
    "tnk-engine-claude-desc": "engine_claude_desc",
    "tnk-engine-dicta-label": "engine_dicta_label",
    "tnk-engine-dicta-desc": "engine_dicta_desc",
    "tnk-judge-card": "multi_judge_card",
    "tnk-judge-top": "multi_judge_top",
    "tnk-judge-claude-label": "judge_claude_label",
    "tnk-judge-claude-desc": "judge_claude_desc",
    "tnk-judge-gemini-label": "judge_gemini_label",
    "tnk-judge-gemini-desc": "judge_gemini_desc",
    "tnk-gas-note": "multi_gas_note",
    "tnk-ext-title": "ext_card_title",
    "tnk-ext-desc": "ext_card_desc",
    "tnk-api-section": "api_section",
    "tnk-api-inherit": "api_inherit_note",
    "tnk-api-premium": "api_premium_radio",
    "tnk-api-premium-note": "api_premium_note",
    "tnk-api-personal": "api_personal_radio",
    "tnk-api-gemini-label": "api_gemini_label",
    "tnk-api-claude-label": "api_claude_label",
    "tnk-link-gemini": "api_create_gemini",
    "tnk-link-claude": "api_create_claude",
    "tnk-warn-title": "warn_title",
    "tnk-warn-body": "warn_body",
    "tnk-warn-general": "warn_general_title",
    "tnk-warn-short": "warn_short_test",
    "tnk-warn-net": "warn_internet",
    "tnk-warn-quota": "warn_quota_paid",
    "tnk-warn-prov": "warn_provider_note",
    "tnk-warn-pricing": "warn_pricing",
    "tnk-warn-no-email": "warn_no_email_send",
    "tnk-warn-first": "warn_first_run_slow",
    "tnk-output-help": "output_help",
    "tnk-tab-edition": "tab_edition",
  };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id);
    if (el) el.textContent = t(lang, key);
  }
  const safeSet = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  safeSet("tnk-btn-load-file", "📁 " + t(lang, "choose_file"));
  safeSet("tnk-btn-add-ext", t(lang, "ext_add_btn"));
  safeSet("tnk-btn-next-warn", t(lang, "next_to_warn"));
  safeSet("tnk-btn-back-load", t(lang, "back_to_load"));
  safeSet("tnk-btn-back-warn", t(lang, "back_to_warn"));
  safeSet("tnk-btn-approve-send", t(lang, "approve_and_send"));
  safeSet("tnk-btn-restart", t(lang, "restart_btn"));
  safeSet("tnk-btn-copy", t(lang, "copy_btn"));
  safeSet("tnk-btn-save", t(lang, "save_btn"));
  safeSet("tnk-btn-cancel", t(lang, "cancel_btn"));
  safeSet("tnk-btn-lang", t(lang, "btn_lang"));
  const tb = $("tnk-text-box");
  if (tb) tb.placeholder = t(lang, "paste_placeholder");
  refreshLiveCounter();
  refreshQuotaBar();
}

function showStep(n) {
  currentStep = n;
  $$(".step[data-step]").forEach(el => {
    el.classList.toggle("visible", parseInt(el.dataset.step) === n);
  });
  $$(".step-bar .step").forEach(el => {
    el.classList.toggle("active", parseInt(el.dataset.step) === n);
  });
  if (n === 2) refreshSummary();
}

function refreshLiveCounter() {
  const tb = $("tnk-text-box");
  const lc = $("tnk-live-counter");
  if (tb && lc) lc.textContent = t(lang, "char_count_live", { n: tb.value.length });
}

function refreshQuotaBar() {
  const bar = $("tnk-quota-bar");
  if (!bar) return;
  if (isPaidUser()) {
    bar.textContent = t(lang, "quota_paid");
  } else {
    bar.textContent = t(lang, "quota_free", { used: usedToday(), limit: DAILY_FREE_CHARS });
  }
}

function refreshMixTotal() {
  const g = parseInt(($("tnk-mix-gemini-slider") || {}).value || "0", 10);
  const c = parseInt(($("tnk-mix-claude-slider") || {}).value || "0", 10);
  const d = parseInt(($("tnk-mix-dicta-slider") || {}).value || "0", 10);
  const total = g + c + d;
  const el = $("tnk-mix-total");
  if (el) el.textContent = t(lang, "multi_mix_total", { n: total });
}

// ---------- ext-edition list ----------

function refreshExtList() {
  const ul = $("tnk-ext-list");
  if (!ul) return;
  ul.innerHTML = "";
  extEditions.forEach((ed, i) => {
    const div = document.createElement("div");
    div.className = "ext-item";
    div.innerHTML = `<button class="ext-rm" type="button">${t(lang, "ext_remove_btn")}</button>
                     <span class="ext-name"></span>`;
    div.querySelector(".ext-name").textContent = `${ed.name} · ${ed.text.length}`;
    div.querySelector(".ext-rm").addEventListener("click", () => {
      extEditions.splice(i, 1);
      refreshExtList();
    });
    ul.appendChild(div);
  });
}

async function pickFiles(multiple = false, accept = ".txt,.docx,.rtf,.md") {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    if (multiple) inp.multiple = true;
    inp.style.display = "none";
    inp.addEventListener("change", () => {
      const files = Array.from(inp.files || []);
      document.body.removeChild(inp);
      resolve(files);
    });
    inp.addEventListener("cancel", () => {
      try { document.body.removeChild(inp); } catch (e) { /* noop */ }
      resolve([]);
    });
    document.body.appendChild(inp);
    inp.click();
  });
}

// ---------- recents ----------

function renderRecent() {
  const row = $("tnk-recent-row");
  if (!row) return;
  const recent = loadRecent();
  row.innerHTML = "";
  if (!recent.length) { row.style.display = "none"; return; }
  row.style.display = "flex";
  recent.slice(0, 5).forEach(name => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = name;
    pill.title = name;
    // Recents in browser are name-only — re-pick to load.
    pill.addEventListener("click", () => alert("בחר את הקובץ שוב מהדיסק (הדפדפן לא שומר תוכן בין סשנים)."));
    row.appendChild(pill);
  });
  const clr = document.createElement("span");
  clr.className = "pill";
  clr.style.background = "transparent";
  clr.textContent = t(lang, "recent_clear");
  clr.addEventListener("click", () => { clearRecent(); renderRecent(); });
  row.appendChild(clr);
}

// ---------- summary on warn step ----------

function refreshSummary() {
  const text = ($("tnk-text-box") || {}).value || "";
  const torahMode = (modalEl.querySelector('input[name="tnk-nikud-mode"]:checked') || {}).value === "torah";
  const preserve = ($("tnk-cb-preserve-spelling") || {}).checked;
  const multi = ($("tnk-cb-multi") || {}).checked;
  const provider = (modalEl.querySelector('input[name="tnk-provider"]:checked') || {}).value;
  const engine = (modalEl.querySelector('input[name="tnk-engine"]:checked') || {}).value;
  const judge = (modalEl.querySelector('input[name="tnk-judge"]:checked') || {}).value;
  const copies = parseInt(($("tnk-copies-slider") || {}).value || "3", 10);
  const lines = [
    t(lang, "load_chars_count", { n: text.length }),
    t(lang, torahMode ? "load_torah" : "load_regular"),
    t(lang, preserve ? "load_preserve_on" : "load_preserve_off"),
  ];
  if (multi) {
    lines.push(t(lang, "load_multi_on", {
      n: copies,
      e: engine === "gemini" ? "Gemini" : (engine === "claude" ? "Claude" : "Dicta"),
      j: judge === "gemini" ? "Gemini" : "Claude",
    }));
  } else {
    lines.push(t(lang, "load_provider", {
      p: provider === "gemini" ? "Gemini 3.1 Pro Preview"
        : provider === "claude" ? "Claude Opus 4.7" : "דיקטה",
    }));
  }
  const el = $("tnk-warn-summary");
  if (!el) return;
  el.innerHTML = "<div class='section-title'></div>";
  el.querySelector(".section-title").textContent = t(lang, "load_summary_title");
  for (const l of lines) {
    const div = document.createElement("div");
    div.className = "info";
    div.textContent = "• " + l;
    el.appendChild(div);
  }
}

// ---------- run/vocalize orchestration (port of webview_app.Api.vocalize) ----------

function clientFor(provider) {
  return provider === "dicta" ? dictaClient : gasClient;
}

async function vocalize(params) {
  // Mirrors webview_app.Api.vocalize line-for-line.
  cancelFlag = false;
  gasClient = new NikudGasClient();
  dictaClient = new NikudDictaClient();

  const text = params.text || "";
  const torah_mode = !!params.torah_mode;
  const preserve = !!params.preserve_spelling;
  const multi_on = !!params.multi_enable;
  const single_provider = params.provider || "gemini";
  const multi_engine = params.multi_engine || "gemini";
  const multi_judge = params.multi_judge || "claude";
  const n_copies = Math.max(3, Math.min(10, parseInt(params.multi_copies || 3, 10)));
  const is_premium = !!params.use_premium;
  const mix_enabled = !!params.multi_mix_enable;
  const mix_gemini = Math.max(0, Math.min(5, parseInt(params.multi_mix_gemini || 0, 10)));
  const mix_claude = Math.max(0, Math.min(5, parseInt(params.multi_mix_claude || 0, 10)));
  const mix_dicta = Math.max(0, Math.min(1, parseInt(params.multi_mix_dicta || 0, 10)));

  const _key_for = (provider) => {
    if (is_premium) return [params.access_code || null, null];
    if (provider === "gemini") return [null, params.gemini_api_key || null];
    if (provider === "claude") return [null, params.claude_api_key || null];
    return [null, null]; // dicta
  };

  try {
    if (!multi_on) {
      const [acc, key] = _key_for(single_provider);
      const client = clientFor(single_provider);
      const resp = await client.vocalize({
        text: text, torah_mode: torah_mode,
        preserve_spelling: preserve, provider: single_provider,
        access_code: acc, api_key: key,
      });
      const vocalized = resp.text || resp.result || resp.vocalized || "";
      if (!vocalized) return { ok: false, error: "השרת החזיר ריק" };
      if (!isPaidUser()) recordUsage(text.length);
      return {
        ok: true, edition: vocalized,
        witnesses: [], externals: [],
        quota_used: usedToday(),
      };
    }

    // Build plan
    let plan;
    if (mix_enabled) {
      plan = [
        ["gemini", mix_gemini],
        ["claude", mix_claude],
        ["dicta", mix_dicta],
      ].filter(([p, c]) => c > 0);
      if (!plan.length) {
        return { ok: false, error: "במצב מעורב צריך לבחור לפחות עד אחד מספק כלשהו." };
      }
    } else {
      const single_count = multi_engine === "dicta" ? 1 : n_copies;
      plan = [[multi_engine, single_count]];
    }

    const witnesses = [];
    const total_copies = plan.reduce((s, [, c]) => s + c, 0);
    let copy_idx = 0;
    for (const [prov, count] of plan) {
      const [prov_acc, prov_key] = _key_for(prov);
      const prov_client = clientFor(prov);
      for (let j = 0; j < count; j++) {
        if (cancelFlag) return { ok: false, error: "בוטל" };
        copy_idx += 1;
        const resp = await prov_client.vocalize({
          text: text, torah_mode: torah_mode,
          preserve_spelling: preserve, provider: prov,
          access_code: prov_acc, api_key: prov_key,
        });
        const w = resp.text || resp.result || resp.vocalized || "";
        if (!String(w).trim()) {
          return { ok: false, error: `העתק ${copy_idx} (${prov}) חזר ריק` };
        }
        witnesses.push(`[${prov}]\n${w}`);
        // live tab notification
        try { onWitness({ i: copy_idx, n: total_copies, text: w, provider: prov }); }
        catch (e) { /* noop */ }
        if (copy_idx < total_copies) {
          // 6-second pacing pause between copies (Python original)
          for (let s = 0; s < 6; s++) {
            if (cancelFlag) return { ok: false, error: "בוטל" };
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }
    }

    const payload = witnesses.slice();
    for (const ext of extEditions) {
      payload.push(`[${ext.name}]\n${ext.text}`);
    }

    const [jud_acc, jud_key] = _key_for(multi_judge);
    setStatus(t(lang, "status_judge"));
    const data = await gasClient.judgeWitnesses({
      witnesses: payload, torah_mode: torah_mode,
      judge_provider: multi_judge,
      preserve_spelling: preserve,
      access_code: jud_acc, api_key: jud_key,
    });
    const edition = data.text || data.result || data.vocalized || "";
    if (!edition) return { ok: false, error: "הדיין החזיר ריק" };
    if (!isPaidUser()) recordUsage(text.length);
    return {
      ok: true, edition: edition,
      witnesses: witnesses,
      externals: extEditions.map(e => ({ name: e.name, text: e.text })),
      quota_used: usedToday(),
    };
  } catch (e) {
    if (e instanceof GasCancelledError || e instanceof DictaCancelledError) {
      return { ok: false, error: "בוטל" };
    }
    if (
      e instanceof GasServerError || e instanceof GasNetworkError || e instanceof GasTimeoutError ||
      e instanceof DictaServerError || e instanceof DictaNetworkError || e instanceof DictaTimeoutError
    ) {
      return { ok: false, error: String(e.message || e) };
    }
    return { ok: false, error: String(e && e.message || e) };
  }
}

function setStatus(s) { const el = $("tnk-status"); if (el) el.textContent = s; }

// Live tab for each finished witness
function onWitness(payload) {
  setStatus(t(lang, "status_multi_run", { i: payload.i, n: payload.n }));
  const fill = $("tnk-progress-fill");
  if (fill) fill.style.width = (5 + 70 * (payload.i / payload.n)) + "%";
  addExtraTab("w" + (payload.i - 1), t(lang, "tab_witness", { i: payload.i }), payload.text);
}

function addExtraTab(id, name, content) {
  const tabs = $("tnk-tabs");
  if (!tabs) return;
  const tab = document.createElement("div");
  tab.className = "tab"; tab.dataset.tab = id; tab.textContent = name;
  tab.addEventListener("click", () => switchTab(id));
  tabs.appendChild(tab);

  const cont = document.createElement("div");
  cont.className = "tab-content"; cont.dataset.tabContent = id;
  cont.innerHTML = `<textarea class="result" readonly></textarea>`;
  cont.querySelector("textarea").value = content;
  $("tnk-extra-tabs").appendChild(cont);
}

function switchTab(id) {
  $$("#tnk-tabs .tab").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === id);
  });
  $$("[data-tab-content]").forEach(el => {
    el.classList.toggle("visible", el.dataset.tabContent === id);
  });
}

// ---------- wiring ----------

function wireEvents() {
  $("tnk-btn-close").addEventListener("click", closeModal);
  $("tnk-btn-lang").addEventListener("click", () => {
    lang = lang === "he" ? "en" : "he";
    saveSetting("lang", lang);
    applyTranslations();
    refreshExtList();
    renderRecent();
  });
  $("tnk-btn-theme").addEventListener("click", () => {
    appearance = appearance === "dark" ? "light" : "dark";
    modalEl.classList.toggle("light", appearance === "light");
    $("tnk-btn-theme").textContent = appearance === "dark" ? "☀" : "☾";
    saveSetting("appearance", appearance);
  });

  ["tnk-link-gemini", "tnk-link-claude"].forEach(id => {
    const el = $(id);
    el.addEventListener("click", e => {
      e.preventDefault();
      try { window.open(el.dataset.url, "_blank", "noopener"); } catch (e2) { /* noop */ }
    });
  });

  $("tnk-btn-load-file").addEventListener("click", async () => {
    const files = await pickFiles(false);
    if (!files.length) return;
    try {
      const txt = await extractText(files[0]);
      const tb = $("tnk-text-box");
      if (tb.value.trim()) tb.value += "\n\n" + txt;
      else tb.value = txt;
      $("tnk-file-status").textContent = files[0].name;
      pushRecent(files[0].name);
      renderRecent();
      refreshLiveCounter();
    } catch (e) {
      alert(t(lang, "err_title") + ": " + (e.message || e));
    }
  });

  $("tnk-btn-add-ext").addEventListener("click", async () => {
    const files = await pickFiles(true);
    const failed = [];
    for (const f of files) {
      try {
        const txt = (await extractText(f)).trim();
        if (!txt) { failed.push(`${f.name}: ריק`); continue; }
        extEditions.push({ name: f.name, text: txt });
      } catch (e) {
        failed.push(`${f.name}: ${e.message || e}`);
      }
    }
    refreshExtList();
    if (failed.length) {
      alert(t(lang, "ext_load_failed_title") + "\n\n" + failed.join("\n"));
    }
  });

  $("tnk-cb-multi").addEventListener("change", e => {
    $("tnk-multi-body").classList.toggle("visible", e.target.checked);
  });
  const slider = $("tnk-copies-slider");
  slider.addEventListener("input", () => {
    $("tnk-copies-num").textContent = slider.value;
  });
  $("tnk-cb-mix").addEventListener("change", e => {
    $("tnk-engine-single").style.display = e.target.checked ? "none" : "";
    $("tnk-engine-mix").style.display = e.target.checked ? "" : "none";
  });
  ["tnk-mix-gemini-slider", "tnk-mix-claude-slider", "tnk-mix-dicta-slider"].forEach(id => {
    const el = $(id);
    el.addEventListener("input", () => {
      $(id.replace("-slider", "-num")).textContent = el.value;
      refreshMixTotal();
    });
  });
  refreshMixTotal();

  $("tnk-text-box").addEventListener("input", refreshLiveCounter);

  $("tnk-btn-next-warn").addEventListener("click", () => {
    const text = $("tnk-text-box").value.trim();
    if (!text) { alert(t(lang, "no_text_to_send")); return; }
    const apiMode = (modalEl.querySelector('input[name="tnk-api-mode"]:checked') || {}).value;
    saveSetting("use_premium", useLegacyPremiumMode(apiMode));
    saveSetting("access_code", $("tnk-access-code").value.trim());
    saveSetting("gemini_api_key", $("tnk-gemini-key").value.trim());
    saveSetting("claude_api_key", $("tnk-claude-key").value.trim());
    saveSyncedGeminiApiKey($("tnk-gemini-key").value.trim());
    saveSyncedClaudeApiKey($("tnk-claude-key").value.trim());
    showStep(2);
  });
  $("tnk-btn-back-load").addEventListener("click", () => showStep(1));
  $("tnk-btn-back-warn").addEventListener("click", () => showStep(2));

  $("tnk-btn-approve-send").addEventListener("click", async () => {
    const text = $("tnk-text-box").value.trim();
    if (!text) { alert(t(lang, "no_text_to_send")); return; }
    const can = canSend(text.length, isPaidUser());
    if (!can.ok) { alert(can.reason); return; }

    // Reset prior tabs
    $$("#tnk-tabs .tab:not([data-tab='edition'])").forEach(el => el.remove());
    $$("[data-tab-content]:not([data-tab-content='edition'])").forEach(el => el.remove());
    $("tnk-edition-box").value = "";
    $("tnk-extra-tabs").innerHTML = "";

    showStep(3);
    setStatus(t(lang, "status_sending"));
    $("tnk-progress-fill").style.width = "10%";
    $("tnk-btn-cancel").style.display = "inline-block";

    const params = {
      text: text,
      torah_mode: (modalEl.querySelector('input[name="tnk-nikud-mode"]:checked') || {}).value === "torah",
      preserve_spelling: $("tnk-cb-preserve-spelling").checked,
      multi_enable: $("tnk-cb-multi").checked,
      multi_engine: (modalEl.querySelector('input[name="tnk-engine"]:checked') || {}).value,
      multi_judge: (modalEl.querySelector('input[name="tnk-judge"]:checked') || {}).value,
      multi_copies: parseInt($("tnk-copies-slider").value, 10),
      multi_mix_enable: $("tnk-cb-mix").checked,
      multi_mix_gemini: parseInt($("tnk-mix-gemini-slider").value || "0", 10),
      multi_mix_claude: parseInt($("tnk-mix-claude-slider").value || "0", 10),
      multi_mix_dicta: parseInt($("tnk-mix-dicta-slider").value || "0", 10),
      provider: (modalEl.querySelector('input[name="tnk-provider"]:checked') || {}).value,
      use_premium: useLegacyPremiumMode((modalEl.querySelector('input[name="tnk-api-mode"]:checked') || {}).value),
      access_code: $("tnk-access-code").value.trim(),
      gemini_api_key: $("tnk-gemini-key").value.trim(),
      claude_api_key: $("tnk-claude-key").value.trim(),
    };
    $("tnk-progress-fill").style.width = "40%";
    setStatus(t(lang, "status_waiting"));

    const result = await vocalize(params);
    $("tnk-btn-cancel").style.display = "none";

    if (!result.ok) {
      $("tnk-progress-fill").style.width = "0%";
      setStatus(t(lang, "status_ready"));
      alert(t(lang, "err_title") + ": " + result.error);
      return;
    }
    $("tnk-progress-fill").style.width = "100%";
    $("tnk-edition-box").value = result.edition;
    (result.externals || []).forEach((e, i) => {
      addExtraTab("e" + i, t(lang, "tab_external", { name: e.name }), e.text);
    });
    setStatus(t(lang, "status_done"));
    refreshQuotaBar();
  });

  $("tnk-btn-cancel").addEventListener("click", () => {
    cancelFlag = true;
    try { gasClient && gasClient.cancel(); } catch (e) { /* noop */ }
    try { dictaClient && dictaClient.cancel(); } catch (e) { /* noop */ }
  });

  $$("#tnk-tabs .tab[data-tab='edition']").forEach(el => {
    el.addEventListener("click", () => switchTab("edition"));
  });

  $("tnk-btn-copy").addEventListener("click", async () => {
    const txt = $("tnk-edition-box").value;
    if (!txt.trim()) return;
    try { await navigator.clipboard.writeText(txt); } catch (e) { /* noop */ }
    setStatus(t(lang, "copy_done"));
  });
  $("tnk-btn-save").addEventListener("click", () => {
    const txt = $("tnk-edition-box").value;
    if (!txt.trim()) return;
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = t(lang, "default_basename") + ".txt";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus(t(lang, "save_done", { path: a.download }));
  });
  $("tnk-btn-replace").addEventListener("click", () => {
    const txt = $("tnk-edition-box").value;
    if (!txt.trim()) return;
    if (typeof onResultCb === "function") {
      try { onResultCb(txt); } catch (e) { /* noop */ }
    }
    closeModal();
  });
  $("tnk-btn-restart").addEventListener("click", () => {
    $("tnk-text-box").value = "";
    $("tnk-edition-box").value = "";
    $("tnk-file-status").textContent = "txt / docx / rtf / md";
    $("tnk-progress-fill").style.width = "0%";
    setStatus(t(lang, "status_ready"));
    $$("#tnk-tabs .tab:not([data-tab='edition'])").forEach(el => el.remove());
    $("tnk-extra-tabs").innerHTML = "";
    refreshLiveCounter();
    showStep(1);
  });
}

// ---------- public entry ----------

export async function openTorahNikudModal(opts = {}) {
  await injectCss();

  const overlay = document.createElement("div");
  overlay.className = "tnk-overlay";
  const root = document.createElement("div");
  root.className = "tnk-root";
  root.innerHTML = html();
  overlay.appendChild(root);
  document.body.appendChild(overlay);
  modalEl = root;

  // hydrate from settings
  const cfg = loadSettings();
  lang = cfg.lang || "he";
  appearance = cfg.appearance || "dark";
  modalEl.classList.toggle("light", appearance === "light");
  $("tnk-btn-theme").textContent = appearance === "dark" ? "☀" : "☾";
  $("tnk-access-code").value = stripBidi(cfg.access_code) || "";
  $("tnk-gemini-key").value = getSyncedGeminiApiKey(stripBidi(cfg.gemini_api_key) || "");
  $("tnk-claude-key").value = getSyncedClaudeApiKey(stripBidi(cfg.claude_api_key) || "");
  const legacyPremiumRadio = modalEl.querySelector('input[name="tnk-api-mode"][value="premium"]');
  const personalRadio = modalEl.querySelector('input[name="tnk-api-mode"][value="personal"]');
  if (hasCurrentAppLicense()) {
    if (legacyPremiumRadio) legacyPremiumRadio.disabled = true;
    $("tnk-access-code").disabled = true;
    if (personalRadio) personalRadio.checked = true;
  } else if (cfg.use_premium) {
    const radio = legacyPremiumRadio;
    if (radio) radio.checked = true;
  }
  if (opts.initialText) $("tnk-text-box").value = opts.initialText;
  onResultCb = opts.onResult || null;
  extEditions = [];
  refreshExtList();
  renderRecent();

  wireEvents();
  applyTranslations();
  showStep(1);

  // Esc closes
  const escHandler = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", escHandler);
  overlay._tnkEsc = escHandler;
}

function closeModal() {
  if (!modalEl) return;
  const overlay = modalEl.parentNode;
  try { document.removeEventListener("keydown", overlay._tnkEsc); } catch (e) { /* noop */ }
  try { document.body.removeChild(overlay); } catch (e) { /* noop */ }
  modalEl = null;
  onResultCb = null;
  extEditions = [];
  cancelFlag = true;
  try { gasClient && gasClient.cancel(); } catch (e) { /* noop */ }
  try { dictaClient && dictaClient.cancel(); } catch (e) { /* noop */ }
}
