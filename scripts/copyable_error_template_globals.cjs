'use strict';

const fs = require('node:fs');

const PATH = 'worker/ai_direct.js';
const STAGE = 'drive_download_not_file';
const START = 'async function fetchDriveBlob(body) {';
const END = 'async function uploadDriveToGemini(apiKey, body) {';

let source = fs.readFileSync(PATH, 'utf8').replace(/\r\n/g, '\n');

if (!source.includes(STAGE)) {
  const startIndex = source.indexOf(START);
  const endIndex = source.indexOf(END, startIndex + START.length);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error('[copyable-error-preload] missing fetchDriveBlob boundaries');
  }

  const beforeFunction = source.slice(0, startIndex);
  const functionSource = source.slice(startIndex, endIndex);
  const afterFunction = source.slice(endIndex);

  const finalNotFileReturn =
    /  return \{\n    error: "bad_request",\n    message: "Google Drive[^\n]*HTML[^\n]*",\n  \};\n\}\n\n?$/;

  if (!finalNotFileReturn.test(functionSource)) {
    throw new Error('[copyable-error-preload] missing Drive HTML/non-file return block');
  }

  const patchedFunction = functionSource.replace(
    finalNotFileReturn,
    `  return {
    error: "bad_request",
    message: "Google Drive returned HTML instead of a downloadable file",
    details: {
      stage: "${STAGE}",
      http_status: first.status,
      content_type: firstType,
      response_body: html.slice(0, 3500),
      has_confirm: !!(confirm && (confirm.href || confirm.confirm)),
    },
  };
}

`,
  );

  source = beforeFunction + patchedFunction + afterFunction;
  fs.writeFileSync(PATH, source);
  console.log('[copyable-error-preload] added Drive non-file error details');
}

const finalSource = fs.readFileSync(PATH, 'utf8');
if (!finalSource.includes(STAGE)) {
  throw new Error('[copyable-error-preload] Drive non-file error details verification failed');
}
