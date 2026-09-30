import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('main wires Text Compare through the lightweight loader only', async () => {
  const main = await source('src/main.js');

  assert.match(
    main,
    /import\s+\{\s*wireTextComparePro\s*\}\s+from\s+"\.\/text_compare_pro\/text_compare_lazy_wire\.js"/
  );
  assert.doesNotMatch(
    main,
    /from\s+"\.\/text_compare_pro\/text_compare_pro\.js"/
  );
  assert.match(main, /wireTextComparePro\(paneManager\)/);
});

test('Text Compare full implementation is imported only inside the click path', async () => {
  const lazy = await source('src/text_compare_pro/text_compare_lazy_wire.js');

  assert.doesNotMatch(lazy, /^\s*import\s+.*text_compare_pro\.js/m);
  assert.match(
    lazy,
    /addEventListener\("click",[\s\S]*?await import\("\.\/text_compare_pro\.js"\)/
  );
  assert.match(lazy, /window\.__tcpPaneManager\s*=\s*paneManager/);
  assert.match(lazy, /btn\.dataset\.tcpWired/);
  assert.match(lazy, /btn\.disabled\s*=\s*true/);
  assert.match(lazy, /setAttribute\("aria-busy",\s*"true"\)/);
  assert.match(lazy, /removeAttribute\("aria-busy"\)/);
  assert.match(lazy, /openModal\(\{\s*prefillFromActive:\s*true\s*\}\)/);
});
