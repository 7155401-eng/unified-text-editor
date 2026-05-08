// תרגום עברית/אנגלית לבוט הקריקטורות. Verbatim port from i18n.py.

export const TRANSLATIONS = {
  title: ["🎭 בוט יוצר קריקטורות חרדיות",
          "🎭 Haredi Caricature Bot"],
  key_btn: ["⚙ הגדרות מפתח Gemini",
            "⚙ Gemini API key"],
  lang_btn: ["EN", "עב"],
  theme_dark: ["🌙 כהה", "🌙 Dark"],
  theme_light: ["☀ בהיר", "☀ Light"],
  scene_label: ["תיאור הקריקטורה — זו ההוראה העיקרית:",
                "Caricature description — this is the main instruction:"],
  random_btn: ["🎲 רעיון אקראי מעולם הישיבות",
               "🎲 Random idea from yeshiva life"],
  clear_btn: ["🧹", "🧹"],
  style_label: ["סגנון:", "Style:"],
  aspect_label: ["יחס מימדים:", "Aspect ratio:"],
  count_label: ["כמות תמונות:", "Image count:"],
  negative_label: ["מה לא לכלול (אופציונלי):",
                   "Avoid (optional):"],
  negative_ph: ["למשל: בלי טלפון נייד, בלי רקע עירוני",
                "e.g. no cellphone, no urban background"],
  go_btn: ["✨ צור קריקטורה", "✨ Generate caricature"],
  open_folder: ["📂 פתח את תיקיית התמונות שנשמרו",
                "📂 Open saved-images folder"],
  results: ["תוצאות:", "Results:"],
  gallery: ["גלריה — תמונות אחרונות שלך:",
            "Gallery — your recent images:"],
  ready: ["מוכן", "Ready"],
  sending: ["שולח ל-Gemini...", "Sending to Gemini..."],
  fail: ["כשל ביצירה", "Generation failed"],
  no_text: ["חסרה הוראה", "Missing instruction"],
  no_text_msg: ["צריך לכתוב מה לצייר. אפשר ללחוץ על '🎲 רעיון אקראי' אם אין לך רעיון.",
                "Please type what to draw. Use '🎲 Random idea' if you have no idea."],
  no_key: ["חסר מפתח Gemini", "Gemini key missing"],
  no_key_msg: ["כדי ליצור תמונות צריך מפתח Gemini API.\nהמפתח חינמי וניתן להשגה ב-aistudio.google.com/apikey.\n\nלחץ על 'הגדרות מפתח Gemini' למעלה כדי להוסיף.",
               "Image generation needs a Gemini API key.\nGet a free key at aistudio.google.com/apikey.\n\nClick 'Gemini API key' at the top to add."],
  quota_unlimited: ["🪪 רישיון פעיל — יצירה ללא הגבלה",
                    "🪪 Licensed — unlimited generations"],
  quota_ready: ["גרסה חינמית — יצירה אחת ל-48 שעות זמינה כעת",
                "Free tier — one generation every 48h available now"],
  quota_wait: ["⏳ הגרסה החינמית — היצירה הבאה תהיה זמינה בעוד {wait}",
               "⏳ Free tier — next generation in {wait}"],
  quota_block_title: ["הגרסה החינמית מוגבלת",
                      "Free tier limit"],
  quota_block_msg: ["בגרסה החינמית ניתן ליצור קריקטורה אחת כל יומיים.\nהיצירה הבאה תהיה זמינה בעוד {wait}.\n\nברישיון מלא — יצירה ללא הגבלה.",
                    "Free tier allows one caricature every 48 hours.\nNext generation in {wait}.\n\nFull license — unlimited."],
  creating: ["⏳ הקריקטורה בדרך... זה יכול לקחת חצי דקה",
             "⏳ Drawing... can take half a minute"],
  saved: ["✓ נוצרו {n} תמונות. נשמרו ב-{path}",
          "✓ {n} images created. Saved to {path}"],
  deck_progress: ["רעיון {i} מתוך {n} בסבב הנוכחי",
                  "Idea {i} of {n} in current rotation"],
  placeholder: [
    "התמונות שייווצרו יופיעו כאן.\n\nההוראה העיקרית היא מה שאתה כותב למעלה.\nהסגנון מדגיש את אופי ההומור (מצחיק, הזוי, ילדים…).\nהתמונות נשמרות אוטומטית בתיקייה שלך.",
    "Generated images will appear here.\n\nYour typed instruction is the main directive.\nThe style sets the humor flavor (funny, surreal, kids…).\nImages auto-save to your folder."],
  open: ["פתח", "Open"],
  polish: ["✨ ליטוש הנחיות (עולה אסימונים נוספים)",
           "✨ Polish prompt (uses extra tokens)"],
  polish_tooltip: [
    "ההוראה שלך תישלח קודם ל-Gemini טקסטואלי שמעשיר אותה בפרטי רקע חרדיים — לפני יצירת התמונה. צורך מעט יותר אסימונים.",
    "Your prompt is first sent to text Gemini which enriches it with Haredi background details before image generation. Uses slightly more tokens."],
  polishing: ["מלטש הנחיה...", "Polishing prompt..."],
  polish_failed: ["ליטוש נכשל — שולח את ההנחיה המקורית",
                  "Polish failed — sending original prompt"],
};

export function tr(key, lang, kw = {}) {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  let s = lang === "he" ? entry[0] : entry[1];
  if (kw && Object.keys(kw).length) {
    try {
      for (const k of Object.keys(kw)) {
        s = s.split("{" + k + "}").join(String(kw[k]));
      }
    } catch (e) { /* ignore */ }
  }
  return s;
}
