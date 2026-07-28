import fs from 'node:fs';
const TAG = 'RAVTEXT_FAST_SINGLE_TRANSCRIPTION_PATCH';
const path = 'src/torah_transcription/torah_transcription_ui.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;
if (!src.includes(TAG)) {
  const slider = /min:\s*"3",\s*\n\s*max:\s*"10",/;
  if (!slider.test(src)) throw new Error('[fast-single] runs slider not found');
  src = src.replace(slider, 'min: "1", // ' + TAG + '\n        max: "10",');
  const judge = /(\s*)\/\/ ׳”׳›׳¨׳¢׳× ׳ ׳•׳¡׳—\n\s*this\.statusLabel\.textContent = "׳”׳›׳¨׳¢׳× ׳ ׳•׳¡׳—\.\.\.";/;
  if (!judge.test(src)) throw new Error('[fast-single] adjudication block not found');
  src = src.replace(judge, (all, indent) => `${indent}// ${TAG}: one run returns immediately, without comparison or adjudication.\n${indent}if (s.n_runs === 1 && elevenlabs_witnesses.length === 0 && externals.length === 0) {\n${indent}  const edition = witnesses[0] || "";\n${indent}  this.appState.result = { witnesses, elevenlabs_witnesses: [], externals: [], edition, fast_single: true };\n${indent}  this.progressFill.style.width = "100%";\n${indent}  this.statusLabel.textContent = "׳”׳×׳׳׳•׳ ׳”׳׳”׳™׳¨ ׳”׳¡׳×׳™׳™׳";\n${indent}  this._showResult();\n${indent}  return;\n${indent}}\n\n${indent}// ׳”׳›׳¨׳¢׳× ׳ ׳•׳¡׳—\n${indent}this.statusLabel.textContent = "׳”׳›׳¨׳¢׳× ׳ ׳•׳¡׳—...";`);
}
for (const token of [TAG, 'fast_single: true', '׳”׳×׳׳׳•׳ ׳”׳׳”׳™׳¨ ׳”׳¡׳×׳™׳™׳']) if (!src.includes(token)) throw new Error(`[fast-single] verification failed: ${token}`);
if (src !== before) fs.writeFileSync(path, src);
console.log('[fast-single] verification passed');