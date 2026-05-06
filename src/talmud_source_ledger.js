// talmud_source_ledger.js — Source-of-truth registry for split DOM parts.
//
// Per v3 spec part 2.7 + GPT-3:
// Every element created from existing content is recorded here.
// On unwrap, restoration uses the ledger (not class search) so that content
// is never lost or mis-merged even if classes drift.
//
// One ledger lives per pageEl, keyed in a WeakMap so GC reclaims it
// automatically when pages are recycled.

const _pageLedgers = new WeakMap();

/**
 * Returns the ledger for a pageEl, creating it lazily.
 * @param {HTMLElement} pageEl
 * @returns {{sources: Map<string, SourceRecord>}}
 */
export function getLedger(pageEl) {
  let ledger = _pageLedgers.get(pageEl);
  if (!ledger) {
    ledger = { sources: new Map() };
    _pageLedgers.set(pageEl, ledger);
  }
  return ledger;
}

export function clearLedger(pageEl) {
  const ledger = _pageLedgers.get(pageEl);
  if (ledger) ledger.sources.clear();
}

let _idCounter = 0;
function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  _idCounter++;
  return `tlm-src-${Date.now().toString(36)}-${_idCounter}`;
}

/**
 * @typedef {Object} SourceRecord
 * @property {string} sourceId
 * @property {HTMLElement} originalEl  — the pre-mutation element
 * @property {DocumentFragment} originalFragment  — frozen clone of original children
 * @property {string} originalClassName
 * @property {string|null} originalStyle
 * @property {Array<{role: string, el: HTMLElement, order: number}>} parts
 */

/**
 * Snapshot a stream BEFORE mutation. Returns a sourceId.
 * Stores the original children as a cloned fragment so restore is safe
 * even if the original element is re-purposed.
 *
 * @param {HTMLElement} pageEl
 * @param {HTMLElement} el
 * @returns {string}
 */
export function recordSource(pageEl, el) {
  if (!el) return "";
  const ledger = getLedger(pageEl);
  // Already recorded? Reuse.
  for (const [sid, rec] of ledger.sources) {
    if (rec.originalEl === el) return sid;
  }
  const sourceId = genId();
  const fragmentClone = document.createDocumentFragment();
  for (const child of Array.from(el.childNodes)) {
    fragmentClone.appendChild(child.cloneNode(true));
  }
  ledger.sources.set(sourceId, {
    sourceId,
    originalEl: el,
    originalFragment: fragmentClone,
    originalClassName: el.className || "",
    originalStyle: el.getAttribute("style"),
    parts: [],
  });
  el.dataset.talmudSourceId = sourceId;
  return sourceId;
}

/**
 * Record a derived part (crown/body/expanded/single-half) tied to a source.
 *
 * @param {HTMLElement} pageEl
 * @param {string} sourceId
 * @param {"crown"|"body"|"expanded"|"single-half-1"|"single-half-2"} role
 * @param {HTMLElement} partEl
 */
export function recordPart(pageEl, sourceId, role, partEl) {
  if (!sourceId || !partEl) return;
  const ledger = getLedger(pageEl);
  const source = ledger.sources.get(sourceId);
  if (!source) return;
  const order = source.parts.length;
  partEl.dataset.talmudSourceId = sourceId;
  partEl.dataset.talmudPart = role;
  partEl.dataset.talmudOrder = String(order);
  source.parts.push({ role, el: partEl, order });
}

/**
 * Restore one source: re-content originalEl from frozen fragment, drop parts.
 *
 * Critical: clone the stored fragment so the ledger fragment remains intact
 * (idempotent restore — useful for TOGGLE-IDEMPOTENT invariant).
 *
 * @param {SourceRecord} source
 */
export function restoreSource(source) {
  const { originalEl, originalFragment, originalClassName, originalStyle, parts } = source;
  if (!originalEl) return;
  // Drop derived parts first (so ids don't double-occur).
  for (const part of parts) {
    if (part.el && part.el !== originalEl && part.el.parentNode) {
      part.el.remove();
    }
  }
  // Reset originalEl and re-fill from frozen clone.
  originalEl.replaceChildren(originalFragment.cloneNode(true));
  originalEl.className = originalClassName;
  if (originalStyle) originalEl.setAttribute("style", originalStyle);
  else originalEl.removeAttribute("style");
  delete originalEl.dataset.talmudSourceId;
  delete originalEl.dataset.talmudPart;
  delete originalEl.dataset.talmudOrder;
  delete originalEl.dataset.talmudBodyOf;
  delete originalEl.dataset.talmudRole;
  delete originalEl.dataset.talmudVirtualHalf;
  // Clear part ids defensively (in case they were re-attached).
  for (const part of parts) {
    if (part.el && part.el.dataset) {
      delete part.el.dataset.talmudSourceId;
      delete part.el.dataset.talmudPart;
      delete part.el.dataset.talmudOrder;
    }
  }
}

/**
 * Restore every source recorded for this page.
 * @param {HTMLElement} pageEl
 */
export function restoreAll(pageEl) {
  const ledger = _pageLedgers.get(pageEl);
  if (!ledger) return;
  for (const source of ledger.sources.values()) {
    restoreSource(source);
  }
  ledger.sources.clear();
}

/**
 * Single-commentary special-case: parts share one source.
 * On restore, we sort by order and merge their children back into originalEl.
 *
 * @param {SourceRecord} source
 */
export function restoreSingleCommentary(source) {
  const parts = source.parts.slice().sort((a, b) => a.order - b.order);
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    // Strip duplicated stream-title from second half (if it was cloned).
    if (part.role === "single-half-2") {
      const dupTitle = part.el.querySelector(":scope > .stream-title");
      if (dupTitle) dupTitle.remove();
    }
    while (part.el.firstChild) fragment.appendChild(part.el.firstChild);
    if (part.el !== source.originalEl) part.el.remove();
  }
  source.originalEl.replaceChildren(fragment);
  source.originalEl.className = source.originalClassName;
  if (source.originalStyle) source.originalEl.setAttribute("style", source.originalStyle);
  else source.originalEl.removeAttribute("style");
}
