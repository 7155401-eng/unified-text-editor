import fs from 'node:fs';

const GAS_TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS_COMPAT';
const V2_DIRECT_TAG = 'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_DIRECT';
const DIRECT_ANCHOR = '// הנחיה הסופית לפי סוג';

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

function requireToken(src, token, path) {
  if (!src.includes(token)) {
    throw new Error(`[drive-gas-compat] missing ${token} in ${path}`);
  }
}

function patchGas() {
  const path = 'src/torah_transcription/torah_transcription_gas.js';
  const before = read(path);
  let src = before;

  if (!src.includes('drive_url = null')) {
    const argsAnchor = '    text_payload = null,\n';
    requireToken(src, argsAnchor, path);
    src = src.replace(
      argsAnchor,
      `    drive_url = null,        // ${GAS_TAG}\n    drive_file_name = null,\n${argsAnchor}`,
    );
  }

  if (!src.includes('requestBody.drive_url')) {
    const filesBlock = `    if (filesData.length) {
      requestBody.files = filesData;
    }
`;
    const textBlock = `    if (text_payload) {
      requestBody.text = text_payload;
    }
`;
    const driveBlock = `    if (drive_url) {
      requestBody.drive_url = String(drive_url).trim();
      if (drive_file_name) requestBody.drive_file_name = _basename(drive_file_name);
    }
`;
    if (src.includes(filesBlock)) {
      src = src.replace(filesBlock, driveBlock + filesBlock);
    } else {
      requireToken(src, textBlock, path);
      src = src.replace(textBlock, driveBlock + textBlock);
    }
  }

  const oldHeavy = '      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code"]);';
  const newHeavy = '      const heavy = new Set(["files", "ocr_examples", "text", "api_key", "access_code", "drive_url"]);';
  if (src.includes(oldHeavy)) src = src.replace(oldHeavy, newHeavy);

  const oldCount = '      logBody._files_count = (requestBody.files || []).length;';
  const newCount = `${oldCount}
      logBody._has_drive_url = !!requestBody.drive_url;`;
  if (src.includes(oldCount) && !src.includes('_has_drive_url')) {
    src = src.replace(oldCount, newCount);
  }

  requireToken(src, 'drive_url', path);
  requireToken(src, 'requestBody.drive_url', path);
  requireToken(src, '_has_drive_url', path);
  writeIfChanged(path, before, src);
}

function patchDirectSeed() {
  const path = 'worker/ai_direct.js';
  const before = read(path);
  let src = before;

  const callGemini = 'async function callGemini(modelName, apiKey, promptText, body) {';
  requireToken(src, callGemini, path);

  if (!src.includes(DIRECT_ANCHOR)) {
    src = src.replace(callGemini, `${DIRECT_ANCHOR}\n${callGemini}`);
  }

  const driveBlock = `  if (body.drive_url) {
    const n = remoteName(body);
    parts.push({ file_data: { mime_type: detectMimeType(remoteType(n), n), file_uri: driveDownloadUrl(body.drive_url) } });
  }

`;

  if (!src.includes(driveBlock)) {
    const exactText = '  if (body.text) parts.push({ text: body.text });\n';
    if (src.includes(exactText)) {
      src = src.replace(exactText, driveBlock + exactText);
    } else {
      const textRegex = /(^\s*if\s*\(\s*body\.text\s*\)\s*parts\.push\(\{\s*text:\s*body\.text\s*\}\);\s*$)/m;
      if (!textRegex.test(src)) {
        throw new Error('[drive-gas-compat] could not locate Gemini text part insertion point');
      }
      src = src.replace(textRegex, driveBlock.trimEnd() + '\n$1');
    }
  }

  if (!src.includes(V2_DIRECT_TAG)) {
    src = src.replace(DIRECT_ANCHOR, `${DIRECT_ANCHOR}\n// ${V2_DIRECT_TAG}`);
  }

  requireToken(src, DIRECT_ANCHOR, path);
  requireToken(src, V2_DIRECT_TAG, path);
  requireToken(src, driveBlock.trim(), path);
  writeIfChanged(path, before, src);
}

patchGas();
patchDirectSeed();
console.log('[drive-gas-compat] verification passed');
