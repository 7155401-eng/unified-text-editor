// משה 2026-05-08: שער תצוגה לכלי המתורגמים מ-work-files (פייתון).
// ההיגיון: admin שמחובר רואה את כל הכלים החדשים אוטומטית, בלי URL params.
// משתמש רגיל לא רואה דבר. כשתרצה לפתוח כלי לכולם — נסיר את ה-gate שלו בקומיט קצר.

function isAdmin() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__;
  return !!(auth && auth.admin === true);
}

export function isToolPreviewAllowed(_toolName) {
  // כל הכלים החדשים מוצגים יחד למנהל. אין הבחנה בין כלים ב-gate.
  return isAdmin();
}

export function getActiveToolName() {
  return isAdmin() ? "all" : null;
}

export function revealToolButtons() {
  if (typeof document === "undefined") return;
  if (!isAdmin()) return;
  const buttons = document.querySelectorAll("[data-tool-preview]");
  buttons.forEach((btn) => {
    btn.hidden = false;
  });
}
