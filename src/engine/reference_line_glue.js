// Zero-width Unicode glue used around an inline reference when the source
// has no whitespace at that boundary. U+2060 is specifically defined to
// suppress a line-break opportunity without adding visible spacing.
export const WORD_JOINER = "\u2060";

export function referenceLineGlue(text, position) {
  const value = String(text ?? "");
  const n = Number(position);
  const pos = Math.max(0, Math.min(value.length, Number.isFinite(n) ? n : 0));
  return {
    before: pos > 0 && !/\s/u.test(value[pos - 1]),
    after: pos < value.length && !/\s/u.test(value[pos]),
  };
}
