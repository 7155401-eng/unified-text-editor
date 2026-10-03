import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAutoSync,
  documentPayloadFromContentJson,
  loadInitialState,
  planPagehideBeaconBodies,
  PAGEHIDE_BEACON_BUDGET_BYTES,
  DOCUMENT_SAVE_TIMEOUT_MS,
} from '../../src/server_persistence.js';
import { isStorageBeaconWrite } from '../../worker/storage.js';

const DOC_KEY = 'ravtext.panes.state.v1';
const STALE_KEY = 'ravtext.doc.serverStale.v1';

test('document request envelope reuses the already-serialized content JSON exactly', () => {
  const content = {
    version: 1,
    activeId: 'ראשי-"1"',
    panes: [{
      id: 'main',
      paneRole: 'main',
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: 'אב"ג \\ newline?\nכן' }],
        }],
      },
    }],
  };
  const sig = JSON.stringify(content);
  const payload = documentPayloadFromContentJson(sig);

  assert.equal(payload, `{"content":${sig},"title":""}`);
  assert.deepEqual(JSON.parse(payload), { content, title: '' });
});


test('pagehide beacon planner shares one 64 KiB budget and prioritizes document', () => {
  const documentBody = 'd'.repeat(40 * 1024);
  const settingsBody = 's'.repeat(30 * 1024);
  const plan = planPagehideBeaconBodies({ documentBody, settingsBody });

  assert.equal(PAGEHIDE_BEACON_BUDGET_BYTES, 64 * 1024);
  assert.equal(plan.documentFits, true);
  assert.equal(plan.documentBody, documentBody);
  assert.equal(plan.settingsFits, false);
  assert.equal(plan.settingsBody, null);
  assert.equal(plan.remainingBytes, PAGEHIDE_BEACON_BUDGET_BYTES - documentBody.length);
});

test('oversized document does not consume beacon budget needed by small settings', () => {
  const documentBody = 'd'.repeat(PAGEHIDE_BEACON_BUDGET_BYTES + 1);
  const settingsBody = 's'.repeat(1024);
  const plan = planPagehideBeaconBodies({ documentBody, settingsBody });

  assert.equal(plan.documentFits, false);
  assert.equal(plan.documentBody, null);
  assert.equal(plan.settingsFits, true);
  assert.equal(plan.settingsBody, settingsBody);
  assert.equal(plan.remainingBytes, PAGEHIDE_BEACON_BUDGET_BYTES - settingsBody.length);
});

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key(i) { return [...data.keys()][i] ?? null; },
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
    dump() { return Object.fromEntries(data); },
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

function browserHarness({ storage, sendBeacon = () => true, fetchImpl = null } = {}) {
  const handlers = new Map();
  const windowStub = {
    __RAVTEXT_AUTH__: { loggedIn: true },
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    dispatchEvent() {},
  };
  const restores = [
    replaceGlobal('window', windowStub),
    replaceGlobal('localStorage', storage || fakeStorage()),
    replaceGlobal('navigator', { sendBeacon }),
    replaceGlobal('document', { getElementById: () => null }),
  ];
  if (fetchImpl) restores.push(replaceGlobal('fetch', fetchImpl));
  return {
    handlers,
    fire(type) {
      for (const fn of handlers.get(type) || []) fn();
    },
    restore() {
      for (const fn of restores.reverse()) fn();
    },
  };
}

test('worker accepts POST only for explicit beacon writes', () => {
  assert.equal(
    isStorageBeaconWrite('POST', new URL('https://example.test/api/documents/current?beacon=1')),
    true
  );
  assert.equal(
    isStorageBeaconWrite('POST', new URL('https://example.test/api/documents/current')),
    false
  );
  assert.equal(
    isStorageBeaconWrite('POST', new URL('https://example.test/api/documents/current?beacon=0')),
    false
  );
  assert.equal(
    isStorageBeaconWrite('PUT', new URL('https://example.test/api/documents/current?beacon=1')),
    false
  );
});

test('pagehide flushes local state, marks server pending, and uses explicit beacon endpoints', () => {
  const storage = fakeStorage();
  const beacons = [];
  const h = browserHarness({
    storage,
    sendBeacon(url, body) {
      beacons.push({ url, body });
      return false;
    },
  });

  let flushes = 0;
  let stringSnapshots = 0;
  let objectSnapshots = 0;
  const content = {
    version: 1,
    activeId: 'main',
    panes: [{ id: 'main', paneRole: 'main', content: { type: 'doc', content: [] } }],
  };
  const paneManager = {
    flushSave() { flushes++; },
    serializeForPersistenceString() {
      stringSnapshots++;
      return JSON.stringify(content);
    },
    serializeForPersistence() {
      objectSnapshots++;
      return content;
    },
  };

  try {
    attachAutoSync(paneManager);
    h.fire('pagehide');

    assert.equal(flushes, 1);
    assert.equal(stringSnapshots, 1, 'pagehide should reuse the prepared persistence string');
    assert.equal(objectSnapshots, 0, 'pagehide should not rebuild a persistence object when the string snapshot exists');
    const stale = JSON.parse(storage.getItem(STALE_KEY));
    assert.equal(stale.status, 'pagehide-pending');
    assert.ok(stale.chars > 0);

    assert.ok(
      beacons.some(({ url }) => url === '/api/documents/current?beacon=1'),
      'document beacon did not use explicit beacon endpoint'
    );
    assert.ok(
      beacons.some(({ url }) => url === '/api/settings?beacon=1'),
      'settings beacon did not use explicit beacon endpoint'
    );
  } finally {
    h.restore();
  }
});

test('pagehide skips oversized document beacon but keeps stale protection and sends small settings', () => {
  const storage = fakeStorage({ 'ravtext.theme': 'dark' });
  const beacons = [];
  const h = browserHarness({
    storage,
    sendBeacon(url, body) {
      beacons.push({ url, body });
      return true;
    },
  });

  const hugeText = 'x'.repeat(PAGEHIDE_BEACON_BUDGET_BYTES + 8192);
  const content = {
    version: 1,
    activeId: 'main',
    panes: [{
      id: 'main',
      paneRole: 'main',
      content: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: hugeText }],
        }],
      },
    }],
  };
  const paneManager = {
    flushSave() {},
    serializeForPersistenceString() { return JSON.stringify(content); },
  };

  try {
    attachAutoSync(paneManager);
    h.fire('pagehide');

    const stale = JSON.parse(storage.getItem(STALE_KEY));
    assert.equal(stale.status, 'pagehide-pending');
    assert.ok(stale.chars > PAGEHIDE_BEACON_BUDGET_BYTES);

    assert.equal(
      beacons.some(({ url }) => url === '/api/documents/current?beacon=1'),
      false,
      'oversized document beacon should not be attempted'
    );
    assert.equal(
      beacons.some(({ url }) => url === '/api/settings?beacon=1'),
      true,
      'small settings beacon should still use the remaining budget'
    );
  } finally {
    h.restore();
  }
});

test('network exception during normal document sync marks server stale', async () => {
  const storage = fakeStorage();
  const h = browserHarness({
    storage,
    fetchImpl: async (url) => {
      if (String(url).includes('/api/documents/current')) {
        throw new TypeError('network down');
      }
      return { ok: true, async json() { return { settings: {} }; } };
    },
  });

  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const skippedLongTimers = new Set();
  let fakeTimerId = 1;
  globalThis.setTimeout = (fn, delay = 0) => {
    const id = fakeTimerId++;
    if (delay >= DOCUMENT_SAVE_TIMEOUT_MS) {
      skippedLongTimers.add(id);
      return id;
    }
    queueMicrotask(fn);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    skippedLongTimers.delete(id);
  };

  const content = {
    version: 1,
    activeId: 'network-case',
    panes: [{
      id: 'network-case',
      paneRole: 'main',
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'unsent-newer-text' }] }],
      },
    }],
  };
  const paneManager = {
    serializeForPersistence() { return content; },
    flushSave() {},
  };

  try {
    attachAutoSync(paneManager);
    h.fire('ravtext:engine-rendered');
    await new Promise(resolve => queueMicrotask(resolve));
    await new Promise(resolve => queueMicrotask(resolve));

    const staleRaw = storage.getItem(STALE_KEY);
    assert.ok(staleRaw, 'network exception did not mark the server copy stale');
    const stale = JSON.parse(staleRaw);
    assert.equal(stale.status, 'network-error');
    assert.ok(stale.chars >= JSON.stringify(content).length);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    h.restore();
  }
});

test('pending pagehide protects newer local document from stale server copy', async () => {
  const localContent = {
    version: 1,
    activeId: 'main',
    panes: [{ id: 'main', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'new' }] }] } }],
  };
  const serverContent = {
    version: 1,
    activeId: 'main',
    panes: [{ id: 'main', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] } }],
  };
  const storage = fakeStorage({
    [DOC_KEY]: JSON.stringify(localContent),
    [STALE_KEY]: JSON.stringify({ status: 'pagehide-pending', chars: 123, at: Date.now() }),
  });
  const h = browserHarness({
    storage,
    fetchImpl: async (url) => ({
      ok: true,
      async json() {
        if (String(url).includes('/api/documents/current')) return { document: { content: serverContent } };
        return { settings: {} };
      },
    }),
  });

  let loaded = 0;
  try {
    const result = await loadInitialState({ load() { loaded++; } });
    assert.equal(result.loaded, false);
    assert.equal(result.skipped, 'stale-server-copy');
    assert.equal(loaded, 0);
    assert.ok(storage.getItem(STALE_KEY), 'pending stale marker should remain until server catches up');
  } finally {
    h.restore();
  }
});

test('pending pagehide marker clears when server already matches local snapshot', async () => {
  const content = {
    version: 1,
    activeId: 'main',
    panes: [{ id: 'main', content: { type: 'doc', content: [] } }],
  };
  const storage = fakeStorage({
    [DOC_KEY]: JSON.stringify(content),
    [STALE_KEY]: JSON.stringify({ status: 'pagehide-pending', chars: 123, at: Date.now() }),
  });
  const h = browserHarness({
    storage,
    fetchImpl: async (url) => ({
      ok: true,
      async json() {
        if (String(url).includes('/api/documents/current')) return { document: { content } };
        return { settings: {} };
      },
    }),
  });

  let loaded = 0;
  try {
    const result = await loadInitialState({ load() { loaded++; } });
    assert.equal(result.loaded, true);
    assert.equal(loaded, 1);
    assert.equal(storage.getItem(STALE_KEY), null);
  } finally {
    h.restore();
  }
});

test('recovery metadata is excluded from settings synchronization', async () => {
  const source = await readFile(new URL('../../src/server_persistence.js', import.meta.url), 'utf8');
  assert.match(source, /'ravtext\.doc\.serverStale\.'/);
  assert.match(source, /'ravtext\.panes\.state\.v1\.'/);
});
