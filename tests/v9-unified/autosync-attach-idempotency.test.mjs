import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAutoSync } from '../../src/server_persistence.js';

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  };
}

function fakeStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
  };
}

function windowHarness() {
  const listeners = new Map();
  return {
    listeners,
    window: {
      __RAVTEXT_AUTH__: { loggedIn: true },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent() {},
    },
  };
}

test('attachAutoSync is idempotent for the same PaneManager and Storage object', () => {
  const storage = fakeStorage();
  const { window, listeners } = windowHarness();
  const subscriptions = [];
  const paneManager = {
    on(type, fn) { subscriptions.push({ type, fn }); },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };

  const restores = [
    replaceGlobal('window', window),
    replaceGlobal('localStorage', storage),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('document', { getElementById: () => null }),
  ];

  try {
    attachAutoSync(paneManager);
    const wrappedSetItem = storage.setItem;
    attachAutoSync(paneManager);

    assert.equal(
      subscriptions.filter(x => x.type === 'persist').length,
      1,
      'duplicate attach installed more than one persist subscription'
    );
    assert.equal((listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal((listeners.get('pagehide') || []).length, 1);
    assert.strictEqual(
      storage.setItem,
      wrappedSetItem,
      'duplicate attach wrapped localStorage.setItem a second time'
    );
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

test('unwrappable Storage does not abort document autosync or pagehide recovery', () => {
  const base = fakeStorage();
  const nativeSet = base.setItem.bind(base);
  Object.defineProperty(base, 'setItem', {
    configurable: false,
    enumerable: true,
    get() { return nativeSet; },
    set() { throw new TypeError('readonly Storage method'); },
  });

  const { window, listeners } = windowHarness();
  const subscriptions = [];
  const paneManager = {
    on(type, fn) { subscriptions.push({ type, fn }); },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };

  const restores = [
    replaceGlobal('window', window),
    replaceGlobal('localStorage', base),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('document', { getElementById: () => null }),
  ];

  try {
    assert.doesNotThrow(() => attachAutoSync(paneManager));
    assert.equal(subscriptions.filter(x => x.type === 'persist').length, 1);
    assert.equal((listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal(
      (listeners.get('pagehide') || []).length,
      1,
      'settings wrapper failure prevented pagehide recovery installation'
    );
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
