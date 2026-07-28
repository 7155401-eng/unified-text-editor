import fs from 'node:fs';

const UI_TAG = 'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_UI';
const GAS_TAG = 'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_GAS';
const DIRECT_TAG = 'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_DIRECT';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
function writeIfChanged(path, before, after) {
  if (before === after) {
    console.log(`[gemini-drive-error-details] no changes for ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[gemini-drive-error-details] patched ${path}`);
}
function must(src, token, label) {
  if (!src.includes(token)) throw new Error(`[gemini-drive-error-details] missing ${label}`);
}
function replace(src, a, b, label) {
  must(src, a, label);
  return src.replace(a, b);
}

function patchUi() {
  const path = 'src/torah_transcription/torah_transcription_ui.js';
  const before = read(path);
  if (before.includes(UI_TAG)) return writeIfChanged(path, before, before);
  let s = before;

  const oldShow = `function showMessage(title, msg) {
  try {
    window.alert(\`${title}\\n\\n${msg}\`);
  } catch (e) {
    /* swallow */
  }
}
`;
  const newShow = `// ${UI_TAG}
function redactedErrorDetails(value) {
  try {
    const seen = new WeakSet();
    const text = JSON.stringify(value, (k, v) => {
      if (/api[_-]?key|access[_-]?code|authorization|token|secret/i.test(k)) return "[REDACTED]";
      if (typeof v === "object" && v) {
        if (seen.has(v)) return "[circular]";
        seen.add(v);
      }
      if (typeof v === "string") {
        return v
          .replace(/AIza[0-9A-Za-z_\\-]{20,}/g, "AIza...[REDACTED]")
          .replace(/sk-[0-9A-Za-z_\\-]{12,}/g, "sk-...[REDACTED]")
          .slice(0, 5000);
      }
      return v;
    }, 2);
    return text || "";
  } catch (_) {
    return String(value || "");
  }
}
function showMessage(title, msg, details = null) {
  try {
    const extra = details ? "\\n\\nלוג שגיאה מפורט:\\n" + redactedErrorDetails(details) : "";
    window.alert(\`${title}\\n\\n${msg}\${extra}\`);
  } catch (e) {
    /* swallow */
  }
}
`;
  s = replace(s, oldShow, newShow, 'showMessage');

  // Put the real server/Gemini details into the visible error if present.
  s = s.replaceAll(
    `showMessage(fe.title, fe.message);`,
    `showMessage(fe.title, fe.message, { stage: this.currentStep, error_name: e && e.name, error_code: e && e.error_code, error_message: e && e.message, details: e && e.details, state: this.appState });`
  );

  must(s, UI_TAG, 'ui tag');
  must(s, 'לוג שגיאה מפורט', 'visible details text');
  writeIfChanged(path, before, s);
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);
  if (before.includes(GAS_TAG)) return writeIfChanged(path, before, before);
  let s = before;

  s = replace(s,
`export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
  }
}
`,
`export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0, details = null) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
    this.details = details; // ${GAS_TAG}
  }
}
`, 'GasServerError constructor');

  s = replace(s,
`        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0
        );
`,
`        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0,
          {
            http_status: response.status,
            response_body: data,
            response_body_chars: text.length,
          }
        );
`, 'GasServerError throw');

  must(s, GAS_TAG, 'gas tag');
  must(s, 'response_body_chars', 'gas details');
  writeIfChanged(path, before, s);
}

function patchWorker() {
  const path = 'worker/ai_direct.js';
  const before = read(path);
  if (before.includes(DIRECT_TAG)) return writeIfChanged(path, before, before);
  let s = before;

  must(s, 'fetchDriveBlob', 'fetchDriveBlob');
  must(s, 'uploadDriveToGemini', 'uploadDriveToGemini');
  must(s, 'async function callGemini', 'callGemini');

  const helper = `
// ${DIRECT_TAG}
function _clipDriveErr(x, max = 3500) {
  return String(x || "").slice(0, max);
}
function _driveErrDetails(body, extra = {}) {
  const url = String((body && body.drive_url) || "").trim();
  let id = "";
  try { id = driveFileId(url); } catch (_) {}
  return {
    provider: "gemini",
    stage: extra.stage || "",
    flow: "google_drive_to_gemini_files",
    has_drive_url: !!url,
    drive_file_id: id,
    drive_file_name: String((body && (body.drive_file_name || body.file_name)) || ""),
    prompt_type: String((body && body.prompt_type) || ""),
    model: String((body && body.model) || ""),
    ...extra,
  };
}
function _driveErr(code, message, body, extra = {}) {
  return { error: code || "server_error", message: message || code || "server_error", details: _driveErrDetails(body, extra) };
}
`;
  s = s.replace('async function callGemini(modelName, apiKey, promptText, body) {', helper + '\nasync function callGemini(modelName, apiKey, promptText, body) {');

  const fetchRe = /async function fetchDriveBlob\(body\) \{[\s\S]*?\n\}\nasync function uploadDriveToGemini/;
  const fetchNew = `async function fetchDriveBlob(body) {
  const original = String(body.drive_url || "").trim();
  if (!/^https?:\\/\\//i.test(original)) {
    return _driveErr("bad_request", "קישור Google Drive אינו תקין", body, { stage: "drive_url_validation", input_chars: original.length });
  }

  let first;
  const firstUrl = driveDownloadUrl(original);
  try {
    first = await fetch(firstUrl, { redirect: "follow" });
  } catch (e) {
    return _driveErr("server_error", "לא הצלחתי להוריד את הקובץ מ-Google Drive", body, {
      stage: "drive_fetch_network",
      download_url_used: firstUrl,
      exception_name: e && e.name ? e.name : "",
      exception_message: e && e.message ? e.message : String(e),
    });
  }

  const firstType = first.headers.get("content-type") || "";
  if (first.ok && !/text\\/html/i.test(firstType)) {
    const name = driveRemoteName(body);
    const blob = await first.blob();
    return { blob, name, mime: driveContentTypeFor(name, firstType), size: blob.size };
  }

  const html = await first.text().catch(() => "");
  const confirm = driveConfirmFromHtml(html);
  if (confirm && (confirm.href || confirm.confirm)) {
    const nextUrl = confirm.href
      ? new URL(confirm.href, "https://drive.google.com").toString()
      : driveDownloadUrl(original) + "&confirm=" + encodeURIComponent(confirm.confirm) + (confirm.uuid ? "&uuid=" + encodeURIComponent(confirm.uuid) : "");
    let second;
    try {
      const cookie = first.headers.get("set-cookie");
      second = await fetch(nextUrl, { redirect: "follow", headers: cookie ? { cookie } : {} });
    } catch (e) {
      return _driveErr("server_error", "Google Drive דרש אישור, אבל ההורדה השנייה נכשלה", body, {
        stage: "drive_confirm_fetch_network",
        http_status_initial: first.status,
        content_type_initial: firstType,
        exception_name: e && e.name ? e.name : "",
        exception_message: e && e.message ? e.message : String(e),
      });
    }

    const secondType = second.headers.get("content-type") || "";
    if (second.ok && !/text\\/html/i.test(secondType)) {
      const name = driveRemoteName(body);
      const blob = await second.blob();
      return { blob, name, mime: driveContentTypeFor(name, secondType), size: blob.size };
    }

    return _driveErr("server_error", "Google Drive לא החזיר קובץ גם אחרי אישור הורדה", body, {
      stage: "drive_confirm_response",
      http_status_initial: first.status,
      http_status_confirm: second.status,
      content_type_initial: firstType,
      content_type_confirm: secondType,
      response_preview: _clipDriveErr(await second.text().catch(() => ""), 1200),
    });
  }

  return _driveErr(first.ok ? "bad_request" : "server_error", "Google Drive החזיר HTML או שגיאה במקום קובץ, ולכן הקובץ לא הגיע ל-Gemini", body, {
    stage: "drive_download_not_file",
    http_status: first.status,
    content_type: firstType,
    confirm_found: !!(confirm && (confirm.href || confirm.confirm)),
    response_preview: _clipDriveErr(html, 1200),
  });
}

async function uploadDriveToGemini`;
  s = s.replace(fetchRe, fetchNew);

  const uploadRe = /async function uploadDriveToGemini\(apiKey, body\) \{[\s\S]*?\n\}\n\nasync function callGemini/;
  const uploadNew = `async function uploadDriveToGemini(apiKey, body) {
  const remote = await fetchDriveBlob(body);
  if (remote.error) return remote;

  const mime = remote.mime || driveContentTypeFor(remote.name, "");
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
    const txt = await start.text().catch(() => "");
    return _driveErr(start.status === 401 || start.status === 403 ? "invalid_api_key" : "server_error", "Gemini Files API לא פתח upload session לקובץ Drive", body, {
      stage: "gemini_files_start",
      http_status: start.status,
      upload_url_present: !!uploadUrl,
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_body: _clipDriveErr(txt),
    });
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
    return _driveErr(finish.status === 401 || finish.status === 403 ? "invalid_api_key" : "server_error", "הקובץ ירד מ-Drive, אבל לא הועלה ל-Gemini Files", body, {
      stage: "gemini_files_upload_finalize",
      http_status: finish.status,
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_body: _clipDriveErr(text),
    });
  }

  let data = {};
  try { data = JSON.parse(text); }
  catch (e) {
    return _driveErr("server_error", "Gemini Files החזיר תשובה לא תקינה אחרי העלאת הקובץ", body, {
      stage: "gemini_files_parse",
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_body: _clipDriveErr(text),
      exception_message: e && e.message ? e.message : String(e),
    });
  }

  const file = data.file || data;
  if (!file.uri) {
    return _driveErr("server_error", "Gemini Files לא החזיר file_uri, ולכן הקובץ לא הגיע ל-Gemini", body, {
      stage: "gemini_files_missing_uri",
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_json: data,
    });
  }

  return { uri: file.uri, mimeType: file.mimeType || mime, name: file.name || remote.name, drive_file_size: remote.blob.size };
}

async function callGemini`;
  s = s.replace(uploadRe, uploadNew);

  const oldStatus = `  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: responseText };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText };
    return { error: 'server_error', message: 'Gemini error ' + response.status + ': ' + responseText };
  }
`;
  const newStatus = `  if (response.status !== 200) {
    const details = _driveErrDetails(body, {
      stage: "gemini_generate_content",
      http_status: response.status,
      used_drive_url: !!body.drive_url,
      response_body: _clipDriveErr(responseText),
      file_data_parts: parts.filter((p) => !!p.file_data).length,
      inline_file_parts: parts.filter((p) => !!p.inline_data).length,
    });
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: responseText, details };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText, details };
    return { error: 'server_error', message: 'Gemini error ' + response.status + ': ' + responseText, details };
  }
`;
  s = replace(s, oldStatus, newStatus, 'Gemini non-200 details');

  must(s, DIRECT_TAG, 'direct tag');
  must(s, 'gemini_files_upload_finalize', 'Gemini upload error stage');
  must(s, 'drive_download_not_file', 'Drive fetch error stage');
  must(s, 'gemini_generate_content', 'Gemini generate stage');
  writeIfChanged(path, before, s);
}

patchUi();
patchGas();
patchWorker();
console.log('[gemini-drive-error-details] verification passed');
