import fs from 'node:fs';

const TAG = 'RAVTEXT_FAST_SINGLE_TRANSCRIPTION_PATCH';
const path = 'src/torah_transcription/torah_transcription_ui.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;

if (!src.includes(TAG)) {
  const sliderOld = `        min: "3",
        max: "10",`;
  const sliderNew = `        min: "1", // ${TAG}: 1 = fast single transcription
        max: "10",`;
  if (!src.includes(sliderOld)) throw new Error('[fast-single] missing runs-slider anchor');
  src = src.replace(sliderOld, sliderNew);

  const noteOld = '        "3 = דיוק בסיסי. 10 = דיוק גבוה לעבודות עסקיות. במקרה של סתירה — הרוב קובע."';
  const noteNew = '        "1 = תמלול מהיר: גרסה אחת בלבד, בלי השוואה ובלי דיין. 3 = דיוק בסיסי. 10 = דיוק גבוה; במקרה של סתירה — הרוב קובע."';
  if (!src.includes(noteOld)) throw new Error('[fast-single] missing runs-note anchor');
  src = src.replace(noteOld, noteNew);

  const judgeAnchor = `        // הכרעת נוסח
        this.statusLabel.textContent = "הכרעת נוסח...";`;
  const fastPath = `        // ${TAG}
        // במצב מהיר אין עדים נוספים ואין הכרעה: מציגים מיד את התמלול היחיד.
        if (s.n_runs === 1 && elevenlabs_witnesses.length === 0 && externals.length === 0) {
          const edition = witnesses[0] || "";
          this.appState.result = { witnesses, elevenlabs_witnesses: [], externals: [], edition, fast_single: true };
          this.progressFill.style.width = "100%";
          this.statusLabel.textContent = "התמלול המהיר הסתיים";
          this._showResult();
          return;
        }

        // הכרעת נוסח
        this.statusLabel.textContent = "הכרעת נוסח...";`;
  if (!src.includes(judgeAnchor)) throw new Error('[fast-single] missing adjudication anchor');
  src = src.replace(judgeAnchor, fastPath);
}

for (const token of [TAG, 'תמלול מהיר: גרסה אחת בלבד', 'fast_single: true', 'התמלול המהיר הסתיים']) {
  if (!src.includes(token)) throw new Error(`[fast-single] verification failed: ${token}`);
}
if (src !== before) fs.writeFileSync(path, src);
console.log('[fast-single] verification passed');