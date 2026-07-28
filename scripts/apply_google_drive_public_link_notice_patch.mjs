import fs from 'node:fs';

const TAG = 'RAVTEXT_GOOGLE_DRIVE_PUBLIC_LINK_NOTICE_PATCH';
const path = 'src/torah_transcription/torah_transcription_ui.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;

if (!src.includes(TAG)) {
  const oldNote = `    driveRow.appendChild(el("div", { class: "tt-note" },
      "אפשר לשתף קובץ ציבורי בדרייב במקום להעלות קובץ גדול. צריך הרשאה: כל מי שיש לו קישור יכול לצפות."
    ));`;
  const newNote = `    // ${TAG}
    driveRow.appendChild(el("div", {
      class: "tt-note",
      style: "margin:8px 25px; color:#a23b00; font-weight:700; line-height:1.5;"
    }, "⚠️ לפני שליחה: ב-Google Drive יש להגדיר 'כל מי שיש לו קישור'. ההגדרה חושפת את הקובץ לכל מי שמקבל את הקישור — אין להשתמש בקובץ רגיש."));`;
  if (!src.includes(oldNote)) throw new Error('[drive-public-link-notice] missing public-link note anchor');
  src = src.replace(oldNote, newNote);

  const oldPlaceholder = 'placeholder: "שם קובץ כולל סיומת, לדוגמה audio.mp3",';
  const newPlaceholder = 'placeholder: "שם קובץ (אופציונלי; מסייע בזיהוי סוג הקובץ), למשל audio.mp3",';
  if (!src.includes(oldPlaceholder)) throw new Error('[drive-public-link-notice] missing file-name placeholder anchor');
  src = src.replace(oldPlaceholder, newPlaceholder);
}

if (!src.includes(TAG)) throw new Error('[drive-public-link-notice] verification failed');
if (src !== before) fs.writeFileSync(path, src);
console.log('[drive-public-link-notice] verification passed');