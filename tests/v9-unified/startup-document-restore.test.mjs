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

test('legacy local demo waits for server before falling back to sample', async () => {
  const order = [];
  const result = await finishInitialDocumentRestore({
    loadedFromStorage: true,
    isLegacyDemoState: () => true,
    loadDeferredLocalRecovery: async () => {
      order.push('unexpected-recovery');
      return false;
    },
    serverInitialStatePromise: Promise.resolve({ loaded: true, source: 'server' }).then((value) => {
      order.push('server');
      return value;
    }),
    loadSample: async () => { order.push('sample'); },
  });

  assert.equal(result.source, 'server');
  assert.deepEqual(order, ['server']);
});
