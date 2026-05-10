// quota.py port — daily 500-char free quota tracker.
// In Python this is signed with HMAC-SHA256 derived from LICENSE_SECRET.
// In JS we cannot replicate that authoritatively (the secret lives on the
// server). See MIGRATION_NOTES.md — for production this needs a server
// endpoint. For now we mirror the structure and behavior client-side using
// localStorage so the UI/UX matches the Python original 1:1.

export const DAILY_FREE_CHARS = 500;
const STORAGE_KEY = "ravtext.torah_nikud.quota";

function _todayIso() {
  // Same date.today().isoformat() — local-time YYYY-MM-DD
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function _load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const wrapped = JSON.parse(raw);
    if (!wrapped || typeof wrapped !== "object") return {};
    // Mirror the Python "data + sig" envelope, but without server-issued
    // signing the sig field is informational only.
    if ("data" in wrapped) return wrapped.data || {};
    return {};
  } catch (e) {
    return {};
  }
}

function _save(data) {
  try {
    const wrapped = { data: data, sig: "" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapped));
  } catch (e) { /* noop */ }
}

export function usedToday() {
  const data = _load();
  const today = _todayIso();
  if (data.date !== today) return 0;
  try { return parseInt(data.chars_used || 0, 10) || 0; }
  catch (e) { return 0; }
}

export function remainingToday() {
  return Math.max(0, DAILY_FREE_CHARS - usedToday());
}

export function canSend(numChars, isPaid) {
  if (isPaid) return { ok: true, reason: "" };
  if (numChars <= 0) return { ok: false, reason: "אין טקסט לניקוד." };
  const rem = remainingToday();
  if (numChars > rem) {
    return {
      ok: false,
      reason: (
        `חרגת מהמכסה היומית למשתמש חינם.\n\n` +
        `אורך הטקסט: ${numChars} תווים.\n` +
        `נשאר היום: ${rem} תווים מתוך ${DAILY_FREE_CHARS}.\n\n` +
        `לניקוד ללא הגבלה — צריך רישיון בתשלום.`
      ),
    };
  }
  return { ok: true, reason: "" };
}

export function recordUsage(numChars) {
  const today = _todayIso();
  let data = _load();
  if (data.date !== today) data = { date: today, chars_used: 0 };
  data.chars_used = (parseInt(data.chars_used || 0, 10) || 0)
    + Math.max(0, parseInt(numChars, 10) || 0);
  _save(data);
}
