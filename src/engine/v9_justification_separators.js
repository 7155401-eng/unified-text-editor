// Horizontal source separators that V9 already treats as word boundaries.
// Keep justification gap counting aligned with tokenization instead of counting
// only ASCII U+0020. CR/LF remain forced-break controls and are excluded.
const HORIZONTAL_SEPARATOR_RE = /[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu;

export function countV9JustificationGaps(text) {
  const source = String(text || '');
  return [...source.matchAll(HORIZONTAL_SEPARATOR_RE)].length;
}

export function isV9JustificationSeparator(ch) {
  if (!ch) return false;
  return /^[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/u.test(String(ch));
}
