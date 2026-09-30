// Pure fast-path policy for StreamMark auto-detection.
//
// A stream pane normally recognizes only its own configured symbol. When
// nested-notes mode is enabled it must additionally recognize any @NN marker,
// because those markers can point from one commentary stream to another.
export function hasPotentialStreamMarker(text, userSymbol, { nestedOn = false } = {}) {
  const value = String(text || "");
  if (!value) return false;

  if (userSymbol && value.includes(String(userSymbol))) return true;

  // Main panes (no userSymbol) always auto-detect numeric stream markers.
  // Stream panes do so as well only when nested notes are enabled.
  if (!userSymbol || nestedOn) return /@\d{1,3}/.test(value);

  return false;
}

export function streamMarkerContextRadius(userSymbol) {
  // Numeric markers need at most four source characters (@ + 3 digits).
  // Custom pane symbols are user-editable and can be longer, so the changed
  // range must include the whole symbol or a newly completed symbol can be
  // missed by the large-document fast path.
  return Math.max(8, String(userSymbol || "").length + 1);
}


export function streamMarkerScanMode({
  forceScan = false,
  docChanged = false,
  transactionMapCounts = [],
} = {}) {
  if (forceScan) return "full";
  if (!docChanged) return "none";

  // The changed-range coordinates used by stream_mark.js are directly
  // comparable to oldState/newState only for the overwhelmingly common
  // single-transaction, single-StepMap edit (normal typing/backspace).
  // Multi-step transforms deliberately keep the conservative full scan.
  return transactionMapCounts.length === 1 && transactionMapCounts[0] === 1
    ? "changed-range"
    : "full";
}
