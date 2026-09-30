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
    const storedFirst = mod.getStoredSpacingSettingsSnapshot();
    assert.equal(first.noMidLineSplits,true);
    assert.equal(first.noMidParagraphSoft,false);
    assert(Object.isFrozen(first),'hot-path snapshot must be immutable');
    assert(Object.isFrozen(storedFirst),'stored snapshot must be immutable');
    assert.equal(Object.prototype.hasOwnProperty.call(storedFirst,'preventMidLineSplit'),false,
      'stored snapshot invented a UI default that was never persisted');
    assert.equal(first.preventMidLineSplit,true,
      'effective snapshot lost the UI default');

    for(let i=0;i<1000;i++) {
      assert.strictEqual(mod.getSpacingSettingsSnapshot(), first);
      assert.strictEqual(mod.getStoredSpacingSettingsSnapshot(), storedFirst);
    }
    assert.equal(parseCount,1,'unchanged storage was reparsed inside the hot path');

    const editable = mod.loadSpacingSettings();
    editable.noMidLineSplits = false;
    assert.equal(mod.getSpacingSettingsSnapshot().noMidLineSplits,true,
      'mutable UI copy leaked into cached snapshot');

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

test('layout engines consume central spacing snapshots and do not parse spacing storage themselves',()=>{
  const domPacker = fs.readFileSync(new URL('../../src/engine/dom_packer.js', import.meta.url),'utf8');
  assert.match(domPacker,/getSpacingSettingsSnapshot/);
  assert.doesNotMatch(domPacker,/localStorage\.getItem\(["']ravtext\.spacing\.v1["']\)/);
  assert.doesNotMatch(domPacker,/JSON\.parse\([^\n]*ravtext\.spacing\.v1/);

  const v9Apply = fs.readFileSync(new URL('../../src/vilna_v9_apply.js', import.meta.url),'utf8');
  assert.match(v9Apply,/const storedSpacing = getStoredSpacingSettingsSnapshot\(\)/);
  assert.equal((v9Apply.match(/getStoredSpacingSettingsSnapshot\(\)/g)||[]).length,1,
    'V9 must snapshot persisted spacing only once per render path');
  assert.match(v9Apply,/readSpacingBool\(storedSpacing, "noMidParagraphSoft", false\)/);
  assert.match(v9Apply,/readSpacingBool\(storedSpacing, "noMidLineSplits", false\)/);
  assert.match(v9Apply,/readSpacingBool\(storedSpacing, "preventMidLineSplit", false\)/);
  assert.doesNotMatch(v9Apply,/localStorage\.getItem\(["']ravtext\.spacing\.v1["']\)/);
  assert.doesNotMatch(v9Apply,/JSON\.parse\([^\n]*ravtext\.spacing\.v1/);
});
