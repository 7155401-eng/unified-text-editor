import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/document_chapter_splitter.js';

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function write(path, value) {
  writeFileSync(path, value, 'utf8');
}

function must(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`[docx-uploadid-splitter-menu] Missing anchor: ${label}`);
  return src.replace(search, replacement);
}

const helpers = `
function renderPostUploadMenu() {
  const card = ensureCard();
  if (!card || !uploadedDocx) return;

  card.innerHTML = \`
    <b style="color:#312e81">ההעלאה הסתיימה בהצלחה</b>
    <div style="font-size:12px;color:#64748b;margin-top:4px">
      הקובץ נשמר זמנית בשרת: \${esc(uploadedDocx.fileName || selectedFile?.name || "מסמך Word")}
      · \${fmt(Math.round((uploadedDocx.bytes || selectedFile?.size || 0) / 1024 / 1024))}MB
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      <button type="button" data-wh-scan-uploaded style="border:1px solid #7c3aed;border-radius:8px;background:white;padding:8px 12px;font-weight:700;cursor:pointer">פצל לפי כותרות עכשיו</button>
      <button type="button" data-wh-import-full style="border:1px solid #2563eb;border-radius:8px;background:white;padding:8px 12px;font-weight:700;cursor:pointer">הכנס הכול כקובץ אחיד</button>
      <button type="button" data-wh-save-later style="border:1px solid #16a34a;border-radius:8px;background:white;padding:8px 12px;font-weight:700;cursor:pointer;color:#15803d">שמור לזיכרון וטפל מאוחר יותר</button>
      <button type="button" data-wh-cancel-upload style="border:1px solid #dc2626;border-radius:8px;background:white;padding:8px 12px;cursor:pointer;color:#dc2626">בטל ומחק מהשרת</button>
    </div>
  \`;
}

async function scanUploadedNow() {
  if (!uploadedDocx?.uploadId) return;
  loading("השרת מתחיל לסרוק כותרות...");

  const serverImport = await scanUploadedWordChapters(uploadedDocx.uploadId);
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
  renderCard();
  ensureLauncher();
}

async function importUploadedFullAsSingleFile() {
  if (!uploadedDocx?.uploadId) return;
  loading("מכניס את כל הקובץ כמסמך אחד...");
  const serverDoc = await extractUploadedWordFull(uploadedDocx.uploadId);
  if (!serverDoc?.result) throw new Error("השרת לא החזיר מסמך תקין.");
  loadExtractedChapter(serverDoc.title || uploadedDocx.fileName || "מסמך Word", serverDoc.result);
  removeCard();
  ensureLauncher();
}

function saveUploadedForLater() {
  if (!uploadedDocx?.uploadId) return;
  const key = "ravtext-pending-docx-uploads";
  let items = [];
  try {
    items = JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    items = [];
  }
  items.unshift({ ...uploadedDocx, savedAt: Date.now() });
  localStorage.setItem(key, JSON.stringify(items.slice(0, 20)));
  loading("הקובץ נשמר לזיכרון. אפשר לחזור אליו מתפריט קובץ.");
}

async function cancelUploadedDocx() {
  if (uploadedDocx?.uploadId) {
    try {
      await deleteUploadedWordChapterFile(uploadedDocx.uploadId);
    } catch (error) {
      console.warn("[chapter-upload] delete upload failed:", error);
    }
  }
  uploadedDocx = null;
  selectedFile = null;
  state = null;
  importedKeys = new Set();
  lastImported = null;
  removeCard();
  ensureLauncher();
}

`;

let src = read(TARGET);

src = src.replace(
  `  extractWordChapterOnServer,
  importWordChaptersOnServer,
  normalizeServerScanState,`,
  `  extractUploadedWordChapter,
  extractUploadedWordFull,
  deleteUploadedWordChapterFile,
  extractWordChapterOnServer,
  importWordChaptersOnServer,
  normalizeServerScanState,
  scanUploadedWordChapters,
  uploadWordChapterFileOnly,`
);

if (!src.includes('let uploadedDocx = null;')) {
  src = must(src, 'let selectedFile = null;\n', 'let selectedFile = null;\nlet uploadedDocx = null;\n', 'uploadedDocx state');
}

if (!src.includes('function renderPostUploadMenu()')) {
  src = must(src, '\nasync function scanFile(fileObj, thisToken) {', `\n${helpers}\nasync function scanFile(fileObj, thisToken) {`, 'insert post-upload helpers');
}

if (!src.includes('uploadWordChapterFileOnly(fileObj')) {
  src = must(
    src,
    `async function scanFile(fileObj, thisToken) {
  if (!fileObj || thisToken !== token) return;

  try {`,
    `async function scanFile(fileObj, thisToken) {
  if (!fileObj || thisToken !== token) return;

  try {
    const started = Date.now();
    loading("מכין את קובץ Word לשליחה...");

    const uploaded = await uploadWordChapterFileOnly(fileObj, {
      onBodyStart() {
        loading("מכין את קובץ Word לשליחה...");
      },
      onBodyReady(info) {
        loading(\`הקובץ מוכן לשליחה: \${fmt(Math.round((info.bodyBytes || info.fileSize || 0) / 1024 / 1024))}MB\`);
      },
      onUploadStart() {
        loading("העלאת הקובץ לשרת התחילה...");
      },
      onUploadProgress(info) {
        if (info.percent != null) loading(\`מעלה לשרת... \${info.percent}%\`);
        else loading(\`מעלה לשרת... \${fmt(Math.round((info.loaded || 0) / 1024 / 1024))}MB\`);
      },
      onUploadDone(info) {
        loading("ההעלאה לשרת הסתיימה בהצלחה.");
        console.info("[chapter-upload]", {
          event: "upload_only_done",
          elapsedMs: Date.now() - started,
          requestId: info?.requestId || null,
          fileName: fileObj?.name || null,
          fileSize: fileObj?.size || null,
        });
      },
    });

    if (thisToken !== token) return;

    uploadedDocx = {
      uploadId: uploaded.uploadId,
      fileHash: uploaded.fileHash,
      bytes: uploaded.bytes || fileObj?.size || 0,
      fileName: fileObj?.name || "מסמך Word",
      uploadedAt: uploaded.uploadedAt || Date.now(),
    };

    state = null;
    selectedLevel = 1;
    chaptersOpen = false;
    importedKeys = new Set();
    lastImported = null;
    renderPostUploadMenu();
    return;
  } catch (uploadError) {
    if (thisToken !== token) return;
    errorCard(uploadError?.message || String(uploadError));
    return;
  }

  try {`,
    'upload-only first step'
  );
}

src = src.replace(
  `docId = null;
  cachedIds = new Set();`,
  `docId = null;
  uploadedDocx = null;
  cachedIds = new Set();`
);

src = src.replace(
  `if (state?.serverSide) {
      loading(\`מחלץ את הפרק בצד שרת: \${chapterIndex + 1}...\`);
      const serverChapter = await extractWordChapterOnServer(selectedFile, {
        level: selectedLevel,
        index: chapterIndex,
      });`,
  `if (state?.serverSide && state?.uploadId) {
      loading(\`מחלץ את הפרק מהקובץ שכבר הועלה: \${chapterIndex + 1}...\`);
      const serverChapter = await extractUploadedWordChapter(state.uploadId, {
        level: selectedLevel,
        index: chapterIndex,
      });
    } else if (state?.serverSide) {
      loading(\`מחלץ את הפרק בצד שרת: \${chapterIndex + 1}...\`);
      const serverChapter = await extractWordChapterOnServer(selectedFile, {
        level: selectedLevel,
        index: chapterIndex,
      });`
);

if (!src.includes('data-wh-scan-uploaded')) {
  src = must(
    src,
    `  const loadButton = ev.target.closest("[data-wh-load]");

  if (refresh) {`,
    `  const loadButton = ev.target.closest("[data-wh-load]");
  const scanUploaded = ev.target.closest("[data-wh-scan-uploaded]");
  const importFull = ev.target.closest("[data-wh-import-full]");
  const saveLater = ev.target.closest("[data-wh-save-later]");
  const cancelUpload = ev.target.closest("[data-wh-cancel-upload]");

  if (scanUploaded) {
    ev.preventDefault();
    scanUploadedNow().catch((error) => errorCard(error?.message || String(error)));
    return;
  }

  if (importFull) {
    ev.preventDefault();
    importUploadedFullAsSingleFile().catch((error) => errorCard(error?.message || String(error)));
    return;
  }

  if (saveLater) {
    ev.preventDefault();
    saveUploadedForLater();
    return;
  }

  if (cancelUpload) {
    ev.preventDefault();
    cancelUploadedDocx();
    return;
  }

  if (refresh) {`,
    'post-upload button handlers'
  );
}

write(TARGET, src);
