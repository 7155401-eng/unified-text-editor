/**
 * One routing decision for every Word-note import path.
 *
 * The rich-body/Mammoth path and the XML/plain path must call this exact
 * function. If they classify the same Word note differently, the body can
 * contain a stream reference whose note was never added to that stream,
 * shifting every later link.
 */
export function resolveWordNoteRouting(
  noteText,
  markerToSymbol = {},
  noneSymbol = null,
  {
    skipEmptyNotes = true,
    markerMatchMode = "contains",
  } = {}
) {
  const raw = String(noteText ?? "");

  if (skipEmptyNotes && !raw.trim()) {
    return { symbol: null, text: "", marker: null };
  }

  const found = raw.match(/@(\d+)/);
  if (found && Object.prototype.hasOwnProperty.call(markerToSymbol || {}, found[1])) {
    const marker = found[1];
    const symbol = markerToSymbol[marker];

    // Word-import routing markers are numeric by definition, so marker can be
    // embedded safely in these regexes without a second escaping implementation.
    if (markerMatchMode === "starts") {
      const pattern = new RegExp("^\\s*@" + marker + "\\s*:?\\s*");
      if (!pattern.test(raw)) {
        return { symbol: null, text: raw.trim(), marker: null };
      }
      const stripped = raw.replace(pattern, "").trim();
      if (skipEmptyNotes && !stripped) {
        return { symbol: null, text: "", marker: null };
      }
      return { symbol, text: stripped, marker };
    }

    const stripped = raw.replace(new RegExp("@" + marker + "\\s*:?\\s*"), "").trim();
    if (skipEmptyNotes && !stripped) {
      return { symbol: null, text: "", marker: null };
    }
    return { symbol, text: stripped, marker };
  }

  // A note containing an unselected @NN is not an "unmarked" note.
  if (noneSymbol && !found) {
    const stripped = raw.trim();
    if (skipEmptyNotes && !stripped) {
      return { symbol: null, text: "", marker: null };
    }
    return { symbol: noneSymbol, text: stripped, marker: null };
  }

  return { symbol: null, text: raw.trim(), marker: null };
}
