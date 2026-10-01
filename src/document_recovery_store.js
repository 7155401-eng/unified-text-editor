// Browser-local emergency recovery for large documents.
//
// localStorage remains the primary fast snapshot. IndexedDB is only a second
// safety net for documents large enough to approach localStorage quota, or
// whenever the primary write fails. Keeping this separate avoids slowing the
// normal editing path while still giving oversized documents a durable local
// copy.
//
// The queue is latest-wins: while one IDB transaction is in flight, intermediate
// full-document snapshots have no recovery value. Only the newest waiting
// snapshot (or clear request) is kept.

export const DOCUMENT_RECOVERY_DB_NAME = "ravtext-document-recovery-v1";
export const DOCUMENT_RECOVERY_STORE = "snapshots";
export const DOCUMENT_RECOVERY_KEY = "current";
export const DOCUMENT_RECOVERY_VERSION = 1;
export const DOCUMENT_RECOVERY_MIRROR_MIN_CHARS = 750000;
export const DOCUMENT_RECOVERY_TOMBSTONE_KEY = "ravtext.panes.recoveryClearedAt.v1";

let _queuedOperation = null;
let _drainPromise = Promise.resolve();
let _draining = false;

function getIndexedDB(factory) {
  if (factory !== undefined) return factory;
  try { return globalThis.indexedDB || null; } catch { return null; }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
  });
}

async function openRecoveryDb(factory) {
  const idb = getIndexedDB(factory);
  if (!idb || typeof idb.open !== "function") return null;

  const request = idb.open(DOCUMENT_RECOVERY_DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(DOCUMENT_RECOVERY_STORE)) {
      db.createObjectStore(DOCUMENT_RECOVERY_STORE);
    }
  };
  return requestResult(request);
}

export function shouldMirrorDocumentRecovery(text) {
  return typeof text === "string" && text.length >= DOCUMENT_RECOVERY_MIRROR_MIN_CHARS;
}

export async function writeDocumentRecoverySnapshot(
  text,
  { force = false, now = Date.now(), indexedDBFactory } = {}
) {
  if (typeof text !== "string" || !text) return false;
  if (!force && !shouldMirrorDocumentRecovery(text)) return false;

  let db = null;
  try {
    db = await openRecoveryDb(indexedDBFactory);
    if (!db) return false;
    const tx = db.transaction(DOCUMENT_RECOVERY_STORE, "readwrite");
    tx.objectStore(DOCUMENT_RECOVERY_STORE).put({
      version: DOCUMENT_RECOVERY_VERSION,
      text,
      chars: text.length,
      at: Number(now) || Date.now(),
    }, DOCUMENT_RECOVERY_KEY);
    await transactionDone(tx);
    return true;
  } catch (error) {
    console.warn("[document-recovery] IndexedDB snapshot write failed:", error);
    return false;
  } finally {
    try { db?.close?.(); } catch {}
  }
}

export async function readDocumentRecoverySnapshot({ indexedDBFactory } = {}) {
  let db = null;
  try {
    db = await openRecoveryDb(indexedDBFactory);
    if (!db) return null;
    const tx = db.transaction(DOCUMENT_RECOVERY_STORE, "readonly");
    const value = await requestResult(
      tx.objectStore(DOCUMENT_RECOVERY_STORE).get(DOCUMENT_RECOVERY_KEY)
    );
    await transactionDone(tx);
    if (
      !value ||
      value.version !== DOCUMENT_RECOVERY_VERSION ||
      typeof value.text !== "string" ||
      !value.text
    ) {
      return null;
    }
    return {
      version: value.version,
      text: value.text,
      chars: Number(value.chars) || value.text.length,
      at: Number(value.at) || 0,
    };
  } catch (error) {
    console.warn("[document-recovery] IndexedDB snapshot read failed:", error);
    return null;
  } finally {
    try { db?.close?.(); } catch {}
  }
}

export async function clearDocumentRecoverySnapshot({ indexedDBFactory } = {}) {
  let db = null;
  try {
    db = await openRecoveryDb(indexedDBFactory);
    if (!db) return false;
    const tx = db.transaction(DOCUMENT_RECOVERY_STORE, "readwrite");
    tx.objectStore(DOCUMENT_RECOVERY_STORE).delete(DOCUMENT_RECOVERY_KEY);
    await transactionDone(tx);
    return true;
  } catch (error) {
    console.warn("[document-recovery] IndexedDB snapshot clear failed:", error);
    return false;
  } finally {
    try { db?.close?.(); } catch {}
  }
}

async function performQueuedOperation(operation) {
  if (!operation) return false;
  if (operation.type === "clear") {
    return clearDocumentRecoverySnapshot();
  }
  return writeDocumentRecoverySnapshot(operation.text, {
    force: operation.force,
    now: operation.at,
  });
}

function enqueueRecoveryOperation(operation) {
  _queuedOperation = operation;
  if (_draining) return _drainPromise;

  _draining = true;
  const drain = async () => {
    try {
      let last = false;
      while (_queuedOperation) {
        const next = _queuedOperation;
        _queuedOperation = null;
        last = await performQueuedOperation(next);
      }
      return last;
    } finally {
      _draining = false;
    }
  };

  _drainPromise = _drainPromise.then(drain, drain);
  return _drainPromise;
}

export function queueDocumentRecoverySnapshot(text, { force = false, now = Date.now() } = {}) {
  if (typeof text !== "string" || !text) return Promise.resolve(false);
  if (!force && !shouldMirrorDocumentRecovery(text)) {
    return enqueueRecoveryOperation({ type: "clear" });
  }
  return enqueueRecoveryOperation({
    type: "put",
    text,
    force: true,
    at: Number(now) || Date.now(),
  });
}

export function queueDocumentRecoveryClear() {
  return enqueueRecoveryOperation({ type: "clear" });
}

// Test helper: wait until the current latest-wins queue is fully drained.
export async function flushDocumentRecoveryQueue() {
  await _drainPromise;
  if (_draining) await _drainPromise;
  return true;
}
