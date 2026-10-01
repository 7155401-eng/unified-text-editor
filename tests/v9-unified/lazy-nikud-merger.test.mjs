import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('Nikud Merger implementation stays out of the startup static import graph', async () => {
  const main = await source('src/main.js');
  assert.match(
    main,
    /import\s+\{\s*wireNikudMergerButton\s*\}\s+from\s+"\.\/nikud_merger_lazy_wire\.js"/
  );
  assert.doesNotMatch(
    main,
    /^\s*import\s+.*from\s+"\.\/nikud_merger\/nikud_merger\.js"/m
  );
});

test('lightweight wire loads Nikud Merger only from the explicit click path', async () => {
  const lazy = await source('src/nikud_merger_lazy_wire.js');
  assert.doesNotMatch(
    lazy,
    /^\s*import\s+.*nikud_merger\/nikud_merger\.js/m
  );
  assert.match(
    lazy,
    /_nikudMergerModulePromise\s*=\s*import\("\.\/nikud_merger\/nikud_merger\.js"\)/
  );

  const click = lazy.indexOf('btn.addEventListener("click"');
  const dynamic = lazy.indexOf('await loadNikudMergerModule()', click);
  const open = lazy.indexOf('await openNikudMerger({ cleanText })', click);
  assert.ok(click >= 0, 'click handler missing');
  assert.ok(dynamic > click, 'module must load from click handler');
  assert.ok(open > dynamic, 'tool must open only after module load');
});

test('lazy Nikud Merger wire preserves selection and button safety semantics', async () => {
  const lazy = await source('src/nikud_merger_lazy_wire.js');

  assert.match(lazy, /id\s*=\s*"btn-nikud-merger"/);
  assert.match(lazy, /textBetween\(from, to, "\\n"\)/);
  assert.match(lazy, /btn\.disabled\s*=\s*true/);
  assert.match(lazy, /setAttribute\("aria-busy",\s*"true"\)/);
  assert.match(lazy, /finally\s*\{/);
  assert.match(lazy, /btn\.disabled\s*=\s*false/);
  assert.match(lazy, /removeAttribute\("aria-busy"\)/);
});

test('failed Nikud Merger chunk load is retryable', async () => {
  const lazy = await source('src/nikud_merger_lazy_wire.js');
  const loader = lazy.match(/async function loadNikudMergerModule\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(loader, /\.catch\(\(error\) => \{/);
  assert.match(loader, /_nikudMergerModulePromise\s*=\s*null/);
  assert.match(loader, /throw error/);
});
