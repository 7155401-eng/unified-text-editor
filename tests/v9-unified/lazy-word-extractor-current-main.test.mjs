import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('advanced Word extractor stays out of the startup graph', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    main,
    /import\s*\{[^}]*openWordExtractor[^}]*\}\s*from\s*["']\.\/word_extractor\/word_extractor\.js["']/
  );
  assert.doesNotMatch(main, /setupWordExtractor\(paneManager,\s*rerenderPages\)\s*;/);
  assert.match(
    main,
    /case\s+["']word-import-streams["'][\s\S]*?await\s+import\(["']\.\/word_extractor\/word_extractor\.js["']\)/
  );
});

test('openWordExtractor owns required host setup before opening', async () => {
  const extractor = await readFile(new URL('../../src/word_extractor/word_extractor.js', import.meta.url), 'utf8');
  const open = extractor.match(/export async function openWordExtractor\(paneManager, onLoaded\) \{([\s\S]*?)\n\}/)?.[1] || '';

  const gate = open.indexOf('await assertToolAllowed("word-extractor")');
  const setup = open.indexOf('setupWordExtractor(paneManager, onLoaded)');
  const dialog = open.indexOf('openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded)');

  assert.ok(gate >= 0, 'permission gate missing');
  assert.ok(setup > gate, 'host setup must happen after permission gate');
  assert.ok(dialog > setup, 'host setup must happen before dialog open');
});

test('legacy openImport remains compatible with stored setup refs', async () => {
  const extractor = await readFile(new URL('../../src/word_extractor/word_extractor.js', import.meta.url), 'utf8');
  assert.match(
    extractor,
    /export async function openImport\(\)[\s\S]*?openWordExtractorDialogWithOverwriteStyles\(_paneManagerRef, _onLoadedRef\)/
  );
});
