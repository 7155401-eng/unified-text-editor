import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../../.github/workflows/v9-spacing-regressions.yml',import.meta.url),'utf8');
const verifier=fs.readFileSync(new URL('../../scripts/v9-unified/verify-build-sources.mjs',import.meta.url),'utf8');

test('V9 build integrity baseline follows the actual PR base',()=>{
  assert.match(workflow,/ref: \$\{\{ github\.event\.pull_request\.base\.sha \|\| 'main' \}\}/);
  assert(!workflow.includes('ref: 82936b7ba1720714f6ae73bda95e9791f6873856'),
    'workflow regressed to historical hard-coded build baseline');
});

test('build verifier derives baseline SHA from the checked-out baseline repository',()=>{
  assert.match(verifier,/const baselineSha = git\(baseline, \['rev-parse', 'HEAD'\]\)\.toString\(\)\.trim\(\)/);
  assert(!/const baselineSha = ['"][0-9a-f]{40}['"]/.test(verifier),
    'verifier regressed to hard-coded baseline SHA');
});
