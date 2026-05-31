import { readFileSync, writeFileSync } from 'node:fs';

const TARGET = 'src/word_extractor/word_extractor_dialog.js';

let src = readFileSync(TARGET, 'utf8');

// משה 2026-05-31: ה-functionality הזה (Web Worker + IndexedDB cache לסריקת
// DOCX, fileHash, scan/extract caching) כבר נכלל ישירות בקוד של
// word_extractor_dialog.js — אבל בשמות `workerScan` / `workerExtract` במקום
// `safeWorkerScan` / `safeWorkerExtract`. ה-patch הזה רק יוסיף נספח כפול
// שייכשל ב-build. אם המצב כבר נכון — לדלג ב-no-op בלי process.exit (קריאה
// מ-vite.config.js → exit עוצר את כל הקונפיג).
const _superseded =
  src.includes('async function workerScan') &&
  src.includes('async function idbGet') &&
  src.includes('async function fileHash') &&
  src.includes('IDB_STORE_SCAN');

function replaceOnce(needle, replacement, label) {
  if (!src.includes(needle)) {
    throw new Error(`[word-extractor-freeze-patch] Missing anchor: ${label}`);
  }
  src = src.replace(needle, replacement);
}

if (_superseded) {
  console.log('[word-extractor-freeze-patch] superseded — current file already wires worker+IDB scan/extract; no-op');
} else {

if (!src.includes('fileHash: null,')) {
  replaceOnce(
    '  zipBuf: null,\n',
    '  zipBuf: null,\n  fileHash: null,\n',
    'state zipBuf'
  );
}

const helperAnchor = '};\n\nconst BRACKET_SERIES_DEFAULTS';
const helperBlock = `// =====================================================================
// Web Worker + IndexedDB cache — keeps heavy DOCX XML parsing off the UI
// =====================================================================

let _worker = null;
let _workerPending = new Map();
let _workerIdCounter = 0;

function _getWorker() {
  if (!_worker) {
    _worker = new Worker(new URL('./word_extractor.worker.js', import.meta.url), { type: 'module' });
    _worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data || {};
      const pending = _workerPending.get(id);
      if (!pending) return;
      _workerPending.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error || 'Word extractor worker error'));
    };
    _worker.onerror = (err) => {
      console.warn('[word_extractor] worker crashed:', err);
      for (const [, pending] of _workerPending) {
        pending.reject(new Error('Word extractor worker crashed: ' + (err?.message || String(err))));
      }
      _workerPending.clear();
      _worker = null;
    };
  }
  return _worker;
}

function _workerCall(type, payload) {
  return new Promise((resolve, reject) => {
    const id = ++_workerIdCounter;
    _workerPending.set(id, { resolve, reject });
    _getWorker().postMessage({ type, id, payload });
  });
}

async function workerScan(buf) {
  return _workerCall('scan', { buf });
}

async function workerExtract(buf, simpleSelected, options) {
  return _workerCall('extract', { buf, simpleSelected, options });
}

async function safeWorkerScan(buf) {
  try {
    return await workerScan(buf);
  } catch (e) {
    console.warn('[word_extractor] worker scan failed; falling back to main thread:', e);
    const [titles, headerFooter, sections, styles, sources, stylesFull] = await Promise.all([
      extract_doc_titles(buf.slice(0)),
      extract_headers_footers(buf.slice(0)),
      find_sections_in_docx(buf.slice(0)),
      find_all_styles_in_docx(buf.slice(0)),
      find_all_note_sources(buf.slice(0)),
      engine.find_all_styles_full(buf.slice(0)),
    ]);
    return { titles, headerFooter, sections, styles, sources, stylesFull };
  }
}

async function safeWorkerExtract(buf, simpleSelected, options) {
  try {
    return await workerExtract(buf, simpleSelected, options);
  } catch (e) {
    console.warn('[word_extractor] worker extract failed; falling back to main thread:', e);
    return engine.docx_extract_simple(buf.slice(0), simpleSelected, options);
  }
}

const IDB_NAME = 'ravtext-extract';
const IDB_STORE_SCAN = 'scans';
const IDB_STORE_EXTRACT = 'extracts';

function _openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE_SCAN)) db.createObjectStore(IDB_STORE_SCAN);
      if (!db.objectStoreNames.contains(IDB_STORE_EXTRACT)) db.createObjectStore(IDB_STORE_EXTRACT);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(store, key) {
  try {
    const db = await _openIdb();
    return await new Promise((resolve) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function idbSet(store, key, value) {
  try {
    const db = await _openIdb();
    await new Promise((resolve) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch {
    // Cache is opportunistic only.
  }
}

async function fileHash(buf) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
`;

if (!src.includes('async function safeWorkerScan')) {
  replaceOnce(
    helperAnchor,
    `};\n\n${helperBlock}\n\nconst BRACKET_SERIES_DEFAULTS`,
    'helper insertion'
  );
}

const scanNeedle = `    _state.zipBuf = await file.arrayBuffer();
    const [titles, headerFooter, sections, styles, sources, stylesFull] = await Promise.all([
      extract_doc_titles(_state.zipBuf.slice(0)),
      extract_headers_footers(_state.zipBuf.slice(0)),
      find_sections_in_docx(_state.zipBuf.slice(0)),
      find_all_styles_in_docx(_state.zipBuf.slice(0)),
      find_all_note_sources(_state.zipBuf.slice(0)),
      engine.find_all_styles_full(_state.zipBuf.slice(0)),
    ]);
    _state.metadata = { titles, headerFooter, sections, styles };`;

const scanReplacement = `    _state.zipBuf = await file.arrayBuffer();
    setStatus('סורק את המסמך... (הדפדפן לא קופא)');

    const hash = await fileHash(_state.zipBuf);
    _state.fileHash = hash;
    let scanResult = hash ? await idbGet(IDB_STORE_SCAN, hash) : null;

    if (!scanResult) {
      scanResult = await safeWorkerScan(_state.zipBuf.slice(0));
      if (hash) await idbSet(IDB_STORE_SCAN, hash, scanResult);
    }

    const { titles, headerFooter, sections, styles, sources, stylesFull } = scanResult;
    _state.metadata = { titles, headerFooter, sections, styles };`;

if (src.includes(scanNeedle)) {
  src = src.replace(scanNeedle, scanReplacement);
} else if (!src.includes('let scanResult = hash ? await idbGet(IDB_STORE_SCAN, hash) : null;')) {
  throw new Error('[word-extractor-freeze-patch] Missing scan block anchor');
}

const extractReplacement = `    const selKey = _state.fileHash
      ? _state.fileHash + '-' + JSON.stringify(simpleSelected) + (skipEmptyNotes ? '-s' : '') + '-' + markerMatchMode
      : null;
    let result = selKey ? await idbGet(IDB_STORE_EXTRACT, selKey) : null;

    if (!result) {
      setStatus('מחלץ הערות... (הדפדפן לא קופא)');
      result = await safeWorkerExtract(_state.zipBuf.slice(0), simpleSelected, {
        notesHtmlMap,
        skipEmptyNotes,
        markerMatchMode,
      });
      if (selKey) await idbSet(IDB_STORE_EXTRACT, selKey, result);
    }`;

const extractRe = /    const result = await engine\.docx_extract_simple\(\n\s+_state\.zipBuf\.slice\(0\),\s*simpleSelected,\s*\{\s*\n\s+notesHtmlMap,\s*\n\s+skipEmptyNotes,\s*\n\s+markerMatchMode\s*\n\s+\}\s*\n\s+\);/;

if (extractRe.test(src)) {
  src = src.replace(extractRe, extractReplacement);
} else if (!src.includes('let result = selKey ? await idbGet(IDB_STORE_EXTRACT, selKey) : null;')) {
  throw new Error('[word-extractor-freeze-patch] Missing extract block anchor');
}

const resetNeedle = `  _state.zipBuf = null;
  _state.sources = [];`;
if (src.includes(resetNeedle) && !src.includes('  _state.fileHash = null;\n  _state.sources = [];')) {
  src = src.replace(resetNeedle, `  _state.zipBuf = null;\n  _state.fileHash = null;\n  _state.sources = [];`);
}

writeFileSync(TARGET, src, 'utf8');
} // end of !_superseded
