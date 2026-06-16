// Free-account daily quota gate for premium/public tools.
// Text upload/import through the Word extractor is a core entry path and must remain usable
// for logged-in free accounts without consuming the one-use daily tool quota.

import { openPremiumPage } from "./premium_page.js";
import { showToast } from "./time_warning.js";

const TOOL_USAGE_KEY = "ravtext.daily.tools";  // { yyyy-mm-dd: { toolName: count } }

// These tools are allowed for logged-in free accounts without daily quota.
// Keep this list intentionally narrow: this fixes text upload/import only.
const FREE_UNMETERED_TOOLS = new Set([
  "word-extractor",
]);

function normalizeToolName(toolName) {
  return String(toolName || "").trim();
}

export function isFreeUnmeteredTool(toolName) {
  return FREE_UNMETERED_TOOLS.has(normalizeToolName(toolName));
}

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
  } catch {
    return {};
  }
}

function writeUsage(usage) {
  try {
    localStorage.setItem(TOOL_USAGE_KEY, JSON.stringify(usage));
  } catch {}
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
 * Check if user can run a tool. Returns { allowed: bool, reason?: string, unmetered?: bool }.
 * @param {string} toolName - canonical tool id (e.g. "nikud-merger", "word-extractor")
 */
export function canUseTool(toolName) {
  const key = normalizeToolName(toolName);
  if (!key) return { allowed: false, reason: "missing_tool" };

  if (isPaid()) return { allowed: true };
  if (!isLoggedIn()) return { allowed: false, reason: "login" };

  if (isFreeUnmeteredTool(key)) {
    return { allowed: true, unmetered: true };
  }

  const today = todayUsage();
  if ((today[key] || 0) >= 1) return { allowed: false, reason: "quota" };
  return { allowed: true };
}

/**
 * Mark a tool as used today. Returns updated count.
 */
export function markToolUsed(toolName) {
  const keyName = normalizeToolName(toolName);
  if (!keyName) return 0;

  // Upload/import is intentionally not counted against the free daily quota.
  if (isFreeUnmeteredTool(keyName)) {
    const today = todayUsage();
    return today[keyName] || 0;
  }

  const all = readUsage();
  const key = todayKey();
  if (!all[key]) {
    // garbage-collect: keep only today
    for (const k of Object.keys(all)) delete all[k];
    all[key] = {};
  }
  all[key][keyName] = (all[key][keyName] || 0) + 1;
  writeUsage(all);
  return all[key][keyName];
}

export function showToolBlocked(toolName, niceName, reason) {
  if (reason === "login") {
    showToast({
      kind: "info",
      title: "צריך להתחבר",
      msg: `${niceName || toolName} צריך התחברות. משתמשים משלמים מקבלים שימוש מלא, ומשתמשים חינמיים מקבלים שימוש אחד בכל כלי.`,
      actionText: "התחברות",
      action: () => { window.location.href = "/api/auth/login"; },
      autoCloseMs: 8000,
    });
  } else if (reason === "quota") {
    showToast({
      kind: "warn",
      title: "המכסה היומית נוצלה",
      msg: `${niceName || toolName} זמין פעם אחת בחשבון חינמי. שדרג לפרימיום לשימוש ללא הגבלה.`,
      actionText: "לפרימיום",
      action: openPremiumPage,
      secondaryText: "סגור",
      autoCloseMs: 8000,
    });
  }
}

/**
 * Try to consume one daily use of a tool. Shows the right toast when blocked.
 * @returns {boolean} true if allowed (and consumed when metered), false if blocked.
 */
export function tryUseTool(toolName, niceName) {
  const key = normalizeToolName(toolName);
  const check = canUseTool(key);
  if (check.allowed) {
    if (!isPaid() && !check.unmetered) markToolUsed(key);
    return true;
  }
  showToolBlocked(key, niceName, check.reason);
  return false;
}
