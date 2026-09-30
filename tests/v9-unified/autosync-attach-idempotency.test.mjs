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

function windowHarness({ throwOnceOn = null } = {}) {
  const listeners = new Map();
  let remainingThrow = throwOnceOn;
  return {
    listeners,
    window: {
      __RAVTEXT_AUTH__: { loggedIn: true },
      addEventListener(type, fn) {
        if (remainingThrow === type) {
          remainingThrow = null;
          throw new Error('listener install failed: ' + type);
        }
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent() {},
    },
  };
}

function installGlobals(storage, harness) {
  return [
    replaceGlobal('window', harness.window),
    replaceGlobal('localStorage', storage),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('document', { getElementById: () => null }),
  ];
}

function restoreAll(restores) {
  for (const restore of restores.reverse()) restore();
}

test('attachAutoSync is idempotent for the same PaneManager and Storage object', () => {
  const storage = fakeStorage();
  const harness = windowHarness();
  const subscriptions = [];
  const paneManager = {
    on(type, fn) { subscriptions.push({ type, fn }); },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };
  const restores = installGlobals(storage, harness);

  try {
    attachAutoSync(paneManager);
    const wrappedSetItem = storage.setItem;
    attachAutoSync(paneManager);

    assert.equal(subscriptions.filter(x => x.type === 'persist').length, 1);
    assert.equal((harness.listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal((harness.listeners.get('pagehide') || []).length, 1);
    assert.strictEqual(storage.setItem, wrappedSetItem);
  } finally {
    restoreAll(restores);
  }
});

test('two PaneManagers sharing one Storage do not stack settings wrappers', () => {
  const storage = fakeStorage();
  const harness = windowHarness();
  const managerA = { on() {}, serializeForPersistenceString() { return '{"a":1}'; }, flushSave() {} };
  const managerB = { on() {}, serializeForPersistenceString() { return '{"b":1}'; }, flushSave() {} };
  const restores = installGlobals(storage, harness);

  try {
    attachAutoSync(managerA);
    const onceWrapped = storage.setItem;
    attachAutoSync(managerB);
    assert.strictEqual(storage.setItem, onceWrapped);
  } finally {
    restoreAll(restores);
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

  const harness = windowHarness();
  const subscriptions = [];
  const paneManager = {
    on(type, fn) { subscriptions.push({ type, fn }); },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };
  const restores = installGlobals(base, harness);

  try {
    assert.doesNotThrow(() => attachAutoSync(paneManager));
    assert.equal(subscriptions.filter(x => x.type === 'persist').length, 1);
    assert.equal((harness.listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal((harness.listeners.get('pagehide') || []).length, 1);
  } finally {
    restoreAll(restores);
  }
});

test('failed paneManager listener registration remains retryable', () => {
  const storage = fakeStorage();
  const harness = windowHarness();
  const subscriptions = [];
  let fail = true;
  const paneManager = {
    on(type, fn) {
      if (fail) {
        fail = false;
        throw new Error('temporary paneManager.on failure');
      }
      subscriptions.push({ type, fn });
    },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };
  const restores = installGlobals(storage, harness);

  try {
    assert.throws(() => attachAutoSync(paneManager), /temporary paneManager\.on failure/);
    assert.equal(subscriptions.length, 0);
    assert.doesNotThrow(() => attachAutoSync(paneManager));
    assert.equal(subscriptions.filter(x => x.type === 'persist').length, 1);
    assert.equal((harness.listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal((harness.listeners.get('pagehide') || []).length, 1);
  } finally {
    restoreAll(restores);
  }
});

test('failure after persist registration retries only the missing listener steps', () => {
  const storage = fakeStorage();
  const harness = windowHarness({ throwOnceOn: 'ravtext:local-document-saved' });
  const subscriptions = [];
  const paneManager = {
    on(type, fn) { subscriptions.push({ type, fn }); },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };
  const restores = installGlobals(storage, harness);

  try {
    assert.throws(() => attachAutoSync(paneManager), /listener install failed/);
    assert.equal(subscriptions.filter(x => x.type === 'persist').length, 1);
    assert.doesNotThrow(() => attachAutoSync(paneManager));
    assert.equal(
      subscriptions.filter(x => x.type === 'persist').length,
      1,
      'retry duplicated an already-installed persist subscription'
    );
    assert.equal((harness.listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal((harness.listeners.get('pagehide') || []).length, 1);
  } finally {
    restoreAll(restores);
  }
});

test('re-entrant attach during paneManager.on is ignored until outer install completes', () => {
  const storage = fakeStorage();
  const harness = windowHarness();
  const subscriptions = [];
  let paneManager;
  paneManager = {
    on(type, fn) {
      subscriptions.push({ type, fn });
      attachAutoSync(paneManager);
    },
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
    flushSave() {},
  };
  const restores = installGlobals(storage, harness);

  try {
    assert.doesNotThrow(() => attachAutoSync(paneManager));
    assert.equal(subscriptions.filter(x => x.type === 'persist').length, 1);
    assert.equal((harness.listeners.get('ravtext:local-document-saved') || []).length, 1);
    assert.equal((harness.listeners.get('pagehide') || []).length, 1);
  } finally {
    restoreAll(restores);
  }
});
