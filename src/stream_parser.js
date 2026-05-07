// משה 2026-05-07: thin client only — האלגוריתם הועבר לשרת (worker/stream_parser.js).
// בלי השרת אי אפשר לזהות זרמים. זאת הגנה מפני העתקת הקוד.
// תוויות (titles) נקבעות בשרת לפי הקוד; אין צורך ב-defaultLabelForCode כאן.

const ENDPOINT = '/api/streams/parse';

async function callServer(text) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: String(text || '') }),
  });
  if (!res.ok) {
    throw new Error(`Stream parse failed: HTTP ${res.status}`);
  }
  return res.json();
}

export async function parseRawTextToHTML(text) {
  return callServer(text);
}

export async function scanRawText(text) {
  const r = await callServer(text);
  return r.stats;
}
