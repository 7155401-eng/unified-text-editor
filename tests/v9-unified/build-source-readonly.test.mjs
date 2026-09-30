import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function text(path) {
  return readFile(new URL('../../' + path, import.meta.url), 'utf8');
}

test('normal install/dev/build lifecycle does not run source-mutating migration patches', async () => {
  const pkg = JSON.parse(await text('package.json'));
  const scripts = pkg.scripts || {};

  assert.equal(scripts.postinstall, undefined);
  assert.equal(scripts.predev, undefined);
  assert.equal(scripts.prebuild, undefined);
  assert.equal(scripts.dev, 'vite --port 5173 --open');
  assert.equal(scripts.build, 'vite build');

  for (const name of ['dev', 'build']) {
    assert.doesNotMatch(scripts[name] || '', /apply_|fix_demo_literal_newline/);
  }

  const vite = await text('vite.config.js');
  assert.doesNotMatch(vite, /await\s+import\([^)]*apply_/);
  assert.doesNotMatch(vite, /const\s+_patches\s*=/);
});

test('former build-time migrations are committed in runtime source', async () => {
  const [
    index,
    gas,
    ui,
    direct,
    aiTools,
    minuteAccess,
  ] = await Promise.all([
    text('index.html'),
    text('src/torah_transcription/torah_transcription_gas.js'),
    text('src/torah_transcription/torah_transcription_ui.js'),
    text('worker/ai_direct.js'),
    text('worker/ai_tools.js'),
    text('worker/minute_access.js'),
  ]);

  assert.match(index, /ravtext-floating-language-switcher-style/);
  assert.match(index, /ravtext-floating-language-switcher-script/);

  assert.match(gas, /RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_GAS_COMPAT/);
  assert.match(gas, /RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_GAS/);

  for (const marker of [
    'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_UI',
    'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_UI',
    'RAVTEXT_PAID_GEMINI_KEY_NOTICE',
    'RAVTEXT_UPLOAD_LIMIT_GUIDANCE_PATCH',
    'RAVTEXT_GOOGLE_DRIVE_PUBLIC_LINK_NOTICE_PATCH',
    'RAVTEXT_FAST_SINGLE_TRANSCRIPTION_PATCH',
  ]) {
    assert.ok(ui.includes(marker), 'missing committed UI migration marker: ' + marker);
  }

  for (const marker of [
    'RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_DIRECT',
    'RAVTEXT_GOOGLE_DRIVE_LINK_NORMALIZATION_PATCH',
    'RAVTEXT_GOOGLE_DRIVE_UPLOAD_HARDENING_PATCH',
    'RAVTEXT_COMPLETE_COPYABLE_DRIVE_ERROR_LOGS',
    'RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_DIRECT',
    'RAVTEXT_GEMINI_503_RETRY_PATCH',
  ]) {
    assert.ok(direct.includes(marker), 'missing committed worker migration marker: ' + marker);
  }

  assert.match(aiTools, /RAVTEXT_LARGE_ELEVENLABS_MULTIPART_PATCH/);
  assert.match(minuteAccess, /RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH/);
});
