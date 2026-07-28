import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS_COMPAT';
const DIRECT_ANCHOR = '// הנחיה הסופית לפי סוג';
const DIRECT_TAG = 'RAVTEXT_GOOGLE_DRIVE_DIRECT_ANCHOR_COMPAT';

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
  if (!src.includes(token)) {
    throw new Error(`[drive-gas-compat] verification failed in ${path}: missing ${token}`);
  }
}
function insertAfterFirst(src, needle, addition, label) {
  if (!src.includes(needle)) {
    throw new Error(`[drive-gas-compat] missing ${label}`);
  }
  return src.replace(needle, needle + addition);
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);
  if (
    before.includes(TAG) &&
    before.includes('requestBody.drive_url') &&
    before.includes('_has_drive_url')
  ) {
    writeIfChanged(path, before, before);
    return;
  }

  let src = before;
  const exactFilesLine = '    files = null,           // [{name, mime, blob}] OR [File]\n';
  const driveArgs =
    `    drive_url = null,        // ${TAG}\n` +
    `    drive_file_name = null,\n`;

  if (!src.includes('drive_url = null')) {
    if (src.includes(exactFilesLine)) {
      src = insertAfterFirst(src, exactFilesLine, driveArgs, 'files argument line');
    } else {
      const textPayloadLine = '    text_payload = null,\n';
      if (!src.includes(textPayloadLine)) {
        throw new Error('[drive-gas-compat] could not locate GAS call argument block');
      }
      src = src.replace(textPayloadLine, driveArgs + textPayloadLine);
    }
  }

  if (!src.includes('requestBody.drive_url')) {
    const filesBlock = `    if (filesData.length) {
      requestBody.files = filesData;
    }
`;
    const driveBlock = `    if (drive_url) {
      requestBody.drive_url = String(drive_url).trim();
      if (drive_file_name) requestBody.drive_file_name = _basename(drive_file_name);
    }
`;
    const textBlock = `    if (text_payload) {
      requestBody.text = text_payload;
    }
`;
    if (src.includes(filesBlock)) {
      src = src.replace(filesBlock, driveBlock + filesBlock);
    } else if (src.includes(textBlock)) {
      src = src.replace(textBlock, driveBlock + textBlock);
    } else {
      throw new Error('[drive-gas-compat] could not locate request body insertion point');
    }
  }

  const oldHeavy = `     const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code"]);
`;
  const newHeavy = `      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code", "drive_url"]);
`;
  if (src.includes(oldHeavy)) src = src.replace(oldHeavy, newHeavy);

  const oldCount = `      logBody._files_count = (requestBody.files || []).length;
`;
  const newCount = `      logBody._files_count = (requestBody.files || []).length;
      logBody._has_drive_url = !!requestBody.drive_url;
`;
  if (src.includes(oldCount) && !src.includes('_has_drive_url')) src = src.replace(oldCount, newCount);

  assertHas(src, TAG, path);
  assertHas(src, 'requestBody.drive_url', path);
  assertHas(src, '_has_drive_url', path);
  writeIfChanged(path, before, src);
}

function patchDirectSeed() {
  const path = 'worker/ai_direct.js';
  const before = read(path);
  let src = before;

  const callGemini = 'async function callGemini(modelName, apiKey, promptText, body) {';
  assertHas(src, callGemini, path);

  if (!src.includes(DIRECT_ANCHOR)) {
    src = src.replace(
      callGemini,
      `${DIRECT_ANCHOR} // ${DIRECT_TAG}\n${callGemini}`
    );
  }

  const expectedDriveBlock = `  if (body.drive_url) {
    const n = remoteName(body);
    parts.push({ file_data: { mime_type: detectMimeType(remoteType(n), n), file_uri: driveDownloadUrl(body.drive_url) } });
  }

`;

  if (!src.includes(expectedDriveBlock)) {
    const textLine = '  if (body.text) parts.push({ text: body.text });\n';
    if (src.includes(textLine)) {
      src = src.replace(textLine, expectedDriveBlock + textLine);
    } else {
      const textRegex = /(^\s*if\s*\(s*body\.text\s*\)\s*parts\.push\(\{\*\s*text:\s*body\.text\s*\}\);\s*$)/m;
      if (!textRegex.test(src)) {
        throw new Error('[drive-gas-compat] could not locate Gemini text part insertion point');
      }
      src = src.replace(textRegex, expectedDriveBlock.trimEnd() + '\n$1');
    }
  }

  assertHas(src, DIRECT_ANCHOR, path);
  assertHas(src, expectedDriveBlock.trim(), path);
  writeIfChanged(path, before, src);
}

patchGas();
patchDirectSeed();
console.log('[drive-gas-compat] verification passed');
