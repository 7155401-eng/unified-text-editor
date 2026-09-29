import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const core = fs.readFileSync(path.join(root, 'src/vilna_v9.js'), 'utf8');
const scripts = [
  'scripts/apply_v9_limit_full_strip3_one_line_patch.mjs',
  'scripts/apply_v9_column_split_line_edge_guard_patch.mjs',
];
function runPatches(source, selected = scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v9-build-compat-'));
  try {
    fs.mkdirSync(path.join(dir,'src'));
    fs.writeFileSync(path.join(dir,'src/vilna_v9.js'),source);
    for (const s of selected) execFileSync(process.execPath,[path.join(root,s)],{cwd:dir,stdio:'pipe'});
    return fs.readFileSync(path.join(dir,'src/vilna_v9.js'),'utf8');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
const positioned = `strips.map(s => ({
        x: s.x,
        y_start: s.y_start,
        y_end: s.y_end,
        width: s.width,
        lockYStart: s.lockYStart === true,
      })),`;

test('legacy build guards retain measured stream x, boundaries and rich source without rewriting', () => {
  assert.ok(core.includes(positioned));
  assert.ok(core.includes('rich: firstRich,'));
  assert.equal(runPatches(core),core);
  assert.equal(runPatches(runPatches(core)),core);
});

test('build accepts older complete strip metadata without discarding its invariants', () => {
  const legacy = core.replace(positioned,positioned.replace('        x: s.x,\n',''));
  assert.notEqual(legacy,core);
  assert.equal(runPatches(legacy,[scripts[0]]),legacy);
});

test('build still rejects positioned strips missing their end and start lock', () => {
  const broken = core.replace(positioned,positioned
    .replace('        y_end: s.y_end,\n','')
    .replace('        lockYStart: s.lockYStart === true,\n',''));
  assert.notEqual(broken,core);
  assert.throws(() => runPatches(broken,[scripts[0]]));
});

test('rich split build guard still rejects missing continuation metadata', () => {
  const needle = `rich: firstRich,
        runs: firstRuns,
        syntheticContinuationAfter: true,`;
  assert.ok(core.includes(needle));
  const broken = core.replace(needle,needle.replace('syntheticContinuationAfter: true','syntheticContinuationAfter: false'));
  assert.throws(() => runPatches(broken,[scripts[1]]));
});
