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
