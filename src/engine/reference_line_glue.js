// Compute the source word that must remain atomic around an inline reference.
// No source characters are inserted or rewritten: the renderer uses this range
// only to wrap the existing text + reference in a nowrap inline box.
export function referenceNoBreakRange(text, position) {
  const value = String(text ?? "");
  const n = Number(position);
  const pos = Math.max(0, Math.min(value.length, Number.isFinite(n) ? n : 0));
  if (pos <= 0 || pos >= value.length) return null;

  // A real whitespace boundary is always a legal line-break opportunity.
  if (/\s/u.test(value[pos - 1]) || /\s/u.test(value[pos])) return null;

  let start = pos;
  while (start > 0 && !/\s/u.test(value[start - 1])) start--;

  let end = pos;
  while (end < value.length && !/\s/u.test(value[end])) end++;

  return end > start ? { start, end } : null;
}
