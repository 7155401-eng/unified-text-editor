import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_HARDENING_PATCH';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function writeIfChanged(path, before, after) {
  if (before === after) {
    console.log(`[drive-upload-hardening] no changes for ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[drive-upload-hardening] patched ${path}`);
}

function insertBefore(src, needle, addition, label) {
  if (!src.includes(needle)) throw new Error(`[drive-upload-hardening] missing anchor: ${label}`);
  return src.replace(needle, addition + needle);
}

function replaceOnce(src, needle, replacement, label) {
  if (!src.includes(needle)) throw new Error(`[drive-upload-hardening] missing anchor: ${label}`);
  return src.replace(needle, replacement);
}

function assertHas(src, token, path) {
  if (!src.includes(token)) throw new Error(`[drive-upload-hardening] verification failed in ${path}: ${token}`);
}

function patchDirect() {
  const path = 'worker/ai_direct.js';
  const before = read(path);
  if (before.includes(TAG)) {
    writeIfChanged(path, before, before);
    return;
  }
  let src = before;
  const helper = `
// ${TAG}
function driveContentTypeFor(name, fallback) {
  return fallback || detectMimeType(remoteType(name), name);
}
function driveConfirmFromHtml(html) {
  const text = String(html || "");
  const href = text.match(/href="([^"]*uc\\?export=download[^"]+)"/i);
  if (href && href[1]) return { href: href[1].replace(/&amp;/g, "&") };
  const confirm = text.match(/[?&]confirm=([0-9A-Za-z_-]+)/);
  const uuid = text.match(/[?&]uuid=([0-9A-Za-z_-]+)/);
  return { confirm: confirm ? confirm[1] : "", uuid: uuid ? uuid[1] : "" };
}
async function fetchDriveBlob(body) {
  const original = String(body.drive_url || "").trim();
  if (!/^https?:\\/\\//i.test(original)) {
    return { error: "bad_request", message: "קישור Google Drive אינו תקין" };
  }

  let first;
  try {
    first = await fetch(driveDownloadUrl(original), { redirect: "follow" });
  } catch (e) {
    return { error: "server_error", message: "לא הצלחתי להוריד מדרייב: " + (e && e.message ? e.message : String(e)) };
  }

  const firstType = first.headers.get("content-type") || "";
  if (first.ok && !/text\\/html/i.test(firstType)) {
    const name = remoteName(body);
    return { blob: await first.blob(), name, mime: driveContentTypeFor(name, firstType) };
  }

  const html = await first.text().catch(() => "");
  const confirm = driveConfirmFromHtml(html);
  if (confirm && (confirm.href || confirm.confirm)) {
    const nextUrl = confirm.href
      ? new URL(confirm.href, "https://drive.google.com").toString()
      : driveDownloadUrl(original) + "&confirm=" + encodeURIComponent(confirm.confirm) + (confirm.uuid ? "&uuid=" + encodeURIComponent(confirm.uuid) : "");
    const cookie = first.headers.get("set-cookie");
    const second = await fetch(nextUrl, { redirect: "follow", headers: cookie ? { cookie } : {} });
    const secondType = second.headers.get("content-type") || "";
    if (second.ok && !/text\\/html/i.test(secondType)) {
      const name = remoteName(body);
      return { blob: await second.blob(), name, mime: driveContentTypeFor(name, secondType) };
    }
    return { error: "server_error", message: "Google Drive החזיר שגיאה " + second.status };
  }

  if (!first.ok) return { error: "server_error", message: "Google Drive החזיר שגיאה " + first.status };
  return {
    error: "bad_request",
    message: "Google Drive החזיר דף HTML במקום קובץ. צריך לשתף את הקובץ כך שכל מי שיש לו קישור יכול לצפות.",
  };
}
async function uploadDriveToGemini(apiKey, body) {
  const remote = await fetchDriveBlob(body);
  if (remote.error) return remote;
  const mime = driveContentTypeFor(remote.name, remote.mime);
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(remote.blob.size),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: remote.name } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) {
    return { error: "server_error", message: "Gemini Files upload start failed " + start.status + ": " + await start.text().catch(() => "") };
  }
  const finish = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Type": mime,
      "Content-Length": String(remote.blob.size),
    },
    body: remote.blob,
  });
  const text = await finish.text();
  if (!finish.ok) {
    return { error: "server_error", message: "Gemini Files upload failed " + finish.status + ": " + text };
  }
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  const file = data.file || data;
  if (!file.uri) return { error: "server_error", message: "Gemini Files upload did not return file uri" };
  return { uri: file.uri, mimeType: file.mimeType || mime };
}
`;
  src = insertBefore(src, 'async function callGemini(modelName, apiKey, promptText, body) {', helper, 'direct hardening helper');

  const oldGeminiDrive = `  if (body.drive_url) {
    const n = remoteName(body);
    parts.push({ file_data: { mime_type: detectMimeType(remoteType(n), n), file_uri: driveDownloadUrl(body.drive_url) } });
  }

`;
  const newGeminiDrive = `  if (body.drive_url) {
    const uploadedDriveFile = await uploadDriveToGemini(apiKey, body);
    if (uploadedDriveFile.error) return uploadedDriveFile;
    parts.push({ file_data: { mime_type: uploadedDriveFile.mimeType, file_uri: uploadedDriveFile.uri } });
  }

`;
  src = replaceOnce(src, oldGeminiDrive, newGeminiDrive, 'gemini drive files upload');

  assertHas(src, TAG, path);
  assertHas(src, 'uploadDriveToGemini', path);
  assertHas(src, 'driveConfirmFromHtml', path);
  writeIfChanged(path, before, src);
}

function verifyAll() {
  const checks = [
    ['src/torah_transcription/torah_transcription_ui.js', ['RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_UI', 'drive_url', '_setDriveUrl']],
    ['src/torah_transcription/torah_transcription_gas.js', ['RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS', 'drive_url', '_has_drive_url']],
    ['worker/ai_direct.js', ['RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_DIRECT', TAG, 'uploadDriveToGemini', 'fetchDriveBlob']],
  ];
  for (const [path, tokens] of checks) {
    const src = read(path);
    for (const token of tokens) assertHas(src, token, path);
  }
  console.log('[drive-upload-hardening] verification passed');
}

patchDirect();
verifyAll();
