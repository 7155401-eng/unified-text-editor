// משה 2026-05-08: שער תצוגה לכלי מתורגמים מ-work-files (פייתון).
// admin שמחובר רואה כלי בבטא אוטומטית. משתמש רגיל רואה רק כלים מאושרים.
// אישור כלי לכולם = הוספת שמו ל-PUBLIC_TOOLS.

const PUBLIC_TOOLS = new Set([
  "nikud-merger",   // אושר 2026-05-08 — מיזוג ניקוד
]);

function isAdmin() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__;
  return !!(auth && auth.admin === true);
}

export function isToolPreviewAllowed(toolName) {
  if (PUBLIC_TOOLS.has(toolName)) return true;
  return isAdmin();
}

export function revealToolButtons() {
  if (typeof document === "undefined") return;
  const admin = isAdmin();
  const buttons = document.querySelectorAll("[data-tool-preview]");
  buttons.forEach((btn) => {
    const tool = btn.getAttribute("data-tool-preview");
    if (admin || PUBLIC_TOOLS.has(tool)) {
      btn.hidden = false;
    }
  });
}
