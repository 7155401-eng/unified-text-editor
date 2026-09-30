import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dialog = fs.readFileSync(new URL('../../src/word_extractor/word_extractor_dialog.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../../src/word_extractor/word_extractor.worker.js', import.meta.url), 'utf8');
const chapters = fs.readFileSync(new URL('../../src/document_chapter_splitter.js', import.meta.url), 'utf8');

test('B1: Word import has a real visible progress element and staged percentages',()=>{
  assert.match(dialog, /<progress id="import-progress"[^>]*max="100"/);
  assert.match(dialog, /prog\.hidden = false/);
  for (const pct of [5,12,18,25,94,100]) {
    assert(dialog.includes(`, false, ${pct})`) || dialog.includes(`, false, ${pct};`) || dialog.includes(`, false, ${pct}\n`),
      `scan/import progress milestone ${pct}% missing`);
  }
  for (const pct of [20,34,42,72,78,86]) {
    assert(dialog.includes(`, false, ${pct})`) || dialog.includes(`, false, ${pct};`) || dialog.includes(`, false, ${pct}\n`),
      `import progress milestone ${pct}% missing`);
  }
});

test('B1: Word worker actually emits progress events instead of only accepting them in UI',()=>{
  assert.match(worker, /self\.postMessage\(\{ type: "progress", message, progress: value \}\)/);
  for (const pct of [28,38,78,45,50,66]) {
    assert(worker.includes(String(pct)), `worker milestone ${pct}% missing`);
  }
  assert.match(worker, /progress\("קורא מבנה, סגנונות והערות\.\.\.", 38\)/);
  assert.match(worker, /progress\("מפריד טקסט ראשי והערות\.\.\.", 50\)/);
});

test('B2: chapter manager is inserted at the bottom immediately before import action buttons',()=>{
  assert.match(chapters, /const btns = \$\("\.we-btns", inner\)/);
  assert.match(chapters, /btns\.parentElement\.insertBefore\(card, btns\)/);
  assert(!/insertBefore\(card,\s*streamsWrap\)/.test(chapters),
    'chapter manager regressed to the old position above/alongside stream options');
});
