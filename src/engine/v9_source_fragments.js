import { sliceRuns } from './runs_dom.js';

// All offsets below are UTF-16 boundaries in canonical main text. The original
// boundary map is retained at ingress; a render never reconstructs source IDs
// by searching the painted text. These helpers never mutate their inputs.
const anchorOf = r => Number(r?.anchor ?? r?.absoluteAnchor ?? r?.localAnchor);

// A reference written directly after a word belongs to that word at a split.
// Explicit forward anchors retain the old right-affinity contract.
export function referenceInV9Range(ref, start, end, total) {
  const a = anchorOf(ref);
  if (!(end > start)) return false;
  if (ref?.anchorAffinity === 'backward') return (a > start || (start === 0 && a === 0)) && a <= end;
  return a >= start && (a < end || (end === total && a === end));
}
export function rebaseV9Notes(notes, sourceOffset) {
  return (notes || []).map(n => Number.isFinite(n?._v9ParentAnchor)
    ? shiftRef(n, Math.max(0, n._v9ParentAnchor - sourceOffset)) : n);
}
const lowerBound = (xs, n) => {
  let a = 0, b = xs.length;
  while (a < b) { const m = (a + b) >>> 1; if (xs[m] < n) a = m + 1; else b = m; }
  return a;
};

export function canonicalMainText(input) {
  const raw = String(input ?? '');
  const omitted = new Uint8Array(raw.length);
  for (const m of raw.matchAll(/\{@\d+[^}]*\}|@\d+/g)) omitted.fill(1, m.index, m.index + m[0].length);
  const chars = [], starts = [], ends = [];
  for (let i = 0; i < raw.length; i++) {
    if (omitted[i]) continue;
    let c = raw[i];
    if (c === '\r') { if (raw[i + 1] === '\n') continue; c = '\n'; }
    if (c === '\t') c = ' ';
    if (c === ' ' && (chars.at(-1) === ' ' || chars.at(-1) === '\n')) {
      if (chars.length) ends[ends.length - 1] = i + 1;
      continue;
    }
    if (c === '\n' && chars.at(-1) === ' ') { chars.pop(); starts.pop(); ends.pop(); }
    chars.push(c); starts.push(i); ends.push(i + 1);
  }
  let a = 0, b = chars.length;
  while (a < b && /\s/u.test(chars[a])) a++;
  while (b > a && /\s/u.test(chars[b - 1])) b--;
  return { text: chars.slice(a, b).join(''), starts: starts.slice(a, b), ends: ends.slice(a, b), rawLength: raw.length };
}

function mapRuns(runs, map) {
  return (runs || []).flatMap(r => {
    const start = lowerBound(map.ends, Number(r.start) + 1);
    const end = lowerBound(map.starts, Number(r.end));
    return end > start ? [{ start, end, marks: { ...(r.marks || {}) } }] : [];
  });
}

function sourceParagraphStyleMarks(style) {
  const src = style && typeof style === 'object' ? style : {};
  const marks = {};
  for (const key of [
    'fontFamily','fontSize','fontSizeUnit','fontWeight','fontStyle',
    'color','backgroundColor','bgColor','lineHeight','textDecoration'
  ]) {
    if (src[key] !== undefined && src[key] !== null && src[key] !== '') marks[key] = src[key];
  }
  if (src.bold === true) marks.bold = true;
  if (src.italic === true) marks.italic = true;
  if (src.underline === true) marks.underline = true;
  if (src.strike === true) marks.strike = true;
  return marks;
}

function mappedSourceRuns(p, map) {
  const explicit = mapRuns(p.mainRuns || p.runs || [], map);
  const paragraphMarks = sourceParagraphStyleMarks(p.style);
  if (!map.text.length || Object.keys(paragraphMarks).length === 0) return explicit;
  // Source paragraph style is semantic document formatting. It is deliberately
  // separate from cfg.mainStyleId (the chosen stream style). Putting it in a
  // full-range run lets explicit child runs override it while still allowing
  // the bold-override rule to recognize a genuinely bold source paragraph.
  return [{ start: 0, end: map.text.length, marks: paragraphMarks }, ...explicit];
}

function shiftRef(r, anchor) {
  return { ...r, anchor, absoluteAnchor: anchor, localAnchor: anchor };
}

export function prepareV9SourceParagraph(p, index = 0) {
  if (!p) return { mainText: '', mainRuns: [], notes: [] };
  if (p._v9Source) return p;
  const original = p.blockType === 'table' && Array.isArray(p.tableRows) && p.tableRows.length
    ? p.tableRows.map(row => row.join('  |  ')).join('\n')
    : (p.mainText ?? p.text ?? '');
  const map = canonicalMainText(original);
  const id = String(p.id || `main-${index + 1}`);
  const remap = r => {
    const a = anchorOf(r);
    return Number.isFinite(a) ? shiftRef(r, lowerBound(map.starts, a)) : { ...r };
  };
  const notes = (p.notes || []).filter(Boolean).map((r, i) => {
    const note = r.nested ? { ...r } : remap(r);
    const a = anchorOf(note);
    return { ...note, _v9NoteKey: r._v9NoteKey || `${id}:${r.stream || r.streamId || r.streamCode}:${r.uid || r.num || i + 1}`,
      _v9ParentParagraphId: id, _v9ParentAnchor: a,
      anchorAffinity: r.anchorAffinity || (a > 0 && !/\s/u.test(map.text[a-1] || ' ') ? 'backward' : 'forward') };
  });
  const mainRefs = (Array.isArray(p.mainRefs) && p.mainRefs.length)
    ? p.mainRefs.filter(r=>r && r.nested !== true).map(r=> {
        const ref=remap(r);
        const note=notes.find(n=>!n.nested && ((r.uid && n.uid===r.uid) ||
          ((n.stream || n.streamId || n.streamCode)===(r.stream || r.streamId || r.streamCode) &&
          n.num===r.num && anchorOf(n)===anchorOf(ref))));
        return note && !ref.anchorAffinity ? {...ref,anchorAffinity:note.anchorAffinity} : ref;
      })
    : notes.filter(r=>r.nested !== true).map(r=>({...r}));
  const runs = mappedSourceRuns(p, map);
  return {
    ...p, id, mainText: map.text, mainRuns: runs, runs, mainRefs, notes,
    _v9Source: { id, index: index + 1, text: map.text, starts: map.starts, ends: map.ends, rawLength: map.rawLength },
    _v9SourceOffset: 0,
    _v9SourceEnd: map.text.length,
  };
}

export function sliceV9Paragraph(p, start, end, overrides = {}) {
  const source = prepareV9SourceParagraph(p);
  const n = source.mainText.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > n) {
    throw new RangeError('V9 fragment bounds must be ordered UTF-16 offsets within the paragraph');
  }
  const refs = (source.mainRefs || []).filter(r => {
    return referenceInV9Range(r, start, end, n);
  }).map(r => shiftRef(r, anchorOf(r) - start));
  const runs = sliceRuns(source.mainRuns || [], start, end);
  return {
    ...source, ...overrides,
    mainText: source.mainText.slice(start, end), mainRuns: runs, runs, mainRefs: refs,
    _v9SourceOffset: source._v9SourceOffset + start,
    _v9SourceEnd: source._v9SourceOffset + end,
    _v9ContinuesFromSplit: !!source._v9ContinuesFromSplit || start > 0,
    _v9OpeningWordAllowed: source._v9OpeningWordAllowed !== false && start === 0,
    _continues: end < n || !!source._continues || overrides._continues === true,
  };
}

// Keep whitespace at a split in the prefix. The suffix starts after it, as the
// existing note-anchor split policy expects. This gives disjoint, exhaustive
// source ranges instead of losing separators through repeated trim()/join().
export function splitV9Paragraph(p, splitText, beforeNotes, afterNotes, firstOverrides = {}) {
  const base = Number(splitText.suffixBaseOffset);
  return {
    firstHalf: sliceV9Paragraph(p, 0, base, { ...firstOverrides, notes: beforeNotes || [], _continues: true }),
    secondHalf: sliceV9Paragraph(p, base, p.mainText.length, { notes: afterNotes || [] }),
  };
}

export function joinV9ParagraphFragments(a, b, notes) {
  if (!a?._v9Source || a._v9Source !== b?._v9Source || a._v9SourceEnd !== b._v9SourceOffset) {
    throw new Error('V9 only joins adjacent fragments of the same source paragraph');
  }
  const text = a.mainText + b.mainText;
  const runs = [...(a.mainRuns || []), ...(b.mainRuns || []).map(r => ({ ...r, start: r.start + a.mainText.length, end: r.end + a.mainText.length }))];
  return {
    ...a, mainText: text, mainRuns: runs, runs,
    mainRefs: [...(a.mainRefs || []), ...(b.mainRefs || []).map(r => shiftRef(r, anchorOf(r) + a.mainText.length))],
    notes: rebaseV9Notes(notes || [...(a.notes || []), ...(b.notes || [])], a._v9SourceOffset),
    _v9SourceEnd: b._v9SourceEnd,
    _continues: !!b._continues,
  };
}

export function sourceMetadata(entry, start, end) {
  const origin = entry.source || entry._v9Source;
  const offset = Number(entry.sourceOffset ?? entry._v9SourceOffset) || 0;
  const a = offset + start, b = offset + end;
  return {
    paragraphId: String(origin?.id || entry.id || 'main-1'),
    paragraphIndex: origin?.index || entry.index || 1,
    start: a, end: b,
    rawStart: origin?.starts?.[a] ?? a,
    rawEnd: b > a ? (origin?.ends?.[b - 1] ?? b) : (origin?.starts?.[a] ?? a),
    paragraphStart: a === 0 && !entry.continues && entry._v9OpeningWordAllowed !== false,
    continuation: a > 0 || !!entry.continues,
    domain: 'canonical-main-utf16',
  };
}
