import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistenceTextSnapshotCache } from '../../src/persistence_text_snapshot_cache.js';

test('full persistence text is reused while revision, active pane and docs are unchanged', () => {
  let stringifyCalls = 0;
  const cache = new PersistenceTextSnapshotCache((value) => {
    stringifyCalls++;
    return JSON.stringify(value);
  });
  const docA = { id: 'a' };
  const docB = { id: 'b' };
  let builds = 0;

  const make = () => ({ build: ++builds });
  const key = { revision: 7, activeId: 'main', docs: [docA, docB] };

  const first = cache.get(key, make);
  const second = cache.get({ ...key, docs: [docA, docB] }, make);

  assert.equal(second, first);
  assert.equal(builds, 1);
  assert.equal(stringifyCalls, 1);
});

test('revision, active pane or silent ProseMirror doc replacement invalidates full text cache', () => {
  const cache = new PersistenceTextSnapshotCache();
  const docA = { id: 'a' };
  const docB = { id: 'b' };
  const docC = { id: 'c' };
  let builds = 0;
  const make = () => ({ build: ++builds });

  cache.get({ revision: 1, activeId: 'a', docs: [docA, docB] }, make);
  cache.get({ revision: 2, activeId: 'a', docs: [docA, docB] }, make);
  cache.get({ revision: 2, activeId: 'b', docs: [docA, docB] }, make);
  cache.get({ revision: 2, activeId: 'b', docs: [docA, docC] }, make);

  assert.equal(builds, 4);
});

test('explicit invalidation prevents stale reuse', () => {
  const cache = new PersistenceTextSnapshotCache();
  const doc = {};
  let builds = 0;
  const key = { revision: 1, activeId: 'main', docs: [doc] };

  cache.get(key, () => ({ build: ++builds }));
  cache.invalidate();
  cache.get(key, () => ({ build: ++builds }));

  assert.equal(builds, 2);
});
