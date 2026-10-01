import test from 'node:test';
import assert from 'node:assert/strict';
import { finishInitialDocumentRestore } from '../../src/startup_document_restore.js';

test('valid fast local state reconciles recovery once without waiting for server/sample', async () => {
  let recovery = 0, serverObserved = 0, sample = 0;
  const server = Promise.resolve().then(() => {
    serverObserved++;
    return { loaded: true, source: 'server' };
  });

  const result = await finishInitialDocumentRestore({
    loadedFromStorage: true,
    isLegacyDemoState: () => false,
    loadDeferredLocalRecovery: async () => { recovery++; return false; },
    serverInitialStatePromise: server,
    loadSample: async () => { sample++; },
  });

  assert.equal(result.source, 'local-storage');
  assert.equal(recovery, 1);
  assert.equal(sample, 0);
  await server;
  assert.equal(serverObserved, 1);
});

test('deferred local recovery wins over the already-running server request', async () => {
  let resolveServer;
  const order = [];
  const server = new Promise((resolve) => { resolveServer = resolve; });

  const pending = finishInitialDocumentRestore({
    loadedFromStorage: false,
    isLegacyDemoState: () => false,
    loadDeferredLocalRecovery: async () => {
      order.push('recovery');
      return true;
    },
    serverInitialStatePromise: server,
    loadSample: async () => { order.push('sample'); },
  });

  const result = await pending;
  assert.deepEqual(order, ['recovery']);
  assert.equal(result.source, 'local-recovery');
  resolveServer({ loaded: true, source: 'server' });
});

test('server restore completes before sample fallback and prevents sample overwrite', async () => {
  const order = [];
  let resolveServer;
  const server = new Promise((resolve) => { resolveServer = resolve; });

  const pending = finishInitialDocumentRestore({
    loadedFromStorage: false,
    isLegacyDemoState: () => false,
    loadDeferredLocalRecovery: async () => {
      order.push('recovery-miss');
      return false;
    },
    serverInitialStatePromise: server.then((value) => {
      order.push('server');
      return value;
    }),
    loadSample: async () => { order.push('sample'); },
  });

  await Promise.resolve();
  assert.deepEqual(order, ['recovery-miss']);
  resolveServer({ loaded: true, source: 'server' });

  const result = await pending;
  assert.equal(result.source, 'server');
  assert.deepEqual(order, ['recovery-miss', 'server']);
});

test('sample runs only after recovery misses and server confirms no document', async () => {
  const order = [];
  const result = await finishInitialDocumentRestore({
    loadedFromStorage: false,
    isLegacyDemoState: () => false,
    loadDeferredLocalRecovery: async () => {
      order.push('recovery-miss');
      return false;
    },
    serverInitialStatePromise: Promise.resolve({ loaded: false }).then((value) => {
      order.push('server-empty');
      return value;
    }),
    loadSample: async () => { order.push('sample'); },
  });

  assert.equal(result.source, 'sample');
  assert.deepEqual(order, ['recovery-miss', 'server-empty', 'sample']);
});

test('legacy local demo checks emergency recovery before waiting for server', async () => {
  const order = [];
  const result = await finishInitialDocumentRestore({
    loadedFromStorage: true,
    isLegacyDemoState: () => true,
    loadDeferredLocalRecovery: async () => {
      order.push('recovery-miss');
      return false;
    },
    serverInitialStatePromise: Promise.resolve({ loaded: true, source: 'server' }).then((value) => {
      order.push('server');
      return value;
    }),
    loadSample: async () => { order.push('sample'); },
  });

  assert.equal(result.source, 'server');
  assert.deepEqual(order, ['recovery-miss', 'server']);
  assert(!order.includes('sample'),'sample raced ahead of the server after a recovery miss');
});


test('real loadInitialState waits for browser-local authority before applying server document', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;

  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => data.has(String(k)) ? data.get(String(k)) : null,
    setItem: (k,v) => data.set(String(k), String(v)),
    removeItem: (k) => data.delete(String(k)),
    key: (i) => [...data.keys()][i] ?? null,
    get length(){ return data.size; },
  };
  globalThis.window = { __RAVTEXT_AUTH__: { loggedIn: true } };
  const serverContent = { version:1, panes:[{ id:'server', content:{ type:'doc', content:[] } }] };
  globalThis.fetch = async (url) => ({
    ok: true,
    status: 200,
    json: async () => String(url).includes('/api/settings')
      ? { settings:{} }
      : { document:{ content:serverContent } },
  });

  let releaseGate;
  const gate = new Promise((resolve) => { releaseGate = resolve; });
  let loads = 0;
  const manager = {
    getContentRevision: () => 0,
    load: () => { loads++; },
    flushSave() {},
  };

  try {
    const mod = await import('../../src/server_persistence.js?startup-authority-gate-test');
    const pending = mod.loadInitialState(manager, {
      mayApplyDocument: async () => await gate,
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(loads, 0, 'server document applied before local authority resolved');

    releaseGate(false);
    const result = await pending;
    assert.equal(loads, 0, 'server document overwrote browser-local authoritative state');
    assert.equal(result.skipped, 'browser-local-startup-authoritative');
    assert.equal(result.serverDocumentAvailable, true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});

test('main startup always reconciles emergency recovery even after fast localStorage load', async () => {
  const fs = await import('node:fs');
  const mainSource = fs.readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /const loadedFromStorage = paneManager\.loadFromStorage\(\);/);
  assert.match(mainSource, /let initialLoadPromise = finishInitialDocumentRestore\(\{/);
  assert(!/if\s*\(!loadedFromStorage\s*\|\|\s*isLegacyDemoState\(\)\)\s*\{\s*initialLoadPromise\s*=\s*finishInitialDocumentRestore/s.test(mainSource),
    'recovery reconciliation is still skipped whenever fast localStorage succeeds');
  assert.match(mainSource, /mayApplyDocument:\s*async\s*\(\)\s*=>\s*!\(await startupLocalAuthorityPromise\)/);
});
