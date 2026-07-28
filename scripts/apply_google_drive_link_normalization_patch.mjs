import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_LINK_NORMALIZATION_PATCH';
const path = 'worker/ai_direct.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;

if (!src.includes(TAG)) {
  const helpers = `// ${TAG}
function driveFileId(url) {
  const raw = String(url || "").trim();
  const find = (text) => {
    const query = String(text || "").match(/[?&](?:id|file_id)=([^&#/]+)/i);
    if (query) return decodeURIComponent(query[1]);
    const match = String(text || "").match(/\\/(?:file|document|spreadsheets|presentation|drawings)(?:\\/u\\/\\d+)?\\/d\\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  };
  try {
    const u = new URL(raw);
    return u.searchParams.get("id") || u.searchParams.get("file_id") || find(u.pathname) || "";
  } catch (_) { return find(raw); }
}
function driveLinkKind(url) {
  const text = String(url || "").toLowerCase();
  if (/\\/drive\\/(?:u\\/\\d+\\/)?folders\\//.test(text)) return "folder";
  if (/forms\\.google\\.com\\//.test(text)) return "form";
  if (/docs\\.google\\.com\\/document\\//.test(text)) return "document";
  if (/docs\\.google\\.com\\/spreadsheets\\//.test(text)) return "spreadsheet";
  if (/docs\\.google\\.com\\/presentation\\//.test(text)) return "presentation";
  if (/docs\\.google\\.com\\/drawings\\//.test(text)) return "drawing";
  return "file";
}
function driveDownloadUrl(url) {
  const raw = String(url || "").trim();
  const id = driveFileId(raw);
  if (!id) return raw;
  const kind = driveLinkKind(raw);
  if (kind === "document") return "https://docs.google.com/document/d/" + encodeURIComponent(id) + "/export?format=docx";
  if (kind === "spreadsheet") return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(id) + "/export?format=xlsx";
  if (kind === "presentation") return "https://docs.google.com/presentation/d/" + encodeURIComponent(id) + "/export/pptx";
  if (kind === "drawing") return "https://docs.google.com/drawings/d/" + encodeURIComponent(id) + "/export/png";
  return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id);
}
function remoteName(body) { return String(body.drive_file_name || body.file_name || "google-drive-file").trim(); }
function remoteType(name) {
  const ext = String(name || "").toLowerCase().split("?")[0].split("#")[0].split(".").pop();
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "audio";
}`;
  const anchor = '// RAVTEXT_GOOGLE_DRIVE_UPLOAD_HARDENING_PATCH';
  if (!src.includes(anchor)) throw new Error('[drive-link-normalization] missing worker anchor');
  src = src.replace(anchor, helpers + '\n\n' + anchor);
}

const oldStart = `  const original = String(body.drive_url || "").trim();
  if (!/^https?:\\/\\//i.test(original)) {`;
const newStart = `  const original = String(body.drive_url || "").trim();
  const linkKind = driveLinkKind(original);
  if (linkKind === "folder") return { error: "bad_request", message: "קישור לתיקיית Google Drive אינו קישור לקובץ. יש להדביק קישור לקובץ בודד." };
  if (linkKind === "form") return { error: "bad_request", message: "קישור ל-Google Form אינו קישור לקובץ שניתן להוריד." };
  if (!/^https?:\\/\\//i.test(original)) {`;
if (src.includes(oldStart)) src = src.replace(oldStart, newStart);
for (const token of [TAG, 'export?format=docx', 'export?format=xlsx', 'export/pptx', 'קישור לתיקיית Google Drive']) {
  if (!src.includes(token)) throw new Error(`[drive-link-normalization] verification failed: ${token}`);
}
if (src !== before) fs.writeFileSync(path, src);
console.log('[drive-link-normalization] verification passed');