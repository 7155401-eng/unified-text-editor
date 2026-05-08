// משה 2026-05-08: שער תצוגה מקדימה לכלי מתורגם מ-work-files (פייתון).
// הכלי מופיע רק אם:
//   1. המשתמש מחובר כ-admin (window.__RAVTEXT_AUTH__.admin === true)
//   2. ה-URL מכיל ?tool=<tool-name>
//   3. ה-URL מכיל ?k=<PREVIEW_SECRET>
// כדי להסיר את ה-gate ולפתוח את הכלי לכולם — מחק את הקובץ הזה ואת הקריאות שלו ב-main.js + index.html.

const PREVIEW_SECRET = "9q7zX3mP4w";

function readParams() {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search || "");
  } catch {
    return null;
  }
}

function isAdmin() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__;
  return !!(auth && auth.admin === true);
}

export function isToolPreviewAllowed(toolName) {
  if (!isAdmin()) return false;
  const params = readParams();
  if (!params) return false;
  if (params.get("k") !== PREVIEW_SECRET) return false;
  const requested = params.get("tool");
  if (!requested) return false;
  if (requested === "all") return true;
  return requested === toolName;
}

export function getActiveToolName() {
  if (!isAdmin()) return null;
  const params = readParams();
  if (!params) return null;
  if (params.get("k") !== PREVIEW_SECRET) return null;
  return params.get("tool") || null;
}

export function revealToolButtons() {
  if (typeof document === "undefined") return;
  const active = getActiveToolName();
  if (!active) return;
  const buttons = document.querySelectorAll("[data-tool-preview]");
  buttons.forEach((btn) => {
    const tool = btn.getAttribute("data-tool-preview");
    if (active === "all" || tool === active) {
      btn.hidden = false;
    }
  });
}
