import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('Comparator implementation stays out of the startup static import graph', async () => {
  const main = await source('src/main.js');
  assert.match(
    main,
    /import\s+\{\s*wireComparatorButton\s*\}\s+from\s+"\.\/comparator_tool\/comparator_lazy_wire\.js"/
  );
  assert.doesNotMatch(
    main,
    /^\s*import\s+.*from\s+"\.\/comparator_tool\/comparator\.js"/m
  );
});

test('Comparator lazy wire imports the real tool only from explicit activation', async () => {
  const lazy = await source('src/comparator_tool/comparator_lazy_wire.js');
  assert.doesNotMatch(lazy, /^\s*import\s+.*\.\/comparator\.js/m);
  assert.match(lazy, /_comparatorModulePromise\s*=\s*import\("\.\/comparator\.js"\)/);

  const click = lazy.indexOf('document.addEventListener("click"');
  const load = lazy.indexOf('await loadComparatorModule()');
  assert.ok(click >= 0, 'delegated click handler missing');
  assert.ok(load >= 0, 'dynamic Comparator load missing');
});

test('Comparator lazy wire preserves full and integrated command semantics', async () => {
  const lazy = await source('src/comparator_tool/comparator_lazy_wire.js');
  assert.match(lazy, /data-cmd="open-comparator"/);
  assert.match(lazy, /data-cmd="open-comparator-integrated"/);
  assert.match(lazy, /getAttribute\("data-variant"\)\s*===\s*"integrated"/);
  assert.match(lazy, /openComparator\(\{ variant \}\)/);
  assert.match(lazy, /void openFromButton\(integratedButton, "integrated"\)/);
});

test('Comparator lazy wire protects duplicate activation and restores button state', async () => {
  const lazy = await source('src/comparator_tool/comparator_lazy_wire.js');
  assert.match(lazy, /if \(!button \|\| button\.disabled\) return/);
  assert.match(lazy, /button\.disabled\s*=\s*true/);
  assert.match(lazy, /setAttribute\("aria-busy",\s*"true"\)/);
  assert.match(lazy, /finally\s*\{/);
  assert.match(lazy, /button\.disabled\s*=\s*false/);
  assert.match(lazy, /removeAttribute\("aria-busy"\)/);
  assert.match(lazy, /if \(_wired\) return false/);
});

test('failed Comparator chunk load is retryable', async () => {
  const lazy = await source('src/comparator_tool/comparator_lazy_wire.js');
  const loader = lazy.match(/async function loadComparatorModule\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loader, /\.catch\(\(error\) => \{/);
  assert.match(loader, /_comparatorModulePromise\s*=\s*null/);
  assert.match(loader, /throw error/);
});
