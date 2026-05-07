// Elegant install prompt — מופיע אוטומטית בביקור השלישי, וגם
// כשלוחצים על כפתור "התקן כאפליקציה" בכרטיסיית הורדה.
//
// מונה ביקורים מבוסס localStorage עם מנעול sessionStorage כדי שלא
// נספור פעמים מרובות באותה לשונית. אחרי "אולי אחר כך" נחכה 7 ימים,
// אחרי "אל תציג שוב" — לא נטריד יותר. אחרי התקנה מוצג טוסט עדין
// עם הוראות לקיבוע בשורת המשימות (אם המשתמש סימן את הצ'קבוקס).

import {
  isInstalled,
  isInstallable,
  requestInstall,
  onChange,
} from "./pwa_install_controller.js";

const VISIT_KEY = "ravtext.pwa.visits";
const DISMISSED_KEY = "ravtext.pwa.promptDismissed";
const SESSION_FLAG = "ravtext_pwa_session_counted";
const TASKBAR_PREF_KEY = "ravtext.pwa.showTaskbarHelp";
const LATER_DAYS = 7;

function readNum(key) {
  try { return parseInt(localStorage.getItem(key) || "0", 10) || 0; }
  catch { return 0; }
}

function writeNum(key, v) {
  try { localStorage.setItem(key, String(v)); } catch {}
}

function countVisitOnce() {
  try {
    if (sessionStorage.getItem(SESSION_FLAG)) return readNum(VISIT_KEY);
    sessionStorage.setItem(SESSION_FLAG, "1");
  } catch {}
  const next = readNum(VISIT_KEY) + 1;
  writeNum(VISIT_KEY, next);
  return next;
}

function dismissedNeverAsk() {
  try { return localStorage.getItem(DISMISSED_KEY) === "never"; }
  catch { return false; }
}

function dismissedLaterRecently() {
  try {
    const v = localStorage.getItem(DISMISSED_KEY) || "";
    if (!v.startsWith("later:")) return false;
    const ts = parseInt(v.slice(6), 10) || 0;
    return (Date.now() - ts) < (1000 * 60 * 60 * 24 * LATER_DAYS);
  } catch { return false; }
}

function injectStyles() {
  if (document.getElementById("rt-pwa-install-styles")) return;
  const style = document.createElement("style");
  style.id = "rt-pwa-install-styles";
  style.textContent = `
@keyframes rt-pwa-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes rt-pwa-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes rt-pwa-slide-up {
  from { opacity: 0; transform: translate(-50%, -42%) scale(0.96); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes rt-pwa-toast-in {
  from { opacity: 0; transform: translate(-50%, 20px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

.rt-pwa-overlay {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: rt-pwa-fade-in 0.25s ease-out;
}
.rt-pwa-overlay.closing { animation: rt-pwa-fade-out 0.22s ease-out forwards; }
.rt-pwa-card {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(480px, calc(100vw - 32px));
  max-height: calc(100vh - 32px); overflow: auto;
  background: linear-gradient(165deg, #ffffff 0%, #f8fafc 100%);
  border-radius: 20px;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(15, 23, 42, 0.06);
  padding: 28px 28px 22px;
  font-family: "David Libre", "Frank Ruhl Libre", system-ui, -apple-system, sans-serif;
  color: #1e293b;
  animation: rt-pwa-slide-up 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.rt-pwa-icon {
  width: 64px; height: 64px; border-radius: 16px;
  background: linear-gradient(135deg, #2c5aa0 0%, #1e4078 100%);
  display: flex; align-items: center; justify-content: center;
  margin: 0 0 18px;
  box-shadow: 0 8px 24px rgba(44, 90, 160, 0.4);
}
.rt-pwa-icon img { width: 38px; height: 38px; filter: brightness(0) invert(1); }
.rt-pwa-title {
  font-size: 22px; font-weight: 700; line-height: 1.3;
  margin: 0 0 8px; color: #0f172a;
}
.rt-pwa-title .accent { color: #2c5aa0; }
.rt-pwa-subtitle {
  font-size: 14px; color: #475569; line-height: 1.6;
  margin: 0 0 16px;
}
.rt-pwa-bullets {
  list-style: none; padding: 0; margin: 0 0 16px;
  font-size: 13.5px; color: #334155;
}
.rt-pwa-bullets li {
  padding: 5px 0;
  display: flex; align-items: flex-start; gap: 10px;
  line-height: 1.5;
}
.rt-pwa-bullets li::before {
  content: "✓"; color: #16a34a; font-weight: 700;
  flex-shrink: 0; margin-top: 1px;
}
.rt-pwa-shortcuts {
  background: #f1f5f9; border-radius: 12px;
  padding: 12px 14px 10px; margin: 0 0 18px;
  font-size: 13px; color: #475569;
}
.rt-pwa-shortcuts-title {
  font-weight: 600; color: #0f172a;
  margin: 0 0 6px; font-size: 12.5px;
}
.rt-pwa-shortcuts label {
  display: flex; align-items: center; gap: 8px;
  padding: 3px 0; cursor: pointer;
}
.rt-pwa-shortcuts label.fixed {
  color: #64748b; cursor: default;
}
.rt-pwa-shortcuts input[type="checkbox"] { margin: 0; cursor: pointer; }
.rt-pwa-shortcuts input[disabled] { cursor: default; }
.rt-pwa-actions {
  display: flex; gap: 10px; margin: 0 0 10px;
}
.rt-pwa-primary {
  flex: 1;
  background: linear-gradient(135deg, #2c5aa0 0%, #1e4078 100%);
  color: #fff; border: 0; border-radius: 12px;
  padding: 13px 16px; font-size: 15px; font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(44, 90, 160, 0.4);
  transition: transform 0.15s, box-shadow 0.15s;
  font-family: inherit;
}
.rt-pwa-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(44, 90, 160, 0.5);
}
.rt-pwa-primary:active:not(:disabled) { transform: translateY(0); }
.rt-pwa-primary:disabled {
  opacity: 0.55; cursor: not-allowed;
  background: linear-gradient(135deg, #94a3b8, #64748b);
  box-shadow: none;
}
.rt-pwa-later {
  background: #fff; color: #475569;
  border: 1px solid #cbd5e1; border-radius: 12px;
  padding: 13px 18px; font-size: 14px; cursor: pointer;
  transition: background 0.15s;
  font-family: inherit;
}
.rt-pwa-later:hover { background: #f8fafc; }
.rt-pwa-never {
  display: block; margin: 0 auto;
  background: transparent; border: 0; color: #94a3b8;
  font-size: 12px; cursor: pointer; padding: 6px 8px;
  text-decoration: underline; font-family: inherit;
}
.rt-pwa-never:hover { color: #475569; }
.rt-pwa-close {
  position: absolute; top: 12px; left: 12px;
  background: transparent; border: 0;
  width: 32px; height: 32px; border-radius: 8px;
  font-size: 22px; line-height: 1; color: #94a3b8;
  cursor: pointer; transition: background 0.15s;
}
.rt-pwa-close:hover { background: #f1f5f9; color: #475569; }
.rt-pwa-availability {
  font-size: 11.5px; color: #94a3b8;
  margin: 6px 0 0; text-align: center;
  min-height: 16px;
}

.rt-pwa-toast {
  position: fixed; bottom: 24px; left: 50%;
  transform: translateX(-50%);
  background: linear-gradient(135deg, #0f172a, #1e293b);
  color: #fff;
  padding: 14px 18px; border-radius: 12px;
  font-family: "David Libre", system-ui, sans-serif; font-size: 14px;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4),
              0 0 0 1px rgba(255, 255, 255, 0.06);
  z-index: 99998; max-width: 92vw;
  display: flex; align-items: center; gap: 12px;
  animation: rt-pwa-toast-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.rt-pwa-toast .close {
  background: transparent; border: 0; color: #cbd5e1;
  cursor: pointer; font-size: 18px; padding: 0 4px;
}
.rt-pwa-toast .close:hover { color: #fff; }

/* Dark theme support */
body[data-theme="dark"] .rt-pwa-card,
body.dark-theme .rt-pwa-card {
  background: linear-gradient(165deg, #1e293b 0%, #0f172a 100%);
  color: #e2e8f0;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.08);
}
body[data-theme="dark"] .rt-pwa-title,
body.dark-theme .rt-pwa-title { color: #f8fafc; }
body[data-theme="dark"] .rt-pwa-title .accent,
body.dark-theme .rt-pwa-title .accent { color: #60a5fa; }
body[data-theme="dark"] .rt-pwa-subtitle,
body.dark-theme .rt-pwa-subtitle { color: #cbd5e1; }
body[data-theme="dark"] .rt-pwa-bullets,
body.dark-theme .rt-pwa-bullets { color: #cbd5e1; }
body[data-theme="dark"] .rt-pwa-shortcuts,
body.dark-theme .rt-pwa-shortcuts { background: #0f172a; color: #cbd5e1; }
body[data-theme="dark"] .rt-pwa-shortcuts-title,
body.dark-theme .rt-pwa-shortcuts-title { color: #f8fafc; }
body[data-theme="dark"] .rt-pwa-later,
body.dark-theme .rt-pwa-later {
  background: #1e293b; color: #cbd5e1; border-color: #475569;
}
body[data-theme="dark"] .rt-pwa-later:hover,
body.dark-theme .rt-pwa-later:hover { background: #334155; }
body[data-theme="dark"] .rt-pwa-close:hover,
body.dark-theme .rt-pwa-close:hover { background: #1e293b; }
  `;
  document.head.appendChild(style);
}

let _activeOverlay = null;

function buildDialog() {
  const overlay = document.createElement("div");
  overlay.className = "rt-pwa-overlay";
  overlay.innerHTML = `
    <div class="rt-pwa-card" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="rt-pwa-title">
      <button type="button" class="rt-pwa-close" aria-label="סגור">×</button>
      <div class="rt-pwa-icon"><img src="/favicon.svg" alt="" /></div>
      <h2 class="rt-pwa-title" id="rt-pwa-title">התקן את <span class="accent">רב טקסט</span> כאפליקציה</h2>
      <p class="rt-pwa-subtitle">חלון משלה, פתיחה מהירה — נפתח כמו תוכנה ולא כדף בדפדפן.</p>
      <ul class="rt-pwa-bullets">
        <li>פתיחה כמו תוכנה רגילה — חלון נפרד, ללא סרגל דפדפן</li>
        <li>נעולה לאתר רב טקסט — לא ניתן לגלוש לאתרים אחרים מתוך החלון</li>
        <li>פעולה מהירה יותר וזיכרון פחות מטאב בדפדפן</li>
      </ul>
      <div class="rt-pwa-shortcuts">
        <div class="rt-pwa-shortcuts-title">קיצורי דרך:</div>
        <label class="fixed"><input type="checkbox" checked disabled /> שולחן העבודה — נוצר אוטומטית</label>
        <label class="fixed"><input type="checkbox" checked disabled /> תפריט "התחל" — נוצר אוטומטית</label>
        <label><input type="checkbox" id="rt-pwa-taskbar-pref" checked /> הצג הוראות לקיבוע בשורת המשימות</label>
      </div>
      <div class="rt-pwa-actions">
        <button type="button" class="rt-pwa-primary">📲 התקן עכשיו</button>
        <button type="button" class="rt-pwa-later">אולי אחר כך</button>
      </div>
      <button type="button" class="rt-pwa-never">אל תציג שוב</button>
      <p class="rt-pwa-availability" id="rt-pwa-availability"></p>
    </div>
  `;
  return overlay;
}

function showInstallDialog() {
  if (isInstalled()) return;
  injectStyles();

  if (_activeOverlay) {
    _activeOverlay.remove();
    _activeOverlay = null;
  }

  const overlay = buildDialog();
  document.body.appendChild(overlay);
  _activeOverlay = overlay;

  const primary = overlay.querySelector(".rt-pwa-primary");
  const availability = overlay.querySelector("#rt-pwa-availability");
  const taskbarPref = overlay.querySelector("#rt-pwa-taskbar-pref");

  function updateAvailability() {
    if (isInstallable()) {
      primary.disabled = false;
      availability.textContent = "";
    } else {
      primary.disabled = true;
      availability.textContent = "ההתקנה לא זמינה כרגע. פתח את האתר בכרום או באדג' עדכניים על המחשב.";
    }
  }
  updateAvailability();
  const offChange = onChange(updateAvailability);

  function close(reason) {
    offChange();
    overlay.classList.add("closing");
    setTimeout(() => {
      if (overlay.parentNode) overlay.remove();
      if (_activeOverlay === overlay) _activeOverlay = null;
    }, 220);
    if (reason === "later") {
      try { localStorage.setItem(DISMISSED_KEY, "later:" + Date.now()); } catch {}
    } else if (reason === "never") {
      try { localStorage.setItem(DISMISSED_KEY, "never"); } catch {}
    } else if (reason === "installed") {
      try { localStorage.removeItem(DISMISSED_KEY); } catch {}
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close("later");
  });
  overlay.querySelector(".rt-pwa-close").addEventListener("click", () => close("later"));
  overlay.querySelector(".rt-pwa-later").addEventListener("click", () => close("later"));
  overlay.querySelector(".rt-pwa-never").addEventListener("click", () => close("never"));

  primary.addEventListener("click", async () => {
    try {
      localStorage.setItem(TASKBAR_PREF_KEY, taskbarPref.checked ? "1" : "0");
    } catch {}
    primary.disabled = true;
    primary.textContent = "מתקין…";
    const result = await requestInstall();
    if (result.outcome === "accepted") {
      close("installed");
    } else {
      // user declined the native dialog — give them another path
      primary.textContent = "📲 התקן עכשיו";
      updateAvailability();
      close("later");
    }
  });

  function onEsc(e) {
    if (e.key === "Escape") {
      close("later");
      window.removeEventListener("keydown", onEsc);
    }
  }
  window.addEventListener("keydown", onEsc);
}

function showPostInstallTaskbarHelp() {
  let wantHelp = "1";
  try { wantHelp = localStorage.getItem(TASKBAR_PREF_KEY) || "1"; } catch {}
  if (wantHelp !== "1") return;

  injectStyles();
  const toast = document.createElement("div");
  toast.className = "rt-pwa-toast";
  toast.dir = "rtl";
  toast.innerHTML = `
    <span>✓ הותקן! לקיבוע בשורת המשימות: לחץ ימני על אייקון "רב טקסט" בשורת המשימות → "קבע לשורת המשימות".</span>
    <button type="button" class="close" aria-label="סגור">×</button>
  `;
  document.body.appendChild(toast);
  toast.querySelector(".close").addEventListener("click", () => toast.remove());
  setTimeout(() => {
    if (toast.parentNode) {
      toast.style.transition = "opacity 0.4s, transform 0.4s";
      toast.style.opacity = "0";
      toast.style.transform = "translate(-50%, 20px)";
      setTimeout(() => toast.remove(), 400);
    }
  }, 18000);
}

export function initPwaInstallPrompt() {
  if (isInstalled()) return;

  const visits = countVisitOnce();

  // Always wire the post-install toast, even if we don't show the dialog.
  window.addEventListener("appinstalled", showPostInstallTaskbarHelp);

  if (dismissedNeverAsk()) return;
  if (dismissedLaterRecently()) return;

  if (visits >= 3) {
    let shown = false;
    const tryShow = () => {
      if (shown || isInstalled()) return;
      shown = true;
      // המתנה קצרה כדי לא לקפוץ בפנים של המשתמש מיד עם הטעינה.
      setTimeout(showInstallDialog, 1500);
    };
    if (isInstallable()) {
      tryShow();
    } else {
      const off = onChange(() => {
        if (isInstallable()) { off(); tryShow(); }
      });
      // אם beforeinstallprompt לא נורה תוך 4 שניות — הצג בכל זאת
      // עם הסבר על ההתקנה הידנית; דפדפנים ללא תמיכת PWA יראו fallback.
      setTimeout(() => { if (!shown) { off(); tryShow(); } }, 4000);
    }
  }
}

// Manual trigger from the Downloads tab button.
export function showInstallDialogManually() {
  showInstallDialog();
}
