const fs = require('node:fs');

globalThis.title = '${title}';
globalThis.msg = '${msg}';
globalThis.extra = '${extra}';

const patchPath = 'scripts/apply_copyable_error_log_patch.mjs';
const insertion = "  s = s.replace('async function callGemini(modelName, apiKey, promptText, body) {', helper + '\\nasync function callGemini(modelName, apiKey, promptText, body) {');\n";
const uploadReplacement = '  s = s.replace(uploadRe, uploadNew);\n';
const markerLine = '  // COPYABLE_ERROR_HELPER_INSERTION_ORDER_FIXED\n';

let source = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');

const occurrenceCount = source.split(insertion).length - 1;
if (occurrenceCount < 1) {
  throw new Error('[copyable-error-bootstrap] missing helper insertion statement');
}
if (!source.includes(uploadReplacement)) {
  throw new Error('[copyable-error-bootstrap] missing upload replacement statement');
}

// Remove every existing helper insertion and marker, then put exactly one helper
// insertion after uploadDriveToGemini has been replaced. This prevents the
// upload-function regex from swallowing the helper and its DIRECT tag.
source = source.split(insertion).join('');
source = source.split(markerLine).join('');
source = source.replace(
  uploadReplacement,
  uploadReplacement + markerLine + insertion,
);

const finalCount = source.split(insertion).length - 1;
const uploadIndex = source.indexOf(uploadReplacement);
const insertionIndex = source.indexOf(insertion);

if (finalCount !== 1 || insertionIndex <= uploadIndex) {
  throw new Error('[copyable-error-bootstrap] failed to place helper after upload replacement');
}

fs.writeFileSync(patchPath, source);
console.log('[copyable-error-bootstrap] helper insertion order verified');
