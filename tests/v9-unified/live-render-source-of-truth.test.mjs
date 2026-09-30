import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('live-render build step is verifier-only and never rewrites application source', () => {
  const verifier = read('scripts/apply_live_render_default_off_patch.mjs');
  assert(!verifier.includes('writeFileSync('), 'verifier still writes source files');
  assert(!verifier.includes('source.replace('), 'verifier still mutates source through replace');
  assert(!verifier.includes('replaceRequired('), 'legacy source patcher is still active');
  assert.match(verifier, /direct-source policy verified/);
});

test('main live-render gate remains opt-in through explicit userChoice', () => {
  const source = read('src/main.js');
  assert.match(source, /LIVE_RENDER_DEFAULT_OFF_IN_SOURCE/);
  assert.match(source, /LIVE_RENDER_CHOICE_KEY = LIVE_RENDER_KEY \+ "\.userChoice"/);
  assert.match(source, /localStorage\.getItem\(LIVE_RENDER_CHOICE_KEY\) !== "1"\) return false/);
  assert.match(source, /localStorage\.getItem\(LIVE_RENDER_KEY\) === "1"/);
});

test('pause controls use the same opt-in live-render policy', () => {
  const source = read('src/render_pause_controls.js');
  assert.match(source, /LIVE_RENDER_DEFAULT_OFF_IN_SOURCE/);
  assert.match(source, /LIVE_CHOICE_KEY = LIVE_KEY \+ "\.userChoice"/);
  assert.match(source, /localStorage\.getItem\(LIVE_CHOICE_KEY\) !== "1"\) return false/);
  assert.match(source, /if \(options\.userChoice\) localStorage\.setItem\(LIVE_CHOICE_KEY, "1"\)/);
});
