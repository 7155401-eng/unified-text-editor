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

function requireToken(source, token, label, path) {
  if (!source.includes(token)) {
    throw new Error(`[gemini-drive-error-details] missing ${label} in ${path}`);
  }
}

function replaceRequired(source, needle, replacement, label, path) {
  if (!source.includes(needle)) {
    throw new Error(`[gemini-drive-error-details] missing ${label} in ${path}`);
  }
  const after = source.replace(needle, replacement);
  if (after === source) {
    throw new Error(`[gemini-drive-error-details] failed to replace ${label} in ${path}`);
  }
  return after;
}

function patchUi() {
  const path = 'src/torah_transcription/torah_transcription_ui.js';
  const before = read(path);

  if (before.includes(UI_TAG)) {
    requireToken(before, 'redactedErrorDetails', 'UI redaction helper', path);
    requireToken(before, 'לוג שגיאה מפורט', 'visible details text', path);
    return writeIfChanged(path, before, before);
  }

  const oldShow = `function showMessage(title, msg) {
  try {
    window.alert(\`\${title}\\n\\n\${msg}\`);
  } catch (e) {
    /* swallow */
  }
}
`;

  const newShow = `// ${UI_TAG}
function redactedErrorDetails(value) {
  try {
    const seen = new WeakSet();
    const text = JSON.stringify(value, (key, item) => {
      if (/api[_-]?key|access[_-]?code|authorization|token|secret/i.test(key)) return "[REDACTED]";
      if (typeof item === "object" && item) {
        if (seen.has(item)) return "[circular]";
        seen.add(item);
      }
      if (typeof item === "string") {
        return item
          .replace(/AIza[0-9A-Za-z_\\-]{20,}/g, "AIza...[REDACTED]")
          .replace(/sk-[0-9A-Za-z_\\-]{12,}/g, "sk-...[REDACTED]")
          .slice(0, 5000);
      }
      return item;
    }, 2);
    return text || "";
  } catch (_) {
    return String(value || "");
  }
}
function showMessage(title, msg, details = null) {
  try {
    const extra = details ? "\\n\\nלוג שגיאה מפורט:\\n" + redactedErrorDetails(details) : "";
    window.alert(\`\${title}\\n\\n\${msg}\${extra}\`);
  } catch (e) {
    /* swallow */
  }
}
`;

  let source = replaceRequired(before, oldShow, newShow, 'showMessage function', path);

  const oldCall = 'showMessage(fe.title, fe.message);';
  const newCall = 'showMessage(fe.title, fe.message, { stage: this.currentStep, error_name: e && e.name, error_code: e && e.error_code, error_message: e && e.message, details: e && e.details, state: this.appState });';
  if (source.includes(oldCall)) {
    source = source.replaceAll(oldCall, newCall);
  } else if (!source.includes(newCall)) {
    throw new Error(`[gemini-drive-error-details] missing showMessage error call in ${path}`);
  }

  requireToken(source, UI_TAG, 'UI tag', path);
  requireToken(source, 'redactedErrorDetails', 'UI redaction helper', path);
  requireToken(source, 'לוג שגיאה מפורט', 'visible details text', path);
  writeIfChanged(path, before, source);
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);

  if (before.includes(GAS_TAG)) {
    requireToken(before, 'this.details = details', 'GAS details property', path);
    requireToken(before, 'response_body_chars', 'GAS response details', path);
    return writeIfChanged(path, before, before);
  }

  const oldClass = `export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
  }
}
`;

  const newClass = `export class GasServerError extends Error {
  constructor(errorCode, message = "", balanceAgorot = 0, details = null) {
    super(message || errorCode);
    this.name = "GasServerError";
    this.error_code = errorCode;
    this.message = message || errorCode;
    this.balance_agorot = balanceAgorot;
    this.details = details; // ${GAS_TAG}
  }
}
`;

  const oldThrow = `        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0
        );`;

  const newThrow = `        throw new GasServerError(
          err,
          data.message || "",
          data.balance_agorot || 0,
          {
            http_status: response.status,
            response_body: data,
            response_body_chars: text.length,
          }
        );`;

  let source = replaceRequired(before, oldClass, newClass, 'GasServerError constructor', path);
  source = replaceRequired(source, oldThrow, newThrow, 'GasServerError throw', path);

  requireToken(source, GAS_TAG, 'GAS tag', path);
  requireToken(source, 'response_body_chars', 'GAS response details', path);
  writeIfChanged(path, before, source);
}

function patchWorker() {
  const path = 'worker/ai_direct.js';
  const before = read(path);

  if (before.includes(DIRECT_TAG)) {
    const required = [
      '_driveErrDetails',
      'gemini_files_start',
      'gemini_files_upload_finalize',
      'gemini_files_missing_uri',
      'gemini_generate_content',
      'drive_download_not_file',
    ];
    for (const token of required) requireToken(before, token, token, path);
    return writeIfChanged(path, before, before);
  }

  let source = before;
  requireToken(source, 'fetchDriveBlob', 'fetchDriveBlob', path);
  requireToken(source, 'uploadDriveToGemini', 'uploadDriveToGemini', path);
  requireToken(source, 'async function callGemini', 'callGemini', path);

  const helper = `// ${DIRECT_TAG}
function _clipDriveErr(value, max = 3500) {
  return String(value || "").slice(0, max);
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
  return {
    error: code || "server_error",
    message: message || code || "server_error",
    details: _driveErrDetails(body, extra),
  };
}

`;

  const callGeminiAnchor = 'async function callGemini(modelName, apiKey, promptText, body) {';
  source = replaceRequired(source, callGeminiAnchor, helper + callGeminiAnchor, 'worker helper insertion point', path);

  const startOld = `  if (!start.ok || !uploadUrl) {
    return { error: "server_error", message: "Gemini Files upload start failed " + start.status + ": " + await start.text().catch(() => "") };
  }`;
  const startNew = `  if (!start.ok || !uploadUrl) {
    const responseText = await start.text().catch(() => "");
    return _driveErr(
      start.status === 401 || start.status === 403 ? "invalid_api_key" : "server_error",
      "Gemini Files upload start failed " + start.status + ": " + responseText,
      body,
      {
        stage: "gemini_files_start",
        http_status: start.status,
        upload_url_present: !!uploadUrl,
        file_name: remote.name,
        file_size: remote.blob.size,
        mime_type: mime,
        response_body: _clipDriveErr(responseText),
      }
    );
  }`;
  source = replaceRequired(source, startOld, startNew, 'Gemini Files start error block', path);

  const finishOld = `  if (!finish.ok) {
    return { error: "server_error", message: "Gemini Files upload failed " + finish.status + ": " + text };
  }`;
  const finishNew = `  if (!finish.ok) {
    return _driveErr(
      finish.status === 401 || finish.status === 403 ? "invalid_api_key" : "server_error",
      "Gemini Files upload failed " + finish.status + ": " + text,
      body,
      {
        stage: "gemini_files_upload_finalize",
        http_status: finish.status,
        file_name: remote.name,
        file_size: remote.blob.size,
        mime_type: mime,
        response_body: _clipDriveErr(text),
      }
    );
  }`;
  source = replaceRequired(source, finishOld, finishNew, 'Gemini Files finalize error block', path);

  const parseOld = `  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  const file = data.file || data;`;
  const parseNew = `  let data = {};
  try { data = JSON.parse(text); }
  catch (e) {
    return _driveErr("server_error", "Gemini Files returned invalid JSON", body, {
      stage: "gemini_files_parse",
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_body: _clipDriveErr(text),
      exception_message: e && e.message ? e.message : String(e),
    });
  }
  const file = data.file || data;`;
  source = replaceRequired(source, parseOld, parseNew, 'Gemini Files JSON parse block', path);

  const uriOld = `  if (!file.uri) return { error: "server_error", message: "Gemini Files upload did not return file uri" };`;
  const uriNew = `  if (!file.uri) {
    return _driveErr("server_error", "Gemini Files upload did not return file uri", body, {
      stage: "gemini_files_missing_uri",
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_json: data,
    });
  }`;
  source = replaceRequired(source, uriOld, uriNew, 'Gemini Files missing URI block', path);

  const uploadErrorOld = '    if (uploadedDriveFile.error) return uploadedDriveFile;';
  const uploadErrorNew = '    if (uploadedDriveFile.error) return { ...uploadedDriveFile, details: uploadedDriveFile.details || _driveErrDetails(body, { stage: "gemini_files_upload" }) };';
  source = replaceRequired(source, uploadErrorOld, uploadErrorNew, 'Drive upload propagation', path);

  const statusOld = `  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: responseText };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText };
    return { error: 'server_error', message: 'Gemini error ' + response.status + ': ' + responseText };
  }`;
  const statusNew = `  if (response.status !== 200) {
    const details = _driveErrDetails(body, {
      stage: "gemini_generate_content",
      http_status: response.status,
      used_drive_url: !!body.drive_url,
      response_body: _clipDriveErr(responseText),
      file_data_parts: parts.filter((part) => !!part.file_data).length,
      inline_file_parts: parts.filter((part) => !!part.inline_data).length,
    });
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: responseText, details };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText, details };
    return { error: 'server_error', message: 'Gemini error ' + response.status + ': ' + responseText, details };
  }`;
  source = replaceRequired(source, statusOld, statusNew, 'Gemini non-200 details', path);

  const required = [
    DIRECT_TAG,
    '_driveErrDetails',
    'gemini_files_start',
    'gemini_files_upload_finalize',
    'gemini_files_missing_uri',
    'gemini_generate_content',
    'drive_download_not_file',
  ];
  for (const token of required) requireToken(source, token, token, path);

  writeIfChanged(path, before, source);
}

patchUi();
patchGas();
patchWorker();
console.log('[gemini-drive-error-details] verification passed');
