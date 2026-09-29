// Text, style ranges and anchors must share one boundary map. Never align
// marks against a second independently marker-stripped copy of the text.
export function mapMainParagraphSource(rawValue, runs = [], markers = [], { normalize = true } = {}) {
  const raw = String(rawValue || '');
  const removed = new Uint8Array(raw.length);
  const replacements = new Map();
  const ordered = [...markers].sort((a,b) => a.atInPara - b.atInPara);
  for (const m of ordered) {
    const start = Math.max(0, m.atInPara), end = Math.min(raw.length, start + String(m.sym || '').length);
    removed.fill(1, start, end);
    // Hiding a label must not add a space, including inside a word.
    if (m.replaceWith) replacements.set(start, String(m.replaceWith));

  }
  const boundary = new Array(raw.length + 1);
  let stripped = '';
  for (let i = 0; i < raw.length; i++) {
    boundary[i] = stripped.length;
    stripped += replacements.get(i) || '';
    if (!removed[i]) stripped += raw[i];
  }
  boundary[raw.length] = stripped.length;
  const normalizedBoundary = new Array(stripped.length + 1);
  let normalized = '';
  for (let i = 0; i < stripped.length; i++) {
    normalizedBoundary[i] = normalized.length;
    const c = normalize && stripped[i] === '\t' ? ' ' : stripped[i];
    if (!normalize || c !== ' ' || !normalized.endsWith(' ')) normalized += c;
  }
  normalizedBoundary[stripped.length] = normalized.length;
  const mainTextNet = normalize ? normalized.trim() : normalized;
  const leading = normalize ? normalized.length - normalized.trimStart().length : 0;
  const mapped = pos => Math.max(0, Math.min(mainTextNet.length,
    normalizedBoundary[boundary[Math.max(0, Math.min(raw.length, Number(pos) || 0))]] - leading));
  const mainRuns = (runs || []).flatMap(r => {
    const start = mapped(r.start), end = mapped(r.end);
    return end > start ? [{start, end, marks: {...(r.marks || {})}}] : [];
  });
  const mainConsumers = ordered.map(m => ({ stream:m.code, sym:m.sym, anchor:mapped(m.atInPara),
    anchorAffinity: m.atInPara > 0 && !/\s/u.test(raw[m.atInPara-1]) ? 'backward' : 'forward' }));
  return { mainTextNet, mainRuns, mainConsumers };
}
