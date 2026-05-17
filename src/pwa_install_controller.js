import "./render_pause_controls.js";

// PWA install — shared singleton state.
//
// beforeinstallprompt נורה פעם אחת בלבד לטעינת דף. כדי שגם הכפתור
// בכרטיסיית "הורדה" וגם המודל האלגנטי בביקור השלישי יוכלו להפעיל
// התקנה — נלכוד את האירוע במקום אחד ונחשוף API משותף.

const INSTALLED_KEY = "ravtext.pwa.installed";

let _prompt = null;
const _listeners = new Set();

function notify() {
  for (const cb of Array.from(_listeners)) {
    try { cb(); } catch (err) { console.warn("[pwa-controller] listener:", err); }
  }
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  _prompt = e;
  // אם הדפדפן מציע התקנה מחדש — סימן שהאפליקציה אינה מותקנת.
  // יכול לקרות אחרי שמשתמש הסיר ידנית את ה-PWA. נאפס את הדגל
  // כדי שהמודל וההצעה יוכלו לעלות שוב.
  try { localStorage.removeItem(INSTALLED_KEY); } catch {}
  notify();
});

window.addEventListener("appinstalled", () => {
  _prompt = null;
  try { localStorage.setItem(INSTALLED_KEY, "1"); } catch {}
  notify();
});

export function isStandalone() {
  // המניפסט מצהיר display_override: ["standalone", "minimal-ui"], אז Chrome
  // עלול לפתוח את האפליקציה ב-minimal-ui (למשל ב-launch מ-`--app=URL`, או
  // כשמסך הפעלה לא תומך ב-standalone). שני המצבים = "אפליקציה מותקנת שלא
  // רצה כטאב רגיל", שניהם צריכים לקבל את ה-fetch tagger.
  if (!window.matchMedia) return window.navigator.standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: minimal-ui)").matches
    || window.navigator.standalone === true;
}

export function isInstalled() {
  if (isStandalone()) return true;
  try { return localStorage.getItem(INSTALLED_KEY) === "1"; } catch { return false; }
}

export function isInstallable() {
  return _prompt !== null;
}

export async function requestInstall() {
  if (!_prompt) return { available: false };
  const p = _prompt;
  try {
    p.prompt();
    const { outcome } = await p.userChoice;
    return { available: true, outcome };
  } catch (err) {
    return { available: true, outcome: "error", error: err };
  } finally {
    _prompt = null;
    notify();
  }
}

export function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[pwa] sw register failed:", err);
  }
}

// fetch wrapper — בכל בקשה ב-PWA standalone נצרף כותרת
// X-Ravtext-Display: standalone כדי שה-worker יוכל לזהות שזו
// בקשה לגיטימית מהאפליקציה המותקנת ולא לדחות אותה ב-checkOrigin.
//
// אבטחה: הדפדפן עצמו שולח Sec-Fetch-Site שלא ניתן לזיוף מ-JS.
// ה-worker מאשר רק כש-Sec-Fetch-Site === 'same-origin' AND
// X-Ravtext-Display === 'standalone'. תוקף מדומיין אחר יקבל
// Sec-Fetch-Site === 'cross-site' מהדפדפן ולא יוכל לעקוף.
let _fetchWrapped = false;
export function installFetchTagger() {
  if (_fetchWrapped) return;
  if (!isStandalone()) return;
  if (typeof window.fetch !== "function") return;

  const orig = window.fetch.bind(window);
  window.fetch = function (input, init = {}) {
    try {
      // תיוג רק לבקשות same-origin (אל api/ שלנו). חוצה-origin —
      // לא מוסיפים, כי זה יפעיל preflight CORS ויפיל בקשות לגוגל וכו'.
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const u = new URL(url, location.href);
      if (u.host !== location.host) return orig(input, init);

      const headers = new Headers(init.headers || (input && input.headers) || {});
      if (!headers.has("X-Ravtext-Display")) {
        headers.set("X-Ravtext-Display", "standalone");
      }
      return orig(input, { ...init, headers });
    } catch {
      return orig(input, init);
    }
  };
  _fetchWrapped = true;
}

// בדיקה אסינכרונית של מצב התקנה אמיתי (אם הדפדפן תומך
// ב-getInstalledRelatedApps). אם API חסר — מחזיר null ונופלים
// חזרה על ה-flag הסטטי.
export async function checkRealInstalledStatus() {
  try {
    if (navigator.getInstalledRelatedApps) {
      const apps = await navigator.getInstalledRelatedApps();
      return Array.isArray(apps) && apps.length > 0;
    }
  } catch {}
  return null;
}
