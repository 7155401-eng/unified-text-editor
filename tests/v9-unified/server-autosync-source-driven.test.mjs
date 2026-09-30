import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAutoSync } from '../../src/server_persistence.js';

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
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

function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    setTimeout(fn, delay) {
      const id = nextId++;
      active.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) {
      active.delete(id);
    },
    delays() {
      return [...active.values()].map(x => x.delay).sort((a, b) => a - b);
    },
    runOneByDelay(delay) {
      const hit = [...active.entries()].find(([, x]) => x.delay === delay);
      assert.ok(hit, 'missing active timer for delay ' + delay);
      const [id, entry] = hit;
      active.delete(id);
      entry.fn();
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('document autosync follows pane changes, has max wait, and serializes network writes', async () => {
  const timers = fakeTimers();
  const storage = fakeStorage();
  const listeners = new Map();
  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
  };

  const callbacks = new Map();
  let content = { version: 1, panes: [{ id: 'main', content: { text: 'A' } }] };
  const paneManager = {
    on(type, fn) { callbacks.set(type, fn); },
    serializeForPersistence() { return content; },
    flushSave() {},
  };

  const fetchCalls = [];
  let releaseSlow = null;
  const fetchStub = (url, init = {}) => {
    fetchCalls.push({ url: String(url), init, parsed: JSON.parse(init.body || '{}') });
    if (fetchCalls.length === 2) {
      return new Promise((resolve) => {
        releaseSlow = () => resolve({ ok: true, status: 200 });
      });
    }
    return Promise.resolve({ ok: true, status: 200 });
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
  ];

  try {
    attachAutoSync(paneManager);

    assert.equal(typeof callbacks.get('change'), 'function',
      'autosync must subscribe directly to PaneManager change');
    assert.equal((listeners.get('ravtext:engine-rendered') || []).length, 0,
      'modern PaneManager must not depend on engine rendering for autosave');

    // Continuous edits keep moving the 2s trailing debounce, but the original
    // 10s maximum wait remains active and cannot be postponed forever.
    callbacks.get('change')();
    callbacks.get('change')();
    callbacks.get('change')();
    assert.deepEqual(timers.delays(), [2000, 10000]);

    timers.runOneByDelay(10000);
    await settle();
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/api/documents/current');
    assert.equal(fetchCalls[0].init.method, 'PUT');
    assert.equal(fetchCalls[0].parsed.content.panes[0].content.text, 'A');

    // Start a slow save for B.
    content = { version: 1, panes: [{ id: 'main', content: { text: 'B' } }] };
    callbacks.get('change')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length, 2);
    assert.ok(releaseSlow, 'second save should be held open');

    // While B is in flight, C becomes current and its debounce expires.
    // It must queue behind B instead of issuing an overlapping PUT.
    content = { version: 1, panes: [{ id: 'main', content: { text: 'C' } }] };
    callbacks.get('change')();
    timers.runOneByDelay(2000);
    await settle();
    assert.equal(fetchCalls.length, 2,
      'newer save must wait for older in-flight save to finish');

    releaseSlow();
    await settle();
    await settle();

    assert.equal(fetchCalls.length, 3);
    assert.equal(fetchCalls[2].parsed.content.panes[0].content.text, 'C');
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
