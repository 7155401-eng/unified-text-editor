// Downloads tab — save the current document state to local disk.
// Uses File System Access API for direct folder writes (with persistent
// permission stored in IndexedDB), falls back to <a download> blob downloads.

const HANDLE_DB = "ravtext-downloads";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "syncFolder";
const AUTO_SYNC_KEY = "ravtext.downloads.autoSync";

let cachedHandle = null;

function openHandleDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle() {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearHandle() {
  const db = await openHandleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readwrite");
    tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function ensurePermission(handle, mode = "readwrite") {
  if (!handle) return false;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

function buildPagesSnapshotHTML() {
  const pagesContainer =
    document.getElementById("pages-container") ||
    document.querySelector(".pages-container") ||
    document.querySelector("#panes-container");
  const pagesHTML = pagesContainer ? pagesContainer.outerHTML : "<p>(no rendered pages)</p>";
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map(el => el.outerHTML).join("\n");
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8" />
<title>רב טקסט — עותק מקומי</title>
${styles}
<style>
body { background: #fff; padding: 20px; font-family: "David Libre", "Frank Ruhl Libre", serif; }
.page { background: #fff; box-shadow: 0 0 8px rgba(0,0,0,0.1); margin: 20px auto; padding: 30px; }
</style>
</head>
<body class="light-theme">
${pagesHTML}
<footer style="margin-top:30px;font-size:11px;color:#888;text-align:center;">
נשמר ב-${new Date().toLocaleString("he-IL")} — עותק משקף של האונליין
</footer>
</body>
</html>`;
}

function buildDocumentJSON() {
  const data = {
    savedAt: new Date().toISOString(),
    panes: [],
    settings: {},
    version: 1,
  };
  document.querySelectorAll(".pane").forEach((p, i) => {
    const ed = p.querySelector(".editor, [contenteditable]");
    data.panes.push({
      index: i,
      streamCode: p.dataset.streamCode || null,
      html: ed ? ed.innerHTML : "",
    });
  });
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("ravtext.")) data.settings[k] = localStorage.getItem(k);
  }
  return JSON.stringify(data, null, 2);
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

async function writeFile(dirHandle, name, blob) {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

function setStatus(text) {
  const el = document.getElementById("dl-folder-status");
  if (el) el.textContent = text;
}

function setLastSave(text) {
  const el = document.getElementById("dl-last-save");
  if (el) el.textContent = text;
}

async function refreshFolderStatus() {
  try {
    cachedHandle = await loadHandle();
    setStatus(cachedHandle ? `תיקיית יעד: ${cachedHandle.name}` : "(טרם נבחרה תיקייה)");
  } catch {
    setStatus("(טרם נבחרה תיקייה)");
  }
}

async function pickFolder() {
  if (!("showDirectoryPicker" in window)) {
    alert("הדפדפן שלך לא תומך בבחירת תיקייה ישירה. השתמש בכפתורי ההורדה.");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (!(await ensurePermission(handle))) {
      alert("ללא הרשאת כתיבה לא ניתן לסנכרן.");
      return;
    }
    await saveHandle(handle);
    cachedHandle = handle;
    setStatus(`תיקיית יעד: ${handle.name}`);
  } catch (e) {
    if (e.name !== "AbortError") console.error("[downloads] pickFolder:", e);
  }
}

async function syncNow() {
  if (!cachedHandle) {
    alert("בחר קודם תיקיית יעד.");
    return;
  }
  if (!(await ensurePermission(cachedHandle))) {
    alert("הרשאת הכתיבה נשללה. בחר תיקייה מחדש.");
    return;
  }
  const html = buildPagesSnapshotHTML();
  const json = buildDocumentJSON();
  await writeFile(cachedHandle, "ravtext-document.html", new Blob([html], { type: "text/html" }));
  await writeFile(cachedHandle, "ravtext-document.json", new Blob([json], { type: "application/json" }));
  setLastSave(`נשמר: ${new Date().toLocaleTimeString("he-IL")}`);
}

async function clearFolderChoice() {
  await clearHandle();
  cachedHandle = null;
  setStatus("(טרם נבחרה תיקייה)");
}

function downloadDocumentHTML() {
  downloadBlob("ravtext-document.html", new Blob([buildPagesSnapshotHTML()], { type: "text/html" }));
  setLastSave(`הורד: ${new Date().toLocaleTimeString("he-IL")}`);
}

function downloadDocumentJSON() {
  downloadBlob("ravtext-document.json", new Blob([buildDocumentJSON()], { type: "application/json" }));
  setLastSave(`הורד: ${new Date().toLocaleTimeString("he-IL")}`);
}

// ─── PWA install (כרום עצמאי, נעול לאתר) ────────────────────────────────────
//
// יעד: כפתור "📲 התקן כאפליקציה" שמתקין את האתר כ-PWA. אחרי התקנה
// האפליקציה נפתחת בחלון משלה (display=standalone במניפסט) רק על
// הסקופ של רב טקסט (scope=/), כך שלא ניתן לגלוש לאתרים אחרים מתוך
// החלון הזה — ניווט מחוץ לסקופ נפתח אוטומטית בדפדפן רגיל.
//
// Chrome/Edge יורים beforeinstallprompt רק אם:
//   1. יש manifest תקין עם scope/start_url/display/icons
//   2. רשום service worker פעיל
//   3. האתר מוגש על https
// אנחנו לוכדים את האירוע ושומרים אותו כדי להפעיל אותו דרך הכפתור.

let _installPrompt = null;

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function setInstallStatus(text) {
  const el = document.getElementById("dl-install-status");
  if (el) el.textContent = text;
}

function setInstallButtonEnabled(enabled) {
  const btn = document.getElementById("dl-install-app");
  if (btn) btn.disabled = !enabled;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch (err) {
    console.warn("[pwa] sw register failed:", err);
  }
}

async function triggerInstall() {
  if (isStandalone()) {
    setInstallStatus("האפליקציה כבר מותקנת ופועלת בחלון עצמאי.");
    return;
  }
  if (!_installPrompt) {
    setInstallStatus("ההתקנה לא זמינה כעת. פתח את האתר בכרום/אדג' על המחשב, ואם הכפתור עדיין לא פעיל — חכה כמה שניות לאחר טעינה.");
    return;
  }
  try {
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallStatus("ההתקנה הושלמה — האפליקציה תפתח בחלון משלה.");
    } else {
      setInstallStatus("ההתקנה בוטלה. אפשר לנסות שוב בכל עת.");
    }
  } catch (err) {
    console.warn("[pwa] install prompt failed:", err);
    setInstallStatus("שגיאה בהפעלת ההתקנה. נסה שוב מהדפדפן או דרך תפריט הדפדפן.");
  } finally {
    _installPrompt = null;
    setInstallButtonEnabled(false);
  }
}

function wirePwaInstall() {
  const btn = document.getElementById("dl-install-app");
  if (!btn) return;

  // מצב התחלתי — הכפתור כבוי עד שיגיע beforeinstallprompt או שנזהה Standalone.
  setInstallButtonEnabled(false);

  if (isStandalone()) {
    setInstallStatus("✓ האפליקציה כבר מותקנת ורצה בחלון עצמאי.");
    btn.textContent = "✓ מותקן";
    return;
  }

  if (!("serviceWorker" in navigator)) {
    setInstallStatus("הדפדפן שלך לא תומך בהתקנת אפליקציה. נסה בכרום או באדג' עדכניים.");
    return;
  }

  setInstallStatus("מאתר זמינות התקנה…");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    _installPrompt = e;
    setInstallButtonEnabled(true);
    setInstallStatus("ההתקנה זמינה — לחץ כדי להתקין.");
  });

  window.addEventListener("appinstalled", () => {
    _installPrompt = null;
    setInstallButtonEnabled(false);
    setInstallStatus("✓ ההתקנה הושלמה.");
    btn.textContent = "✓ מותקן";
  });

  btn.addEventListener("click", triggerInstall);

  // אם אחרי 6 שניות עדיין אין אירוע התקנה — סמן הוראות ידניות.
  // (קורה בדפדפנים שלא תומכים, או באתר שכבר נוסף בעבר ל-Browser PWA list.)
  setTimeout(() => {
    if (!_installPrompt && !isStandalone()) {
      setInstallStatus("אם הכפתור לא נדלק: בכרום/אדג' לחץ על אייקון ההתקנה בשורת הכתובת, או בתפריט „...” → „התקן את האפליקציה”.");
    }
  }, 6000);

  registerServiceWorker();
}

export function wireDownloadsPanel() {
  const panel = document.getElementById("downloads-panel");
  if (!panel) return;

  document.getElementById("dl-download-doc")?.addEventListener("click", downloadDocumentHTML);
  document.getElementById("dl-download-json")?.addEventListener("click", downloadDocumentJSON);
  document.getElementById("dl-pick-folder")?.addEventListener("click", pickFolder);
  document.getElementById("dl-sync-now")?.addEventListener("click", syncNow);
  document.getElementById("dl-clear-folder")?.addEventListener("click", clearFolderChoice);

  const autoCb = document.getElementById("dl-auto-sync");
  if (autoCb) {
    autoCb.checked = localStorage.getItem(AUTO_SYNC_KEY) === "1";
    autoCb.addEventListener("change", () => {
      localStorage.setItem(AUTO_SYNC_KEY, autoCb.checked ? "1" : "0");
    });
  }

  window.addEventListener("ravtext:engine-rendered", () => {
    if (localStorage.getItem(AUTO_SYNC_KEY) === "1" && cachedHandle) {
      syncNow().catch(err => console.warn("[downloads] auto-sync failed:", err));
    }
  });

  wirePwaInstall();
  refreshFolderStatus();
}
