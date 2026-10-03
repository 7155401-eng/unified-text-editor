import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('live-render build step is verifier-only and never rewrites application source', () => {
  const verifier = read('scripts/apply_live_render_default_off_patch.mjs');
  assert(!verifier.includes('writeFileSync('), 'verifier still writes source files');
  assert(!verifier.includes('source.replace('), 'verifier still mutates source through replace');
  assert(!verifier.includes('replaceRequired('), 'legacy source patcher is still active');
  assert(!verifier.includes('LIVE_TOGGLE_HELPER'), 'legacy injected live-render button helper is still embedded in build step');
  assert.match(verifier, /direct-source policy \+ UI verified/);
});

test('main live-render gate remains opt-in and owns the direct UI toggle', () => {
  const source = read('src/main.js');
  assert.match(source, /LIVE_RENDER_DEFAULT_OFF_IN_SOURCE/);
  assert.match(source, /LIVE_RENDER_CHOICE_KEY = LIVE_RENDER_KEY \+ "\.userChoice"/);
  assert.match(source, /localStorage\.getItem\(LIVE_RENDER_CHOICE_KEY\) !== "1"\) return false/);
  assert.match(source, /return localStorage\.getItem\(LIVE_RENDER_KEY\) === "1"/);
  assert.match(source, /function setupLiveRenderToggle\(\)/);
  assert.match(source, /input\.id = "live-render-toggle"/);
  assert.match(source, /input\.checked = isLiveRenderEnabled\(\)/);
  assert.match(source, /localStorage\.setItem\(LIVE_RENDER_CHOICE_KEY, "1"\)/);
  assert.match(source, /localStorage\.setItem\(LIVE_RENDER_KEY, input\.checked \? "1" : "0"\)/);
});

test('pause controls use the same opt-in policy without inventing userChoice on resume', () => {
  const source = read('src/render_pause_controls.js');
  assert.match(source, /LIVE_RENDER_DEFAULT_OFF_IN_SOURCE/);
  assert.match(source, /LIVE_CHOICE_KEY = LIVE_KEY \+ "\.userChoice"/);
  assert.match(source, /localStorage\.getItem\(LIVE_CHOICE_KEY\) !== "1"\) return false/);
  assert.match(source, /return localStorage\.getItem\(LIVE_KEY\) === "1"/);
  assert.match(source, /if \(options\.userChoice\) localStorage\.setItem\(LIVE_CHOICE_KEY, "1"\)/);
  assert.match(source, /setLiveEnabled\(prev === "0" \? false : true\)/);
});


test('empty preview render CTA follows the shared render-running state', () => {
  const source = read('src/render_pause_controls.js');
  assert.match(source, /get emptyHintRender\(\)/);
  assert.match(source, /get emptyHintBuilding\(\)/);
  assert.match(source, /const emptyHintButton = \(\) => byId\("empty-hint-render"\)/);
  assert.match(source, /emptyBtn\.classList\.toggle\("render-running", state\.running\)/);
  assert.match(source, /setAttr\(emptyBtn, "aria-busy", state\.running \? "true" : "false"\)/);
  assert.match(source, /emptyBtn\.disabled = state\.running/);
  assert.match(source, /setText\(emptyBtn, state\.running \? T\.emptyHintBuilding : T\.emptyHintRender\)/);
});
