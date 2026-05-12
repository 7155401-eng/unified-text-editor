// משה 2026-05-09: מכסה יומית לכלים למשתמשים חינמיים מחוברים.
// כלל: כל הכלים (חוץ מעימוד גפ"ת — עליו יש סימן מים והתאפסות דקה) זמינים
// פעם אחת ביום למשתמשים חינמיים מחוברים. משתמשים משלמים = ללא הגבלה.
// משתמשים לא־מחוברים = הוראת התחברות.

import { openPremiumPage } from "./premium_page.js";
import { showToast } from "./time_warning.js";

const TOOL_USAGE_KEY = "ravtext.daily.tools";  // { yyyy-mm-dd: { toolName: count } }

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function readUsage() {
  try {
    const raw = localStorage.getItem(TOOL_USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed || {};
  } catch { return {}; }
}

function writeUsage(usage) {
  try { localStorage.setItem(TOOL_USAGE_KEY, JSON.stringify(usage)); } catch {}
}

function todayUsage() {
  const all = readUsage();
  const today = all[todayKey()] || {};
  return today;
}

function isPaid() {
  const auth = (typeof window !== "undefined") ? window.__RAVTEXT_AUTH__ : null;
  return !!(auth && auth.paid);
}

export function isPaidAccount() {
  return isPaid();
}

function isLoggedIn() {
  const auth = (typeof window !== "undefined") ? window.__RAVTEXT_AUTH__ : null;
  return !!(auth && auth.loggedIn);
}

/**
 * Check if user can run a tool. Returns { allowed: bool, reason: string }.
 * @param {string} toolName - canonical tool id (e.g. "nikud-merger", "word-extractor")
 */
export function canUseTool(toolName) {
  if (isPaid()) return { allowed: true };
  if (!isLoggedIn()) return { allowed: false, reason: "login" };
  const today = todayUsage();
  if ((today[toolName] || 0) >= 1) return { allowed: false, reason: "quota" };
  return { allowed: true };
}

/**
 * Mark a tool as used today. Returns updated count.
 */
export function markToolUsed(toolName) {
  const all = readUsage();
  const key = todayKey();
  if (!all[key]) {
    // garbage-collect: keep only today
    for (const k of Object.keys(all)) delete all[k];
    all[key] = {};
  }
  all[key][toolName] = (all[key][toolName] || 0) + 1;
  writeUsage(all);
  return all[key][toolName];
}

export function showToolBlocked(toolName, niceName, reason) {
  if (reason === "login") {
    showToast({
      kind: "info",
      title: "צריך להתחבר",
      msg: `${niceName || toolName} צריך להתחבר. משתמשים משלמים מקבלים שימוש ללא הגבלה, ומשתמשים חינמיים מקבלים שימוש אחד בכל כלי.`,
      actionText: "התחברות",
      action: () => { window.location.href = "/api/auth/login"; },
      autoCloseMs: 8000,
    });
  } else if (reason === "quota") {
    showToast({
      kind: "warn",
      title: "המכסה היומית נוצלה",
      msg: `${niceName || toolName} זמין פעם אחת בחשבון חינמי. שדרג לפרמיום לשימוש ללא הגבלה.`,
      actionText: "לפרמיום",
      action: openPremiumPage,
      secondaryText: "סגור",
      autoCloseMs: 8000,
    });
  }
}

/**
 * Try to consume one daily use of a tool. Shows the right toast when blocked.
 * @returns {boolean} true if allowed (and consumed), false if blocked.
 */
export function tryUseTool(toolName, niceName) {
  const check = canUseTool(toolName);
  if (check.allowed) {
    if (!isPaid()) markToolUsed(toolName);
    return true;
  }
  showToolBlocked(toolName, niceName, check.reason);
  return false;
}
