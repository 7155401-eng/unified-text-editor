import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd();
const baseline = path.resolve(process.argv[2] || '.v9-baseline');
const baselineSha = '82936b7ba1720714f6ae73bda95e9791f6873856';
const git = (cwd, args) => execFileSync('git', args, { cwd });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const changes = cwd => git(cwd, ['diff', '--name-only', '-z', '--', 'src', 'scripts']).toString().split('\0').filter(Boolean).sort();
assert.equal(git(baseline, ['rev-parse', 'HEAD']).toString().trim(), baselineSha);
const current = changes(root), inherited = changes(baseline);
// Do not hide a source rewrite by ignoring an arbitrary directory. Every
// mutation must also occur in the pinned unmodified baseline, with byte-identical
// input and byte-identical output. Refactored files cannot pass this exception.
assert.deepEqual(current, inherited, 'Build introduced a new source rewrite');
const evidence = current.map(file => {
  const before = git(root, ['show', `HEAD:${file}`]);
  const baseBefore = git(baseline, ['show', `HEAD:${file}`]);
  const after = fs.readFileSync(path.join(root, file));
  const baseAfter = fs.readFileSync(path.join(baseline, file));
  assert.ok(before.equals(baseBefore), `Build rewrote a refactored file: ${file}`);
  assert.ok(after.equals(baseAfter), `Build rewrite differs from baseline: ${file}`);
  return { file, before: digest(before), after: digest(after), sameAsBaseline: true };
});
const report = { baselineSha, headSha: git(root, ['rev-parse', 'HEAD']).toString().trim(),
  refactoredSourceUnchanged: true, inheritedBuildRewrites: evidence };
fs.mkdirSync('test-results/v9-unified', { recursive: true });
fs.writeFileSync('test-results/v9-unified/build-source-verification.json', JSON.stringify(report, null, 2));
fs.writeFileSync('test-results/v9-unified/inherited-build-rewrites.diff', git(root, ['diff', '--', 'src', 'scripts']));
console.log(JSON.stringify(report, null, 2));
