import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachAutoSync,
  scheduleSettingsSync,
  SETTINGS_SAVE_TIMEOUT_MS,
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

function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      active.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) { active.delete(id); },
    delays() { return [...active.values()].map(x => x.delay).sort((a,b) => a-b); },
    runOneByDelay(delay) {
      const hit = [...active.entries()].find(([,x]) => x.delay === delay);
      assert.ok(hit, 'missing timer ' + delay);
      const [id, entry] = hit;
      active.delete(id);
      entry.fn();
    },
  };
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  let failEnumeration = false;
  return {
    get length() { return data.size; },
    key(i) {
      if (failEnumeration) throw new Error('storage enumeration failed');
      return [...data.keys()][i] ?? null;
    },
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
    failEnumeration(value = true) { failEnumeration = value; },
  };
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

test('settings sync is serialized, latest-wins, revert-safe and timeout-bounded', async () => {
  const timers = fakeTimers();
  const storage = fakeStorage({ 'ravtext.test.setting': 'A' });
  const calls = [];

  let releaseA = null;
  let releaseC = null;
  let hungSignal = null;

  const fetchStub = (_url, init = {}) => {
    const parsed = JSON.parse(init.body || '{}');
    calls.push({ init, parsed });
    const n = calls.length;

    if (n === 1) {
      return new Promise(resolve => {
        releaseA = () => resolve({ ok: true, status: 200 });
      });
    }
    if (n === 2) {
      return new Promise(resolve => {
        releaseC = () => resolve({ ok: true, status: 200 });
      });
    }
    if (n === 4) {
      hungSignal = init.signal || null;
      return new Promise((_resolve, reject) => {
        const abort = () => {
          const error = new Error('aborted settings PUT');
          error.name = 'AbortError';
          reject(error);
        };
        if (hungSignal?.aborted) abort();
        else hungSignal?.addEventListener?.('abort', abort, { once: true });
      });
    }

    return Promise.resolve({ ok: true, status: 200 });
  };

  const restores = [
    replaceGlobal('window', { __RAVTEXT_AUTH__: { loggedIn: true } }),
    replaceGlobal('localStorage', storage),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
  ];

  try {
    // A starts slowly.
    scheduleSettingsSync();
    assert.deepEqual(timers.delays(), [2000, 10000]);
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].parsed.settings['ravtext.test.setting'], 'A');

    // B then C arrive while A is in flight. Only C should wait.
    storage.setItem('ravtext.test.setting', 'B');
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 1, 'B overlapped A');

    storage.setItem('ravtext.test.setting', 'C');
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 1, 'C overlapped A');

    releaseA();
    await settle(12);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].parsed.settings['ravtext.test.setting'], 'C',
      'waiting settings were not coalesced to C');

    // Revert to A while C is in flight. A equals the last confirmed server
    // snapshot at queue time, but must still be queued because C may overwrite it.
    storage.setItem('ravtext.test.setting', 'A');
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 2);

    releaseC();
    await settle(12);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].parsed.settings['ravtext.test.setting'], 'A',
      'fast revert to last confirmed state was incorrectly dropped');

    // D hangs. E and F arrive behind it; timeout must abort D and only F follows.
    storage.setItem('ravtext.test.setting', 'D');
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 4);
    assert.ok(hungSignal, 'settings PUT did not receive AbortSignal');

    storage.setItem('ravtext.test.setting', 'E');
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 4, 'E overlapped hung D');

    storage.setItem('ravtext.test.setting', 'F');
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 4, 'F overlapped hung D');
    assert.ok(timers.delays().includes(SETTINGS_SAVE_TIMEOUT_MS));

    timers.runOneByDelay(SETTINGS_SAVE_TIMEOUT_MS);
    await settle(14);
    assert.equal(hungSignal.aborted, true);
    assert.equal(calls.length, 5);
    assert.equal(calls[4].parsed.settings['ravtext.test.setting'], 'F',
      'settings queue did not resume with newest F');
    assert.ok(!calls.some(call => call.parsed.settings['ravtext.test.setting'] === 'E'),
      'superseded E was uploaded');

    // Enumeration failure must fail closed: never replace full server settings
    // with a partial object collected before localStorage threw.
    storage.failEnumeration(true);
    scheduleSettingsSync();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(calls.length, 5, 'partial settings snapshot was uploaded');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

test('pagehide does not beacon a partial settings snapshot after storage enumeration failure', () => {
  const storage = fakeStorage({ 'ravtext.test.setting': 'A' });
  storage.failEnumeration(true);

  const listeners = new Map();
  const beacons = [];
  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
  };

  const paneManager = {
    on() {},
    flushSave() {},
    serializeForPersistenceString() {
      return '{"version":1,"panes":[]}';
    },
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('navigator', {
      sendBeacon(url) {
        beacons.push(String(url));
        return true;
      },
    }),
  ];

  try {
    attachAutoSync(paneManager);
    for (const fn of listeners.get('pagehide') || []) fn();

    assert.ok(beacons.some(url => url.includes('/api/documents/current')),
      'document pagehide beacon should remain independent');
    assert.ok(!beacons.some(url => url.includes('/api/settings')),
      'partial settings snapshot was beaconed');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
