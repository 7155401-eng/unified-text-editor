import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('Styles I/O stays out of the startup static import graph', async () => {
  const main = await source('src/main.js');
  assert.doesNotMatch(main, /^\s*import\s+.*from\s+"\.\/styles_io\.js"/m);
  assert.match(main, /case "styles-io": \{[\s\S]*?await import\("\.\/styles_io\.js"\)/);
});

test('Styles I/O lazy command guards duplicate clicks and restores button state', async () => {
  const main = await source('src/main.js');
  const start = main.indexOf('case "styles-io": {');
  assert.ok(start >= 0, 'styles-io command case missing');
  const block = main.slice(start, start + 1200);
  assert.match(block, /disabled\s*=\s*true/);
  assert.match(block, /setAttribute\("aria-busy",\s*"true"\)/);
  assert.match(block, /openStylesIODialog\(\)/);
  assert.match(block, /finally\s*\{/);
  assert.match(block, /disabled\s*=\s*false/);
  assert.match(block, /removeAttribute\("aria-busy"\)/);
});
