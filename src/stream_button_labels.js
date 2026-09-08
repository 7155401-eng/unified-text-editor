// משה 06/09/2026 (הערה 7): הכפתורים של "סמן בחירה כזרם" ו"קפוץ לזרם" נכתבו
// ישירות ב-index.html עם שמות ברירת המחדל של הזרמים. כשהמשתמש נותן לזרם שם
// חדש, הכפתורים האלה המשיכו להציג את השם הישן — ולכן נראה כאילו המערכת לא
// יודעת איך קוראים לזרם. מעכשיו הם נמשכים מהשם החי של החלונית.
//
// כל כתיבה לדף כאן מותנית: כותבים רק אם הערך באמת השתנה. זה לא קישוט —
// כתיבה חוזרת של אותו טקסט נחשבת שינוי בדף, ושינוי כזה מעיר מאזינים
// אחרים ויוצר לולאה. זה בדיוק הבאג שגרם לכפתור "פתח תפריט זרמים" להבהב.

const BUTTON_SELECTOR = ".btn-stream[data-stream], .btn-stream-jump[data-stream]";

let installed = false;
let queued = false;

function livePaneLabels() {
  const labels = new Map();
  const panes = window.paneManager?.panes;
  if (!Array.isArray(panes)) return labels;
  for (const pane of panes) {
    const code = pane?.streamCode;
    if (!code) continue;
    const label = String(pane.label || "").trim();
    if (label) labels.set(String(code), label);
  }
  return labels;
}

export function syncStreamButtonLabels() {
  const labels = livePaneLabels();
  if (!labels.size) return 0;

  let changed = 0;
  document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
    const label = labels.get(String(button.getAttribute("data-stream")));
    if (!label) return;

    if (button.textContent.trim() !== label) {
      button.textContent = label;
      changed += 1;
    }

    const isJump = button.classList.contains("btn-stream-jump");
    const title = isJump
      ? `גלול ל${label} בתצוגת העמודים`
      : `סמן טקסט נבחר כ${label}`;
    if (button.getAttribute("title") !== title) {
      button.setAttribute("title", title);
      changed += 1;
    }
    if (button.getAttribute("aria-label") !== title) {
      button.setAttribute("aria-label", title);
      changed += 1;
    }
  });
  return changed;
}

function queueSync() {
  if (queued) return;
  queued = true;
  const run = () => {
    queued = false;
    try {
      syncStreamButtonLabels();
    } catch (err) {
      console.warn("[stream-button-labels] sync failed", err);
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function attach() {
  const manager = window.paneManager;
  if (!manager || typeof manager.on !== "function") return false;
  manager.on("change", queueSync);
  queueSync();
  return true;
}

export function installStreamButtonLabels() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  let attempts = 0;
  const boot = () => {
    attempts += 1;
    queueSync();
    if (attach() || attempts >= 40) return;
    setTimeout(boot, 150);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  // שם של זרם משתנה גם דרך שדה טקסט בכותרת החלונית, בלי אירוע "change"
  // של המנהל — לכן מסתנכרנים גם אחרי הקלדה בשדות האלה.
  document.addEventListener("input", (event) => {
    if (event.target?.closest?.(".pane-header, .stream-settings-block, .stream-col-input")) queueSync();
  }, true);
  document.addEventListener("change", (event) => {
    if (event.target?.closest?.(".pane-header, .stream-settings-block, .stream-col-input")) queueSync();
  }, true);
}

// חשיפה לבדיקות ולאבחון: מאפשר להריץ סנכרון מיידי ולקבל כמה ערכים השתנו.
if (typeof window !== "undefined") {
  window.__ravtextSyncStreamButtonLabels = syncStreamButtonLabels;
}

installStreamButtonLabels();
