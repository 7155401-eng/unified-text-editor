import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
  };
}

test('document-style cache reuses parses, preserves mutable-copy API and notices same-tab writes', async () => {
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = fakeStorage({
    'ravtext.documentStyles.v1': JSON.stringify({ mainStyleId: 'style-a' }),
  });

  try {
    const mod = await import('../../src/document_style_settings.js');
    assert.equal('getDocumentStyleSettingsSnapshot' in mod, false,
      'cache implementation leaked a new production API');

    const originalParse = JSON.parse;
    let parseCount = 0;
    JSON.parse = function (...args) {
      parseCount += 1;
      return originalParse.apply(this, args);
    };

    try {
      const first = mod.loadDocumentStyleSettings();
      const second = mod.loadDocumentStyleSettings();
      assert.equal(parseCount, 1, 'unchanged raw storage reparsed');
      assert.equal(first.mainStyleId, 'style-a');
      assert.equal(second.mainStyleId, 'style-a');

      first.mainStyleId = 'caller-mutated';
      assert.equal(mod.loadDocumentStyleSettings().mainStyleId, 'style-a',
        'caller mutation poisoned cached settings');
      assert.equal(parseCount, 1, 'caller mutation forced an unnecessary reparse');

      globalThis.localStorage.setItem(
        'ravtext.documentStyles.v1',
        JSON.stringify({ mainStyleId: 'style-b' })
      );
      assert.equal(mod.loadDocumentStyleSettings().mainStyleId, 'style-b');
      assert.equal(parseCount, 2, 'same-tab raw write was not detected');

      mod.saveDocumentStyleSettings({ mainStyleId: 'style-c' });
      assert.equal(mod.loadDocumentStyleSettings().mainStyleId, 'style-c');
      assert.equal(parseCount, 2, 'save did not update cache atomically');

      globalThis.localStorage.setItem('ravtext.documentStyles.v1', '{bad json');
      assert.equal(mod.loadDocumentStyleSettings().mainStyleId, '');
      assert.equal(parseCount, 3, 'invalid raw value was not reparsed once');
      assert.equal(mod.loadDocumentStyleSettings().mainStyleId, '');
      assert.equal(parseCount, 3, 'same invalid raw value reparsed repeatedly');
    } finally {
      JSON.parse = originalParse;
    }
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
