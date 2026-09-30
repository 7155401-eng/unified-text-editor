import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalSettings } from '../../src/server_persistence.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length(){ return data.size; },
    key(i){ return [...data.keys()][i] ?? null; },
    getItem(k){ return data.has(k) ? data.get(k) : null; },
    setItem(k,v){ data.set(String(k),String(v)); },
    removeItem(k){ data.delete(String(k)); },
    dump(){ return Object.fromEntries(data); },
  };
}

test('server settings seed missing keys but do not roll back existing local choices on refresh',()=>{
  const previous = globalThis.localStorage;
  globalThis.localStorage = fakeStorage({
    'ravtext.talmudLayout.crownLines':'4',
    'ravtext.pageNumbers':'1',
  });
  try {
    applyLocalSettings({
      'ravtext.talmudLayout.crownLines':'3',
      'ravtext.pageNumbers':'0',
      'ravtext.talmudLayout.sideMode':'right-left',
    }, { preserveExisting:true });
    assert.deepEqual(globalThis.localStorage.dump(),{
      'ravtext.talmudLayout.crownLines':'4',
      'ravtext.pageNumbers':'1',
      'ravtext.talmudLayout.sideMode':'right-left',
    });
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
