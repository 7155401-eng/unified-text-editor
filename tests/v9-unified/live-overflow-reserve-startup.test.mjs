import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('disabled live-overflow reserve is cleared from session and CSS', async () => {
  const data = new Map([
    ['ravtext.layout.overflowReserve.v1', '73'],
    ['ravtext.layout.overflowReserve.v1.iter', '4'],
  ]);
  globalThis.sessionStorage = {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(String(key), String(value)),
    removeItem: key => data.delete(String(key)),
  };
  const css = new Map([['--ravtext-features-overflow-reserve', '73px']]);
  globalThis.document = {
    documentElement: {
      style: {
        setProperty: (key, value) => css.set(String(key), String(value)),
      },
    },
  };

  try {
    const mod = await import('../../src/engine/live_overflow_corrector.js?startup-reset-regression');
    mod.resetLiveOverflowReserve();
    assert.equal(data.has('ravtext.layout.overflowReserve.v1'), false);
    assert.equal(data.has('ravtext.layout.overflowReserve.v1.iter'), false);
    assert.equal(css.get('--ravtext-features-overflow-reserve'), '0px');
  } finally {
    delete globalThis.sessionStorage;
    delete globalThis.document;
  }
});

test('startup never restores the disabled live-overflow reserve', () => {
  const main = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  const bridge = fs.readFileSync(new URL('../../src/engine_bridge.js', import.meta.url), 'utf8');

  assert.match(main, /resetLiveOverflowReserve\(\);/);
  assert.doesNotMatch(main, /bootstrapLiveOverflowReserve\(\);/);
  assert.doesNotMatch(main, /import\s*\{[^}]*bootstrapLiveOverflowReserve/);
  assert.doesNotMatch(bridge, /import\s*\{[^}]*bootstrapLiveOverflowReserve/);

  // The old post-render self-corrector stays disabled. This fix must not
  // accidentally revive the mechanism that originally generated the reserve.
  assert.match(bridge, /const RESURRECTED_POST_RENDER_IS_OFF = true/);
});
