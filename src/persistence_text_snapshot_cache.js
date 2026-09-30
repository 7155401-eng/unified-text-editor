// Cache the full persistence JSON string while all observable persistence
// inputs remain identical.
//
// Revision catches normal text/metadata edits routed through PaneManager._save().
// activeId is included because focus can change without scheduling a save.
// ProseMirror state.doc identities catch silent programmatic document changes
// performed with emitUpdate:false.
export class PersistenceTextSnapshotCache {
  constructor(stringify = JSON.stringify) {
    this._stringify = stringify;
    this.invalidate();
  }

  _sameDocs(docs) {
    if (!Array.isArray(docs) || docs.length !== this._docs.length) return false;
    for (let i = 0; i < docs.length; i++) {
      if (docs[i] !== this._docs[i]) return false;
    }
    return true;
  }

  get({ revision = 0, activeId = null, docs = [] } = {}, createValue) {
    if (
      this._hasValue &&
      revision === this._revision &&
      activeId === this._activeId &&
      this._sameDocs(docs)
    ) {
      return this._text;
    }

    if (typeof createValue !== "function") {
      throw new TypeError("createValue must be a function");
    }

    const text = this._stringify(createValue());
    this._revision = revision;
    this._activeId = activeId;
    this._docs = Array.from(docs);
    this._text = text;
    this._hasValue = true;
    return text;
  }

  invalidate() {
    this._revision = null;
    this._activeId = null;
    this._docs = [];
    this._text = null;
    this._hasValue = false;
  }
}
