// מכסת שימוש לבוט הקריקטורות — Verbatim port of quota.py (browser side).
//
// מכסה (תפעלי, לא חלון):
// - בחינם: יצירה אחת כל 24 שעות (תמונה ליום)
// - ברישיון: ללא הגבלה
//
// בדפדפן השמירה היא ב-localStorage תחת המפתח caricature_quota
// (במקום %LOCALAPPDATA%/RavText/caricature_quota.json בגרסת Python).
// אין HMAC כי אין סוד צד-לקוח שמשמעותי במידע ציבורי הזה.

export const COOLDOWN_SECONDS = 24 * 3600;
const LS_KEY_QUOTA = "ravtext.caricature.quota";

function read() {
  try {
    const raw = localStorage.getItem(LS_KEY_QUOTA);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch (e) { /* ignore */ }
  return {};
}

function write(data) {
  try {
    localStorage.setItem(LS_KEY_QUOTA, JSON.stringify(data));
  } catch (e) { /* ignore */ }
}

/** מחזיר { ok: boolean, wait: number } — wait בשניות, 0 כשמותר. */
export function canGenerate(licensed) {
  if (licensed) return { ok: true, wait: 0 };
  const last = Number(read().last_used_ts || 0);
  const elapsed = Date.now() / 1000 - last;
  if (elapsed >= COOLDOWN_SECONDS) return { ok: true, wait: 0 };
  return { ok: false, wait: Math.floor(COOLDOWN_SECONDS - elapsed) };
}

export function markUsed() {
  const data = read();
  data.last_used_ts = Date.now() / 1000;
  write(data);
}

export function humanize(seconds) {
  if (seconds <= 0) return "עכשיו";
  let h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    h = h % 24;
    return `${d} ימים ו-${h} שעות`;
  }
  if (h > 0) {
    return `${h} שעות ו-${m} דקות`;
  }
  return `${m} דקות`;
}
