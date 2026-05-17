import fs from 'node:fs';

const file = 'src/demo_mode.js';
// In the broken source there are two literal characters: backslash + n,
// directly between the closing brace and the export statement.
const broken = '}\\nexport function installConsoleGuard() {';
const fixed = '}\nexport function installConsoleGuard() {';

let text = fs.readFileSync(file, 'utf8');
if (text.includes(broken)) {
  text = text.split(broken).join(fixed);
  fs.writeFileSync(file, text, 'utf8');
  console.log('[build-fix] repaired literal backslash-n before installConsoleGuard in src/demo_mode.js');
}

const after = fs.readFileSync(file, 'utf8');
if (after.includes(broken)) {
  throw new Error('src/demo_mode.js still contains literal backslash-n before installConsoleGuard');
}
