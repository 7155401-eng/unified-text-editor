// Shared V9 classification for zero-width standalone direction controls.
//
// These characters must satisfy two constraints at once:
// 1. layout/tokenization: they are not words and must never consume a
//    justification slot or visible width;
// 2. final DOM: they MUST remain in the character stream so the Unicode BiDi
//    algorithm can resolve nearby neutral punctuation correctly.
//
// Keep this list to standalone marks only. Paired embedding/isolate controls
// (LRE/RLE/LRI/RLI/FSI/PDI/PDF) have scoped semantics and are intentionally not
// reclassified here.
const STANDALONE_DIRECTION_CONTROLS = new Set([
  "\u061c", // ARABIC LETTER MARK
  "\u200e", // LEFT-TO-RIGHT MARK
  "\u200f", // RIGHT-TO-LEFT MARK
  "\u2060", // WORD JOINER (zero-width source glue; not directional but layout-neutral)
]);

export function isV9StandaloneDirectionControl(ch) {
  return STANDALONE_DIRECTION_CONTROLS.has(String(ch || ""));
}

export function isV9StandaloneDirectionControlOnly(text) {
  const value = String(text || "");
  if (!value) return false;
  for (const ch of value) {
    if (!isV9StandaloneDirectionControl(ch)) return false;
  }
  return true;
}

export function splitV9EdgeGlue(rawText) {
  const raw = String(rawText || "");
  let start = 0;
  let end = raw.length;

  const isEdgeGlue = ch =>
    ch === " " ||
    ch === "\t" ||
    isV9StandaloneDirectionControl(ch);

  while (start < end && isEdgeGlue(raw[start])) start++;
  while (end > start && isEdgeGlue(raw[end - 1])) end--;

  return {
    leadingLength: start,
    visibleStart: start,
    visibleEnd: end,
    visible: raw.slice(start, end),
    leadingText: raw.slice(0, start),
    trailingText: raw.slice(end),
  };
}
