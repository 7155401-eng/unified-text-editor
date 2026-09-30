import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const git = (args) => execFileSync('git', args, { cwd: root });

function trackedChanges() {
  return git(['diff','--name-only','-z','--','.'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .filter(file =>
      !file.startsWith('dist/') &&
      !file.startsWith('worker-dist/') &&
      !file.startsWith('test-results/')
    )
    .sort();
}

const changed = trackedChanges();
assert.deepEqual(
  changed,
  [],
  'Build/postinstall rewrote tracked source files: ' + changed.join(', ')
);

const report = {
  headSha: git(['rev-parse','HEAD']).toString().trim(),
  sourceUnchanged: true,
  changedFiles: [],
};

fs.mkdirSync('test-results/v9-unified', { recursive: true });
fs.writeFileSync(
  'test-results/v9-unified/build-source-verification.json',
  JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));
