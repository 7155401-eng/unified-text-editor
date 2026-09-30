import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('advanced Word extractor stays out of the startup module graph', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    main,
    /import\s*\{[^}]*openWordExtractor[^}]*\}\s*from\s*["']\.\/word_extractor\/word_extractor\.js["']/
  );
  assert.doesNotMatch(
    main,
    /import\s*\{[^}]*setupWordExtractor[^}]*\}\s*from\s*["']\.\/word_extractor\/word_extractor\.js["']/
  );
  assert.match(
    main,
    /case\s+["']word-import-streams["'][\s\S]*?await\s+import\(["']\.\/word_extractor\/word_extractor\.js["']\)/
  );
});

test('lazy Word open preserves startup setup semantics at click time', async () => {
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');
  const extractor = await readFile(new URL('../../src/word_extractor/word_extractor.js', import.meta.url), 'utf8');

  const block = main.match(/case\s+["']word-import-streams["']\s*:\s*\{([\s\S]*?)\n\s*break;\n\s*\}/)?.[1] || '';
  const setupPos = block.indexOf('wordExtractor.setupWordExtractor(paneManager, rerenderPages)');
  const openPos = block.indexOf('wordExtractor.openWordExtractor(paneManager, rerenderPages)');
  assert.ok(setupPos >= 0, 'lazy click path must still configure paneManager/onLoaded refs');
  assert.ok(openPos > setupPos, 'setup must happen before opening the extractor');

  assert.match(extractor, /export function setupWordExtractor\([\s\S]*?_paneManagerRef\s*=\s*paneManager/);
  assert.match(extractor, /function openWordExtractorDialogWithOverwriteStyles[\s\S]*?installConfirmCapture\(\)/);
});
