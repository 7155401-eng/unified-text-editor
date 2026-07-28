import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_LINK_NORMALIZATION_PATCH';
const uiPath = 'src/torah_transcription/torah_transcription_ui.js';
const workerPath = 'worker/ai_direct.js';
const read = (path) => fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const write = (path, before, after) => { if (before !== after) fs.writeFileSync(path, after); };

const fileIdFunction = `function driveFileId(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  const find = (text) => {
    const query = String(text || "").match(/[?&](?:id|file_id)=([^&#/]+)/i);
    if (query) return decodeURIComponent(query[1]);
    const path = String(text || "").match(/\\/(?:file|document|spreadsheets|presentation|drawings)(?:\\/u\\/\\d+)?\\/d\\/([^/?#]+)/i);
    return path ? decodeURIComponent(path[1]) : "";
  };
  try {
    const u = new URL(raw);
    return u.searchParams.get("id") || u.searchParams.get("file_id") || find(u.pathname) || "";
  } catch (_) {
    return find(raw);
  }
}`;

const linkKindFunction = `function driveLinkKind(url) {
  const text = String(url || "").toLowerCase();
  if (/\\/drive\\/(?:u\\/\\d+\\/)?folders\\//.test(text)) return "folder";
  if (/forms\\.google\\.com\\//.test(text)) return "form";
  if (/docs\\.google\\.com\\/document\\//.test(text)) return "document";
  if (/docs\\.google\\.com\\/spreadsheets\\//.test(text)) return "spreadsheet";
  if (/docs\\.google\\.com\\/presentation\\//.test(text)) return "presentation";
  if (/docs\\.google\\.com\\/drawings\\//.test(text)) return "drawing";
  return "file";
}`;

function replaceFunction(src, name, nextName, replacement) {
  const pattern = new RegExp(`function ${name}\\(url\\) \\{[\\s\\S]*?\\n\\}\\n(?=function ${nextName})`);
  if (!pattern.test(src)) throw new Error(`[drive-link-normalization] missing ${name} anchor`);
  return src.replace(pattern, replacement + '\n');
}

function patchUi() {
  const before = read(uiPath);
  let src = before;
  if (!src.includes(TAG)) {
    src = replaceFunction(src, 'driveFileId', 'isGoogleDriveUrl', `// ${TAG}\n${fileIdFunction}`);
  }
  for (const token of [TAG, 'spreadsheets', 'presentation', 'drawings']) {
    if (!src.includes(token)) throw new Error(`[drive-link-normalization] UI verification failed: ${token}`);
  }
  write(uiPath, before, src);
}

function patchWorker() {
  const before = read(workerPath);
  let src = before;
  if (!src.includes(TAG)) {
    src = replaceFunction(src, 'driveFileId', 'driveDownloadUrl', `// ${TAG}\n${fileIdFunction}\n${linkKindFunction}`);
    const oldDownload = `function driveDownloadUrl(url) {
  const id = driveFileId(url);
  return id ? "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id) : String(url || "").trim();
}`;
    const newDownload = `function driveDownloadUrl(url) {
  const raw = String(url || "").trim();
  const id = driveFileId(raw);
  if (!id) return raw;
  const kind = driveLinkKind(raw);
  if (kind === "document") return "https://docs.google.com/document/d/" + encodeURIComponent(id) + "/export?format=docx";
  if (kind === "spreadsheet") return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(id) + "/export?format=xlsx";
  if (kind === "presentation") return "https://docs.google.com/presentation/d/" + encodeURIComponent(id) + "/export/pptx";
  if (kind === "drawing") return "https://docs.google.com/drawings/d/" + encodeURIComponent(id) + "/export/png";
  return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id);
}`;
    if (!src.includes(oldDownload)) throw new Error('[drive-link-normalization] missing driveDownloadUrl anchor');
    src = src.replace(oldDownload, newDownload);
    const oldFetchStart = `  const original = String(body.drive_url || "").trim();
  if (!/^https?:\\/\\//i.test(original)) {`;
    const newFetchStart = `  const original = String(body.drive_url || "").trim();
  const linkKind = driveLinkKind(original);
  if (linkKind === "folder") return { error: "bad_request", message: "קישור לתיקיית Google Drive אינו קישור לקובץ. יש להדביק קישור לקובץ בודד." };
  if (linkKind === "form") return { error: "bad_request", message: "קישור ל-Google Form אינו קישור לקובץ שניתן להוריד." };
  if (!/^https?:\\/\\//i.test(original)) {`;
    if (!src.includes(oldFetchStart)) throw new Error('[drive-link-normalization] missing fetchDriveBlob anchor');
    src = src.replace(oldFetchStart, newFetchStart);
  }
  for (const token of [TAG, 'export?format=docx', 'export?format=xlsx', 'export/pptx', 'קישור לתיקיית Google Drive']) {
    if (!src.includes(token)) throw new Error(`[drive-link-normalization] worker verification failed: ${token}`);
  }
  write(workerPath, before, src);
}

patchUi();
patchWorker();
console.log('[drive-link-normalization] verification passed');