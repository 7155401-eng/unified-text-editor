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


test('legacy v9MainGap migrates once into independent crown-main spacing', async()=>{
  const previousStorage = globalThis.localStorage;
  const storage = fakeStorage(JSON.stringify({ v9MainGap: 23 }));
  globalThis.localStorage = storage;

  // Query-bust so this test gets a fresh module cache independent of the test
  // above and reads this fixture's raw storage on first access.
  const mod = await import('../../src/spacing_settings.js?crown-gap-migration=1');
  try {
    const effective = mod.getSpacingSettingsSnapshot();
    const stored = mod.getStoredSpacingSettingsSnapshot();
    assert.equal(effective.v9MainGap,23);
    assert.equal(effective.v9CrownMainGap,23,
      'existing users did not preserve their previous coupled visual clearance');
    assert.equal(Object.prototype.hasOwnProperty.call(stored,'v9CrownMainGap'),false,
      'read-time migration mutated the exact persisted-key snapshot');

    const saved = mod.saveSpacingSettings({...effective,v9MainGap:7,v9CrownMainGap:19});
    assert.equal(saved.v9MainGap,7);
    assert.equal(saved.v9CrownMainGap,19,
      'horizontal and vertical V9 gaps did not become independently persistent');
  } finally {
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
  assert.match(v9Apply,/const effectiveSpacing = getSpacingSettingsSnapshot\(\)/,
    'V9 did not read effective geometry spacing');
  assert.match(v9Apply,/streamLineHeightRatio = safeV9LineHeightRatio\(effectiveSpacing\.streamLineHeight\)/,
    'global stream line-height is still disconnected from V9 config');
  assert.match(v9Apply,/streamLineHeightRatio,/,
    'V9 config does not expose a dedicated stream pitch');
  assert.match(v9Apply,/crownMainGapPx:\s*Math\.max\(0,\s*Number\(effectiveSpacing\.v9CrownMainGap\)/,
    'V9 crown clearance is not sourced from its independent vertical spacing key');
  assert.match(v9Apply,/readSpacingBool\(storedSpacing, "noMidParagraphSoft", false\)/);
  assert.match(v9Apply,/readSpacingBool\(storedSpacing, "noMidLineSplits", false\)/);
  assert.match(v9Apply,/readSpacingBool\(storedSpacing, "preventMidLineSplit", false\)/);
  assert.doesNotMatch(v9Apply,/localStorage\.getItem\(["']ravtext\.spacing\.v1["']\)/);
  assert.doesNotMatch(v9Apply,/JSON\.parse\([^\n]*ravtext\.spacing\.v1/);
});
