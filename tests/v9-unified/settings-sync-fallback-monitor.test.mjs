import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachAutoSync,
  loadInitialState,
  SETTINGS_FALLBACK_POLL_MS,
} from '../../src/server_persistence.js';

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

function readonlyMethodStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const nativeSet = (key, value) => data.set(String(key), String(value));

  const storage = {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(key) { return data.has(String(key)) ? data.get(String(key)) : null; },
    removeItem(key) { data.delete(String(key)); },
  };

  Object.defineProperty(storage, 'setItem', {
    configurable: false,
    enumerable: true,
    get() { return nativeSet; },
    set() { throw new TypeError('readonly Storage method'); },
  });

  return { storage, nativeSet };
}

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

test('unwrappable localStorage gets one polling fallback and reconciles known server/local differences', async () => {
  const { storage, nativeSet } = readonlyMethodStorage({
    'ravtext.test.setting': 'local-new',
  });

  const listeners = new Map();
  const intervals = [];
  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
    setInterval(fn, delay) {
      const item = { fn, delay };
      intervals.push(item);
      return intervals.length;
    },
  };

  const settingsPuts = [];
  const fetchStub = async (url, init = {}) => {
    const u = String(url);
    if (u === '/api/documents/current') {
      return {
        ok: true,
        status: 200,
        async json() { return { document: null }; },
      };
    }
    if (u === '/api/settings' && (!init.method || init.method === 'GET')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { settings: { 'ravtext.test.setting': 'server-old' } };
        },
      };
    }
    if (u === '/api/settings' && init.method === 'PUT') {
      settingsPuts.push(JSON.parse(init.body));
      return { ok: true, status: 200 };
    }
    throw new Error('unexpected fetch ' + u);
  };

  const subscriptionsA = [];
  const managerA = {
    on(type, fn) { subscriptionsA.push({ type, fn }); },
    flushSave() {},
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
  };
  const managerB = {
    on() {},
    flushSave() {},
    serializeForPersistenceString() { return '{"version":1,"panes":[]}'; },
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('fetch', fetchStub),
  ];

  try {
    const startup = await loadInitialState(managerA);
    assert.equal(startup.hadServerSettings, true);
    assert.equal(storage.getItem('ravtext.test.setting'), 'local-new',
      'startup server settings rolled back an existing local choice');

    attachAutoSync(managerA);
    await settle(14);

    assert.equal(intervals.length, 1, 'unwrappable Storage did not get exactly one fallback monitor');
    assert.equal(intervals[0].delay, SETTINGS_FALLBACK_POLL_MS);
    assert.equal(settingsPuts.length, 1,
      'known stale server settings were not reconciled at attach');
    assert.equal(settingsPuts[0].settings['ravtext.test.setting'], 'local-new');

    // Idempotent for the same manager and for another manager sharing Storage.
    attachAutoSync(managerA);
    attachAutoSync(managerB);
    assert.equal(intervals.length, 1, 'fallback monitor was duplicated');

    // Programmatic write bypasses the impossible wrapper. Polling must detect it.
    nativeSet('ravtext.test.setting', 'local-later');
    intervals[0].fn();
    await settle(14);

    assert.equal(settingsPuts.length, 2);
    assert.equal(settingsPuts[1].settings['ravtext.test.setting'], 'local-later');

    // No change => no redundant PUT.
    intervals[0].fn();
    await settle();
    assert.equal(settingsPuts.length, 2);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
