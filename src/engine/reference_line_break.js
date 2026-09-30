// Line-break policy around visible inline main-reference markers.
//
// The marker is a separate DOM node, but legal break points must come from the
// source text. If either side of the marker touches source text with no real
// whitespace, keep the complete surrounding source token atomic.
export function mainRefNoSpaceTokenBounds(text, pos) {
  const value = String(text || "");
  const at = Math.max(0, Math.min(value.length, Number(pos) || 0));
  const joinsBefore = at > 0 && !/\s/u.test(value[at - 1]);
  const joinsAfter = at < value.length && !/\s/u.test(value[at]);
  if (!joinsBefore && !joinsAfter) return null;

  let start = at;
  while (start > 0 && !/\s/u.test(value[start - 1])) start--;
  let end = at;
  while (end < value.length && !/\s/u.test(value[end])) end++;
  return { start, end };
}
