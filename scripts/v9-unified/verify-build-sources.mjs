import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd();
const baseline = path.resolve(process.argv[2] || '.v9-baseline');
const git = (cwd, args) => execFileSync('git', args, { cwd });
const baselineSha = git(baseline, ['rev-parse', 'HEAD']).toString().trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

const trackedSourcePathspec = [
  '.',
  ':(exclude)dist/**',
  ':(exclude)worker-dist/**',
  ':(exclude)test-results/**',
  ':(exclude).v9-baseline/**',
];
const changes = cwd => git(cwd, ['diff', '--name-only', '-z', '--', ...trackedSourcePathspec])
  .toString().split('\0').filter(Boolean).sort();

const current = changes(root);
const inherited = changes(baseline);

// A production build must be read-only with respect to every tracked source
// file. Generated outputs live under dist/worker-dist and are excluded above.
assert.deepEqual(
  current,
  [],
  'Build rewrote tracked source files: ' + current.join(', ')
);

const baselineEvidence = inherited.map(file => {
  const before = git(baseline, ['show', `HEAD:${file}`]);
  const after = fs.readFileSync(path.join(baseline, file));
  return {
    file,
    before: digest(before),
    after: digest(after),
  };
});

const report = {
  baselineSha,
  headSha: git(root, ['rev-parse', 'HEAD']).toString().trim(),
  trackedSourceUnchanged: true,
  inheritedBaselineBuildRewrites: baselineEvidence,
  eliminatedBaselineRewrites: inherited,
};

fs.mkdirSync('test-results/v9-unified', { recursive: true });
fs.writeFileSync(
  'test-results/v9-unified/build-source-verification.json',
  JSON.stringify(report, null, 2)
);
fs.writeFileSync(
  'test-results/v9-unified/inherited-build-rewrites.diff',
  git(baseline, ['diff', '--', ...trackedSourcePathspec])
);
console.log(JSON.stringify(report, null, 2));
