// Cache editor JSON by immutable ProseMirror document identity.
//
// TipTap/ProseMirror replaces editor.state.doc whenever document content changes,
// including transactions that suppress onUpdate. Reusing getJSON() while the
// exact doc object is unchanged is therefore safe for persistence snapshots and
// avoids walking every untouched editor on each autosave.
export class EditorJsonSnapshotCache {
  constructor() {
    this._entries = new WeakMap();
  }

  get(editor) {
    if (!editor || typeof editor.getJSON !== "function") return null;
    const doc = editor.state?.doc ?? null;
    const hit = this._entries.get(editor);
    if (hit && hit.doc === doc) return hit.value;

    const value = editor.getJSON();
    this._entries.set(editor, { doc, value });
    return value;
  }

  invalidate(editor) {
    if (editor) this._entries.delete(editor);
  }
}
