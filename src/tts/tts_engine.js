// המרת טקסט לדיבור — הלוגיקה (העברה מהתוכנה הקודמת, פריט ה-2).
//
// בתוכנה הישנה זה היה כרטיס בתפריט בלבד, בלי שורת קוד אחת, ומסומן „מודול
// בתשלום". משה הכריע 02/10: „אף אחד לא מקבל ספק בחינם אלא רק מכניס מפתח לבד"
// — כלומר המשתמש מביא מפתח משלו, בדיוק כמו בכלי התמלול. ולכן אין כאן מכסה,
// אין עלות למשה, ואין סוד ששמור אצלנו.
//
// כאן יושבת רק הלוגיקה: ניקוי הטקסט, חיתוך למנות, ובניית הבקשה. שום דבר כאן
// אינו פונה לרשת ואינו נוגע במסך — ולכן אפשר לבדוק את הכל בלי דפדפן ובלי מפתח.

// אותו מקום שבו כלי התמלול כבר שומר את המפתחות של המשתמש. אם כבר יש שם מפתח
// ElevenLabs — הכלי הזה עובד בלי שמשה יזין דבר.
export const TTS_CONFIG_KEY = "ravtext.torah_transcription.config";

export const ELEVEN_API = "https://api.elevenlabs.io/v1/text-to-speech";
export const ELEVEN_DEFAULT_MODEL = "eleven_multilingual_v2";
// הקול הרב-לשוני שתומך בעברית. המשתמש יכול להחליף למזהה קול משלו.
export const ELEVEN_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

// מגבלת תווים לבקשה. ElevenLabs מקבל יותר, אבל מנה קטנה חוזרת מהר יותר,
// נכשלת בזול יותר, ומאפשרת פס התקדמות אמיתי במקום מסך תקוע.
export const MAX_CHARS_PER_CHUNK = 1800;

/* ───────────────────────── מפתח המשתמש ───────────────────────── */

export function readElevenLabsKey(storage) {
  try {
    const raw = storage?.getItem?.(TTS_CONFIG_KEY);
    if (!raw) return "";
    const cfg = JSON.parse(raw);
    return String(cfg?.elevenlabs_api_key || "").trim();
  } catch {
    return "";
  }
}

/* ───────────────────────── ניקוי לקריאה ───────────────────────── */

// סימן זרם בתחילת הערה: @01, ואחריו לפעמים מספר בסוגריים מרובעות.
const STREAM_MARKER = /@\d{1,3}(?:\s*\[\d+\])?/gu;
// מספר הערה בודד בסוגריים מרובעות בתוך הטקסט.
const BRACKET_NUMBER = /\[\d+\]/gu;
// הערה שהוכנסה כסוגריים מסולסלות בתוך הטקסט.
const CURLY_NOTE = /\{[^{}]*\}/gu;
// סוגריים מיוחדות שהמנוע משתמש בהן לסימני-מים של מצב דמו.
const DEMO_BRACKETS = /[⟦⟧]/gu;

/**
 * מכין טקסט לקריאה בקול.
 *
 * בלי זה הקול היה מקריא „שטרודל אפס אחת" באמצע משפט, וקורא בקול רם הערה
 * שהמשתמש בכלל לא רצה לשמוע כאן. המטרה: שישמע כמו שמישהו קורא מהספר.
 *
 * @param {string} text
 * @param {{keepCurlyNotes?: boolean}} options
 */
export function stripForSpeech(text, { keepCurlyNotes = false } = {}) {
  let out = String(text ?? "");
  out = out.replace(DEMO_BRACKETS, "");
  out = out.replace(STREAM_MARKER, "");
  if (!keepCurlyNotes) out = out.replace(CURLY_NOTE, "");
  out = out.replace(BRACKET_NUMBER, "");
  // רווחים כפולים שנוצרו מהמחיקה, ורווח לפני סימן פיסוק.
  out = out.replace(/[ \t ]+/gu, " ");
  out = out.replace(/ ([,.;:!?׃])/gu, "$1");
  // לא למחוק שורות ריקות שמפרידות פסקאות — הן הפסקה בקריאה.
  out = out.replace(/\n{3,}/gu, "\n\n");
  return out.split("\n").map((line) => line.trim()).join("\n").trim();
}

/* ───────────────────────── חיתוך למנות ───────────────────────── */

// סוף משפט בעברית ובלועזית, כולל סוף-פסוק (׃) וסוף קטע בספרי קודש (:).
const SENTENCE_END = /[.!?׃:]["'”׳]?\s/u;

/**
 * חותך טקסט ארוך למנות שאפשר לשלוח.
 *
 * הכלל: **לעולם לא לחתוך באמצע מילה**, ועדיף לחתוך בסוף משפט. אם אין סוף
 * משפט בטווח — חותכים ברווח האחרון. אם אפילו רווח אין (מילה ענקית אחת),
 * חותכים בגבול, כי אין ברירה.
 */
export function chunkTextForSpeech(text, maxChars = MAX_CHARS_PER_CHUNK) {
  const clean = String(text ?? "");
  const limit = Math.max(1, Math.trunc(maxChars) || MAX_CHARS_PER_CHUNK);
  if (!clean.trim()) return [];
  if (clean.length <= limit) return [clean.trim()];

  const chunks = [];
  let rest = clean;

  while (rest.length > limit) {
    const window = rest.slice(0, limit);

    // 1) סוף המשפט האחרון בחלון
    let cut = -1;
    const re = new RegExp(SENTENCE_END, "gu");
    let m;
    while ((m = re.exec(window)) !== null) cut = m.index + m[0].length;

    // 2) אם אין — הרווח האחרון
    if (cut <= 0) {
      const space = window.lastIndexOf(" ");
      const newline = window.lastIndexOf("\n");
      cut = Math.max(space, newline);
    }

    // 3) אם גם זה אין — חותכים בגבול
    if (cut <= 0) cut = limit;

    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push(piece);
    rest = rest.slice(cut);
  }

  const tail = rest.trim();
  if (tail) chunks.push(tail);
  return chunks;
}

/* ───────────────────────── הערכת זמן ───────────────────────── */

/**
 * כמה שניות דיבור, בערך. משמש רק לפס ההתקדמות — לא להבטחה למשתמש.
 * קצב קריאה בעברית נע סביב 13 תווים לשנייה בקריאה רגילה.
 */
export function estimateSpeechSeconds(text, charsPerSecond = 13) {
  const n = String(text ?? "").replace(/\s+/gu, " ").trim().length;
  const rate = Math.max(1, Number(charsPerSecond) || 13);
  return Math.round(n / rate);
}

/* ───────────────────────── בניית הבקשה ───────────────────────── */

/**
 * בונה את הבקשה לספק — ולא שולח אותה.
 *
 * מופרד בכוונה: כך אפשר לבדוק את הבקשה בלי רשת ובלי מפתח אמיתי, והמפתח
 * לעולם לא נכתב ליומן או לדוח.
 */
export function buildElevenLabsRequest({
  text,
  apiKey,
  voiceId = ELEVEN_DEFAULT_VOICE,
  modelId = ELEVEN_DEFAULT_MODEL,
  stability = 0.5,
  similarityBoost = 0.75,
} = {}) {
  const body = String(text ?? "").trim();
  if (!body) throw new Error("אין טקסט להקראה.");
  const key = String(apiKey ?? "").trim();
  if (!key) throw new Error("חסר מפתח ElevenLabs. אפשר להזין אותו בהגדרות הכלי.");
  const voice = String(voiceId || ELEVEN_DEFAULT_VOICE).trim();

  return {
    url: `${ELEVEN_API}/${encodeURIComponent(voice)}`,
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: body,
      model_id: String(modelId || ELEVEN_DEFAULT_MODEL),
      voice_settings: {
        stability: Math.min(1, Math.max(0, Number(stability) || 0)),
        similarity_boost: Math.min(1, Math.max(0, Number(similarityBoost) || 0)),
      },
    }),
  };
}

/**
 * הופך תקלה של הספק להודעה שאומרת מה קרה ומה לעשות — ולא קוד שגיאה.
 */
export function describeTtsFailure(status, detail = "") {
  const n = Number(status);
  if (n === 401 || n === 403) {
    return "המפתח לא התקבל. יש לבדוק שהוא הועתק במלואו ושהחשבון פעיל.";
  }
  if (n === 422) {
    return "הספק לא קיבל את הטקסט. לרוב זה קורה כשנבחר קול שאינו תומך בעברית.";
  }
  if (n === 429) {
    return "חרגת מהקצב המותר בחשבון שלך אצל הספק. כדאי להמתין דקה ולנסות שוב.";
  }
  if (n >= 500) {
    return "השירות של הספק לא זמין כרגע. הטקסט שלך נשמר, אפשר לנסות שוב בעוד רגע.";
  }
  const extra = String(detail || "").trim();
  return `ההקראה נכשלה${extra ? ` (${extra.slice(0, 120)})` : ""}.`;
}
