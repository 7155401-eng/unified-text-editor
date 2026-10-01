import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const root = process.cwd();
const baseline = path.resolve(process.argv[2] || '.v9-baseline');

export function resolveGitBinary(env = process.env) {
  const names = process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git'] : ['git'];
  const candidates = [];
  for (const dir of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(dir, name));
  }
  if (process.platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(base, 'Git', 'cmd', 'git.exe'));
      candidates.push(path.join(base, 'Git', 'bin', 'git.exe'));
    }
  } else {
    candidates.push('/usr/bin/git', '/usr/local/bin/git', '/opt/homebrew/bin/git');
  }
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }
  return 'git';
}

const gitBinary = resolveGitBinary();
const git = (cwd, args) => {
  try {
    return execFileSync(gitBinary, args, { cwd, env: process.env });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Git executable was not found. resolved=${gitBinary} PATH=${process.env.PATH || ''}`,
        { cause: error }
      );
    }
    throw error;
  }
};
const baselineSha = git(baseline, ['rev-parse', 'HEAD']).toString().trim();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const changes = cwd => git(cwd, ['diff', '--name-only', '-z', '--', 'src', 'scripts']).toString().split('\0').filter(Boolean).sort();
const current = changes(root), inherited = changes(baseline);
// Do not hide a source rewrite by ignoring an arbitrary directory. Every
// remaining mutation must occur in the pinned unmodified baseline, with
// byte-identical input and output. Refactored files cannot pass this exception.
// Eliminating a baseline rewrite is allowed; adding a new one is not.
assert.deepEqual(current.filter(file => !inherited.includes(file)), [],
  'Build introduced a new source rewrite');
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
  refactoredSourceUnchanged: true, inheritedBuildRewrites: evidence,
  eliminatedBaselineRewrites: inherited.filter(file => !current.includes(file)) };
fs.mkdirSync('test-results/v9-unified', { recursive: true });
fs.writeFileSync('test-results/v9-unified/build-source-verification.json', JSON.stringify(report, null, 2));
fs.writeFileSync('test-results/v9-unified/inherited-build-rewrites.diff', git(root, ['diff', '--', 'src', 'scripts']));
console.log(JSON.stringify(report, null, 2));
