import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('advanced Word extractor is absent from the startup module graph', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    main,
    /import\s*\{[^}]*openWordExtractor[^}]*\}\s*from\s*["']\.\/word_extractor\/word_extractor\.js["']/
  );
  assert.doesNotMatch(
    main,
    /setupWordExtractor\(paneManager,\s*rerenderPages\)\s*;/
  );
  assert.match(
    main,
    /case\s+["']word-import-streams["'][\s\S]*?await\s+import\(["']\.\/word_extractor\/word_extractor\.js["']\)/
  );
});

test('direct open owns setup so lazy callers cannot forget host refs', async () => {
  const extractor = await readFile(new URL('../../src/word_extractor/word_extractor.js', import.meta.url), 'utf8');
  const open = extractor.match(/export async function openWordExtractor\(paneManager, onLoaded\) \{([\s\S]*?)\n\}/)?.[1] || '';

  const allowPos = open.indexOf('await assertToolAllowed("word-extractor")');
  const setupPos = open.indexOf('setupWordExtractor(paneManager, onLoaded)');
  const openPos = open.indexOf('openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded)');

  assert.ok(allowPos >= 0, 'permission gate must remain');
  assert.ok(setupPos > allowPos, 'setup must happen only after the tool gate allows opening');
  assert.ok(openPos > setupPos, 'setup must happen before the dialog opens');
});

test('legacy openImport keeps using stored setup refs', async () => {
  const extractor = await readFile(new URL('../../src/word_extractor/word_extractor.js', import.meta.url), 'utf8');
  assert.match(
    extractor,
    /export async function openImport\(\)[\s\S]*?openWordExtractorDialogWithOverwriteStyles\(_paneManagerRef, _onLoadedRef\)/
  );
});
