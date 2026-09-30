import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  let failWrites = false;
  return {
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) {
      if (failWrites) throw new Error('simulated write failure');
      data.set(String(k), String(v));
    },
    removeItem(k) { data.delete(String(k)); },
    setFailWrites(v) { failWrites = !!v; },
  };
}

function fakeDocument() {
  const values = new Map();
  return {
    documentElement: {
      style: {
        setProperty(k, v) { values.set(k, v); },
        getPropertyValue(k) { return values.get(k) || ''; },
      },
    },
  };
}

test('page-settings cache detects same-tab writes and preserves runtime fallbacks', async () => {
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;

  const storage = fakeStorage({
    'ravtext.pageSettings.v1': JSON.stringify({ top: 10, right: 20, bottom: 30, left: 40 }),
    'ravtext.output.includeBackground': '0',
  });
  globalThis.localStorage = storage;
  globalThis.window = { __RAVTEXT_STORAGE_DISABLED__: false };
  globalThis.document = fakeDocument();

  const originalParse = JSON.parse;
  let parseCount = 0;

  try {
    const mod = await import('../../src/page_settings.js?cache-regression=20260930');
    JSON.parse = function (...args) {
      parseCount += 1;
      return originalParse.apply(this, args);
    };

    assert.deepEqual(mod.getPageMargins(), { top: 10, right: 20, bottom: 30, left: 40 });
    assert.deepEqual(mod.getPageMargins(), { top: 10, right: 20, bottom: 30, left: 40 });
    assert.equal(parseCount, 1, 'unchanged page settings reparsed');

    storage.setItem('ravtext.pageSettings.v1', JSON.stringify({ top: 33, right: 21, bottom: 31, left: 41 }));
    assert.equal(mod.getPageMargins().top, 33, 'same-tab raw margin write was not detected');
    assert.equal(parseCount, 2);

    mod.setPageMargins({ top: 44, right: 22, bottom: 32, left: 42 });
    assert.equal(mod.getPageMargins().top, 44);
    assert.equal(parseCount, 2, 'successful save did not update margin cache atomically');

    storage.setItem('ravtext.pageSettings.v1', JSON.stringify({ top: 55, right: 23, bottom: 33, left: 43 }));
    assert.equal(mod.getPageMargins().top, 55);
    assert.equal(parseCount, 3);

    assert.equal(mod.isOutputBackgroundEnabled(), false);
    storage.setItem('ravtext.output.includeBackground', '1');
    assert.equal(mod.isOutputBackgroundEnabled(), true, 'same-tab output-background write was not detected');

    globalThis.window.__RAVTEXT_STORAGE_DISABLED__ = true;
    mod.setPageMargins({ top: 66, right: 24, bottom: 34, left: 44 });
    assert.equal(mod.getPageMargins().top, 66, 'storage-disabled runtime margin was not preserved');
    assert.equal(JSON.parse(storage.getItem('ravtext.pageSettings.v1')).top, 55,
      'storage-disabled margin unexpectedly persisted');

    mod.setOutputBackgroundEnabled(false);
    assert.equal(mod.isOutputBackgroundEnabled(), false, 'storage-disabled output runtime override was not preserved');
    assert.equal(storage.getItem('ravtext.output.includeBackground'), '1',
      'storage-disabled output background unexpectedly persisted');

    globalThis.window.__RAVTEXT_STORAGE_DISABLED__ = false;
    storage.setFailWrites(true);
    mod.setPageMargins({ top: 77, right: 25, bottom: 35, left: 45 });
    assert.equal(mod.getPageMargins().top, 77, 'failed write discarded runtime margin');
    storage.setFailWrites(false);

    mod.setPageMargins({ top: 80, right: 26, bottom: 36, left: 46 });
    assert.equal(JSON.parse(storage.getItem('ravtext.pageSettings.v1')).top, 80);
    storage.setItem('ravtext.pageSettings.v1', JSON.stringify({ top: 22, right: 27, bottom: 37, left: 47 }));
    assert.equal(mod.getPageMargins().top, 22, 'cache stayed ephemeral after a later successful save');
  } finally {
    JSON.parse = originalParse;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
