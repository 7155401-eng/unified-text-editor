const fs = require('node:fs');

globalThis.title = '${title}';
globalThis.msg = '${msg}';
globalThis.extra = '${extra}';

const patchPath = 'scripts/apply_copyable_error_log_patch.mjs';
const marker = 'COPYABLE_ERROR_HELPER_INSERTION_ORDER_FIXED';
let source = fs.readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n');

if (!source.includes(marker)) {
  const earlyInsertion = "  s = s.replace('async function callGemini(modelName, apiKey, promptText, body) {', helper + '\\nasync function callGemini(modelName, apiKey, promptText, body) {');\n";
  const uploadReplacement = '  s = s.replace(uploadRe, uploadNew);\n';

  if (!source.includes(earlyInsertion)) {
    throw new Error('[copyable-error-bootstrap] missing early helper insertion');
  }
  if (!source.includes(uploadReplacement)) {
    throw new Error('[copyable-error-bootstrap] missing upload replacement');
  }

  source = source.replace(earlyInsertion, '');
  source = source.replace(
    uploadReplacement,
    uploadReplacement +
      `\n  // ${marker}\n` +
      "  s = s.replace('async function callGemini(modelName, apiKey, promptText, body) {', helper + '\\nasync function callGemini(modelName, apiKey, promptText, body) {');\n",
  );

  fs.writeFileSync(patchPath, source);
  console.log('[copyable-error-bootstrap] moved direct helper insertion after upload replacement');
}
