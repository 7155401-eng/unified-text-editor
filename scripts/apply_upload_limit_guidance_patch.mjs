import fs from 'node:fs';

const TAG = 'RAVTEXT_UPLOAD_LIMIT_GUIDANCE_PATCH';
const path = 'src/torah_transcription/torah_transcription_ui.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;

if (!src.includes(TAG)) {
  const fileRowAnchor = `    row.appendChild(fileRow);

    const driveRow = el("div", { class: "tt-card", style: "margin-top:12px;" });`;
  const fileRowReplacement = `    row.appendChild(fileRow);
    // ${TAG}
    row.appendChild(el("div", {
      class: "tt-note",
      style: "margin:8px 25px; line-height:1.5;"
    }, "העלאה רגילה: גודל ההעלאה תלוי במגבלות השרת. אם קובץ גדול נכשל, נסה קישור Drive ציבורי, קובץ MP3/M4A דחוס, או פיצול לקבצים קטנים."));

    const driveRow = el("div", { class: "tt-card", style: "margin-top:12px;" });`;
  if (!src.includes(fileRowAnchor)) throw new Error('[upload-limit-guidance] missing file-row anchor');
  src = src.replace(fileRowAnchor, fileRowReplacement);

  const inputAnchor = `    this.driveUrlInput = el("input", {`;
  const driveGuide = `    driveRow.appendChild(el("div", {
      class: "tt-note",
      style: "margin:8px 25px; line-height:1.5;"
    }, "קישור Drive: הקובץ יורד דרך השרת לפני העיבוד. מומלץ עד כ-80MB; מעל כ-100MB הוא עלול להיכשל בגלל מגבלת זיכרון. הקובץ חייב להיות משותף ל'כל מי שיש לו קישור'."));
    
`;
  if (!src.includes(inputAnchor)) throw new Error('[upload-limit-guidance] missing Drive input anchor');
  src = src.replace(inputAnchor, driveGuide + inputAnchor);

  const oldButton = '}, "בחר מקישור Drive"));';
  const newButton = '}, "📎 השתמש בקישור Google Drive"));';
  if (!src.includes(oldButton)) throw new Error('[upload-limit-guidance] missing Drive button anchor');
  src = src.replace(oldButton, newButton);
}

for (const token of [TAG, 'העלאה רגילה: גודל ההעלאה', 'מומלץ עד כ-80MB', '📎 השתמש בקישור Google Drive']) {
  if (!src.includes(token)) throw new Error(`[upload-limit-guidance] verification failed: ${token}`);
}
if (src !== before) fs.writeFileSync(path, src);
console.log('[upload-limit-guidance] verification passed');