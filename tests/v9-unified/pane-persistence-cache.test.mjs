import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EditorJsonSnapshotCache } from '../../src/editor_json_snapshot_cache.js';

test('editor JSON snapshot is reused only while ProseMirror doc identity is unchanged', () => {
  const cache = new EditorJsonSnapshotCache();
  let calls = 0;
  const doc1 = { id: 1 };
  const doc2 = { id: 2 };
  const editor = {
    state: { doc: doc1 },
    getJSON() {
      calls++;
      return { call: calls, doc: this.state.doc.id };
    },
  };

  const first = cache.get(editor);
  const second = cache.get(editor);
  assert.equal(calls, 1);
  assert.strictEqual(second, first);

  // ProseMirror replaces state.doc for every document-changing transaction,
  // including transactions whose onUpdate notification is suppressed.
  editor.state.doc = doc2;
  const third = cache.get(editor);
  assert.equal(calls, 2);
  assert.notStrictEqual(third, first);
  assert.deepEqual(third, { call: 2, doc: 2 });

  assert.strictEqual(cache.get(editor), third);
  assert.equal(calls, 2);

  cache.invalidate(editor);
  cache.get(editor);
  assert.equal(calls, 3);
});

test('snapshot cache is editor-scoped even when two editors expose the same doc object', () => {
  const cache = new EditorJsonSnapshotCache();
  const sharedDoc = {};
  let a = 0;
  let b = 0;
  const editorA = { state: { doc: sharedDoc }, getJSON: () => ({ a: ++a }) };
  const editorB = { state: { doc: sharedDoc }, getJSON: () => ({ b: ++b }) };

  assert.deepEqual(cache.get(editorA), { a: 1 });
  assert.deepEqual(cache.get(editorB), { b: 1 });
  cache.get(editorA);
  cache.get(editorB);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('persistence path uses cached pane JSON while public serialize remains fresh', async () => {
  const pane = await readFile(new URL('../../src/pane_manager.js', import.meta.url), 'utf8');
  const server = await readFile(new URL('../../src/server_persistence.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../../src/main.js', import.meta.url), 'utf8');

  assert.match(pane, /serialize\(\)[\s\S]*?this\.panes\.map\(p => p\.serialize\(\)\)/);
  assert.match(pane, /serializeForPersistence\(\)[\s\S]*?_storageJsonCache\.get\(p\.editor\)/);
  assert.match(pane, /JSON\.stringify\(this\.serializeForPersistence\(\)\)/);

  assert.match(server, /typeof paneManager\.serializeForPersistence === 'function'[\s\S]*?paneManager\.serializeForPersistence\(\)/);
  assert.match(server, /pagehide[\s\S]*?serializeForPersistence/);

  assert.match(main, /beforeunload", flushLocalPaneState/);
  assert.match(main, /pagehide", flushLocalPaneState/);
  assert.match(main, /visibilitychange"[\s\S]*?visibilityState === "hidden"[\s\S]*?flushLocalPaneState/);
});
