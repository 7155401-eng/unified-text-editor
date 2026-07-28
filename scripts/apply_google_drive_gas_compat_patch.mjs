import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS_COMPAT';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}
function writeIfChanged(path, before, after) {
  if (before === after) {
    console.log(`[drive-gas-compat] no changes for ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[drive-gas-compat] patched ${path}`);
}
function assertHas(src, token, path) {
  if (!src.includes(token)) throw new Error(`[drive-gas-compat] verification failed in ${path}: missing ${token}`);
}

function insertAfterFirst(src, needle, addition, label) {
  if (!src.includes(needle)) throw new Error(`[drive-gas-compat] missing ${label}`);
  return src.replace(needle, needle + addition);
}

function addDriveArgs(src) {
  if (src.includes(TAG)) return src;

  const exactFilesLine = '    files = null,           // [{name, mime, blob}] OR [File]\n';
  const driveArgs =
    `    drive_url = null,        // ${TAG}\n` +
    `    drive_file_name = null,\n`;

  if (src.includes(exactFilesLine)) {
    return insertAfterFirst(src, exactFilesLine, driveArgs, 'files argument line');
  }

  const textPayloadLine = '    text_payload = null,\n';
  if (src.includes(textPayloadLine)) {
    return src.replace(textPayloadLine, driveArgs + textPayloadLine);
  }

  throw new Error('[drive-gas-compat] could not locate GAS call argument block');
}

function addDriveRequestBody(src) {
  if (src.includes('requestBody.drive_url')) return src;

  const filesBlock = `    if (filesData.length) {
      requestBody.files = filesData;
    }
`;
  const driveBlock = `    if (drive_url) {
      requestBody.drive_url = String(drive_url).trim();
      if (drive_file_name) requestBody.drive_file_name = _basename(drive_file_name);
    }
`;
  if (src.includes(filesBlock)) {
    return src.replace(filesBlock, driveBlock + filesBlock);
  }

  const textBlock = `    if (text_payload) {
      requestBody.text = text_payload;
    }
`;
  if (src.includes(textBlock)) {
    return src.replace(textBlock, driveBlock + textBlock);
  }

  throw new Error('[drive-gas-compat] could not locate request body insertion point');
}

function addDriveLogSummary(src) {
  let out = src;

  const oldHeavy = `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code"]);
`;
  const newHeavy = `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code", "drive_url"]);
`;
  if (out.includes(oldHeavy)) out = out.replace(oldHeavy, newHeavy);

  const oldCount = `      logBody._files_count = (requestBody.files || []).length;
`;
  const newCount = `      logBody._files_count = (requestBody.files || []).length;
      logBody._has_drive_url = !!requestBody.drive_url;
`;
  if (out.includes(oldCount) && !out.includes('_has_drive_url')) out = out.replace(oldCount, newCount);

  return out;
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);
  if (before.includes(TAG) && before.includes('requestBody.drive_url') && before.includes('_has_drive_url')) {
    writeIfChanged(path, before, before);
    return;
  }

  let src = before;
  src = addDriveArgs(src);
  src = addDriveRequestBody(src);
  src = addDriveLogSummary(src);

  assertHas(src, TAG, path);
  assertHas(src, 'drive_url', path);
  assertHas(src, 'requestBody.drive_url', path);
  assertHas(src, '_has_drive_url', path);
  writeIfChanged(path, before, src);
}

patchGas();
console.log('[drive-gas-compat] verification passed');
