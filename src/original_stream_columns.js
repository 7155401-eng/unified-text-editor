// Copied from prosemirror-edition/src/main.js, adapted only to call the
// current render callback instead of the original local scheduleRender().

import { normalizeStreamOpeningWordSettings } from "./opening_word.js";
import { styleOptionsHtml } from "./style_registry.js";

const STREAM_SETTINGS_KEY = "ravtext.streamSettings.v1";
const GLOBAL_STREAM_OVERRIDES_KEY = "ravtext.globalStreamOverrides.v1";
const STREAM_ORDER_KEY = "ravtext.streamOrder.v1";

// משה 2026-05-13: סדר תצוגה של זרמים בטבלת "פריסה".
// localStorage שומר רשימה: ["03","01","02"]. כל זרם שלא במפה הולך אחרי המוסדרים
// לפי הסדר המספרי. ↑/↓ מזיזים שורה אחת בכל לחיצה.
function loadStreamOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(STREAM_ORDER_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter(c => /^\d{1,3}$/.test(String(c))) : [];
  } catch {
    return [];
  }
}

function saveStreamOrder(order) {
  try {
    localStorage.setItem(STREAM_ORDER_KEY, JSON.stringify(order || []));
    window.dispatchEvent(new CustomEvent("ravtext:stream-order-changed"));
  } catch (_) {}
}

export function getOrderedStreamCodes(codes) {
  const all = Array.from(new Set(codes || [])).filter(Boolean);
  const order = loadStreamOrder();
  const inOrder = order.filter(c => all.includes(c));
  const rest = all.filter(c => !order.includes(c)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return [...inOrder, ...rest];
}

export function moveStreamInOrder(code, direction, allCodes) {
  // משה 2026-05-13: באג קודם — כשלא היה סדר שמור, ה-loadStreamOrder החזיר []
  // ו-moveStreamInOrder ניסה להזיז יחיד בתוך מערך של איבר אחד → לא קרה כלום.
  // עכשיו: אם הקריאה כוללת את רשימת הזרמים הנראים (allCodes), אנחנו מתחילים
  // ממנה (לפי הסדר הנוכחי כפי שהוא מוצג), מוצאים את הקוד ומחליפים שכן.
  const saved = loadStreamOrder();
  const visible = Array.isArray(allCodes) && allCodes.length
    ? allCodes.filter(Boolean)
    : null;
  let working;
  if (visible) {
    working = getOrderedStreamCodes(visible);
  } else if (saved.includes(code)) {
    working = [...saved];
  } else {
    working = [...saved, code];
  }
  const idx = working.indexOf(code);
  if (idx === -1) return;
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= working.length) return;
  [working[swap], working[idx]] = [working[idx], working[swap]];
  saveStreamOrder(working);
}

// משה 2026-05-13: הזזת זרם ליעד מפורש (לשימוש drag-and-drop).
export function setStreamOrder(orderedCodes) {
  if (!Array.isArray(orderedCodes)) return;
  const clean = orderedCodes.filter(c => /^\d{1,3}$/.test(String(c)));
  saveStreamOrder(clean);
}
const DEFAULT_STREAM_SETTINGS = {
  title: "",
  cols: 1,
  inline: true,
  lastLineCenter: true,
  firstNoteAsTitle: false,
  minLinesForCols: 3,
  styleId: "",
  titleStyleId: "",
  // משה 2026-05-13: שליטה ב"פס" שמתחת לכותרת המפרש — כמו בתוכנה הישנה.
  // ברירת מחדל = פס דק אפור (התנהגות נוכחית). אפשר לכבות לחלוטין.
  barShow: true,
  barColor: "#888",
  barThickness: 1,
  // משה 2026-05-13: סגנונות מוכנים בעיצוב תורני (כתר, וילנא, כתב יד וכו').
  // ערך ריק = שימוש ב-barColor/barThickness ידני. ערך אחר דורס.
  barPreset: "",
  // משה 2026-05-15: כשמסומן, סגנון מהרשימה מחליף את ההצגה של "בולד" בזרם
  // הזה — בכל מקום שטקסט מגיע מודגש (לפי mark פר-מילה, דיבור-המתחיל, או
  // מספר [N] מודגש). ערך ריק/לא מסומן = התנהגות רגילה של בולד.
  boldOverrideEnabled: false,
  boldOverrideStyleId: "",
  // משה 2026-05-15: שדה פריסה פר-זרם (4 אפשרויות):
  //   "gemara"     — כתר 2 טורים מעל הראשי (התנהגות גפ"ת קלאסית)
  //   "mishna"     — צד הראשי (פריסת משנה ברורה — התנהגות ברירת מחדל ברגיל)
  //   "onkelos"    — צמוד לראשי, בלי כתר, בלי פיצול (פריסת תרגום אונקלוס)
  //   "side_notes" — בשוליים, פונט קטן (הערות צד)
  //   ""           — ברירת מחדל: עוקב אחר המצב הגלובלי של הדף (תאימות לאחור)
  // הגבלות: gemara ו-onkelos סותרים זה את זה (לא יכולים להיות באותו עמוד).
  // mishna ו-side_notes אינם סותרים אף פריסה אחרת.
  layoutRole: "",
  // משה 2026-05-15: מיקום הזרם לפריסות onkelos/side_notes:
  //   "inner"  — צד פנימי (לקראת הכריכה)
  //   "outer"  — צד חיצוני (הרחק מהכריכה)
  //   "right"  — ימין (תמיד, ללא תלות בפנימי/חיצוני)
  //   "left"   — שמאל (תמיד)
  //   ""       — לא רלוונטי (gemara/mishna)
  layoutPosition: "",
};

// משה 2026-05-13: סגנונות מוכנים לפס מעל המפרש — נבחרו במיוחד לעיצוב
// ספרות תורנית. כל אחד מחזיר אובייקט CSS פשוט להחלה ישירה.
export const BAR_PRESETS = [
  { id: "hairline",     name_he: "חוט יחיד",     desc_he: "קו דק וצנוע בסגנון מהדורות קלאסיות.",                     css: "border-bottom: 1px solid #888;" },
  { id: "double-line",  name_he: "כפול וילנא",   desc_he: "קו כפול בגוון חום־ספר, מזכיר חיתוכי דפוסי וילנא.",       css: "border-bottom: 3px double #6a4e3c;" },
  { id: "thick-thin",   name_he: "עבה ודק",      desc_he: "קו עליון עבה ותחתון דק, כמסגרת עמוד גמרא מסורתית.",     css: "border-top: 2px solid #3b2a1c; border-bottom: 1px solid #3b2a1c; padding-top: 2px; padding-bottom: 2px;" },
  { id: "antique-gold", name_he: "זהב עתיק",     desc_he: "פס זהב עמום ברקע, בנוסח כריכות ספרים עתיקות.",          css: "border: none; border-bottom: none; background-image: linear-gradient(to bottom, #c9a86a 0%, #a8853f 50%, #c9a86a 100%); background-size: 100% 4px; background-position: bottom; background-repeat: no-repeat;" },
  { id: "manuscript",   name_he: "כתב יד",       desc_he: "קו מקווקו דהוי בגוון דיו עתיק, כשורת מחבר בכתב יד.",   css: "border-bottom: 1.5px dashed #5a4632;" },
  { id: "crown",        name_he: "כתר",          desc_he: "פס כפול עליון עבה ותחתון דק בגוון בורדו, כמסגרת כרך מהודר.", css: "border-top: 3px double #732424; border-bottom: 1px solid #732424; padding-top: 3px; padding-bottom: 3px;" },
];

// מחיל סגנון פס על אלמנט כותרת (ב-V9 וב-engine רגיל גם יחד). כללי המבט:
//   1. barShow === false → אין פס כלל.
//   2. barPreset שמוגדר ב-BAR_PRESETS → מחיל את ה-CSS שלו.
//   3. אחרת → barColor + barThickness + barStyle כברירת מחדל.
export function applyBarStyleToElement(el, settings) {
  if (!el || !settings) return;
  if (settings.barShow === false) {
    el.style.borderTop = "none";
    el.style.borderBottom = "none";
    el.style.backgroundImage = "";
    return;
  }
  if (settings.barPreset) {
    const preset = BAR_PRESETS.find(p => p.id === settings.barPreset);
    if (preset) {
      // מאפסים את התכונות הרלוונטיות לפני ההחלה כדי שמעבר בין פריסטים לא ישאיר שאריות.
      el.style.borderTop = "";
      el.style.borderBottom = "";
      el.style.backgroundImage = "";
      el.style.paddingTop = "";
      el.style.paddingBottom = "";
      // מחילים את כל ההכרזות מה-css ידנית.
      preset.css.split(";").forEach(decl => {
        const trimmed = decl.trim();
        if (!trimmed) return;
        const colon = trimmed.indexOf(":");
        if (colon < 0) return;
        const prop = trimmed.slice(0, colon).trim();
        const value = trimmed.slice(colon + 1).trim();
        const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        el.style[camel] = value;
      });
      return;
    }
  }
  const thickness = Number(settings.barThickness);
  const px = Number.isFinite(thickness) ? Math.max(0, Math.min(6, thickness)) : 1;
  const color = String(settings.barColor || "#888").trim() || "#888";
  const borderStyle = String(settings.barStyle || "solid").trim() || "solid";
  el.style.borderTop = "none";
  el.style.backgroundImage = "";
  el.style.borderBottom = px > 0 ? `${px}px ${borderStyle} ${color}` : "none";
}

const GLOBAL_OVERRIDE_DEFS = {
  styleId: { label: "סגנון זרם", type: "style", value: "" },
  titleStyleId: { label: "סגנון כותרת", type: "style", value: "" },
  // משה 2026-05-15: דריסת בולד גלובלית — אם המשתמש סימן את התיבה ובחר סגנון,
  // הסגנון מחליף את הצגת ה"בולד" בכל זרם.
  boldOverrideEnabled: { label: "סגנון מותאם לבולד", type: "boolean", value: false },
  boldOverrideStyleId: { label: "סגנון לבולד", type: "style", value: "" },
  cols: { label: "טורים", type: "number", value: 1, min: 1, max: 6, step: 1 },
  minLinesForCols: { label: "מינ' שורות לטור", type: "number", value: 3, min: 1, max: 20, step: 1 },
  inline: { label: "תצוגה רציפה", type: "boolean", value: true },
  lastLineCenter: { label: "מרכז שורה אחרונה", type: "boolean", value: true },
  firstNoteAsTitle: { label: "הערה ראשונה ככותרת", type: "boolean", value: false },
  opwEnabled: { label: "מילה פותחת", type: "boolean", value: false },
  opwTarget: { label: "מילה פותחת: יעד", type: "select", value: "word", options: [["word", "מילה"], ["letter", "אות"], ["words", "מילים"]] },
  opwCount: { label: "מילה פותחת: N", type: "number", value: 1, min: 1, max: 12, step: 1 },
  opwStyle: { label: "מילה פותחת: סגנון", type: "text", value: "" },
  opwSize: { label: "מילה פותחת: גודל%", type: "number", value: 135, min: 80, max: 500, step: 1 },
  opwFont: { label: "מילה פותחת: גופן", type: "text", value: "David" },
  opwWeight: { label: "מילה פותחת: משקל", type: "select", value: "bold", options: [["normal", "רגיל"], ["bold", "מודגש"], ["heavy", "כבד"]] },
  opwPosition: { label: "מילה פותחת: מיקום", type: "select", value: "dropped", options: [["raised", "מוגבהת"], ["dropped", "נפתחת"]] },
  opwDropLines: { label: "מילה פותחת: שורות שחרור", type: "number", value: 1, min: 1, max: 8, step: 1 },
  opwSpaceAfter: { label: "מילה פותחת: רווח", type: "number", value: 0.3, min: 0, max: 4, step: 0.1 },
  opwSkipOrphan: { label: "מילה פותחת: דלג קצר", type: "boolean", value: false },
  opwCenterFull: { label: "מילה פותחת: מרכוז מלא", type: "boolean", value: false },
  barShow: { label: "פס מעל המפרש", type: "boolean", value: true },
  barPreset: { label: "סגנון פס", type: "select", value: "", options: [["", "ידני"], ["hairline", "חוט יחיד"], ["double-line", "כפול וילנא"], ["thick-thin", "עבה ודק"], ["antique-gold", "זהב עתיק"], ["manuscript", "כתב יד"], ["crown", "כתר"]] },
  barColor: { label: "צבע הפס", type: "text", value: "#888" },
  barThickness: { label: "עובי הפס (px)", type: "number", value: 1, min: 0, max: 6, step: 1 },
  // משה 2026-05-14: פס מעל **כל המפרשים** (בין הראשי להערות) — שליטה גלובלית.
  mainSepShow: { label: "פס בין הראשי לכל המפרשים", type: "boolean", value: false },
  mainSepColor: { label: "צבע פס ראשי-מפרשים", type: "text", value: "#888" },
  mainSepThickness: { label: "עובי פס ראשי-מפרשים (px)", type: "number", value: 1, min: 0, max: 6, step: 1 },

  // משה 2026-05-13: מיספור לזרמים (לתורה אור השלום, להערות וציונים).
  // ברירת מחדל = כיבוי mainRef (לא מופיע מספר בראשי) — שומר תאימות.
  mainRefEnabled: { label: "מספר בראשי", type: "boolean", value: false },
  mainRefPrefix: { label: "ראשי פתיחה", type: "text", value: "[" },
  mainRefSuffix: { label: "ראשי סגירה", type: "text", value: "]" },
  mainRefBold: { label: "ראשי מודגש", type: "boolean", value: false },
  mainRefStyle: { label: "פורמט מספר בראשי", type: "select", value: "num", options: [
    ["num", "מספרים 1 2 3"],
    ["heb-geresh", "עברית א ב ג ... י י\"א"],
    ["heb-double", "עברית א ב ג ... כ ל מ"],
    ["alpha-lower", "אנגלית קטן a b c"],
    ["alpha-upper", "אנגלית גדול A B C"],
    ["roman-lower", "רומיות קטן i ii iii"],
    ["roman-upper", "רומיות גדול I II III"],
  ]},
  // משה 2026-05-15: סגנון טקסט שיוחל על "[N]" בראשי — נבחר מתוך רשימת
  // הסגנונות של המסמך (style_registry). ערך ריק = ללא סגנון.
  mainRefStyleId: { label: "סגנון מספר בראשי", type: "style", value: "" },
  noteNumEnabled: { label: "מספר בהערה", type: "boolean", value: true },
  noteNumPrefix: { label: "הערה פתיחה", type: "text", value: "[" },
  noteNumSuffix: { label: "הערה סגירה", type: "text", value: "]" },
  noteNumBold: { label: "הערה מודגש", type: "boolean", value: false },
  noteNumStyle: { label: "פורמט מספר בהערה", type: "select", value: "num", options: [
    ["num", "מספרים 1 2 3"],
    ["heb-geresh", "עברית א ב ג ... י י\"א"],
    ["heb-double", "עברית א ב ג ... כ ל מ"],
    ["alpha-lower", "אנגלית קטן a b c"],
    ["alpha-upper", "אנגלית גדול A B C"],
    ["roman-lower", "רומיות קטן i ii iii"],
    ["roman-upper", "רומיות גדול I II III"],
  ]},
  // משה 2026-05-15: סגנון טקסט שיוחל על "[N]" בהערה — נבחר מתוך רשימת
  // הסגנונות של המסמך. ערך ריק = ללא סגנון.
  noteNumStyleId: { label: "סגנון מספר בהערה", type: "style", value: "" },
  noteTextPrefix: { label: "סוגר גוף פתיחה", type: "text", value: "" },
  noteTextSuffix: { label: "סוגר גוף סגירה", type: "text", value: "" },
  lemmaBold: { label: "דיבור המתחיל מודגש", type: "boolean", value: true },
  childNumPrefix: { label: "תת-הערה פתיחה", type: "text", value: "[" },
  childNumSuffix: { label: "תת-הערה סגירה", type: "text", value: "]" },
  childNumShowStream: { label: "תת-הערה: הצג קוד זרם", type: "boolean", value: true },
};

export function getStreamSettings() {
  if (!window.__STREAM_SETTINGS__) {
    try {
      window.__STREAM_SETTINGS__ = JSON.parse(localStorage.getItem(STREAM_SETTINGS_KEY) || "{}") || {};
    } catch (_err) {
      window.__STREAM_SETTINGS__ = {};
    }
  }
  return window.__STREAM_SETTINGS__;
}

export function saveStreamSettings() {
  try {
    localStorage.setItem(STREAM_SETTINGS_KEY, JSON.stringify(getStreamSettings()));
  } catch (err) {
    console.warn("[stream-settings] save failed:", err);
  }
}

export function ensureOriginalStreamSettings(code) {
  const settings = getStreamSettings();
  if (!settings[code]) {
    settings[code] = { ...DEFAULT_STREAM_SETTINGS };
  }
  settings[code] = { ...DEFAULT_STREAM_SETTINGS, ...settings[code] };
  settings[code] = normalizeStreamOpeningWordSettings(settings[code]);
  return settings[code];
}

function makeSelect(options, value, onChange) {
  const select = document.createElement("select");
  select.className = "stream-col-select";
  for (const [optionValue, label] of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function makeLabeledInput(labelText, value, attrs, onChange) {
  const label = document.createElement("label");
  label.className = "stream-col-input";
  const span = document.createElement("span");
  span.textContent = labelText;
  const input = document.createElement("input");
  input.type = attrs.type || "text";
  if (attrs.min !== undefined) input.min = String(attrs.min);
  if (attrs.max !== undefined) input.max = String(attrs.max);
  if (attrs.step !== undefined) input.step = String(attrs.step);
  input.value = value ?? "";
  input.addEventListener("change", () => onChange(input));
  label.appendChild(span);
  label.appendChild(input);
  return label;
}

function makeCheckbox(labelText, checked, onChange) {
  const label = document.createElement("label");
  label.className = "toolbar-checkbox";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(document.createTextNode(labelText));
  return label;
}

export function loadGlobalStreamOverrides() {
  let raw = {};
  try {
    raw = JSON.parse(localStorage.getItem(GLOBAL_STREAM_OVERRIDES_KEY) || "{}") || {};
  } catch (_err) {
    raw = {};
  }
  const out = {};
  for (const [key, def] of Object.entries(GLOBAL_OVERRIDE_DEFS)) {
    const item = raw[key] || {};
    out[key] = {
      enabled: !!item.enabled,
      value: item.value !== undefined ? item.value : def.value,
    };
  }
  return out;
}

export function saveGlobalStreamOverrides(overrides) {
  localStorage.setItem(GLOBAL_STREAM_OVERRIDES_KEY, JSON.stringify(overrides || {}));
}

// משה 2026-05-13: תשתית מיספור לזרמים (לראשי, להערה, להערה-בתוך-הערה).
// הקוד הקודם הוחזר פעמיים — לכן עכשיו אני מציג רק את התשתית; ברירת המחדל
// משמרת את הפלט הקיים בדיוק (childNum=[code-num] כמו בעבר, mainRef כבוי).
// כשמשה יבחר להפעיל מיספור — הרינדור יתחיל לבנות לפי השדות האלה.
export function _streamTextSetting(value, fallback) {
  return value === undefined || value === null ? fallback : String(value);
}

export function _streamBoolSetting(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

// משה 2026-05-14: פורמטי מיספור — עברי/אנגלי/רומיות/מספרים.
// "heb-geresh": א ב ג ... י י"א י"ב (כמו ספרות תורנית מסורתית)
// "heb-double": א ב ג ... כ ל מ נ ק ר ש ת (אותיות מורחבות, בלי גרשיים)
// "num": 1 2 3 4 (ערבי)
// "alpha-lower": a b c
// "alpha-upper": A B C
// "roman-lower": i ii iii
// "roman-upper": I II III
const HEB_LETTERS = ["א","ב","ג","ד","ה","ו","ז","ח","ט","י","יא","יב","יג","יד","טו","טז","יז","יח","יט","כ","כא","כב","כג","כד","כה","כו","כז","כח","כט","ל","לא","לב","לג","לד","לה","לו","לז","לח","לט","מ","מא","מב","מג","מד","מה","מו","מז","מח","מט","נ"];
const HEB_DOUBLE = ["א","ב","ג","ד","ה","ו","ז","ח","ט","י","כ","ל","מ","נ","ס","ע","פ","צ","ק","ר","ש","ת"];

function toRoman(n) {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const map = [["M",1000],["CM",900],["D",500],["CD",400],["C",100],["XC",90],["L",50],["XL",40],["X",10],["IX",9],["V",5],["IV",4],["I",1]];
  let out = "";
  for (const [s, v] of map) {
    while (n >= v) { out += s; n -= v; }
  }
  return out;
}

function toAlphaLower(n) {
  if (n < 1) return "";
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

export function formatNumberByStyle(num, style) {
  const n = parseInt(num, 10);
  if (!Number.isFinite(n) || n < 1) return String(num);
  switch (style) {
    case "heb-geresh": return HEB_LETTERS[n - 1] || String(n);
    case "heb-double": return HEB_DOUBLE[n - 1] || String(n);
    case "alpha-lower": return toAlphaLower(n);
    case "alpha-upper": return toAlphaLower(n).toUpperCase();
    case "roman-lower": return toRoman(n).toLowerCase();
    case "roman-upper": return toRoman(n);
    case "num":
    default: return String(n);
  }
}

export function formatStreamNumber(code, num, place = "note") {
  const n = num === undefined || num === null ? "" : String(num);
  const s = getEffectiveStreamSettings(code);

  if (place === "main") {
    if (!_streamBoolSetting(s.mainRefEnabled, false)) return "";
    const style = _streamTextSetting(s.mainRefStyle, "num");
    const formatted = formatNumberByStyle(n, style);
    return _streamTextSetting(s.mainRefPrefix, "[") + formatted + _streamTextSetting(s.mainRefSuffix, "]");
  }

  if (place === "child") {
    const body = _streamBoolSetting(s.childNumShowStream, true) ? `${code}-${n}` : n;
    return _streamTextSetting(s.childNumPrefix, "[") + body + _streamTextSetting(s.childNumSuffix, "]");
  }

  if (!_streamBoolSetting(s.noteNumEnabled, true)) return "";
  const style = _streamTextSetting(s.noteNumStyle, "num");
  const formatted = formatNumberByStyle(n, style);
  return _streamTextSetting(s.noteNumPrefix, "[") + formatted + _streamTextSetting(s.noteNumSuffix, "]");
}

export function shouldBoldStreamNumber(code, place = "note") {
  const s = getEffectiveStreamSettings(code);
  if (place === "main") return _streamBoolSetting(s.mainRefBold, false);
  return _streamBoolSetting(s.noteNumBold, false);
}

export function shouldBoldStreamLemma(code) {
  const s = getEffectiveStreamSettings(code);
  return _streamBoolSetting(s.lemmaBold, true);
}

export function noteTextPrefixForStream(code) {
  return _streamTextSetting(getEffectiveStreamSettings(code).noteTextPrefix, "");
}

export function noteTextSuffixForStream(code) {
  return _streamTextSetting(getEffectiveStreamSettings(code).noteTextSuffix, "");
}

// משה 2026-05-15: מזהה הסגנון להחלת עיצוב על "[N]". "main" = בראשי, אחר = בהערה.
// הערך הוא id מתוך רשימת הסגנונות של המסמך (style_registry), או "" אם לא נבחר.
export function styleIdForStreamNumber(code, place = "note") {
  const s = getEffectiveStreamSettings(code);
  const raw = place === "main" ? s.mainRefStyleId : s.noteNumStyleId;
  return _streamTextSetting(raw, "");
}

// משה 2026-05-15: מחזיר את ה-styleId שמחליף את הצגת ה"בולד" בזרם הזה.
// "" = ההגדרה כבויה (הבולד יישאר רגיל). כל צרכן (renderer רגיל / V9 /
// note_content_builder) שמטפל בבולד מצופה לבדוק את הערך, ואם מלא — להחליף
// את font-weight:700 ב-marks של הסגנון שנבחר.
export function boldOverrideStyleIdForStream(code) {
  const s = getEffectiveStreamSettings(code);
  if (!_streamBoolSetting(s.boldOverrideEnabled, false)) return "";
  return _streamTextSetting(s.boldOverrideStyleId, "");
}

export function getEffectiveStreamSettings(code) {
  const base = normalizeStreamOpeningWordSettings({
    ...DEFAULT_STREAM_SETTINGS,
    ...((typeof window !== "undefined" && window.__STREAM_SETTINGS__ && window.__STREAM_SETTINGS__[code]) || {}),
  });
  const overrides = loadGlobalStreamOverrides();
  const out = { ...base };
  for (const [key, item] of Object.entries(overrides)) {
    if (!item?.enabled) continue;
    const def = GLOBAL_OVERRIDE_DEFS[key];
    if (!def) continue;
    let value = item.value;
    if (def.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      value = Math.max(def.min ?? n, Math.min(def.max ?? n, n));
    } else if (def.type === "boolean") {
      value = !!value;
    }
    out[key] = value;
  }
  return normalizeStreamOpeningWordSettings(out);
}

function makeStyleSelect(labelText, value, onChange) {
  const label = document.createElement("label");
  label.className = "stream-col-input";
  const span = document.createElement("span");
  span.textContent = labelText;
  const select = document.createElement("select");
  select.className = "stream-style-select";
  select.innerHTML = styleOptionsHtml(value || "");
  select.addEventListener("change", () => {
    if (select.value === "__add-custom__") {
      const gallery = document.getElementById("styles-gallery-select");
      if (gallery) {
        gallery.value = "__add-custom__";
        gallery.dispatchEvent(new Event("change", { bubbles: true }));
      }
      select.value = value || "";
      return;
    }
    onChange(select.value);
  });
  label.appendChild(span);
  label.appendChild(select);
  return label;
}

function makeGlobalOverrideControl(key, item, onCommit) {
  const def = GLOBAL_OVERRIDE_DEFS[key];
  const label = document.createElement("label");
  label.className = "stream-col-input global-stream-override-field";

  const enable = document.createElement("input");
  enable.type = "checkbox";
  enable.className = "global-stream-override-enable";
  enable.checked = !!item.enabled;
  enable.title = "סמן כדי לדרוס את ההגדרה הזו בכל זרמי ההערות";
  label.appendChild(enable);

  const span = document.createElement("span");
  span.textContent = `${def.label}:`;
  label.appendChild(span);

  let valueEl;
  if (def.type === "style") {
    valueEl = document.createElement("select");
    valueEl.className = "stream-style-select";
    valueEl.innerHTML = styleOptionsHtml(item.value || "");
    valueEl.value = item.value || "";
    valueEl.addEventListener("change", () => {
      if (valueEl.value === "__add-custom__") {
        const gallery = document.getElementById("styles-gallery-select");
        if (gallery) {
          gallery.value = "__add-custom__";
          gallery.dispatchEvent(new Event("change", { bubbles: true }));
        }
        valueEl.value = item.value || "";
        return;
      }
      item.value = valueEl.value;
      onCommit();
    });
  } else if (def.type === "select") {
    valueEl = makeSelect(def.options, item.value ?? def.value, (value) => {
      item.value = value;
      onCommit();
    });
  } else if (def.type === "boolean") {
    valueEl = document.createElement("input");
    valueEl.type = "checkbox";
    valueEl.checked = !!item.value;
    valueEl.addEventListener("change", () => {
      item.value = valueEl.checked;
      onCommit();
    });
  } else {
    valueEl = document.createElement("input");
    valueEl.type = def.type === "number" ? "number" : "text";
    if (def.min !== undefined) valueEl.min = String(def.min);
    if (def.max !== undefined) valueEl.max = String(def.max);
    if (def.step !== undefined) valueEl.step = String(def.step);
    valueEl.value = item.value ?? def.value ?? "";
    valueEl.addEventListener("change", () => {
      item.value = def.type === "number" ? Number(valueEl.value) : valueEl.value;
      onCommit();
    });
  }
  label.appendChild(valueEl);

  enable.addEventListener("change", () => {
    item.enabled = enable.checked;
    onCommit();
  });

  return label;
}

function appendGlobalOverridesPanel(panel, scheduleRender) {
  const overrides = loadGlobalStreamOverrides();
  const block = document.createElement("span");
  block.className = "global-stream-overrides stream-settings-block";

  const heading = document.createElement("strong");
  heading.className = "stream-settings-code";
  heading.textContent = "כל זרמי ההערות";
  heading.title = "כל שדה מסומן דורס את אותו שדה בהגדרות הזרם הפרטי";
  block.appendChild(heading);

  const commit = () => {
    saveGlobalStreamOverrides(overrides);
    scheduleRender();
  };

  for (const key of Object.keys(GLOBAL_OVERRIDE_DEFS)) {
    block.appendChild(makeGlobalOverrideControl(key, overrides[key], commit));
  }
  panel.appendChild(block);
}

export function updateOriginalStreamColumnsPanel(pages, scheduleRender) {
  const panel = document.getElementById("stream-columns-panel");
  if (!panel) return;
  if (!panel.dataset.styleRefreshBound) {
    panel.dataset.styleRefreshBound = "1";
    window.addEventListener("ravtext:styles-changed", () => updateOriginalStreamColumnsPanel(pages, scheduleRender));
  }
  const used = new Set();
  for (const p of pages) for (const c of Object.keys(p.streams || {})) used.add(c);
  for (const pane of window.paneManager?.panes || []) {
    if (pane.streamCode) used.add(pane.streamCode);
  }
  panel.innerHTML = "";
  if (used.size === 0) return;

  const settings = getStreamSettings();
  const commitRender = () => {
    saveStreamSettings();
    scheduleRender();
  };

  const heading = document.createElement("span");
  heading.className = "stream-label-static";
  heading.textContent = "הגדרות זרמים במקום אחד:";
  panel.appendChild(heading);
  appendGlobalOverridesPanel(panel, commitRender);

  const sorted = getOrderedStreamCodes(Array.from(used));
  for (let codeIdx = 0; codeIdx < sorted.length; codeIdx++) {
    const code = sorted[codeIdx];
    if (!settings[code]) settings[code] = { ...DEFAULT_STREAM_SETTINGS };
    settings[code] = normalizeStreamOpeningWordSettings({ ...DEFAULT_STREAM_SETTINGS, ...settings[code] });
    const cur = settings[code];
    const block = document.createElement("span");
    block.className = "stream-settings-block";

    const codeLabel = document.createElement("strong");
    codeLabel.textContent = code;
    codeLabel.className = "stream-settings-code";
    block.appendChild(codeLabel);

    // משה 2026-05-13: שינוי סדר זרמים — חצי ↑/↓ + ידית גרירה ⋮⋮.
    // חצים מעבירים את הרשימה הנוכחית כפרמטר ל-moveStreamInOrder (תיקון לבאג
    // שהחצים לא עשו כלום בכניסה ראשונה).
    block.draggable = true;
    block.dataset.streamCode = code;
    block.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/stream-code", code);
      e.dataTransfer.effectAllowed = "move";
      block.style.opacity = "0.45";
    });
    block.addEventListener("dragend", () => { block.style.opacity = ""; });
    block.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("text/stream-code")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        block.style.outline = "2px dashed var(--rt-accent-2,#185abd)";
      }
    });
    block.addEventListener("dragleave", () => { block.style.outline = ""; });
    block.addEventListener("drop", (e) => {
      e.preventDefault();
      block.style.outline = "";
      const dragged = e.dataTransfer.getData("text/stream-code");
      if (!dragged || dragged === code) return;
      const order = getOrderedStreamCodes(sorted);
      const fromIdx = order.indexOf(dragged);
      const toIdx = order.indexOf(code);
      if (fromIdx === -1 || toIdx === -1) return;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, dragged);
      setStreamOrder(order);
      commitRender();
    });

    const dragHandle = document.createElement("span");
    dragHandle.textContent = "⋮⋮";
    dragHandle.title = "גרור כדי לשנות סדר";
    dragHandle.style.cssText = "display:inline-block;cursor:grab;font-size:16px;color:var(--rt-ink-3,#5a4d3a);padding:0 4px;user-select:none;";
    block.appendChild(dragHandle);

    const orderControls = document.createElement("span");
    orderControls.className = "stream-order-controls";
    orderControls.style.cssText = "display:inline-flex;flex-direction:column;gap:2px;margin:0 6px;vertical-align:middle;";
    const makeArrowBtn = (label, title, dir, disabled) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.style.cssText = "font-size:14px;line-height:1;padding:2px 8px;cursor:pointer;background:var(--rt-surface-3,#f4f1ea);border:1px solid var(--rt-line,#d7d0be);border-radius:3px;color:var(--rt-ink,#222);font-weight:700;min-width:24px;";
      if (disabled) {
        b.disabled = true;
        b.style.opacity = "0.35";
        b.style.cursor = "not-allowed";
      }
      b.addEventListener("click", () => {
        moveStreamInOrder(code, dir, sorted);
        commitRender();
      });
      return b;
    };
    orderControls.appendChild(makeArrowBtn("▲", "הזז למעלה", "up", codeIdx === 0));
    orderControls.appendChild(makeArrowBtn("▼", "הזז למטה", "down", codeIdx === sorted.length - 1));
    block.appendChild(orderControls);

    block.appendChild(makeLabeledInput("כותרת:", cur.title || "", { type: "text" }, (input) => {
      cur.title = input.value.trim();
      input.value = cur.title;
      commitRender();
    }));

    const colsLabel = document.createElement("label");
    colsLabel.className = "stream-col-input";
    const colsSpan = document.createElement("span");
    colsSpan.textContent = "טורים:";
    const colsInput = document.createElement("input");
    colsInput.type = "number";
    colsInput.min = "1";
    colsInput.max = "6";
    colsInput.value = cur.cols || 1;
    colsInput.addEventListener("change", () => {
      let n = parseInt(colsInput.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 6) n = 6;
      colsInput.value = n;
      cur.cols = n;
      commitRender();
    });
    colsLabel.appendChild(colsSpan);
    colsLabel.appendChild(colsInput);
    block.appendChild(colsLabel);

    const minLinesLabel = document.createElement("label");
    minLinesLabel.className = "stream-col-input";
    const minLinesSpan = document.createElement("span");
    minLinesSpan.textContent = "מינ׳ שורות:";
    const minLinesInput = document.createElement("input");
    minLinesInput.type = "number";
    minLinesInput.min = "1";
    minLinesInput.max = "20";
    minLinesInput.value = typeof cur.minLinesForCols === "number" ? cur.minLinesForCols : 3;
    minLinesInput.addEventListener("change", () => {
      let n = parseInt(minLinesInput.value, 10);
      if (!Number.isFinite(n) || n < 1) n = 1;
      if (n > 20) n = 20;
      minLinesInput.value = n;
      cur.minLinesForCols = n;
      commitRender();
    });
    minLinesLabel.appendChild(minLinesSpan);
    minLinesLabel.appendChild(minLinesInput);
    block.appendChild(minLinesLabel);

    const inlineLabel = document.createElement("label");
    inlineLabel.className = "toolbar-checkbox";
    const inlineInput = document.createElement("input");
    inlineInput.type = "checkbox";
    inlineInput.checked = !!cur.inline;
    inlineInput.addEventListener("change", () => {
      cur.inline = inlineInput.checked;
      commitRender();
    });
    inlineLabel.appendChild(inlineInput);
    inlineLabel.appendChild(document.createTextNode("רצופות"));
    block.appendChild(inlineLabel);

    const lastLineLabel = document.createElement("label");
    lastLineLabel.className = "toolbar-checkbox";
    const lastLineInput = document.createElement("input");
    lastLineInput.type = "checkbox";
    lastLineInput.checked = !!cur.lastLineCenter;
    lastLineInput.addEventListener("change", () => {
      cur.lastLineCenter = lastLineInput.checked;
      commitRender();
    });
    lastLineLabel.appendChild(lastLineInput);
    lastLineLabel.appendChild(document.createTextNode("שורה אחרונה ממורכזת"));
    block.appendChild(lastLineLabel);

    block.appendChild(makeCheckbox("הערה ראשונה ככותרת", cur.firstNoteAsTitle, (checked) => {
      cur.firstNoteAsTitle = checked;
      commitRender();
    }));

    block.appendChild(makeStyleSelect("סגנון זרם:", cur.styleId || "", (value) => {
      cur.styleId = value;
      commitRender();
    }));

    block.appendChild(makeStyleSelect("סגנון כותרת:", cur.titleStyleId || "", (value) => {
      cur.titleStyleId = value;
      commitRender();
    }));

    // משה 2026-05-15: סגנון מותאם לבולד — מחליף את ההצגה הרגילה של בולד
    // (font-weight:700) בסגנון מהרשימה. ברירת מחדל = לא מסומן.
    block.appendChild(makeCheckbox("סגנון מותאם לבולד", !!cur.boldOverrideEnabled, (checked) => {
      cur.boldOverrideEnabled = checked;
      commitRender();
    }));
    block.appendChild(makeStyleSelect("סגנון לבולד:", cur.boldOverrideStyleId || "", (value) => {
      cur.boldOverrideStyleId = value;
      commitRender();
    }));

    // משה 2026-05-13: שליטה בפס שמעל המפרש לכל זרם בנפרד.
    block.appendChild(makeCheckbox("פס מעל המפרש", cur.barShow !== false, (checked) => {
      cur.barShow = checked;
      commitRender();
    }));
    // משה 2026-05-13: בחירת סגנון מוכן (תורני) — או "ידני" לצבע+עובי מותאמים.
    const barPresetOptions = [["", "ידני"]].concat(BAR_PRESETS.map(p => [p.id, p.name_he]));
    block.appendChild(makeSelect(
      barPresetOptions,
      cur.barPreset || "",
      (value) => {
        cur.barPreset = value;
        commitRender();
      }
    ));
    block.appendChild(makeLabeledInput("צבע פס:", cur.barColor || "#888", { type: "text" }, (input) => {
      cur.barColor = input.value.trim() || "#888";
      input.value = cur.barColor;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("עובי פס:", cur.barThickness ?? 1, { type: "number", min: 0, max: 6, step: 1 }, (input) => {
      const n = parseInt(input.value, 10);
      cur.barThickness = Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : 1;
      input.value = cur.barThickness;
      commitRender();
    }));

    // משה 2026-05-15: בחירת פריסה פר-זרם. ארבע אפשרויות:
    //   ברירת מחדל (עוקב אחר המצב הגלובלי), גמרא (כתר), משנה ברורה (צד),
    //   תרגום אונקלוס, הערות צד.
    // הגבלה: gemara ו-onkelos לא יכולים להתקיים יחד בעמוד אחד.
    const layoutRoleLabel = document.createElement("label");
    layoutRoleLabel.className = "stream-col-input";
    const layoutRoleSpan = document.createElement("span");
    layoutRoleSpan.textContent = "פריסה:";
    layoutRoleLabel.appendChild(layoutRoleSpan);
    const layoutRoleSelect = makeSelect(
      [
        ["", "ברירת מחדל"],
        ["gemara", "גמרא (כתר)"],
        ["mishna", "משנה ברורה"],
        ["onkelos", "תרגום אונקלוס"],
        ["side_notes", "הערות צד"],
      ],
      cur.layoutRole || "",
      (value) => {
        cur.layoutRole = value;
        // נקה layoutPosition אם הפריסה החדשה לא צריכה אותה
        if (value !== "onkelos" && value !== "side_notes") {
          cur.layoutPosition = "";
        }
        commitRender();
      }
    );
    layoutRoleLabel.appendChild(layoutRoleSelect);
    block.appendChild(layoutRoleLabel);

    // מיקום הזרם — רלוונטי רק לאונקלוס והערות צד.
    const layoutPosLabel = document.createElement("label");
    layoutPosLabel.className = "stream-col-input";
    const layoutPosSpan = document.createElement("span");
    layoutPosSpan.textContent = "מיקום:";
    layoutPosLabel.appendChild(layoutPosSpan);
    const layoutPosSelect = makeSelect(
      [
        ["", "ללא"],
        ["inner", "פנימי"],
        ["outer", "חיצוני"],
        ["right", "ימין"],
        ["left", "שמאל"],
      ],
      cur.layoutPosition || "",
      (value) => {
        cur.layoutPosition = value;
        commitRender();
      }
    );
    layoutPosLabel.appendChild(layoutPosSelect);
    block.appendChild(layoutPosLabel);

    // משה 2026-05-14: הגדרות מיספור לכל זרם בנפרד — כפי שהיה בתוכנה הישנה.
    // המשתמש יכול לקבוע סוגריים/הדגשה לכל זרם בנפרד או דרך "כל זרמי ההערות"
    // (גלובלי). ההגדרה הפרטית גוברת אם קיימת.
    block.appendChild(makeCheckbox("מספר בראשי", cur.mainRefEnabled !== undefined ? cur.mainRefEnabled : false, (checked) => {
      cur.mainRefEnabled = checked;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("פתיחה ראשי:", cur.mainRefPrefix ?? "[", { type: "text" }, (input) => {
      cur.mainRefPrefix = input.value;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("סגירה ראשי:", cur.mainRefSuffix ?? "]", { type: "text" }, (input) => {
      cur.mainRefSuffix = input.value;
      commitRender();
    }));
    block.appendChild(makeCheckbox("ראשי מודגש", !!cur.mainRefBold, (checked) => {
      cur.mainRefBold = checked;
      commitRender();
    }));
    // משה 2026-05-14: פורמט מיספור בראשי — מספרים/עברית/רומיות/אנגלית
    const numStyleOptions = [
      ["num", "מספרים 1 2 3"],
      ["heb-geresh", 'עברית א ב ג ... י י"א'],
      ["heb-double", "עברית א ב ג ... כ ל מ"],
      ["alpha-lower", "אנגלית קטן a b c"],
      ["alpha-upper", "אנגלית גדול A B C"],
      ["roman-lower", "רומיות קטן i ii iii"],
      ["roman-upper", "רומיות גדול I II III"],
    ];
    const mainStyleLabel = document.createElement("label");
    mainStyleLabel.className = "stream-col-input";
    const mainStyleSpan = document.createElement("span");
    mainStyleSpan.textContent = "פורמט ראשי:";
    mainStyleLabel.appendChild(mainStyleSpan);
    mainStyleLabel.appendChild(makeSelect(numStyleOptions, cur.mainRefStyle || "num", (val) => {
      cur.mainRefStyle = val;
      commitRender();
    }));
    block.appendChild(mainStyleLabel);
    // משה 2026-05-15: בחירת סגנון טקסט (מתוך רשימת סגנונות המסמך) ל-"[N]" בראשי.
    block.appendChild(makeStyleSelect("סגנון מספר בראשי:", cur.mainRefStyleId || "", (value) => {
      cur.mainRefStyleId = value;
      commitRender();
    }));
    block.appendChild(makeCheckbox("מספר בהערה", cur.noteNumEnabled !== false, (checked) => {
      cur.noteNumEnabled = checked;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("פתיחה הערה:", cur.noteNumPrefix ?? "[", { type: "text" }, (input) => {
      cur.noteNumPrefix = input.value;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("סגירה הערה:", cur.noteNumSuffix ?? "]", { type: "text" }, (input) => {
      cur.noteNumSuffix = input.value;
      commitRender();
    }));
    block.appendChild(makeCheckbox("הערה מודגש", !!cur.noteNumBold, (checked) => {
      cur.noteNumBold = checked;
      commitRender();
    }));
    // משה 2026-05-14: פורמט מיספור בהערה — נפרד מהפורמט בראשי
    const noteStyleLabel = document.createElement("label");
    noteStyleLabel.className = "stream-col-input";
    const noteStyleSpan = document.createElement("span");
    noteStyleSpan.textContent = "פורמט הערה:";
    noteStyleLabel.appendChild(noteStyleSpan);
    noteStyleLabel.appendChild(makeSelect(numStyleOptions, cur.noteNumStyle || "num", (val) => {
      cur.noteNumStyle = val;
      commitRender();
    }));
    block.appendChild(noteStyleLabel);
    // משה 2026-05-15: בחירת סגנון טקסט (מתוך רשימת סגנונות המסמך) ל-"[N]" בהערה.
    block.appendChild(makeStyleSelect("סגנון מספר בהערה:", cur.noteNumStyleId || "", (value) => {
      cur.noteNumStyleId = value;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("סוגר גוף פתיחה:", cur.noteTextPrefix ?? "", { type: "text" }, (input) => {
      cur.noteTextPrefix = input.value;
      commitRender();
    }));
    block.appendChild(makeLabeledInput("סוגר גוף סגירה:", cur.noteTextSuffix ?? "", { type: "text" }, (input) => {
      cur.noteTextSuffix = input.value;
      commitRender();
    }));
    block.appendChild(makeCheckbox('"דיבור המתחיל" מודגש', cur.lemmaBold !== false, (checked) => {
      cur.lemmaBold = checked;
      commitRender();
    }));

    const opwLabel = document.createElement("label");
    opwLabel.className = "toolbar-checkbox";
    const opwInput = document.createElement("input");
    opwInput.type = "checkbox";
    opwInput.checked = !!cur.opwEnabled;
    opwInput.addEventListener("change", () => {
      cur.opwEnabled = opwInput.checked;
      commitRender();
    });
    opwLabel.appendChild(opwInput);
    opwLabel.appendChild(document.createTextNode("מילה פותחת"));
    block.appendChild(opwLabel);

    block.appendChild(makeSelect(
      [["word", "מילה"], ["letter", "אות"], ["words", "מילים"]],
      cur.opwTarget,
      (value) => {
        cur.opwTarget = value;
        commitRender();
      }
    ));

    const opwCountLabel = document.createElement("label");
    opwCountLabel.className = "stream-col-input";
    const opwCountSpan = document.createElement("span");
    opwCountSpan.textContent = "N:";
    const opwCountInput = document.createElement("input");
    opwCountInput.type = "number";
    opwCountInput.min = "1";
    opwCountInput.max = "12";
    opwCountInput.value = cur.opwCount || 1;
    opwCountInput.addEventListener("change", () => {
      cur.opwCount = Math.max(1, Math.min(12, parseInt(opwCountInput.value, 10) || 1));
      opwCountInput.value = cur.opwCount;
      commitRender();
    });
    opwCountLabel.appendChild(opwCountSpan);
    opwCountLabel.appendChild(opwCountInput);
    block.appendChild(opwCountLabel);

    block.appendChild(makeLabeledInput("סגנון:", cur.opwStyle || "", { type: "text" }, (input) => {
      cur.opwStyle = input.value.trim();
      commitRender();
    }));

    block.appendChild(makeSelect(
      [["raised", "מוגבהת"], ["dropped", "נפתחת"]],
      cur.opwPosition,
      (value) => {
        cur.opwPosition = value;
        commitRender();
      }
    ));

    const opwSizeLabel = document.createElement("label");
    opwSizeLabel.className = "stream-col-input";
    const opwSizeSpan = document.createElement("span");
    opwSizeSpan.textContent = "%:";
    const opwSizeInput = document.createElement("input");
    opwSizeInput.type = "number";
    opwSizeInput.min = "80";
    opwSizeInput.max = "500";
    opwSizeInput.value = cur.opwSize || 135;
    opwSizeInput.addEventListener("change", () => {
      cur.opwSize = Math.max(80, Math.min(500, parseInt(opwSizeInput.value, 10) || 135));
      opwSizeInput.value = cur.opwSize;
      commitRender();
    });
    opwSizeLabel.appendChild(opwSizeSpan);
    opwSizeLabel.appendChild(opwSizeInput);
    block.appendChild(opwSizeLabel);

    block.appendChild(makeLabeledInput("גופן:", cur.opwFont || "David", { type: "text" }, (input) => {
      cur.opwFont = input.value.trim() || "David";
      input.value = cur.opwFont;
      commitRender();
    }));

    block.appendChild(makeSelect(
      [["normal", "רגיל"], ["bold", "מודגש"], ["heavy", "כבד"]],
      cur.opwWeight,
      (value) => {
        cur.opwWeight = value;
        commitRender();
      }
    ));

    block.appendChild(makeLabeledInput("שורות:", cur.opwDropLines || 1, { type: "number", min: 1, max: 8 }, (input) => {
      cur.opwDropLines = Math.max(1, Math.min(8, parseInt(input.value, 10) || 1));
      input.value = cur.opwDropLines;
      commitRender();
    }));

    block.appendChild(makeLabeledInput("רווח:", cur.opwSpaceAfter ?? 0.3, { type: "number", min: 0, max: 4, step: 0.1 }, (input) => {
      const n = parseFloat(input.value);
      cur.opwSpaceAfter = Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 0.3;
      input.value = cur.opwSpaceAfter;
      commitRender();
    }));

    block.appendChild(makeCheckbox("דלג קצר", cur.opwSkipOrphan, (checked) => {
      cur.opwSkipOrphan = checked;
      commitRender();
    }));

    block.appendChild(makeCheckbox("מרכז מלא", cur.opwCenterFull, (checked) => {
      cur.opwCenterFull = checked;
      commitRender();
    }));

    const mbWidthLabel = document.createElement("label");
    mbWidthLabel.className = "stream-col-input";
    const mbWidthSpan = document.createElement("span");
    mbWidthSpan.textContent = "משנ\"ב %:";
    const mbWidthInput = document.createElement("input");
    mbWidthInput.type = "number";
    mbWidthInput.min = "0";
    mbWidthInput.max = "95";
    mbWidthInput.value = cur.mishnaWidth || 0;
    mbWidthInput.title = "0 = ברירת מחדל";
    mbWidthInput.addEventListener("change", () => {
      cur.mishnaWidth = Math.max(0, Math.min(95, parseInt(mbWidthInput.value, 10) || 0));
      mbWidthInput.value = cur.mishnaWidth;
      commitRender();
    });
    mbWidthLabel.appendChild(mbWidthSpan);
    mbWidthLabel.appendChild(mbWidthInput);
    block.appendChild(mbWidthLabel);

    block.appendChild(makeSelect(
      [["auto", "אוטו"], ["right", "ימין"], ["left", "שמאל"], ["outer", "חיצוני"], ["inner", "פנימי"]],
      cur.mishnaSide || "auto",
      (value) => {
        cur.mishnaSide = value;
        commitRender();
      }
    ));

    panel.appendChild(block);
  }
}
