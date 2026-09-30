import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index=fs.readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const cssPanel=fs.readFileSync(new URL('../../src/css_inject_panel.js',import.meta.url),'utf8');
const customStyles=fs.readFileSync(new URL('../../src/custom_styles.js',import.meta.url),'utf8');

test('icon/SVG-only controls have explicit accessible names',()=>{
  assert.match(cssPanel,/id="ci-close"[^>]*aria-label="סגור חלון CSS מותאם"/);
  assert.match(customStyles,/class="csd-close"[^>]*aria-label="סגור הגדרות סגנון"/);
  assert.match(customStyles,/class="sar-close"[^>]*aria-label="סגור כללי סגנון"/);
  assert.match(customStyles,/id="sar-edit-style"[^>]*aria-label="ערוך את הסגנון שנבחר"/);

  assert.match(index,/data-stream="07"[\s\S]{0,180}?aria-label="סמן טקסט נבחר כזרם 07"/);
  assert.match(index,/data-stream="08"[\s\S]{0,180}?aria-label="סמן טקסט נבחר כזרם 08"/);
  assert.match(index,/id="pdf-download"[\s\S]{0,180}?aria-label="הורד PDF"/);
  assert.match(index,/id="pdf-download-html"[\s\S]{0,220}?aria-label="הורד HTML לדיבוג — קוד מקור למפתחים"/);
});

test('accessibility rebuild does not import the stale bot lockfile change',()=>{
  assert(!fs.existsSync(new URL('../../pnpm-lock.yaml',import.meta.url)),
    'stale #377 pnpm lockfile was copied into the rebuild');
});
