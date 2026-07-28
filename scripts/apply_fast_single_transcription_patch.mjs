import fs from 'node:fs';
const TAG = 'RAVTEXT_FAST_SINGLE_TRANSCRIPTION_PATCH';
const path = 'src/torah_transcription/torah_transcription_ui.js';
const before = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
let src = before;
if (!src.includes(TAG)) {
  const slider = /min:\s*"3",\s*\n\s*max:\s*"10",/;
  if (!slider.test(src)) throw new Error('[fast-single] runs slider not found');
  src = src.replace(slider, 'min: "1", // ' + TAG + '\n        max: "10",');
  const judge = /(\s*)this\.statusLabel\.textContent = [^\n]+;\n\s*this\.progressFill\.style\.width = "85%";/;
  if (!judge.test(src)) throw new Error('[fast-single] adjudication status block not found');
  src = src.replace(judge, (all, indent) => `${indent}// ${TAG}\n${indent}if (s.n_runs === 1 && elevenlabs_witnesses.length === 0 && externals.length === 0) {\n${indent}  const edition = witnesses[0] || "";\n${indent}  this.appState.result = { witnesses, elevenlabs_witnesses: [], externals: [], edition, fast_single: true };\n${indent}  this.progressFill.style.width = "100%";\n${indent}  this.statusLabel.textContent = "Fast transcription completed";\n${indent}  this._showResult();\n${indent}  return;\n${indent}}\n\n${indent}this.statusLabel.textContent = "Adjudication...";\n${indent}this.progressFill.style.width = "85%";`);
}
for (const token of [TAG, 'fast_single: true', 'Fast transcription completed']) if (!src.includes(token)) throw new Error(`[fast-single] verification failed: ${token}`);
if (src !== before) fs.writeFileSync(path, src);
console.log('[fast-single] verification passed');