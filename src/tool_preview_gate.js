// משה 2026-05-08: שער תצוגה לכלי מתורגמים מ-work-files (פייתון).
// admin שמחובר רואה את הכלי אוטומטית. משתמש רגיל לא רואה דבר.
// כשתרצה להפיץ כלי לכולם — שינוי isToolPreviewAllowed להחזיר true תמיד.

function isAdmin() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__;
  return !!(auth && auth.admin === true);
}

export function isToolPreviewAllowed(_toolName) {
  return isAdmin();
}

export function revealToolButtons() {
  if (typeof document === "undefined") return;
  if (!isAdmin()) return;
  const buttons = document.querySelectorAll("[data-tool-preview]");
  buttons.forEach((btn) => {
    btn.hidden = false;
  });
}
