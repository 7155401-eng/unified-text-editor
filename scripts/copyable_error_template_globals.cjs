'use strict';

const fs = require('node:fs');

globalThis.title = '${title}';
globalThis.msg = '${msg}';
globalThis.extra = '${extra}';

const patchPath = 'scripts/apply_copyable_error_log_patch.mjs';
const helperInsertion = "  s = s.replace('async function callGemini(modelName, apiKey, promptText, body) {', helper + '\\nasync function callGemini(modelName, apiKey, promptText, body) {');\n";
const uploadReplacement = '  s = s.replace(uploadRe, uploadNew);\n';
const markerLine = '  // COPYABLE_ERROR_HELPER_INSERTION_ORDER_FIXED\n';
const brittleUploadRegex = String.raw`  const uploadRe = /async function uploadDriveToGemini\(apiKey, body\) \{[\s\S]*?\n\}\n\nasync function callGemini/;` + '\n';
const robustUploadRegex = String.raw`  const uploadRe = /async function uploadDriveToGemini\(apiKey, body\) \{[\s\S]*?\n\}\n+async function callGemini/;` + '\n';
const guardedUploadReplacement = [
  '  if (!uploadRe.test(s)) {',
  "    throw new Error('[gemini-drive-error-details] uploadDriveToGemini function boundary not found');",
  '  }',
  '  s = s.replace(uploadRe, uploadNew);',
].join('\n') + '\n';

let source = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');

if (source.includes(brittleUploadRegex)) {
  source = source.replace(brittleUploadRegex, robustUploadRegex);
} else if (!source.includes(robustUploadRegex)) {
  throw new Error('[copyable-error-bootstrap] upload regex declaration not found');
}

const insertionCount = source.split(helperInsertion).length - 1;
if (insertionCount < 1) {
  throw new Error('[copyable-error-bootstrap] helper insertion statement not found');
}

source = source.split(helperInsertion).join('');
source = source.split(markerLine).join('');
source = source.split(guardedUploadReplacement).join(uploadReplacement);

const replacementCount = source.split(uploadReplacement).length - 1;
if (replacementCount !== 1) {
  throw new Error(`[copyable-error-bootstrap] expected one upload replacement, found ${replacementCount}`);
}

source = source.replace(
  uploadReplacement,
  guardedUploadReplacement + markerLine + helperInsertion,
);

const uploadIndex = source.indexOf(guardedUploadReplacement);
const insertionIndex = source.indexOf(helperInsertion);
const finalInsertionCount = source.split(helperInsertion).length - 1;

if (
  finalInsertionCount !== 1 ||
  uploadIndex < 0 ||
  insertionIndex <= uploadIndex ||
  !source.includes(robustUploadRegex)
) {
  throw new Error('[copyable-error-bootstrap] failed to normalize upload replacement and helper order');
}

fs.writeFileSync(patchPath, source);
console.log('[copyable-error-bootstrap] upload boundary and helper order verified');
