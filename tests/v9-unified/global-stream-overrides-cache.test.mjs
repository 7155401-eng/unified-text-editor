import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function fakeStorage(initialRaw) {
  let raw = initialRaw == null ? null : String(initialRaw);
  return {
    getItem(key) {
      return key === 'ravtext.globalStreamOverrides.v1' ? raw : null;
    },
    setItem(key, value) {
      if (key === 'ravtext.globalStreamOverrides.v1') raw = String(value);
    },
    setRaw(value) { raw = value == null ? null : String(value); },
    getRaw() { return raw; },
  };
}

test('global stream override snapshot caches normalization and notices same-tab raw writes', async () => {
  const previousStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  const storage = fakeStorage(JSON.stringify({
    cols: { enabled: true, value: 2 },
    titleShow: { enabled: true, value: false },
  }));

  globalThis.localStorage = storage;
  globalThis.window = {
    localStorage: storage,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    __STREAM_SETTINGS__: {},
  };

  try {
    const mod = await import('../../src/original_stream_columns.js');
    const nativeParse = JSON.parse;
    let parseCount = 0;
    JSON.parse = (...args) => {
      parseCount += 1;
      return nativeParse(...args);
    };

    try {
      const first = mod.getGlobalStreamOverridesSnapshot();
      assert.equal(first.cols.enabled, true);
      assert.equal(first.cols.value, 2);
      assert.equal(first.titleShow.value, false);
      assert(Object.isFrozen(first), 'override snapshot must be immutable');
      assert(Object.isFrozen(first.cols), 'override records must be immutable');

      for (let i = 0; i < 1000; i++) {
        assert.strictEqual(mod.getGlobalStreamOverridesSnapshot(), first);
      }
      assert.equal(parseCount, 1, 'unchanged raw storage was reparsed');

      const editable = mod.loadGlobalStreamOverrides();
      editable.cols.enabled = false;
      editable.cols.value = 6;
      assert.equal(first.cols.enabled, true);
      assert.equal(first.cols.value, 2);
      assert.equal(mod.loadGlobalStreamOverrides().cols.value, 2,
        'mutable UI copy poisoned the cached snapshot');

      storage.setRaw(JSON.stringify({
        cols: { enabled: true, value: 4 },
        titleShow: { enabled: false, value: true },
      }));
      const afterDirectWrite = mod.getGlobalStreamOverridesSnapshot();
      assert.notStrictEqual(afterDirectWrite, first);
      assert.equal(afterDirectWrite.cols.value, 4);
      assert.equal(afterDirectWrite.titleShow.enabled, false);
      assert.equal(parseCount, 2, 'same-tab raw storage change did not refresh cache');

      storage.setRaw('{bad json');
      const invalid = mod.getGlobalStreamOverridesSnapshot();
      assert.equal(invalid.cols.enabled, false);
      assert.equal(invalid.cols.value, 1);
      assert.equal(parseCount, 3);
      assert.strictEqual(mod.getGlobalStreamOverridesSnapshot(), invalid);
      assert.equal(parseCount, 3, 'same invalid raw value reparsed repeatedly');

      const beforeSaveParse = parseCount;
      mod.saveGlobalStreamOverrides({
        cols: { enabled: true, value: 5 },
        titleShow: { enabled: true, value: false },
      });
      const afterSave = mod.getGlobalStreamOverridesSnapshot();
      assert.equal(afterSave.cols.value, 5);
      assert.equal(afterSave.titleShow.value, false);
      assert.equal(parseCount, beforeSaveParse, 'save path did not seed snapshot cache');
      assert.match(storage.getRaw(), /"value":5/);
    } finally {
      JSON.parse = nativeParse;
    }
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('effective stream settings consume the immutable override snapshot, not cloned UI loader', async () => {
  const source = await readFile(
    new URL('../../src/original_stream_columns.js', import.meta.url),
    'utf8'
  );
  const start = source.indexOf('export function getEffectiveStreamSettings(code)');
  const end = source.indexOf('\n}\n\n// ★ משה 14/09/2026', start);
  assert(start >= 0 && end > start);
  const fn = source.slice(start, end);
  assert.match(fn, /getGlobalStreamOverridesSnapshot\(\)/);
  assert.doesNotMatch(fn, /loadGlobalStreamOverrides\(\)/);
});
