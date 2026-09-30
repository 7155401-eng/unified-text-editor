// Browser-side UX helper for server-authoritative tool quotas.
//
// Quota truth deliberately does NOT live in localStorage. This module only
// checks login/Premium state and renders messages returned by the Worker.

import { openPremiumPage } from "./premium_page.js";
import { showToast } from "./time_warning.js";

function normalizeToolName(toolName) {
  return String(toolName || "").trim();
}

function authState() {
  return (typeof window !== "undefined" && window.__RAVTEXT_AUTH__) || null;
}

function isPaid() {
  return !!authState()?.paid;
}

export function isPaidAccount() {
  return isPaid();
}

function isLoggedIn() {
  return !!authState()?.loggedIn;
}

// Kept for compatibility with existing callers. The server policy registry is
// authoritative; this function no longer decides whether a tool is metered.
export function isFreeUnmeteredTool(toolName) {
  return normalizeToolName(toolName) === "word-extractor";
}

/**
 * Local pre-check only. Free quota exhaustion is intentionally NOT decided here.
 */
export function canUseTool(toolName) {
  const key = normalizeToolName(toolName);
  if (!key) return { allowed: false, reason: "missing_tool" };
  if (isPaid()) return { allowed: true };
  if (!isLoggedIn()) return { allowed: false, reason: "login" };
  return { allowed: true, serverAuthoritative: true };
}

// Deprecated compatibility shim: usage is recorded by Worker consume actions.
export function markToolUsed(_toolName) {
  return 0;
}

export function showToolBlocked(toolName, niceName, reason, details = null) {
  if (reason === "login") {
    showToast({
      kind: "info",
      title: "צריך להתחבר",
      msg: `${niceName || toolName} דורש התחברות. משתמשי פרימיום מקבלים שימוש ללא הגבלה, ולמשתמשים חינמיים חלה המכסה של הכלי.`,
      actionText: "התחברות",
      action: () => { window.location.href = "/api/auth/login"; },
      autoCloseMs: 8000,
    });
    return;
  }

  if (reason === "quota" || reason === "in_progress") {
    const serverMessage = String(details?.message || "").trim();
    const retry = Number(details?.quota?.retryAfterSeconds ?? details?.retryAfterSeconds ?? 0);
    const retryText = retry > 0
      ? ` ניתן לנסות שוב בעוד כ-${Math.max(1, Math.ceil(retry / 3600))} שעות.`
      : "";
    showToast({
      kind: "warn",
      title: reason === "in_progress" ? "הפעולה כבר נרשמת" : "המכסה החינמית נוצלה",
      msg: serverMessage || `${niceName || toolName}: המכסה החינמית אינה זמינה כרגע.${retryText} בפרימיום השימוש ללא הגבלה.`,
      actionText: "לפרימיום",
      action: openPremiumPage,
      secondaryText: "סגור",
      autoCloseMs: 9000,
    });
  }
}

// Compatibility helper for older buttons. It now performs login-only checking;
// callers that need quota enforcement must use tool_runtime_gate.js.
export function tryUseTool(toolName, niceName) {
  const key = normalizeToolName(toolName);
  const check = canUseTool(key);
  if (check.allowed) return true;
  showToolBlocked(key, niceName, check.reason);
  return false;
}
