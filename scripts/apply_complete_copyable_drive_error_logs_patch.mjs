import fs from 'node:fs';

const TAG = 'RAVTEXT_COMPLETE_COPYABLE_DRIVE_ERROR_LOGS';
const path = 'worker/ai_direct.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;

if (!src.includes(TAG)) {
  const anchor = 'async function fetchDriveBlob(body) {';
  const helper = `// ${TAG}
function driveLinkFailure(body, stage, message, extra = {}) {
  const details = typeof _driveErrDetails === "function"
    ? _driveErrDetails(body, { stage, ...extra })
    : { stage, provider: "google_drive", has_drive_url: !!(body && body.drive_url), ...extra };
  return { error: "bad_request", message, details };
}

`;
  if (!src.includes(anchor)) throw new Error('[complete-drive-errors] missing fetchDriveBlob anchor');
  src = src.replace(anchor, helper + anchor);

  const replacements = [
    [
      'if (linkKind === "folder") return { error: "bad_request", message: "קישור לתיקיית Google Drive אינו קישור לקובץ. יש להדביק קישור לקובץ בודד." };',
      'if (linkKind === "folder") return driveLinkFailure(body, "drive_link_folder", "קישור לתיקיית Google Drive אינו קישור לקובץ. יש להדביק קישור לקובץ בודד.", { link_kind: linkKind });'
    ],
    [
      'if (linkKind === "form") return { error: "bad_request", message: "קישור ל-Google Form אינו קישור לקובץ שניתן להוריד." };',
      'if (linkKind === "form") return driveLinkFailure(body, "drive_link_form", "קישור ל-Google Form אינו קישור לקובץ שניתן להוריד.", { link_kind: linkKind });'
    ],
    [
      'return { error: "bad_request", message: "קישור Google Drive אינו תקין" };',
      'return driveLinkFailure(body, "drive_link_invalid", "קישור Google Drive אינו תקין", { link_kind: linkKind });'
    ],
    [
      'return { error: "server_error", message: "לא הצלחתי להוריד מדרייב: " + (e && e.message ? e.message : String(e)) };',
      'return { error: "server_error", message: "לא הצלחתי להוריד מדרייב: " + (e && e.message ? e.message : String(e)), details: typeof _driveErrDetails === "function" ? _driveErrDetails(body, { stage: "drive_download_fetch", link_kind: linkKind, exception_message: e && e.message ? e.message : String(e) }) : { stage: "drive_download_fetch", link_kind: linkKind } };'
    ],
    [
      'if (!first.ok) return { error: "server_error", message: "Google Drive החזיר שגיאה " + first.status };',
      'if (!first.ok) return { error: "server_error", message: "Google Drive החזיר שגיאה " + first.status, details: typeof _driveErrDetails === "function" ? _driveErrDetails(body, { stage: "drive_download_http", link_kind: linkKind, http_status: first.status, content_type: firstType }) : { stage: "drive_download_http", http_status: first.status } };'
    ]
  ];
  for (const [oldText, newText] of replacements) {
    if (src.includes(oldText)) src = src.replace(oldText, newText);
  }
}

for (const token of [TAG, 'drive_link_invalid', 'drive_link_folder', 'drive_download_fetch', 'drive_download_http']) {
  if (!src.includes(token)) throw new Error(`[complete-drive-errors] verification failed: ${token}`);
}
if (src !== before) fs.writeFileSync(path, src);
console.log('[complete-drive-errors] verification passed');