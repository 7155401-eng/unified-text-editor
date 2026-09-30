import test from 'node:test';
import assert from 'node:assert/strict';

const DOC_KEY = 'ravtext.panes.state.v1';
const STALE_KEY = 'ravtext.doc.serverStale.v1';

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
    delays() { return [...active.values()].map(x => x.delay).sort((a,b) => a-b); },
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

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

async function freshModule(tag) {
  return import(new URL('../../src/server_persistence.js?' + tag, import.meta.url));
}

test('local-import survives slow startup and is retried after autosync attaches', async () => {
  const localContent = {
    version: 1,
    activeId: 'imported',
    panes: [{ id: 'imported', paneRole: 'main', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'new imported local text' }] },
    ] } }],
  };
  const serverContent = {
    version: 1,
    activeId: 'old',
    panes: [{ id: 'old', paneRole: 'main', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'old server text' }] },
    ] } }],
  };

  const storage = fakeStorage({
    [DOC_KEY]: JSON.stringify(localContent),
    [STALE_KEY]: JSON.stringify({
      status: 'local-import',
      chars: JSON.stringify(localContent).length,
      at: Date.now(),
    }),
  });
  const timers = fakeTimers();
  const listeners = new Map();
  const puts = [];

  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
  };

  const fetchStub = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (String(url) === '/api/documents/current' && method === 'GET') {
      return { ok: true, status: 200, async json() { return { document: { content: serverContent } }; } };
    }
    if (String(url) === '/api/settings' && method === 'GET') {
      return { ok: true, status: 200, async json() { return { settings: {} }; } };
    }
    if (String(url) === '/api/documents/current' && method === 'PUT') {
      puts.push(JSON.parse(init.body));
      return { ok: true, status: 200, async json() { return {}; } };
    }
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
    replaceGlobal('CustomEvent', class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    }),
  ];

  const paneManager = {
    load() { throw new Error('stale server document must not be loaded'); },
    serializeForPersistence() { return structuredClone(localContent); },
    on(type, fn) {
      if (!listeners.has('pane:' + type)) listeners.set('pane:' + type, []);
      listeners.get('pane:' + type).push(fn);
    },
    flushSave() {},
  };

  try {
    const mod = await freshModule('startup-import-retry');

    const result = await mod.loadInitialState(paneManager);
    assert.equal(result.loaded, false);
    assert.equal(result.skipped, 'stale-server-copy');
    assert.equal(
      JSON.parse(storage.getItem(STALE_KEY)).status,
      'local-import',
      'local-import protection was cleared before exact server confirmation'
    );

    // Simulate the important race: no local-save event is fired after this
    // point. attachAutoSync itself must notice the outstanding recovery state.
    mod.attachAutoSync(paneManager);
    assert.deepEqual(timers.delays(), [2000, 10000]);

    timers.runByDelay(2000);
    await settle();

    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].content, localContent);
    assert.equal(
      storage.getItem(STALE_KEY),
      null,
      'recovery marker should clear only after the exact local snapshot is confirmed'
    );
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});

test('known over-limit stale document does not retry on every startup', async () => {
  const content = { version: 1, panes: [{ id: 'main', content: { type: 'doc', content: [] } }] };
  const storage = fakeStorage({
    [DOC_KEY]: JSON.stringify(content),
    [STALE_KEY]: JSON.stringify({ status: 413, chars: 2_000_000, at: Date.now() }),
  });
  const timers = fakeTimers();
  const listeners = new Map();

  const restores = [
    replaceGlobal('window', {
      __RAVTEXT_AUTH__: { loggedIn: true },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatchEvent() {},
    }),
    replaceGlobal('localStorage', storage),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
  ];

  try {
    const mod = await freshModule('startup-413-no-loop');
    mod.attachAutoSync({
      serializeForPersistence() { return content; },
      on() {},
      flushSave() {},
    });
    assert.deepEqual(timers.delays(), []);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});


test('typing while startup server fetch is in flight wins over the late server copy', async () => {
  const serverContent = {
    version: 1,
    activeId: 'server',
    panes: [{ id: 'server', paneRole: 'main', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'old server copy' }] },
    ] } }],
  };
  const localContent = {
    version: 1,
    activeId: 'local',
    panes: [{ id: 'local', paneRole: 'main', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'typed while server was slow' }] },
    ] } }],
  };

  const storage = fakeStorage();
  const timers = fakeTimers();
  const listeners = new Map();
  const callbacks = new Map();
  const puts = [];
  let releaseDocumentGet;

  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
  };

  const fetchStub = (url, init = {}) => {
    const method = init.method || 'GET';
    if (String(url) === '/api/documents/current' && method === 'GET') {
      return new Promise((resolve) => {
        releaseDocumentGet = () => resolve({
          ok: true,
          status: 200,
          async json() { return { document: { content: serverContent } }; },
        });
      });
    }
    if (String(url) === '/api/settings' && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() { return { settings: {} }; },
      });
    }
    if (String(url) === '/api/documents/current' && method === 'PUT') {
      puts.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, async json() { return {}; } });
    }
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };

  let revision = 0;
  let loadedServer = false;
  const paneManager = {
    getContentRevision() { return revision; },
    flushSave() {
      storage.setItem(DOC_KEY, JSON.stringify(localContent));
    },
    load() {
      loadedServer = true;
      throw new Error('late server copy must not overwrite a newer editor revision');
    },
    serializeForPersistence() { return structuredClone(localContent); },
    on(type, fn) { callbacks.set(type, fn); },
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
    replaceGlobal('CustomEvent', class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    }),
  ];

  try {
    const paneSource = await import('node:fs/promises').then(({ readFile }) =>
      readFile(new URL('../../src/pane_manager.js', import.meta.url), 'utf8')
    );
    assert.match(paneSource, /getContentRevision\(\)/);
    assert.match(paneSource, /this\._contentRevision\+\+/);

    const mod = await freshModule('startup-edit-vs-server-race');
    const pending = mod.loadInitialState(paneManager);
    await settle();
    assert.equal(typeof releaseDocumentGet, 'function');

    // This models a real TipTap onUpdate while the startup GET is still pending.
    revision++;
    releaseDocumentGet();
    const result = await pending;

    assert.equal(loadedServer, false);
    assert.equal(result.loaded, false);
    assert.equal(result.skipped, 'local-edit-during-server-load');
    assert.deepEqual(JSON.parse(storage.getItem(DOC_KEY)), localContent);
    assert.equal(JSON.parse(storage.getItem(STALE_KEY)).status, 'local-ahead');

    // Once autosync is finally attached by main.js, recovery must be retried
    // even if the user never types another key.
    mod.attachAutoSync(paneManager);
    assert.deepEqual(timers.delays(), [2000, 10000]);
    timers.runByDelay(2000);
    await settle(10);

    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].content, localContent);
    assert.equal(storage.getItem(STALE_KEY), null);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});


test('hung startup document GET times out, cannot load late, and does not block autosync attachment', async () => {
  const localContent = {
    version: 1,
    activeId: 'local',
    panes: [{ id: 'local', paneRole: 'main', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'browser local copy' }] },
    ] } }],
  };
  const lateServerContent = {
    version: 1,
    activeId: 'server',
    panes: [{ id: 'server', paneRole: 'main', content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'late server copy' }] },
    ] } }],
  };

  const storage = fakeStorage({ [DOC_KEY]: JSON.stringify(localContent) });
  const timers = fakeTimers();
  const listeners = new Map();
  const callbacks = new Map();
  const puts = [];
  let releaseDocumentGet;
  let loadedServer = false;

  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent() {},
  };

  const fetchStub = (url, init = {}) => {
    const method = init.method || 'GET';
    if (String(url) === '/api/documents/current' && method === 'GET') {
      return new Promise((resolve) => {
        releaseDocumentGet = () => resolve({
          ok: true,
          status: 200,
          async json() { return { document: { content: lateServerContent } }; },
        });
      });
    }
    if (String(url) === '/api/settings' && method === 'GET') {
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() { return { settings: {} }; },
      });
    }
    if (String(url) === '/api/documents/current' && method === 'PUT') {
      puts.push(JSON.parse(init.body));
      return Promise.resolve({ ok: true, status: 200, async json() { return {}; } });
    }
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };

  const paneManager = {
    getContentRevision() { return 0; },
    load() { loadedServer = true; },
    serializeForPersistence() { return structuredClone(localContent); },
    on(type, fn) { callbacks.set(type, fn); },
    flushSave() {},
  };

  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage),
    replaceGlobal('document', { getElementById: () => null }),
    replaceGlobal('navigator', { sendBeacon: () => true }),
    replaceGlobal('fetch', fetchStub),
    replaceGlobal('setTimeout', timers.setTimeout),
    replaceGlobal('clearTimeout', timers.clearTimeout),
    replaceGlobal('CustomEvent', class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    }),
  ];

  try {
    const mod = await freshModule('startup-document-timeout');
    const pending = mod.loadInitialState(paneManager);
    await settle();

    assert.equal(typeof releaseDocumentGet, 'function');
    assert.deepEqual(timers.delays(), [8000]);

    timers.runByDelay(8000);
    const result = await pending;
    assert.equal(result.loaded, false);
    assert.equal(result.startupTimedOut, true);
    assert.equal(loadedServer, false);
    assert.equal(storage.getItem(STALE_KEY), null,
      'a read timeout alone must not claim that the server is stale');

    // The late GET is now detached from startup control flow. Resolving it
    // later must not apply its document.
    releaseDocumentGet();
    await settle(10);
    assert.equal(loadedServer, false);

    mod.attachAutoSync(paneManager);
    assert.equal(typeof callbacks.get('persist'), 'function');
    assert.deepEqual(timers.delays(), [],
      'timeout alone must not blindly upload an older local snapshot');

    // A subsequent real persistence intent uses the ordinary bounded autosync.
    callbacks.get('persist')();
    assert.deepEqual(timers.delays(), [2000, 10000]);
    timers.runByDelay(2000);
    await settle(10);
    assert.equal(puts.length, 1);
    assert.deepEqual(puts[0].content, localContent);
  } finally {
    for (const restore of restores.reverse()) restore();
  }
});
