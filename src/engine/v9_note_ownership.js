import { normalizeRichTextEntry } from './rich_text_runs.js';
import { referenceInV9Range } from './v9_source_fragments.js';
// Semantic note boundaries survive tokenization, column splits and carry-over.
// Opaque IDs are diagnostics, not text or typographic instructions.
export function markV9NoteRuns(text, runs, nodes, note) {
  const out=[...(runs || [])],key=note?._v9NoteKey;
  if(!key || !text)return out;
  out.push({start:0,end:text.length,marks:{v9NoteKey:key}});
  let offset=0;
  for(const n of nodes || []) {
    const value=n.text || '';
    if(['lemma','body','rest','cont'].includes(n.kind)) {
      const m=/[^\s\u200e\u200f\u2060]+/u.exec(value);
      if(m) {out.push({start:offset+m.index,end:offset+m.index+m[0].length,marks:{v9NoteStart:key}});break;}
    }
    offset+=value.length;
  }
  return out;
}

export function auditV9NoteStarts(plan, required=[]) {
  const seen=new Set();
  for(const box of [...(plan.streamBoxes||[]),...(plan.footerBoxes||[])]) {
    for(const line of box.lines || [])for(const r of line.runs || [])if(r.marks?.v9NoteStart)seen.add(r.marks.v9NoteStart);
  }
  return required.filter(n => {
    if (!seen.has(n.key)) return true;
    if (!n.requireMainAnchor || !Number.isFinite(n.anchor)) return false;
    return !(plan.mainBox?.lines || []).some(line => line.source?.paragraphId === n.paragraphId &&
      referenceInV9Range(n, line.source.start, line.source.end, n.sourceLength));
  });
}

// Verify the plan itself, before painting or advancing the source cursor. Text
// removed from the current page must be the exact suffix queued for the next.
export function verifyV9StreamCoverage(streams, plan) {
  const evidence = [], originals = new Map();
  for (const stream of streams || []) {
    if (!stream) continue;
    const id = String(stream.id);
    const text = normalizeRichTextEntry(stream.rich || {text:(stream.items || []).join(' '),runs:stream.runs || []}).text;
    originals.set(id, (originals.get(id) || '') + text);
  }
  for (const [id, original] of originals) {
    const lines = [...(plan.streamBoxes || []), ...(plan.footerBoxes || [])]
      .filter(box => String(box.id) === id).flatMap(box => box.lines || []);
    const rendered = lines.map(line => line.text || '').join('');
    const remaining = normalizeRichTextEntry(plan.overflow?.streams?.[id] || '').text;
    if (rendered + remaining !== original) {
      const error = new Error(`V9_STREAM_SOURCE_MISMATCH: ${id} (input=${original.length}, planned=${rendered.length}, remaining=${remaining.length})`);
      error.streamId = id;
      throw error;
    }
    evidence.push({stream:id,inputCharacters:original.length,plannedCharacters:rendered.length,remainingCharacters:remaining.length,exact:true});
  }
  return evidence;
}
