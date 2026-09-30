import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('chapter splitter stays out of the editor startup graph', async () => {
  const main = await source('src/main.js');
  assert.doesNotMatch(main, /from\s+["']\.\/document_chapter_splitter\.js["']/);
  assert.doesNotMatch(main, /wireChapterSplitter\(paneManager\)/);
});

test('Word extractor owns the on-demand chapter-splitter boundary', async () => {
  const extractor = await source('src/word_extractor/word_extractor.js');
  assert.doesNotMatch(extractor, /^\s*import\s+.*document_chapter_splitter\.js/m);
  assert.match(extractor, /_chapterSplitterModulePromise\s*=\s*import\("\.\.\/document_chapter_splitter\.js"\)/);
  assert.match(extractor, /const \{ wireChapterSplitter \} = await _chapterSplitterModulePromise/);
  assert.match(extractor, /wireChapterSplitter\(paneManager\)/);
});

test('both Word open paths wire chapters before opening the dialog', async () => {
  const extractor = await source('src/word_extractor/word_extractor.js');

  const modern = extractor.match(/export async function openWordExtractor\(paneManager, onLoaded\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const modernGate = modern.indexOf('await assertToolAllowed("word-extractor")');
  const modernSetup = modern.indexOf('setupWordExtractor(paneManager, onLoaded)');
  const modernChapter = modern.indexOf('await ensureChapterSplitter(paneManager)');
  const modernDialog = modern.indexOf('openWordExtractorDialogWithOverwriteStyles(paneManager, onLoaded)');
  assert.ok(modernGate >= 0);
  assert.ok(modernSetup > modernGate);
  assert.ok(modernChapter > modernSetup);
  assert.ok(modernDialog > modernChapter);

  const legacy = extractor.match(/export async function openImport\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const legacyGate = legacy.indexOf('await assertToolAllowed("word-extractor")');
  const legacyChapter = legacy.indexOf('await ensureChapterSplitter(_paneManagerRef)');
  const legacyDialog = legacy.indexOf('openWordExtractorDialogWithOverwriteStyles(_paneManagerRef, _onLoadedRef)');
  assert.ok(legacyGate >= 0);
  assert.ok(legacyChapter > legacyGate);
  assert.ok(legacyDialog > legacyChapter);
});

test('chapter chunk failure is isolated from normal Word import and retryable', async () => {
  const extractor = await source('src/word_extractor/word_extractor.js');
  const start = extractor.indexOf('async function ensureChapterSplitter');
  assert.ok(start >= 0);
  const block = extractor.slice(start, start + 1200);
  assert.match(block, /catch\s*\(err\)/);
  assert.match(block, /_chapterSplitterModulePromise\s*=\s*null/);
  assert.match(block, /console\.warn\("\[word_extractor\] chapter splitter lazy load failed:"/);
  assert.match(block, /return false/);
});
