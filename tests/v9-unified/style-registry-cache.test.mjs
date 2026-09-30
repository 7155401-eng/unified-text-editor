import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage(initialRaw = null) {
  let raw = initialRaw;
  return {
    failWrites: false,
    failReads: false,
    getItem(key) {
      if (this.failReads) throw new Error('read failed');
      return key === 'ravtext.customStyles.v1' ? raw : null;
    },
    setItem(key, value) {
      if (this.failWrites) throw new Error('write failed');
      if (key === 'ravtext.customStyles.v1') raw = String(value);
    },
    removeItem(key) {
      if (key === 'ravtext.customStyles.v1') raw = null;
    },
    raw() { return raw; },
  };
}

test('style registry cache is raw-aware, parse-efficient and mutation-safe', async () => {
  const storage = fakeStorage(JSON.stringify([{ id:'a', name:'Alpha', fontSize:12 }]));
  const listeners = new Map();
  const events = [];
  globalThis.localStorage = storage;
  globalThis.window = {
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatchEvent(ev) { events.push(ev?.type || ''); return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  };

  const realParse = JSON.parse;
  let parseCount = 0;
  JSON.parse = (...args) => { parseCount++; return realParse(...args); };

  try {
    const mod = await import('../../src/style_registry.js?style-cache-regression');

    const first = mod.loadTextStyles();
    assert.equal(parseCount, 1);
    assert.equal(first[0].name, 'Alpha');

    const second = mod.loadTextStyles();
    assert.equal(parseCount, 1, 'unchanged raw storage reparsed');
    assert.notEqual(first, second, 'mutable API leaked cached array');

    first[0].name = 'MUTATED';
    first.push({ id:'x', name:'X' });
    const afterCallerMutation = mod.loadTextStyles();
    assert.equal(afterCallerMutation.length, 1);
    assert.equal(afterCallerMutation[0].name, 'Alpha', 'caller mutated cache internals');

    storage.setItem('ravtext.customStyles.v1', JSON.stringify([{ id:'b', name:'Beta', bold:true }]));
    const beta = mod.resolveTextStyle('b');
    assert.equal(parseCount, 2, 'same-tab direct raw write did not invalidate');
    assert.equal(beta?.name, 'Beta');
    assert.equal(mod.resolveTextStyle('a'), null);

    beta.name = 'MUTATED-BETA';
    assert.equal(mod.resolveTextStyle('b')?.name, 'Beta', 'resolveTextStyle leaked cache object');

    storage.setItem('ravtext.customStyles.v1', '{malformed');
    assert.deepEqual(mod.loadTextStyles(), []);
    assert.equal(parseCount, 3);
    assert.deepEqual(mod.loadTextStyles(), []);
    assert.equal(parseCount, 3, 'same malformed raw reparsed repeatedly');

    mod.saveTextStyles([{ id:'c', name:'Gamma', italic:true }]);
    assert.equal(parseCount, 3, 'save path should seed parsed cache without reparsing');
    assert.deepEqual(mod.loadTextStyles(), [{ id:'c', name:'Gamma', italic:true }]);
    assert.equal(parseCount, 3);
    assert(events.includes('ravtext:styles-changed'), 'save did not dispatch styles-changed');

    storage.failWrites = true;
    assert.throws(() => mod.saveTextStyles([{ id:'d', name:'Delta' }]), /write failed/);
    storage.failWrites = false;
    assert.equal(mod.resolveTextStyle('c')?.name, 'Gamma', 'failed save poisoned cache');
    assert.equal(mod.resolveTextStyle('d'), null);

    storage.failReads = true;
    assert.deepEqual(mod.loadTextStyles(), []);
    storage.failReads = false;
    assert.equal(mod.resolveTextStyle('c')?.name, 'Gamma', 'cache did not recover after storage read failure');
  } finally {
    JSON.parse = realParse;
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.CustomEvent;
  }
});
