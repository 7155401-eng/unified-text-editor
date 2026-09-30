import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../../src/word_extractor/word_extractor.worker.js', import.meta.url), 'utf8');
const dialog = await readFile(new URL('../../src/word_extractor/word_extractor_dialog.js', import.meta.url), 'utf8');

test('Word import progress remains worker-driven, request-scoped and visible through all long phases', () => {
  assert.match(worker, /function\s+sendProgress\s*\(id,/);
  assert.match(worker, /type:\s*["']progress["']/);
  assert.match(worker, /completed\s*\+=\s*1/);
  assert.match(worker, /completed\s*\/\s*jobs\.length/);
  assert.match(worker, /indeterminate:\s*true/);
  assert.match(worker, /progress:\s*100/);

  // A late progress message from an older scan/extract request must never repaint
  // the currently open modal.
  assert.match(dialog, /if\s*\(!_workerPending\.has\(ev\.data\.id\)\)\s*return/);

  // Native <progress> must support both determinate and indeterminate states.
  assert.match(dialog, /progressVal\s*===\s*["']indeterminate["']/);
  assert.match(dialog, /prog\.removeAttribute\(["']value["']\)/);
  assert.match(dialog, /prog\.setAttribute\(["']value["'],\s*String\(value\)\)/);

  // Progress stays visible around non-worker phases too, so the UI never appears
  // frozen while Mammoth/style extraction is running.
  for (const phase of [
    'מכין את הייבוא...',
    'קורא עיצוב ותוכן מההערות...',
    'מחלץ הערות... (הדפדפן לא קופא)',
    'משמר את עיצוב גוף המסמך...',
  ]) {
    assert.ok(dialog.includes(phase), 'missing Word import progress phase: ' + phase);
  }
});
