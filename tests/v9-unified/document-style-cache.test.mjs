import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k,v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
  };
}

test('document-style cache is identity-stable, mutation-safe, and notices same-tab raw writes', async () => {
  const previous = globalThis.localStorage;
  globalThis.localStorage = fakeStorage({
    'ravtext.documentStyles.v1': JSON.stringify({ mainStyleId: 'style-a' }),
  });

  try {
    const mod = await import('../../src/document_style_settings.js');

    const snap1 = mod.getDocumentStyleSettingsSnapshot();
    const snap2 = mod.getDocumentStyleSettingsSnapshot();
    assert.strictEqual(snap2, snap1, 'unchanged raw settings should reuse the parsed snapshot');
    assert(Object.isFrozen(snap1), 'cached snapshot must be immutable');
    assert.equal(snap1.mainStyleId, 'style-a');

    const mutable = mod.loadDocumentStyleSettings();
    mutable.mainStyleId = 'mutated-locally';
    assert.equal(mod.getDocumentStyleSettingsSnapshot().mainStyleId, 'style-a',
      'caller mutation leaked into cached snapshot');

    // Same-tab direct writes do not fire the browser storage event. The cache
    // must still notice them by comparing the raw stored value.
    globalThis.localStorage.setItem(
      'ravtext.documentStyles.v1',
      JSON.stringify({ mainStyleId: 'style-b' })
    );
    const snap3 = mod.getDocumentStyleSettingsSnapshot();
    assert.notStrictEqual(snap3, snap1, 'raw external write did not invalidate snapshot');
    assert.equal(snap3.mainStyleId, 'style-b');

    mod.saveDocumentStyleSettings({ mainStyleId: 'style-c' });
    const snap4 = mod.getDocumentStyleSettingsSnapshot();
    assert.equal(snap4.mainStyleId, 'style-c');
    assert(Object.isFrozen(snap4));
    assert.equal(
      JSON.parse(globalThis.localStorage.getItem('ravtext.documentStyles.v1')).mainStyleId,
      'style-c'
    );
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
