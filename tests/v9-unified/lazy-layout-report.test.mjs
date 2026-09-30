import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('main wires layout analysis through the lightweight loader only', async () => {
  const main = await source('src/main.js');
  assert.match(main, /import\s+\{\s*wireLayoutAnalysisReport\s*\}\s+from\s+"\.\/layout_analysis_lazy_wire\.js"/);
  assert.doesNotMatch(main, /from\s+"\.\/layout_analysis_report\.js"/);
  assert.match(main, /wireLayoutAnalysisReport\(pagesContainer\)/);
});

test('layout-report implementation loads only from the explicit click path', async () => {
  const lazy = await source('src/layout_analysis_lazy_wire.js');
  assert.doesNotMatch(lazy, /^\s*import\s+.*layout_analysis_report\.js/m);
  assert.match(lazy, /addEventListener\("click",\s*async\s*\(\)\s*=>\s*\{[\s\S]*?await import\("\.\/layout_analysis_report\.js"\)/);
  assert.match(lazy, /querySelectorAll.*PAGE_SELECTOR/);
  assert.match(lazy, /btn\.disabled\s*=\s*true/);
  assert.match(lazy, /setAttribute\("aria-busy",\s*"true"\)/);
  assert.match(lazy, /openLayoutAnalysisReport\(pagesContainer\)/);
  assert.match(lazy, /finally\s*\{/);
  assert.match(lazy, /btn\.disabled\s*=\s*false/);
  assert.match(lazy, /removeAttribute\("aria-busy"\)/);
});
