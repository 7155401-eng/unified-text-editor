// לקוח Google Apps Script לבוט הקריקטורות (Verbatim port of gas_client.py).
//
// ההנחיות (system prompt + hard rules + styles) **אינן** אצל המשתמש כלל —
// הן יושבות רק על ה-Apps Script של Moshe. הלקוח שולח רק:
//   - prompt_type:   "caricature" / "caricature_polish"
//   - scene_text:    מה שהמשתמש הקליד בעברית/אנגלית (טקסט גולמי)
//   - style_key:     המפתח של הסגנון (מצחיק/הזוי/וכו') — לא טקסט הנחיה
//   - aspect, count, negative
//   - api_key:       המפתח של המשתמש עצמו (לא נשלח אם אין; מנהל הסקריפט יחליט)
//
// ה-Apps Script מבצע: בונה את הפרומפט המלא עם ההנחיות הסודיות,
// קורא ל-Gemini מהשרת, ומחזיר את התמונות כ-base64.

import { getSyncedGeminiApiKey, saveSyncedGeminiApiKey } from "../ai_key_sync.js";

// כתובת ברירת מחדל מגיעה מ-gas_config (אותה זו שב-Python).
const DEFAULT_FROM_CONFIG =
  "/api/caricature";

export const TIMEOUT_SECONDS = 240;

const LS_KEY_API = "ravtext.caricature.gemini_api_key";
const LS_KEY_GAS = "ravtext.caricature.gas_url";

export class GasError extends Error {
  constructor(message) {
    super(message);
    this.name = "GasError";
  }
}

function gasUrl() {
  // מאפשר עדכון runtime בלי לערוך את הקובץ
  try {
    const override = localStorage.getItem(LS_KEY_GAS);
    if (override && override.trim()) {
      const value = override.trim();
      if (!value.includes("script.google.com/macros/")) return value;
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_FROM_CONFIG;
}

export function isConfigured() {
  return Boolean(gasUrl());
}

function userApiKey() {
  // מפתח המשתמש מ-localStorage (החלופה של gemini_api_key.txt בדפדפן)
  try {
    const synced = getSyncedGeminiApiKey();
    if (synced) return synced;
    const txt = localStorage.getItem(LS_KEY_API);
    if (!txt) return null;
    for (const ln of String(txt).split(/\r?\n/)) {
      const s = ln.trim();
      if (s) return s;
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function saveUserApiKey(keys) {
  // שומר מפתח/ות המשתמש לצד הקלינט (לא נשלח עד שמתבצעת קריאה).
  try {
    const cleaned = (keys || [])
      .map((k) => String(k || "").trim())
      .filter(Boolean);
    if (cleaned[0]) saveSyncedGeminiApiKey(cleaned[0]);
    localStorage.setItem(LS_KEY_API, cleaned.join("\n") + "\n");
    return true;
  } catch (e) {
    return false;
  }
}

export function loadUserApiKeys() {
  try {
    const synced = getSyncedGeminiApiKey();
    if (synced) return [synced];
    const txt = localStorage.getItem(LS_KEY_API);
    if (!txt) return [];
    return String(txt)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function base64ToBlob(b64, mime = "image/png") {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * שולח לשרת ומחזיר { images: [{ blob, dataUrl, b64 }, ...], error: string|null }.
 *
 * @param {object} opts
 * @param {string} opts.scene_text    תיאור המשתמש (raw)
 * @param {string} opts.style_key     מפתח הסגנון
 * @param {string} [opts.aspect]      "1:1" וכו'
 * @param {number} [opts.count]       1..4
 * @param {string} [opts.negative]    מה לא לכלול
 * @param {boolean} [opts.polish]     ליטוש הנחיה
 */
export async function generateCaricatures({
  scene_text,
  style_key,
  aspect = "1:1",
  count = 1,
  negative = "",
  polish = false,
} = {}) {
  const url = gasUrl();
  if (!url) {
    return {
      images: [],
      error:
        "כתובת ה-Apps Script לא הוגדרה.\n" +
        "יש להגדיר את משתנה הסביבה RAVTEXT_CARICATURE_GAS_URL " +
        "או לעדכן את DEFAULT_CARICATURE_GAS_URL ב-gas_client.py " +
        "אחרי deploy של הסקריפט.",
    };
  }

  const body = {
    prompt_type: "caricature",
    scene_text: scene_text || "",
    style_key: style_key || "איור מצחיק/הומוריסטי/משעשע",
    aspect: aspect || "1:1",
    count: Math.max(1, Math.min(parseInt(count, 10) || 1, 4)),
    negative: negative || "",
    polish: Boolean(polish),
  };
  const apiKey = userApiKey();
  if (apiKey) body.api_key = apiKey;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),
                           TIMEOUT_SECONDS * 1000);
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") {
      return { images: [], error: "השרת לא הגיב בזמן (timeout)" };
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { images: [], error: "אין חיבור לאינטרנט" };
    }
    return { images: [], error: `שגיאת חיבור: ${e && e.message ? e.message : e}` };
  }
  clearTimeout(timer);

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return { images: [], error: `HTTP ${r.status}: ${txt.slice(0, 200)}` };
  }
  let data;
  try {
    data = await r.json();
  } catch (e) {
    const txt = await r.text().catch(() => "");
    return { images: [], error: `תשובה לא תקינה מהשרת: ${txt.slice(0, 200)}` };
  }

  const err = data && data.error;
  if (err) {
    return { images: [], error: `${err}: ${data.message || ""}` };
  }

  const imagesB64 = (data && data.images) || [];
  const images = [];
  for (const b64 of imagesB64) {
    try {
      const blob = base64ToBlob(b64, "image/png");
      const dataUrl = `data:image/png;base64,${b64}`;
      images.push({ blob, dataUrl, b64 });
    } catch (e) { /* skip bad entry */ }
  }
  if (!images.length) {
    return { images: [], error: "השרת לא החזיר תמונות" };
  }
  return { images, error: null };
}

/** מקבילה של output_dir() — בדפדפן מחזירים תווית טקסטואלית בלבד. */
export function outputDir() {
  return "Pictures/RavText_Caricatures";
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

/** שומר תמונה לוקאלית: מוריד כקובץ, מחזיר את שם הקובץ.
 *  meta נשמר בנפרד כקובץ .txt לצד שמירת התמונה (אם השומר אישר). */
export function saveImage(imageObj, sceneHint, opts = {}) {
  const now = new Date();
  const stamp =
    now.getFullYear() +
    pad2(now.getMonth() + 1) +
    pad2(now.getDate()) +
    "_" +
    pad2(now.getHours()) +
    pad2(now.getMinutes()) +
    pad2(now.getSeconds());
  const human = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ` +
                `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const ext = opts.ext || "png";
  const idx = opts.idx || 1;
  const name = `caricature_${stamp}_${pad2(idx)}.${ext}`;

  // הורדה כקובץ
  try {
    const url = imageObj.dataUrl ||
                URL.createObjectURL(imageObj.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (!imageObj.dataUrl) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
  } catch (e) { /* ignore */ }

  // שמירת sidecar הנחיות בלוקאל סטורג'
  try {
    const lines = [
      `תאריך: ${human}`,
      `סצנה: ${sceneHint || ""}`,
    ];
    if (opts.style) lines.push(`סגנון: ${opts.style}`);
    if (opts.aspect) lines.push(`יחס מימדים: ${opts.aspect}`);
    if (opts.negative) lines.push(`מה לא לכלול: ${opts.negative}`);
    if (opts.polish) lines.push("שיפור פרומפט אוטומטי: כן");
    const txt = lines.join("\n") + "\n";
    const sidecarKey = "ravtext.caricature.sidecar." + name;
    localStorage.setItem(sidecarKey, txt);
  } catch (e) { /* ignore */ }

  return name;
}

/** Override of GAS URL at runtime (e.g. by integration code). */
export function setGasUrl(url) {
  try {
    if (url && url.trim()) {
      localStorage.setItem(LS_KEY_GAS, url.trim());
    } else {
      localStorage.removeItem(LS_KEY_GAS);
    }
  } catch (e) { /* ignore */ }
}
