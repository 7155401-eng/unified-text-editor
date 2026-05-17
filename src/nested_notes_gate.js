import "./first_note_title.js";

// Feature gate for nested footnotes ("הערה על הערה").
//
// Activated by:
//   • URL param `?nested=1`            — turns the feature on for THIS visit
//                                         AND persists to localStorage so
//                                         subsequent loads keep it on.
//   • URL param `?nested=0`            — turns it off and clears the flag.
//   • localStorage `ravtext.nestedNotes=1` — the persisted state.
//
// Why same-domain URL gate: `https://app.ravtext.com/?nested=1&k=...`
// gives the user a shareable link that opts them in. On the same domain,
// the render preflight succeeds (it gates on origin, not on the feature).
//
// When the gate is OFF:
//   • engine_bridge.js skips the expandNestedInNote pass — `@XX` markers
//     embedded in stream-pane note text stay as literal characters,
//     identical to the pre-feature behavior. Backwards-compatible.
//   • The beginner hint banner is hidden.
// When the gate is ON:
//   • Embedded markers are pulled as children; renderer shows them inline.
//   • The hint banner appears (until dismissed).

const STORAGE_KEY = "ravtext.nestedNotes";

let _cached = null;

export function isNestedNotesEnabled() {
  if (_cached !== null) return _cached;
  if (typeof window === "undefined") return false;
  // URL param wins for this load and writes to storage so subsequent
  // navigation within the same session keeps the choice.
  try {
    const params = new URLSearchParams(window.location.search || "");
    const v = params.get("nested");
    if (v === "1" || v === "true") {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch (_) {}
      _cached = true;
      return true;
    }
    if (v === "0" || v === "false") {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      _cached = false;
      return false;
    }
  } catch (_) {}
  try {
    _cached = localStorage.getItem(STORAGE_KEY) === "1";
  } catch (_) {
    _cached = false;
  }
  return _cached;
}

// For tests: drop the cache so a fresh check re-reads URL + localStorage.
export function _resetNestedNotesGateCache() {
  _cached = null;
}
