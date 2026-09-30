import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('CSS inject panel is not part of the startup static import graph', async () => {
  const main = await source('src/main.js');
  assert.doesNotMatch(main, /^\s*import\s+.*from\s+"\.\/css_inject_panel\.js"/m);
  assert.match(
    main,
    /setTimeout\(async \(\) => \{[\s\S]*?await import\("\.\/css_inject_panel\.js"\)[\s\S]*?setupCssInjectPanel\(\)[\s\S]*?\}, 500\);/
  );
});

test('deferred CSS panel load keeps startup resilient on chunk failure', async () => {
  const main = await source('src/main.js');
  const at = main.indexOf('await import("./css_inject_panel.js")');
  assert.ok(at >= 0, 'deferred CSS-panel import missing');
  const block = main.slice(Math.max(0, at - 180), at + 520);
  assert.match(block, /try\s*\{/);
  assert.match(block, /catch\s*\(err\)/);
  assert.match(block, /console\.warn\("\[css-inject\] deferred module load failed"/);
});
