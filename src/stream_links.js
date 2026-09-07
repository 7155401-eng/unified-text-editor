// Per-stream "notes on notes" links.
//
// The rule Moshe asked for: every stream pane that takes part in
// notes-on-notes may choose which OTHER stream(s) it is allowed to hang
// from. By default a stream is linked to the main text only — its notes
// are pulled by `@XX` markers in the MAIN pane and nowhere else.
//
// Shape stored in localStorage under STREAM_LINKS_STORAGE_KEY:
//   { "02": ["01"], "03": ["01", "02"] }
// read as: "stream 02's notes may attach to an @02 marker found inside a
// note that belongs to stream 01".
//
// Missing key, empty object or an empty list all mean the same thing:
// main only. That is the default, so an untouched installation behaves
// exactly like "linked to the main only".
//
// Nothing here touches the MAIN pane path — markers in the main body are
// never gated, they always pull their stream's next note.

export const STREAM_LINKS_STORAGE_KEY = "ravtext.streamLinks.v1";
export const STREAM_LINKS_CHANGED_EVENT = "ravtext:stream-links-changed";

let _cache = null;
let _cacheLoaded = false;

function normCode(value) {
  return String(value == null ? "" : value).trim();
}

// Defensive: storage can hold anything (hand-edited, older build, corrupt).
// Everything that is not a clean child -> [parents] mapping is dropped.
function sanitize(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of Object.keys(raw)) {
    const child = normCode(key);
    if (!child) continue;
    const list = raw[key];
    if (!Array.isArray(list)) continue;
    const parents = [];
    for (const entry of list) {
      const parent = normCode(entry);
      // A stream nesting inside itself is meaningless and the engine
      // already refuses it — drop it here so it never reaches storage.
      if (!parent || parent === child) continue;
      if (parents.indexOf(parent) === -1) parents.push(parent);
    }
    if (parents.length) out[child] = parents;
  }
  return out;
}

function readFromStorage() {
  try {
    if (typeof localStorage === "undefined" || !localStorage) return null;
    const raw = localStorage.getItem(STREAM_LINKS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// The whole map. Cached because the engine asks per marker, inside the
// packing loop — re-parsing JSON there would be wasteful.
export function getStreamLinks() {
  if (_cacheLoaded && _cache) return _cache;
  _cache = sanitize(readFromStorage());
  _cacheLoaded = true;
  return _cache;
}

// Parents currently chosen for one stream. Always a fresh array, so a
// caller can sort or splice it without corrupting the cache.
export function getStreamParents(code) {
  const child = normCode(code);
  if (!child) return [];
  const links = getStreamLinks();
  return links[child] ? links[child].slice() : [];
}

// The single question the engine asks: may `childCode`'s next note be
// pulled by a marker sitting inside a note that belongs to `parentCode`?
export function canNestInside(childCode, parentCode) {
  const child = normCode(childCode);
  const parent = normCode(parentCode);
  if (!child || !parent || child === parent) return false;
  const list = getStreamLinks()[child];
  return Array.isArray(list) && list.indexOf(parent) !== -1;
}

function persist(map) {
  const clean = sanitize(map);
  _cache = clean;
  _cacheLoaded = true;
  try {
    if (typeof localStorage !== "undefined" && localStorage) {
      if (Object.keys(clean).length === 0) {
        // Nothing linked anywhere — remove the key instead of storing an
        // empty object, so "never touched" and "reset to default" look the
        // same both on disk and in the cache signature.
        localStorage.removeItem(STREAM_LINKS_STORAGE_KEY);
      } else {
        localStorage.setItem(STREAM_LINKS_STORAGE_KEY, JSON.stringify(clean));
      }
    }
  } catch (_) {}
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(STREAM_LINKS_CHANGED_EVENT, { detail: { links: clean } }));
    }
  } catch (_) {}
  return clean;
}

// Replace the parent list of ONE stream. An empty list means "main only".
export function setStreamParents(code, parents) {
  const child = normCode(code);
  if (!child) return getStreamLinks();
  const next = { ...getStreamLinks() };
  const cleanParents = [];
  for (const entry of Array.isArray(parents) ? parents : []) {
    const parent = normCode(entry);
    if (!parent || parent === child) continue;
    if (cleanParents.indexOf(parent) === -1) cleanParents.push(parent);
  }
  if (cleanParents.length) next[child] = cleanParents;
  else delete next[child];
  return persist(next);
}

// Replace the whole map at once (used by tests and by a future import).
export function setStreamLinks(map) {
  return persist(map);
}

// Storage string exactly as the cache signature should see it, so a change
// of links invalidates the packer's cached content.
export function streamLinksSignature() {
  const links = getStreamLinks();
  const codes = Object.keys(links).sort();
  if (codes.length === 0) return "";
  return codes.map((c) => c + ">" + links[c].slice().sort().join(",")).join(";");
}

// For tests and for another tab writing the same key.
export function _resetStreamLinksCache() {
  _cache = null;
  _cacheLoaded = false;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (event) => {
    if (event && event.key === STREAM_LINKS_STORAGE_KEY) _resetStreamLinksCache();
  });
}
