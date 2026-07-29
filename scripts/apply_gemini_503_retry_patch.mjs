import fs from 'node:fs';
const TAG = 'RAVTEXT_GEMINI_503_RETRY_PATCH';
const path = 'worker/ai_direct.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;
if (!src.includes(TAG)) {
  const start = src.indexOf('async function callGemini(');
  const end = src.indexOf('async function callClaude(', start);
  if (start < 0 || end < 0) throw new Error('[gemini-retry] callGemini bounds not found');
  const segment = src.slice(start, end);
  const oldFetch = `  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();`;
  const newFetch = `  // ${TAG}: retry transient provider overloads before exposing an error.
  let response;
  let responseText = "";
  const retryDelaysMs = [0, 1200, 3000];
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
    if (retryDelaysMs[attempt]) await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    responseText = await response.text();
    if (response.status !== 503) break;
  }`;
  if (!segment.includes(oldFetch)) throw new Error('[gemini-retry] Gemini fetch block not found');
  src = src.slice(0, start) + segment.replace(oldFetch, newFetch) + src.slice(end);
}
for (const token of [TAG, 'retryDelaysMs', 'response.status !== 503']) if (!src.includes(token)) throw new Error(`[gemini-retry] verification failed: ${token}`);
if (src !== before) fs.writeFileSync(path, src);
console.log('[gemini-retry] verification passed');