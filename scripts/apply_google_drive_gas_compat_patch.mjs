import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS';

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

function addDriveArgs(src) {
  if (src.includes(TAG)) return src;

  const argBlock = `    files = null,           // [{name, mime, blob}] OR [File]
    drive_url = null,       // ${TAG}
    drive_file_name = null,
`;
  if (src.includes(`    files = null,           // [{name, mime, blob}] OR [File]\n`)) {
    return src.replace(`    files = null,           // [{name, mime, blob}] OR [File]\n`, argBlock);
  }

  const generic = src.replace(
    /(files\s*=\s*null,\s*(?:\\/\/[^\n])?\n)/,
    `$1    drive_url = null,       // ${TAG}\n    drive_file_name = null,\n`
  );
  if (generic !== src) return generic;

  return src.replace(
    `    text_payload = null,\n`,
    `    drive_url = null,       // ${TAG}\n    drive_file_name = null,\n    text_payload = null,\n`
  );
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);
  if (before.includes(TAG)) {
    assertHas(before, 'drive_url', path);
    writeIfChanged(path, before, before);
    return;
  }
  let src = before;

  src = addDriveArgs(src);

  const fileBody = `    if (filesData.length) {
      requestBody.files = filesData;
    }
`;
  const fileBodyWithDrive = `    if (drive_url) {
      requestBody.drive_url = String(drive_url).trim();
      if (drive_file_name) requestBody.drive_file_name = _basename(drive_file_name);
    }
    if (filesData.length) {
      requestBody.files = filesData;
    }
`;
  if (src.includes(fileBody)) {
    src = src.replace(fileBody, fileBodyWithDrive);
  } else {
    src = src.replace(
      `    if (text_payload) {\n`,
      `    if (drive_url) {\n      requestBody.drive_url = String(drive_url).trim();\n      if (drive_file_name) requestBody.drive_file_name = _basename(drive_file_name);\n    }\n    if (text_payload) {\n`
    );
  }

  src = src.replace(
    `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code"]);\n`,
    `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code", "drive_url"]);\n`
  );

  src = src.replace(
    `      logBody._files_count = (requestBody.files || []).length;\n`,
    `      logBody._files_count = (requestBody.files || []).length;\n      logBody._has_drive_url = !!requestBody.drive_url;\n`
  );

  assertHas(src, TAG, path);
  assertHas(src, 'requestBody.drive_url', path);
  assertHas(src, '_has_drive_url', path);
  writeIfChanged(path, before, src);
}

patchGas();
console.log('[drive-gas-compat] verification passed');
