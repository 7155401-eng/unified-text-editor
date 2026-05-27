import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/document_chapter_splitter.js';

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, value) {
  writeFileSync(path, value, 'utf8');
}

function must(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`[docx-upload-action-feedback] Missing anchor: ${label}`);
  return src.replace(search, replacement);
}

function replaceBetween(src, start, end, replacement, label) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`[docx-upload-action-feedback] Missing block start: ${label}`);
  const b = src.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`[docx-upload-action-feedback] Missing block end: ${label}`);
  return src.slice(0, a) + replacement + src.slice(b);
}

const feedbackHelpers = `
function ensureUploadActionProgressStyle() {
  if (document.getElementById("ravtext-upload-action-progress-style")) return;

  const style = document.createElement("style");
  style.id = "ravtext-upload-action-progress-style";
  style.textContent = \`
    @keyframes ravtext-progress-pulse {
      from { transform: translateX(-55%); opacity: .62; }
      to { transform: translateX(205%); opacity: 1; }
    }
    .ravtext-upload-action-bar-indeterminate {
      width: 38%;
      animation: ravtext-progress-pulse 1.05s ease-in-out infinite alternate;
    }
    #we-static-connection-probe button:not([disabled]) {
      opacity: 1;
    }
    #we-static-connection-probe button:not([disabled]):active {
      transform: translateY(1px);
    }
  \`;
  document.head.appendChild(style);
}

function renderUploadActionProgress({ title, message, percent = null, details = "" } = {}) {
  ensureUploadActionProgressStyle();

  const card = ensureCard();
  if (!card) return;

  const raw = percent == null ? null : Number(percent);
  const pct = raw == null || !Number.isFinite(raw) ? null : Math.max(0, Math.min(100, Math.round(raw)));

  card.innerHTML = \`
    <b style="color:#312e81">\${esc(title || "מבצע פעולה...")}</b>

    <div style="font-size:12px;color:#64748b;margin-top:4px">
      \${esc(message || "")}
    </div>

    <div style="margin-top:12px;border:1px solid #cbd5e1;border-radius:999px;overflow:hidden;background:#f8fafc;height:14px">
      <div class="\${pct == null ? "ravtext-upload-action-bar-indeterminate" : ""}" style="
        height:100%;
        width:\${pct == null ? "38%" : pct + "%"};
        background:#7c3aed;
        transition:width .2s ease;
      "></div>
    </div>

    <div style="font-size:11px;color:#64748b;margin-top:6px">
      \${pct == null ? "מתקדם..." : pct + "%"}
    </div>

    \${details ? \`
      <pre style="margin-top:10px;white-space:pre-wrap;font-size:11px;color:#475569;background:white;border:1px solid #e2e8f0;border-radius:8px;padding:8px">\${esc(details)}</pre>
    \` : ""}
  \`;
}

function renderUploadActionSuccess({ title, message, actionsHtml = "" } = {}) {
  const card = ensureCard();
  if (!card) return;

  card.innerHTML = \`
    <b style="color:#166534">\${esc(title || "הפעולה הושלמה")}</b>

    <div style="font-size:12px;color:#475569;margin-top:6px">
      \${esc(message || "")}
    </div>

    <div style="margin-top:10px;background:#ecfdf5;border:1px solid #bbf7d0;border-radius:8px;padding:8px;color:#166534">
      ✓ בוצע בהצלחה
    </div>

    \${actionsHtml ? \`
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        \${actionsHtml}
      </div>
    \` : ""}
  \`;
}

function readPendingDocxUploads() {
  const key = "ravtext-pending-docx-uploads";
  try {
    const items = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writePendingDocxUploads(items) {
  localStorage.setItem("ravtext-pending-docx-uploads", JSON.stringify((Array.isArray(items) ? items : []).slice(0, 20)));
}

function pendingUploadButtonStyle(color = "#7c3aed") {
  return \`border:1px solid \${color};border-radius:8px;background:white;padding:8px 12px;font-weight:700;cursor:pointer;color:\${color}\`;
}

function renderPendingUploadsList() {
  const card = ensureCard();
  if (!card) return;

  const items = readPendingDocxUploads();

  if (!items.length) {
    card.innerHTML = \`
      <b style="color:#312e81">קבצים שמורים</b>
      <div style="margin-top:8px;color:#64748b">אין קבצים שמורים לטיפול מאוחר יותר.</div>
      <button type="button" data-wh-back-upload-menu
        style="margin-top:12px;border:1px solid #cbd5e1;border-radius:8px;background:white;padding:8px 12px;cursor:pointer">
        חזור
      </button>
    \`;
    return;
  }

  card.innerHTML = \`
    <b style="color:#312e81">קבצים שמורים לטיפול מאוחר יותר</b>

    <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
      \${items.map((item, index) => \`
        <div style="border:1px solid #e2e8f0;border-radius:9px;background:white;padding:9px">
          <b>\${esc(item.fileName || "מסמך Word")}</b>
          <div style="font-size:12px;color:#64748b">
            \${fmt(Math.round((item.bytes || 0) / 1024 / 1024))}MB
            · נשמר: \${new Date(item.savedAt || Date.now()).toLocaleString("he-IL")}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            <button type="button" data-wh-use-pending-upload="\${index}"
              style="\${pendingUploadButtonStyle("#7c3aed")}">
              טפל בקובץ זה
            </button>
            <button type="button" data-wh-remove-pending-upload="\${index}"
              style="\${pendingUploadButtonStyle("#dc2626")}">
              הסר מהרשימה
            </button>
          </div>
        </div>
      \`).join("")}
    </div>

    <button type="button" data-wh-back-upload-menu
      style="margin-top:12px;border:1px solid #cbd5e1;border-radius:8px;background:white;padding:8px 12px;cursor:pointer">
      חזור
    </button>
  \`;
}
`;

const scanUploadedNowReplacement = `async function scanUploadedNow() {
  if (!uploadedDocx?.uploadId) return;

  renderUploadActionProgress({
    title: "סורק כותרות...",
    message: "השרת קורא את הקובץ שכבר הועלה ומאתר כותרות.",
    percent: null,
  });

  const serverImport = await scanUploadedWordChaptersSafe(uploadedDocx.uploadId);

  renderUploadActionProgress({
    title: "סורק כותרות...",
    message: "הכותרות התקבלו. בונה רשימת פרקים.",
    percent: 90,
  });

  const serverState = normalizeServerScanState(serverImport, selectedFile);
  if (!serverState) throw new Error("השרת לא החזיר manifest תקין.");

  state = {
    ...serverState,
    serverSide: true,
    uploadId: uploadedDocx.uploadId,
    serverDocumentId: uploadedDocx.uploadId,
  };
  selectedLevel = !state.heads?.[1]?.length && state.heads?.[2]?.length ? 2 : 1;
  chaptersOpen = false;

  renderUploadActionProgress({
    title: "סורק כותרות...",
    message: "רשימת הפרקים מוכנה.",
    percent: 100,
  });

  setTimeout(() => {
    renderCard();
    ensureLauncher();
  }, 120);
}
`;

const importFullReplacement = `async function importUploadedFullAsSingleFile() {
  if (!uploadedDocx?.uploadId) return;

  renderUploadActionProgress({
    title: "מכניס את כל הקובץ...",
    message: "השרת מכין את כל המסמך כקובץ אחד.",
    percent: null,
  });

  const serverDoc = await extractUploadedWordFullSafe(uploadedDocx.uploadId);
  if (!serverDoc?.result) throw new Error("השרת לא החזיר מסמך תקין.");

  renderUploadActionProgress({
    title: "מכניס את כל הקובץ...",
    message: "המסמך התקבל. מכניס לעורך.",
    percent: 90,
  });

  loadExtractedChapter(serverDoc.title || uploadedDocx.fileName || "מסמך Word", serverDoc.result);

  renderUploadActionProgress({
    title: "מכניס את כל הקובץ...",
    message: "המסמך נכנס לעורך.",
    percent: 100,
  });

  setTimeout(() => {
    removeCard();
    ensureLauncher();
  }, 180);
}
`;

const saveLaterReplacement = `function saveUploadedForLater() {
  if (!uploadedDocx?.uploadId) {
    errorCard("אין קובץ שהועלה לשמירה.");
    return;
  }

  renderUploadActionProgress({
    title: "שומר לזיכרון...",
    message: "שומר את פרטי הקובץ ברשימת הקבצים לטיפול מאוחר יותר.",
    percent: 20,
  });

  try {
    renderUploadActionProgress({
      title: "שומר לזיכרון...",
      message: "קורא רשימת קבצים קיימת.",
      percent: 40,
    });

    let items = readPendingDocxUploads();

    const item = {
      ...uploadedDocx,
      savedAt: Date.now(),
      fileName: uploadedDocx.fileName || selectedFile?.name || "מסמך Word",
      bytes: uploadedDocx.bytes || selectedFile?.size || 0,
    };

    items = items.filter(x => x?.uploadId !== item.uploadId);
    items.unshift(item);

    renderUploadActionProgress({
      title: "שומר לזיכרון...",
      message: "כותב לזיכרון הדפדפן.",
      percent: 70,
    });

    writePendingDocxUploads(items);

    const verify = readPendingDocxUploads();
    const found = verify.some(x => x?.uploadId === item.uploadId);

    if (!found) {
      throw new Error("השמירה לא אומתה אחרי כתיבה ל־localStorage.");
    }

    renderUploadActionProgress({
      title: "שומר לזיכרון...",
      message: "השמירה אומתה.",
      percent: 100,
    });

    setTimeout(() => {
      renderUploadActionSuccess({
        title: "הקובץ נשמר לטיפול מאוחר יותר",
        message: \`נשמר: \${item.fileName}. אפשר לחזור אליו מרשימת הקבצים השמורים.\`,
        actionsHtml: \`
          <button type="button" data-wh-show-pending-uploads
            style="\${pendingUploadButtonStyle("#15803d")}">
            הצג קבצים שמורים
          </button>

          <button type="button" data-wh-scan-uploaded
            style="\${pendingUploadButtonStyle("#7c3aed")}">
            בכל זאת פצל עכשיו
          </button>
        \`,
      });
    }, 180);
  } catch (error) {
    errorCard("שמירה לזיכרון נכשלה: " + (error?.message || String(error)));
  }
}
`;

const cancelReplacement = `async function cancelUploadedDocx() {
  renderUploadActionProgress({
    title: "מוחק מהשרת...",
    message: uploadedDocx?.uploadId
      ? "מבטל את ההעלאה ומוחק את הקובץ הזמני."
      : "מבטל את הפעולה.",
    percent: null,
  });

  if (uploadedDocx?.uploadId) {
    try {
      await deleteUploadedWordChapterFileSafe(uploadedDocx.uploadId);
    } catch (error) {
      console.warn("[chapter-upload] delete upload failed:", error);
      errorCard("מחיקת הקובץ מהשרת נכשלה: " + (error?.message || String(error)));
      return;
    }
  }

  uploadedDocx = null;
  selectedFile = null;
  state = null;
  importedKeys = new Set();
  lastImported = null;

  renderUploadActionSuccess({
    title: "הקובץ נמחק",
    message: "ההעלאה בוטלה והקובץ הזמני נמחק מהשרת.",
  });

  setTimeout(() => {
    removeCard();
    ensureLauncher();
  }, 1200);
}
`;

let src = read(TARGET);

if (!src.includes('function renderUploadActionProgress(')) {
  src = must(src, '\nfunction renderPostUploadMenu() {', `\n${feedbackHelpers}\nfunction renderPostUploadMenu() {`, 'insert feedback helpers');
}

src = replaceBetween(
  src,
  'async function scanUploadedNow() {',
  '\nasync function importUploadedFullAsSingleFile() {',
  scanUploadedNowReplacement + '\n',
  'scanUploadedNow'
);

src = replaceBetween(
  src,
  'async function importUploadedFullAsSingleFile() {',
  '\nfunction saveUploadedForLater() {',
  importFullReplacement + '\n',
  'importUploadedFullAsSingleFile'
);

src = replaceBetween(
  src,
  'function saveUploadedForLater() {',
  '\nasync function cancelUploadedDocx() {',
  saveLaterReplacement + '\n',
  'saveUploadedForLater'
);

src = replaceBetween(
  src,
  'async function cancelUploadedDocx() {',
  '\nasync function scanFile(',
  cancelReplacement + '\n',
  'cancelUploadedDocx'
);

if (!src.includes('const usePendingUpload = ev.target.closest("[data-wh-use-pending-upload]");')) {
  src = must(
    src,
    `  const cancelUpload = ev.target.closest("[data-wh-cancel-upload]");`,
    `  const cancelUpload = ev.target.closest("[data-wh-cancel-upload]");
  const showPendingUploads = ev.target.closest("[data-wh-show-pending-uploads]");
  const usePendingUpload = ev.target.closest("[data-wh-use-pending-upload]");
  const removePendingUpload = ev.target.closest("[data-wh-remove-pending-upload]");
  const backUploadMenu = ev.target.closest("[data-wh-back-upload-menu]");`,
    'pending upload button constants'
  );

  src = must(
    src,
    `  if (scanUploaded) {`,
    `  if (showPendingUploads) {
    ev.preventDefault();
    renderPendingUploadsList();
    return;
  }

  if (backUploadMenu) {
    ev.preventDefault();
    renderPostUploadMenu();
    return;
  }

  if (usePendingUpload) {
    ev.preventDefault();

    const index = Number(usePendingUpload.dataset.whUsePendingUpload);
    const item = readPendingDocxUploads()[index];

    if (!item?.uploadId) {
      errorCard("הקובץ השמור אינו תקין.");
      return;
    }

    uploadedDocx = item;
    selectedFile = selectedFile || { name: item.fileName || "מסמך Word", size: item.bytes || 0 };
    state = null;
    importedKeys = new Set();
    lastImported = null;

    renderPostUploadMenu();
    return;
  }

  if (removePendingUpload) {
    ev.preventDefault();

    const index = Number(removePendingUpload.dataset.whRemovePendingUpload);
    const items = readPendingDocxUploads();
    const removed = items.splice(index, 1)[0];

    writePendingDocxUploads(items);

    if (removed?.uploadId) {
      deleteUploadedWordChapterFileSafe(removed.uploadId).catch(error => {
        console.warn("[chapter-upload] delete pending upload failed:", error);
      });
    }

    renderPendingUploadsList();
    return;
  }

  if (scanUploaded) {`,
    'pending upload handlers'
  );
}

write(TARGET, src);
