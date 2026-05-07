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
  notify();
});

window.addEventListener("appinstalled", () => {
  _prompt = null;
  try { localStorage.setItem(INSTALLED_KEY, "1"); } catch {}
  notify();
});

export function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
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
