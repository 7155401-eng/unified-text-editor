import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const vite = fs.readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
const verifier = fs.readFileSync(new URL('../../scripts/v9-unified/verify-build-sources.mjs', import.meta.url), 'utf8');

test('npm build and dev no longer run source-mutating migration patches', () => {
  assert.equal(pkg.scripts.build, 'vite build');
  assert.equal(pkg.scripts.dev, 'vite --port 5173 --open');
  assert.equal(pkg.scripts.postinstall, 'node scripts/verify_integrated_source_state.mjs');
  assert.equal(pkg.scripts.prebuild, undefined);
  assert.equal(pkg.scripts.predev, undefined);
  for (const key of ['build', 'dev', 'postinstall']) {
    assert.doesNotMatch(pkg.scripts[key], /apply_[\w-]+_patch\.mjs/);
  }
});

test('Vite config never executes migration patch scripts', () => {
  assert.doesNotMatch(vite, /const\s+_patches\s*=/);
  assert.doesNotMatch(vite, /await\s+import\(p\)/);
  assert.match(vite, /Build configuration must never mutate tracked source files/);
});

test('build verifier covers all tracked source, not only src/scripts', () => {
  assert.match(verifier, /const trackedSourcePathspec = \[/);
  assert.match(verifier, /'\.'[,\n]/);
  assert.match(verifier, /:\(exclude\)dist\/\*\*/);
  assert.match(verifier, /:\(exclude\)worker-dist\/\*\*/);
  assert.match(verifier, /assert\.deepEqual\(\s*current,\s*\[\]/s);
  assert.match(verifier, /Build rewrote tracked source files/);
});

test('production-only build features are committed to source before build starts', () => {
  const required = new Map([
    ['../../index.html', ['ravtext-floating-language-switcher-style', 'ravtext-floating-language-switcher-script']],
    ['../../worker/ai_tools.js', ['RAVTEXT_LARGE_ELEVENLABS_MULTIPART_PATCH']],
    ['../../worker/minute_access.js', ['RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH']],
    ['../../worker/ai_direct.js', ['RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_DIRECT', 'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_DIRECT']],
    ['../../src/torah_transcription/torah_transcription_gas.js', ['RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS_COMPAT']],
    ['../../src/torah_transcription/torah_transcription_ui.js', ['RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_UI', 'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_UI']],
  ]);
  for (const [rel, tokens] of required) {
    const source = fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
    for (const token of tokens) assert.ok(source.includes(token), rel + ' missing ' + token);
  }
});
