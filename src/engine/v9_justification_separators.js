// Horizontal source separators recognized by V9 tokenization.
// ASCII U+0020 keeps the historical path byte-for-byte; the helpers below are
// only used to extend justification to separators that historically were not
// counted or were not expanded consistently by the browser.
const HORIZONTAL_SEPARATOR_RE = /[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/gu;
const SPECIAL_SEPARATOR_RE = /[\t\v\f\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/u;

export function countV9JustificationGaps(text) {
  return [...String(text || '').matchAll(HORIZONTAL_SEPARATOR_RE)].length;
}

export function hasSpecialV9JustificationSeparator(text) {
  return SPECIAL_SEPARATOR_RE.test(String(text || ''));
}

export function isV9JustificationSeparator(ch) {
  if (!ch) return false;
  return /^[\t\v\f \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]$/u.test(String(ch));
}

export function needsExplicitV9JustificationSpacer(ch) {
  const value = String(ch || '');
  // Keep ordinary space, NBSP and tab on the browser-native path. Other
  // Unicode spacing characters do not receive word-spacing consistently.
  return isV9JustificationSeparator(value) &&
    value !== ' ' && value !== '\u00a0' && value !== '\t';
}
