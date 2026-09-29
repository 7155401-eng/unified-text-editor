import { sliceRuns } from './runs_dom.js';
import { sourceMetadata } from './v9_source_fragments.js';

export const V9_INLINE_PLAN_VERSION = 'v9-inline-1';
const EPS = 1 / 64;
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const refAnchor = r => Number(r.anchor ?? r.absoluteAnchor ?? r.localAnchor);

export function partForRange(entry, start, visibleEnd, consumedEnd = visibleEnd, style = entry.typography) {
  const raw = entry.text.slice(start, visibleEnd);
  const leading = (raw.match(/^[ \t]+/) || [''])[0].length;
  const text = raw.slice(leading);
  const refs = (entry.mainRefs || []).filter(r => {
    const a = refAnchor(r);
    return a >= start && (a < consumedEnd || (consumedEnd === entry.text.length && a === consumedEnd));
  }).map(r => ({ ...r, localPos: Math.max(0, Math.min(text.length, refAnchor(r) - start - leading)) }));
  return { text, leadingText: raw.slice(0, leading), trailingText: entry.text.slice(visibleEnd, consumedEnd), runs: sliceRuns(entry.runs || [], start + leading, visibleEnd), refs, style };
}

// Intersect the actual allocated intervals crossed by an entire row. In
// particular, a row may cross a widening strip without moving its boundary.
// An uncovered vertical gap cannot be bridged. The input strips are immutable.
export function rowGeometry(strips, y, height, pageBottom) {
  if (!(height > 0) || y + height > pageBottom + EPS) return null;
  let cursor = y, left = -Infinity, right = Infinity;
  for (const s of strips) {
    if (s.y_end <= cursor + EPS) continue;
    if (s.y_start > cursor + EPS) return null;
    left = Math.max(left, s.x);
    right = Math.min(right, s.x + s.width);
    cursor = Math.min(y + height, s.y_end);
    if (cursor >= y + height - EPS) return right > left + EPS ? { x: left, width: right - left } : null;
  }
  return null;
}

function nextSlot(strips, y, height, pageBottom) {
  for (const at of [y, ...strips.filter(s => s.y_start > y + EPS).map(s => s.y_start)]) {
    const g = rowGeometry(strips, at, height, pageBottom);
    if (g) return { ...g, y: at };
  }
  return null;
}

function availableBeside(g, y, height, opening) {
  if (!opening || y >= opening.y + opening.height - EPS || y + height <= opening.y + EPS) return g;
  const right = Math.min(g.x + g.width, opening.x - opening.gap);
  // A single RTL line is contiguous: no text is teleported to a second island.
  if (opening.x >= g.x + g.width - EPS) return { ...g, width: Math.max(0, right - g.x) };
  if (opening.x + opening.width <= g.x + EPS) return g;
  return { ...g, width: Math.max(0, right - g.x) };
}

function tokensOf(text) {
  return [...text.matchAll(/\r\n|[\r\n]|[^\s]+/gu)].map(m => ({
    text: m[0], start: m.index, end: m.index + m[0].length,
    type: /[\r\n]/.test(m[0]) ? 'break' : 'word',
  }));
}

function overflowEntry(entry, start) {
  const refs = (entry.mainRefs || []).filter(r => refAnchor(r) >= start).map(r => {
    const a = refAnchor(r) - start;
    return { ...r, anchor: a, absoluteAnchor: a, localAnchor: a };
  });
  return {
    ...entry, text: entry.text.slice(start), rich: undefined,
    runs: sliceRuns(entry.runs || [], start, entry.text.length), mainRefs: refs,
    sourceOffset: number(entry.sourceOffset) + start,
    continues: !!entry.continues || start > 0,
    _v9OpeningWordAllowed: entry._v9OpeningWordAllowed !== false && start === 0,
  };
}

function freezeLine(line) {
  // The renderer receives a value, not a mutable layout model. Deep-freezing
  // small plans makes any late layout authority fail loudly in development.
  const seen = new WeakSet();
  function visit(o) {
    if (!o || typeof o !== 'object' || seen.has(o)) return o;
    seen.add(o); for (const v of Object.values(o)) visit(v); return Object.freeze(o);
  }
  return visit(line);
}

/** Main paragraphs, including their openings, are planned by this ONE flow.
 * `context.measure(part)` and the final painter use the same styled content.
 * No DOM node, browser float, scale, or guessed safety percentage is in a plan.
 */
export function layoutV9MainParagraphs(rawEntries, rawStrips, context, pageBottom) {
  const strips = rawStrips.map(s => ({ ...s })).sort((a, b) => a.y_start - b.y_start);
  const lines = [], diagnostics = [];
  let y = strips[0]?.y_start || 0;
  const finish = (entryIndex = rawEntries.length, offset = 0, reason = '') => {
    const remaining = rawEntries.slice(entryIndex).map((e, i) => overflowEntry(e, i ? 0 : offset));
    const overflowText = remaining.map(e => e.text).join('\n');
    return { lines: lines.map(l => freezeLine(structuredClone(l))), endY: y, overflowText, overflowParagraphs: remaining, diagnostics, overflowReason: reason, debug: null };
  };
  for (let ei = 0; ei < rawEntries.length; ei++) {
    const entry = { ...rawEntries[ei], runs: [...(rawEntries[ei].runs || [])] };
    if (!entry.text) continue;
    const pitch = context.lineHeight;
    const paragraphLineStart = lines.length;
    const tokens = tokensOf(entry.text);
    let cursor = 0, ti = 0, opening = null, openingAttached = false;
    const descriptor = context.describeOpening(entry);
    if (descriptor) {
      if (!(descriptor.end > 0 && descriptor.end <= entry.text.length)) throw new Error('Invalid V9 opening source range');
      if (descriptor.position === 'raised') {
        // A raised opening is an ordinary styled inline range. It goes through
        // exactly the same measured line breaking as the rest of the paragraph.
        entry.runs = [...entry.runs, { start: descriptor.start, end: descriptor.end, marks: descriptor.marks }];
      } else {
        const part = partForRange(entry, 0, descriptor.end, descriptor.end);
        part.runs = [...part.runs, { start: descriptor.start, end: descriptor.end, marks: descriptor.marks }];
        const m = context.measure(part);
        const height = Math.max(pitch * descriptor.dropLines, m.height);
        const slot = nextSlot(strips, y, height, pageBottom);
        if (!slot) return finish(ei, 0, 'opening-does-not-fit-page');
        if (m.width > slot.width + EPS) return finish(ei, 0, 'opening-wider-than-allocated-region');
        y = slot.y;
        opening = { part, x: slot.x + slot.width - m.width, y, width: m.width, height,
          gap: descriptor.gapPx, topInset: m.topInset || 0, dropLines: descriptor.dropLines };
        cursor = descriptor.end;
        // Letter openings can end inside the first word; keep the suffix token
        // and its original offsets rather than discarding the remainder.
        while (ti < tokens.length && tokens[ti].end <= cursor) ti++;
        if (tokens[ti] && tokens[ti].start < cursor) tokens[ti] = { ...tokens[ti], start: cursor, text: entry.text.slice(cursor, tokens[ti].end) };
      }
    }
    const emit = (body, start, end, geometry, rowY, m, forcedBreak, wordTokens) => {
      const attached = opening && !openingAttached ? opening : null;
      const sourceStart = attached ? 0 : start;
      const isLast = end >= entry.text.length && !entry.continuesAfter;
      const gaps = (body.text.match(/ /g) || []).length;
      const justify = !isLast && !forcedBreak && gaps > 0;
      const natural = m.width;
      const line = {
        layoutVersion: V9_INLINE_PLAN_VERSION,
        x: geometry.x, y: rowY, width: geometry.width, lineHeightPx: Math.max(pitch, m.height),
        fontSize: number(entry.typography?.fontSize, context.fontSize),
        text: entry.text.slice(sourceStart, end), runs: sliceRuns(entry.runs, sourceStart, end),
        words: entry.text.slice(sourceStart, end).trim().split(/\s+/u).filter(Boolean),
        wordTokens, naturalWidth: natural, forcedBreak, isLast,
        openingWindow: !!opening && rowY < opening.y + opening.height - EPS,
        openingHostFullWidth: rowGeometry(strips, rowY, Math.max(pitch, m.height), pageBottom)?.width || geometry.width,
        source: sourceMetadata(entry, sourceStart, end),
        sourceText: entry.text.slice(sourceStart, end),
        render: { body, topInset: m.topInset || 0, opening: attached,
          wordSpacing: justify ? Math.max(0, (geometry.width - natural) / gaps) : 0,
          alignment: isLast || forcedBreak ? 'center' : 'right' },
      };
      lines.push(line);
      if (attached) openingAttached = true;
      return line;
    };
    while (ti < tokens.length) {
      let slot = nextSlot(strips, y, pitch, pageBottom);
      if (!slot) {
        // Preserve a placed opening even if its body starts on the next page.
        if (opening && !openingAttached) {
          emit(partForRange(entry, cursor, cursor), cursor, cursor, { x: opening.x, width: opening.width }, opening.y,
            { width: 0, height: pitch }, false, []);
          y = Math.max(y, opening.y + opening.height);
        }
        return finish(ei, cursor, 'page-full');
      }
      y = slot.y;
      let rowH = pitch, selected = null, g;
      for (let attempt = 0; attempt < 8; attempt++) {
        const row = rowGeometry(strips, y, rowH, pageBottom);
        if (!row) { selected = null; break; }
        g = availableBeside(row, y, rowH, opening);
        const start = tokens[ti].start;
        if (tokens[ti].type === 'break') {
          const end = tokens[ti].end;
          const body = partForRange(entry, cursor, start, end);
          selected = { body, end, next: ti + 1, m: context.measure(body), forcedBreak: true, wordTokens: [] };
        } else {
          let limit = ti;
          while (limit < tokens.length && tokens[limit].type !== 'break') limit++;
          let lo = ti, hi = limit - 1, best = -1, bestMeasure = null, bestPart;
          // Exact styled candidate widths; logarithmic search, cached per render.
          while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            const nextTok = tokens[mid + 1];
            const consumedEnd = nextTok?.type === 'break' ? nextTok.end : (nextTok?.start ?? entry.text.length);
            const body = partForRange(entry, cursor, tokens[mid].end, consumedEnd);
            const m = context.measure(body);
            if (m.width <= g.width + EPS) { best = mid; bestMeasure = m; bestPart = body; lo = mid + 1; }
            else hi = mid - 1;
          }
          if (best < ti) { selected = null; break; }
          const nextTok = tokens[best + 1];
          const forcedBreak = nextTok?.type === 'break';
          const end = forcedBreak ? nextTok.end : (nextTok?.start ?? entry.text.length);
          selected = { body: bestPart, end, next: best + 1 + (forcedBreak ? 1 : 0), m: bestMeasure, forcedBreak: !!forcedBreak, wordTokens: tokens.slice(ti, best + 1) };
        }
        const nextH = Math.max(rowH, selected.m.height, pitch);
        if (nextH <= rowH + EPS) break;
        rowH = nextH;
        if (attempt === 7) throw new Error('V9 line geometry did not converge');
      }
      if (!selected) {
        if (opening && y < opening.y + opening.height - EPS) {
          if (!openingAttached) emit(partForRange(entry, cursor, cursor), cursor, cursor, { x: opening.x, width: opening.width }, opening.y,
            { width: 0, height: pitch }, false, []);
          y = opening.y + opening.height;
          diagnostics.push({ code: 'opening-body-below', paragraphId: entry.id });
          continue;
        }
        const next = strips.find(s => s.y_start > y + EPS && s.y_start < pageBottom && s.width > (slot?.width || 0));
        if (next) { y = next.y_start; continue; }
        return finish(ei, cursor, 'unbreakable-content-or-no-row-space');
      }
      const line = emit(selected.body, cursor, selected.end, g, y, selected.m, selected.forcedBreak, selected.wordTokens);
      line.lineHeightPx = rowH;
      cursor = selected.end; ti = selected.next; y += rowH;
    }
    if (opening && !openingAttached) {
      emit(partForRange(entry, cursor, entry.text.length), cursor, entry.text.length, { x: opening.x, width: opening.width }, opening.y,
        { width: 0, height: pitch }, false, []);
    }
    if (opening) {
      y = Math.max(y, opening.y + opening.height);
      const sole = lines.length === paragraphLineStart + 1 ? lines[paragraphLineStart] : null;
      if (sole?.render.opening && sole.isLast && !sole.forcedBreak) {
        const base = rowGeometry(strips, opening.y, opening.height, pageBottom);
        const total = opening.width + (sole.render.body.text ? opening.gap : 0) + sole.naturalWidth;
        if (base && total <= base.width + EPS) {
          sole.x = base.x + (base.width - total) / 2;
          sole.width = Math.max(0, sole.naturalWidth);
          sole.render.opening = { ...opening, x: sole.x + sole.naturalWidth + (sole.render.body.text ? opening.gap : 0) };
          sole.render.alignment = 'right';
        }
      }
    }
    // A following original paragraph never inherits an opening window.

  }
  return finish();
}
