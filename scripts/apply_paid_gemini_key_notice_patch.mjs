import fs from 'node:fs';

const TAG = 'RAVTEXT_PAID_GEMINI_KEY_NOTICE';
const path = 'src/torah_transcription/torah_transcription_ui.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;

if (!src.includes(TAG)) {
  const oldLabel = '"מפתח Gemini (תמיד נדרש):"';
  const newLabel = '"מפתח Gemini בתשלום (תמיד נדרש):"';
  if (!src.includes(oldLabel)) throw new Error('[paid-gemini-key] missing Gemini label');
  src = src.replace(oldLabel, newLabel);

  const anchor = '    pers.appendChild(this.geminiEntry);';
  const notice = `    pers.appendChild(this.geminiEntry);
    // ${TAG}
    pers.appendChild(el("div", {
      class: "tt-note",
      style: "margin:0 25px 12px; color:#a23b00; font-weight:700; line-height:1.5;"
    }, "⚠️ נדרש מפתח Gemini מפרויקט Google Cloud עם חיוב פעיל. מפתח של המכסה החינמית בלבד אינו מספיק לעיבוד קבצים גדולים או להרצות חוזרות."));`;
  if (!src.includes(anchor)) throw new Error('[paid-gemini-key] missing Gemini input anchor');
  src = src.replace(anchor, notice);
}

for (const token of [TAG, 'מפתח Gemini בתשלום', 'חיוב פעיל', 'המכסה החינמית בלבד']) {
  if (!src.includes(token)) throw new Error(`[paid-gemini-key] verification failed: ${token}`);
}
if (src !== before) fs.writeFileSync(path, src);
console.log('[paid-gemini-key] verification passed');