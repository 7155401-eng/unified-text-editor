import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../../.github/workflows/v9-spacing-regressions.yml',import.meta.url),'utf8');
const verifier=fs.readFileSync(new URL('../../scripts/v9-unified/verify-build-sources.mjs',import.meta.url),'utf8');

test('V9 build integrity requires the current checkout to remain byte-clean',()=>{
  assert(!workflow.includes('Fetch exact baseline for build comparison'),
    'workflow still depends on building an older PR base');
  assert(!workflow.includes('.v9-baseline'),
    'workflow still carries the historical baseline checkout');
  assert.match(workflow,/git diff --exit-code -- \. ':/);
});

test('build verifier forbids every tracked source rewrite instead of grandfathering baseline rewrites',()=>{
  assert.match(verifier,/Build\/postinstall rewrote tracked source files/);
  assert.match(verifier,/assert\.deepEqual\(\s*changed,\s*\[\]/s);
  assert(!verifier.includes('inheritedBuildRewrites'),
    'verifier still permits inherited build-time source rewriting');
  assert(!verifier.includes('baselineSha'),
    'verifier still depends on an old-source baseline');
});
