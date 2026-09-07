// משה 06/09/2026 (הערה 16): „הצג זרמים” — הבורר שבוחר אילו זרמים מוצגים.
//
// מה שהיה: הרכיב קיים בדף עם ערך כמו „01,02”, אבל הוא לא היה מחובר לשום דבר.
// נמדד: שינוי הערך ושליחת אירועי השינוי לא הזיזו כלום — שש חלוניות מוצגות
// לפני ואחרי, והרוחבים זהים לחלוטין. משה דיווח על זה בזמנו, ובצדק.
//
// מה שיש עכשיו: הבורר באמת מסתיר ומציג חלוניות.
//
// שני כללים שקבעתי כאן בכוונה:
//   • הסתרה בלבד — התוכן של חלונית מוסתרת נשאר שלם ולא נמחק. חזרה לבחירה
//     קודמת מחזירה אותה כמו שהייתה.
//   • החלונית הראשית תמיד מוצגת. היא לא זרם, ואי אפשר „לא לבחור” אותה.
//
// כל כתיבה לדף כאן מותנית — כותבים רק אם המצב באמת השתנה, כדי לא להעיר
// מאזינים אחרים וליצור לולאה.

const INPUT_ID = "talmud-streams-input";
const HIDDEN_CLASS = "pane-hidden-by-picker";

let installed = false;
let queued = false;

function pickerInput() {
  return document.getElementById(INPUT_ID);
}

// „01,02” · „1, 2” · „01 02” — כולם אותו דבר. ריק = הצג הכול.
export function parseSelection(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const codes = text
    .split(/[^0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => String(parseInt(part, 10)))
    .filter((n) => n !== "NaN")
    .map((n) => n.padStart(2, "0"));
  return codes.length ? new Set(codes) : null;
}

export function applyStreamVisibility() {
  const panes = window.paneManager?.panes;
  if (!Array.isArray(panes)) return 0;

  const selection = parseSelection(pickerInput()?.value);
  let changed = 0;

  for (const pane of panes) {
    const el = pane?.element;
    if (!el) continue;
    // הראשית תמיד מוצגת; חלונית בלי קוד זרם אינה נבחרת בבורר.
    const hide = !!(selection && pane.streamCode && !selection.has(String(pane.streamCode)));
    if (el.classList.contains(HIDDEN_CLASS) !== hide) {
      el.classList.toggle(HIDDEN_CLASS, hide);
      changed += 1;
    }
  }

  if (changed) {
    try { window.__ravtextApplyPaneWidths?.(); } catch (_) {}
  }
  return changed;
}

function queueApply() {
  if (queued) return;
  queued = true;
  const run = () => {
    queued = false;
    try {
      applyStreamVisibility();
    } catch (err) {
      console.warn("[stream-visibility] apply failed", err);
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

export function installStreamVisibility() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  document.addEventListener("input", (event) => {
    if (event.target?.id === INPUT_ID) queueApply();
  }, true);
  document.addEventListener("change", (event) => {
    if (event.target?.id === INPUT_ID) queueApply();
  }, true);

  let attempts = 0;
  const boot = () => {
    attempts += 1;
    queueApply();
    const manager = window.paneManager;
    if (manager && typeof manager.on === "function") {
      manager.on("change", queueApply);
      return;
    }
    if (attempts < 40) setTimeout(boot, 150);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}

// חשיפה לבדיקות ולאבחון.
if (typeof window !== "undefined") {
  window.__ravtextApplyStreamVisibility = applyStreamVisibility;
}

installStreamVisibility();
