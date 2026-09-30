import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function fakeStorage(initialRaw) {
  let raw = String(initialRaw || "");
  return {
    getItem(key) {
      return key === 'ravtext.spacing.v1' ? raw : null;
    },
    setItem(key, value) {
      if (key === 'ravtext.spacing.v1') raw = String(value);
    },
    setRaw(value) { raw = String(value); },
    getRaw() { return raw; },
  };
}

test('spacing snapshot caches parse/normalization but invalidates on direct raw storage changes', async()=>{
  const previousStorage = globalThis.localStorage;
  const storage = fakeStorage(JSON.stringify({
    noMidLineSplits:true,
    noMidParagraphSoft:false,
    pageMainLineHeight:1.6,
  }));
  globalThis.localStorage = storage;

  const mod = await import('../../src/spacing_settings.js');
  const nativeParse = JSON.parse;
  let parseCount = 0;
  JSON.parse = (...args) => {
    parseCount++;
    return nativeParse(...args);
  };

  try {
    const first = mod.getSpacingSettingsSnapshot();
    assert.equal(first.noMidLineSplits,true);
    assert.equal(first.noMidParagraphSoft,false);
    assert(Object.isFrozen(first),'hot-path snapshot must be immutable');

    for(let i=0;i<1000;i++) {
      assert.strictEqual(mod.getSpacingSettingsSnapshot(), first);
    }
    assert.equal(parseCount,1,'unchanged storage was reparsed inside the hot path');

    const editable = mod.loadSpacingSettings();
    editable.noMidLineSplits = false;
    assert.equal(mod.getSpacingSettingsSnapshot().noMidLineSplits,true,
      'mutable UI copy leaked into cached snapshot');

    // Simulate a same-window direct write that bypasses saveSpacingSettings().
    storage.setRaw(JSON.stringify({
      noMidLineSplits:false,
      noMidParagraphSoft:true,
      pageMainLineHeight:1.7,
    }));
    const afterDirectWrite = mod.getSpacingSettingsSnapshot();
    assert.notStrictEqual(afterDirectWrite,first);
    assert.equal(afterDirectWrite.noMidLineSplits,false);
    assert.equal(afterDirectWrite.noMidParagraphSoft,true);
    assert.equal(parseCount,2,'changed raw storage did not invalidate parse cache');

    // The official save path seeds the cache immediately; the next read must
    // not parse the string that saveSpacingSettings itself just produced.
    const beforeSaveParseCount = parseCount;
    mod.saveSpacingSettings({...afterDirectWrite,noMidLineSplits:true});
    const afterSave = mod.getSpacingSettingsSnapshot();
    assert.equal(afterSave.noMidLineSplits,true);
    assert.equal(parseCount,beforeSaveParseCount,'save path failed to seed cache');
  } finally {
    JSON.parse = nativeParse;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('dom_packer consumes the central spacing snapshot and no longer parses spacing storage itself',()=>{
  const source = fs.readFileSync(new URL('../../src/engine/dom_packer.js', import.meta.url),'utf8');
  assert.match(source,/getSpacingSettingsSnapshot/);
  assert.doesNotMatch(source,/localStorage\.getItem\(["']ravtext\.spacing\.v1["']\)/);
  assert.doesNotMatch(source,/JSON\.parse\([^\n]*ravtext\.spacing\.v1/);
});
