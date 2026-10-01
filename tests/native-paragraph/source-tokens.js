// Research only: a native inline no-wrap span binds source characters and
// reference objects until a REAL source break opportunity. Never insert joiner
// characters, NBSP, <br>, or an inline-block wrapper for the whole source word.
import { appendV9PlannedPart } from '../../src/engine/v9_text_measurement.js';
import { sliceRuns } from '../../src/engine/runs_dom.js';

// NBSP, NARROW NBSP and the legacy FEFF joiner must retain their no-break
// semantics. All other JS whitespace remains outside the no-wrap spans.
const SEGMENTS = /[^\S\u00a0\u202f\ufeff]+|[\S\u00a0\u202f\ufeff]+/gu;
const IS_BREAKABLE = /^[^\S\u00a0\u202f\ufeff]+$/u;

export function nativeSourceChunks(part) {
  if (!part || typeof part.text !== 'string') throw new TypeError('Expected a prepared text part');
  const chunks = [...part.text.matchAll(SEGMENTS)].map(m => ({
    start: m.index, end: m.index + m[0].length, text: m[0],
    noWrap: !IS_BREAKABLE.test(m[0]),
    runs: sliceRuns(part.runs || [], m.index, m.index + m[0].length), refs: [],
  }));
  if (!chunks.length) chunks.push({start: 0, end: 0, text: '', noWrap: false, runs: [], refs: []});
  let cursor = 0, index = 0;
  for (const ref of part.refs || []) {
    // Match appendV9PlannedPart's effective monotonic source positions exactly.
    const pos = Math.max(cursor, Math.min(part.text.length, Number(ref.localPos) || 0));
    while (index < chunks.length - 1 && chunks[index].end < pos) index++;
    if (index < chunks.length - 1 && chunks[index].end === pos && !chunks[index].noWrap) index++;
    const owner = chunks[index];
    owner.refs.push({...ref, localPos: pos - owner.start});
    cursor = pos;
  }
  return chunks;
}

export function appendNativeSourcePart(parent, part) {
  // Edge source accounting is identical to the V9 painter. Internal spaces
  // remain visible: slicing via partForRange on each word would hide them.
  appendV9PlannedPart(parent, {text: '', leadingText: part.leadingText});
  for (const chunk of nativeSourceChunks(part)) {
    let target = parent;
    if (chunk.noWrap) {
      target = document.createElement('span');
      target.className = 'native-source-token';
      target.style.whiteSpace = 'nowrap';
      target.dataset.sourceStart = String(chunk.start);
      target.dataset.sourceEnd = String(chunk.end);
      parent.appendChild(target);
    }
    // Hidden metadata must not split a shaping run even though it paints no glyph.
    appendV9PlannedPart(target, {text: chunk.text, runs: chunk.runs, refs: chunk.refs.filter(ref => ref.formatted), style: part.style});
  }
  appendV9PlannedPart(parent, {text: '', trailingText: part.trailingText});
}
