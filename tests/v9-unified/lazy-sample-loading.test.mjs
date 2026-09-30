import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('large Shulchan starter sample stays out of the entry module', async () => {
  const source = await readFile(new URL('../../src/sample_loader.js', import.meta.url), 'utf8');

  assert.doesNotMatch(
    source,
    /import\s+\w+\s+from\s+["']\.\.\/samples\/sample-shulchan\.txt\?raw["']/
  );
  assert.match(
    source,
    /import\(["']\.\.\/samples\/sample-shulchan\.txt\?raw["']\)/
  );
  assert.match(
    source,
    /export\s+async\s+function\s+loadStaticStarterSample\([^)]+\)[\s\S]*?await\s+loadSampleText\(["']shulchan["']\)/
  );
});

test('default sample routing preserves historical Hebrew/Shulchan content identity', async () => {
  const source = await readFile(new URL('../../src/sample_loader.js', import.meta.url), 'utf8');

  // Talmud remains its own lazy sample; every other historical sample name
  // continues to resolve to Shulchan rather than silently changing content.
  assert.match(source, /if\s*\(name\s*===\s*["']talmud["']\)[\s\S]*?sample-talmud\.txt\?raw/);
  assert.match(source, /return\s*\(await\s+import\(["']\.\.\/samples\/sample-shulchan\.txt\?raw["']\)\)\.default/);
});
