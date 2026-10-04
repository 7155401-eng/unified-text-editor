import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('startup keeps help center and find/replace implementations out of main static graph', async () => {
  const main = await source('src/main.js');

  assert.doesNotMatch(main, /from\s+["']\.\/help_center\.js["']/);
  assert.doesNotMatch(main, /from\s+["']\.\/find_replace\.js["']/);
  assert.match(main, /from\s+["']\.\/help_center_lazy_wire\.js["']/);
  assert.match(main, /from\s+["']\.\/find_replace_lazy_wire\.js["']/);
  assert.match(main, /wireHelpCenterLazy\(\)/);
  assert.match(main, /wireFindReplaceLazy\(\)/);
});

test('help center lazy wire imports implementation only after button activation and can retry failures', async () => {
  const lazy = await source('src/help_center_lazy_wire.js');

  assert.match(lazy, /import\(["']\.\/help_center\.js["']\)/);
  assert.match(lazy, /addEventListener\(["']click["']/);
  assert.match(lazy, /helpModulePromise\s*=\s*null;[\s\S]*?throw error/);
  assert.match(lazy, /openHelpCenter\(\)/);
});

test('find/replace lazy wire hands Ctrl+F to the full module exactly once after loading', async () => {
  const lazy = await source('src/find_replace_lazy_wire.js');

  assert.match(lazy, /import\(["']\.\/find_replace\.js["']\)/);
  assert.match(lazy, /event\.preventDefault\(\)/);
  assert.match(lazy, /window\.removeEventListener\(["']keydown["'],\s*onFirstFind\)/);
  assert.match(lazy, /mod\.setupFindReplace\(\)/);
  assert.match(lazy, /mod\.openFindReplace\(\)/);

  const removeAt = lazy.indexOf('window.removeEventListener("keydown", onFirstFind)');
  const setupAt = lazy.indexOf('mod.setupFindReplace()');
  assert.ok(removeAt >= 0 && setupAt > removeAt, 'lazy key handler must be removed before full handler is installed');
});
