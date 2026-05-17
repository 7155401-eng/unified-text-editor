// Downloads tab — save the current document state to local disk.
// Uses File System Access API for direct folder writes (with persistent
// permission stored in IndexedDB), falls back to <a download> blob downloads.

import {
  isStandalone,
  isInstallable,
  isInstalled,
  onChange as onPwaChange,
  registerServiceWorker,
} from "./pwa_install_controller.js";
import { showInstallDialogManually } from "./pwa_install_prompt.js";
import { isDemoMode } from "./demo_mode.js";

const HANDLE_DB = "ravtext-downloads";
const HANDLE_STORE = "handles";
const HANDLE_KEY = "syncFolder";
const AUTO_SYNC_KEY = "ravtext.downloads.autoSync";
const SECURE_EXPORT_HTML_ENDPOINT = "/api/secure-export-html";

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

async function secureExportHtmlBlob(html) {
  const response = await fetch(SECURE_EXPORT_HTML_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html, requestedAt: new Date().toISOString() }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json();
      detail = data?.error ? ` (${data.error})` : "";
    } catch (_) {}
    throw new Error(`secure_export_failed${detail}`);
  }

  return await response.blob();
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

  try {
    const htmlBlob = await secureExportHtmlBlob(buildPagesSnapshotHTML());
    await writeFile(cachedHandle, "ravtext-document.html", htmlBlob);
    if (!isDemoMode()) {
      await writeFile(cachedHandle, "ravtext-document.json", new Blob([buildDocumentJSON()], { type: "application/json" }));
    }
    setLastSave(`נשמר דרך השרת: ${new Date().toLocaleTimeString("he-IL")}`);
  } catch (err) {
    console.error("[downloads] secure sync failed:", err);
    alert("הייצוא המאובטח דרך השרת נכשל. כדי למנוע עקיפת סימן מים, הקובץ לא נשמר מקומית.");
  }
}

async function clearFolderChoice() {
  await clearHandle();
  cachedHandle = null;
  setStatus("(טרם נבחרה תיקייה)");
}

async function downloadDocumentHTML() {
  try {
    const htmlBlob = await secureExportHtmlBlob(buildPagesSnapshotHTML());
    downloadBlob("ravtext-document.html", htmlBlob);
    setLastSave(`הורד דרך השרת: ${new Date().toLocaleTimeString("he-IL")}`);
  } catch (err) {
    console.error("[downloads] secure HTML export failed:", err);
    alert("הייצוא המאובטח דרך השרת נכשל. כדי למנוע עקיפת סימן מים, ההורדה המקומית נחסמה.");
  }
}

function downloadDocumentJSON() {
  if (isDemoMode()) {
    alert("במצב דמו אין הורדת JSON גולמי, כי הוא יכול לעקוף סימני מים. השתמש בהורדת HTML המאובטחת דרך השרת.");
    return;
  }
  downloadBlob("ravtext-document.json", new Blob([buildDocumentJSON()], { type: "application/json" }));
  setLastSave(`הורד: ${new Date().toLocaleTimeString("he-IL")}`);
}

// ─── PWA install (כרום עצמאי, נעול לאתר) ────────────────────────────────────
function setInstallStatus(text) {
  const el = document.getElementById("dl-install-status");
  if (el) el.textContent = text;
}

function refreshInstallButtonUI() {
  const btn = document.getElementById("dl-install-app");
  if (!btn) return;

  if (isInstalled() || isStandalone()) {
    btn.disabled = true;
    btn.textContent = "✓ מותקן";
    setInstallStatus("האפליקציה כבר מותקנת ופועלת בחלון עצמאי.");
    return;
  }

  if (!("serviceWorker" in navigator)) {
    btn.disabled = true;
    setInstallStatus("הדפדפן שלך לא תומך בהתקנת אפליקציה. נסה בכרום או באדג' עדכניים.");
    return;
  }

  btn.disabled = false;
  if (isInstallable()) {
    setInstallStatus("ההתקנה זמינה — לחץ לפתיחת אשף ההתקנה.");
  } else {
    setInstallStatus("לחץ לקבלת הוראות ההתקנה. ההתקנה הישירה נדלקת אוטומטית בכרום/אדג'.");
  }
}

function wirePwaInstall() {
  const btn = document.getElementById("dl-install-app");
  if (!btn) return;

  refreshInstallButtonUI();
  onPwaChange(refreshInstallButtonUI);

  btn.addEventListener("click", () => {
    if (isInstalled() || isStandalone()) {
      setInstallStatus("האפליקציה כבר מותקנת — פתח אותה דרך שולחן העבודה או תפריט התחל.");
      return;
    }
    showInstallDialogManually();
  });

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
