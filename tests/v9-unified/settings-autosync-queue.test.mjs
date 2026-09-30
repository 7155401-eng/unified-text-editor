import test from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
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
    runByDelay(delay) {
      const hit = [...active.entries()].find(([,x]) => x.delay === delay);
      assert.ok(hit, 'missing timer ' + delay);
      const [id, entry] = hit;
      active.delete(id);
      entry.fn();
    },
  };
}

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  };
}

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

test('settings saves are serialized and keep the snapshot captured when their debounce fires', async () => {
  const storage = fakeStorage({ 'ravtext.test.setting': 'A' });
  const timers = fakeTimers();
  const calls = [];
  let releaseA;
  let releaseB;

  const fetchStub = (url, init = {}) => {
    assert.equal(String(url), '/api/settings');
    assert.equal(init.method, 'PUT');
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) {
      return new Promise(resolve => {
        releaseA = () => resolve({ ok: true, status: 200 });
      });
    }
    if (calls.length === 2) {
      return new Promise(resolve => {
        releaseB = () => resolve({ ok: true, status: 200 });
      });
    }
    throw new Error('unexpected settings PUT #' + calls.length);
  };

  const restores = [
    replaceGlobal('window', { __RAVTEXT_AUTH__: { loggedIn: true } }),
    replaceGlobal('localStorage', storage),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
  ];

  try {
    const mod = await import(new URL(
      '../../src/server_persistence.js?settings-queue-order',
      import.meta.url
    ));

    // A starts and remains in flight.
    mod.scheduleSettingsSync();
    timers.runByDelay(2000);
    await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].settings['ravtext.test.setting'], 'A');

    // B's debounce fires while A is still in flight. It must be snapshotted
    // now but must not start a second network request yet.
    storage.setItem('ravtext.test.setting', 'B');
    mod.scheduleSettingsSync();
    timers.runByDelay(2000);
    await settle();
    assert.equal(calls.length, 1, 'B overlapped the older A request');

    // Mutate browser state again without scheduling another save. The already
    // queued B request must remain B rather than rereading C when it gets turn.
    storage.setItem('ravtext.test.setting', 'C');

    releaseA();
    await settle(20);
    assert.equal(calls.length, 2);
    assert.equal(
      calls[1].settings['ravtext.test.setting'],
      'B',
      'queued settings save was not an immutable snapshot'
    );

    releaseB();
    await settle();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

test('a failed settings request does not poison later queued settings', async () => {
  const storage = fakeStorage({ 'ravtext.test.setting': 'A' });
  const timers = fakeTimers();
  const calls = [];
  let rejectA;

  const fetchStub = (url, init = {}) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) {
      return new Promise((_resolve, reject) => {
        rejectA = () => reject(new Error('offline'));
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
    const mod = await import(new URL(
      '../../src/server_persistence.js?settings-queue-recovery',
      import.meta.url
    ));

    mod.scheduleSettingsSync();
    timers.runByDelay(2000);
    await settle();
    assert.equal(calls.length, 1);

    storage.setItem('ravtext.test.setting', 'B');
    mod.scheduleSettingsSync();
    timers.runByDelay(2000);
    await settle();
    assert.equal(calls.length, 1);

    rejectA();
    await settle(20);
    assert.equal(calls.length, 2, 'queue stopped after a failed older request');
    assert.equal(calls[1].settings['ravtext.test.setting'], 'B');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
