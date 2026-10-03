import { sliceRuns } from './runs_dom.js';
import { findV9ExactTailPartition } from './v9_exact_tail_partition.js';
import { sourceMetadata, referenceInV9Range } from './v9_source_fragments.js';
import { openingWordSkipReason } from '../opening_word.js';
import { isV9StandaloneDirectionControlOnly, splitV9EdgeGlue } from './v9_bidi_controls.js';
import { countV9JustificationGaps, hasSpecialV9JustificationSeparator } from './v9_justification_separators.js';

export const V9_INLINE_PLAN_VERSION = 'v9-inline-1';
const EPS = 1 / 64;
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const refAnchor = r => Number(r.anchor ?? r.absoluteAnchor ?? r.localAnchor);

const EXACT_TAIL_CACHE_LIMIT = 4096;
const exactTailCaches = new WeakMap();

function exactTailCacheFor(context) {
  let cache = exactTailCaches.get(context);
  if (!cache) {
    cache = new Map();
    exactTailCaches.set(context, cache);
  }
  return cache;
}

function exactTailCacheKey({
  context, entry, sourceBase, sourceSegmentStart, bodySegmentStart,
  segmentEnd, words, tail, gentleMax,
}) {
  const refs = (entry.mainRefs || [])
    .filter(r => referenceInV9Range(r, sourceSegmentStart, segmentEnd, entry.text.length))
    .map(r => [
      refAnchor(r),
      String(r.formatted || ''),
      String(r.cssText || ''),
      String(r.uid || ''),
      String(r.stream || r.code || ''),
      String(r.num ?? ''),
    ]);
  return JSON.stringify([
    Number(context?.generation) || 0,
    sourceBase,
    sourceSegmentStart,
    bodySegmentStart,
    segmentEnd,
    entry.text.slice(sourceSegmentStart, segmentEnd),
    sliceRuns(entry.runs || [], sourceSegmentStart, segmentEnd),
    refs,
    entry.typography || {},
    words.map(w => [w.start, w.end]),
    tail.map(line => [
      number(line?.width, 0),
      number(line?.lineHeightPx, context?.lineHeight),
      !!line?.render?.opening,
      Array.isArray(line?.wordTokens) ? line.wordTokens.length : -1,
    ]),
    gentleMax,
  ]);
}

function rememberExactTailSearch(cache, key, search) {
  const stored = Object.freeze({
    status: search.status,
    evaluations: search.evaluations,
    ...(Array.isArray(search.boundaries)
      ? { boundaries: Object.freeze([...search.boundaries]) }
      : {}),
  });
  if (!cache.has(key) && cache.size >= EXACT_TAIL_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, stored);
  return stored;
}

export function partForRange(entry, start, visibleEnd, consumedEnd = visibleEnd, style = entry.typography) {
  const raw = entry.text.slice(start, visibleEnd);
  const edge = splitV9EdgeGlue(raw);
  // Direction controls alone are not words. Edge glue is retained for source
  // accounting but cannot take part in visual line justification.
  const text = edge.visible;
  const actualEnd = start + edge.visibleEnd;
  const refs = (entry.mainRefs || []).filter(r => {
    return referenceInV9Range(r, start, consumedEnd, entry.text.length);
  }).sort((a, b) => refAnchor(a) - refAnchor(b)).map(r => ({
    ...r,
    localPos: Math.max(0, Math.min(text.length, refAnchor(r) - start - edge.leadingLength)),
  }));
  return {
    text,
    leadingText: edge.leadingText,
    trailingText: entry.text.slice(actualEnd, consumedEnd),
    runs: sliceRuns(entry.runs || [], start + edge.leadingLength, actualEnd),
    refs,
    style,
  };
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
    if (s.lockYStart === true && y < s.y_start - EPS && y + height > s.y_start + EPS) {
      return null;
    }
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

function droppedOpeningCrossesRightEdgeTransition(strips, y, height, pitch, pageBottom) {
  if (!(height > pitch + EPS) || !(pitch > 0)) return false;
  let expectedRight = null;
  const end = Math.min(pageBottom, y + height);

  // Sample every actual text row crossed by the opening. A widening to the
  // LEFT is safe in RTL because the opening stays on one right edge and the
  // following row may use the newly freed left space. A changed RIGHT edge is
  // not safe: the same glyph would sit in the middle of the widened row and
  // trap that row in the old narrow geometry.
  for (let rowY = y; rowY < end - EPS; rowY += pitch) {
    const rowH = Math.min(pitch, end - rowY);
    const g = rowGeometry(strips, rowY, rowH, pageBottom);
    if (!g) continue;
    const right = g.x + g.width;
    if (expectedRight == null) expectedRight = right;
    else if (Math.abs(right - expectedRight) > EPS) return true;
  }
  return false;
}

function availableBeside(g, y, height, opening) {
  if (!opening || y >= opening.y + opening.height - EPS || y + height <= opening.y + EPS) return g;
  const right = Math.min(g.x + g.width, opening.x - opening.gap);
  // A single RTL line is contiguous: no text is teleported to a second island.
  if (opening.x >= g.x + g.width - EPS) return { ...g, width: Math.max(0, right - g.x) };
  if (opening.x + opening.width <= g.x + EPS) return g;
  return { ...g, width: Math.max(0, right - g.x) };
}

// A word that cannot fit beside the opening's first narrow row may fit on a
// later row after V9 widens the region. Stay on the current row grid and retry
// only a genuinely wider free interval; the normal measured flow still decides
// whether the complete word and its height fit there. Constant-width fallback
// remains unchanged, and no line or glyph is repositioned after paint.
function nextWiderOpeningRow(strips, y, pitch, opening, pageBottom) {
  if (!(pitch > 0)) return null;
  const current = rowGeometry(strips, y, pitch, pageBottom);
  if (!current) return null;
  const currentWidth = availableBeside(current, y, pitch, opening).width;
  const end = Math.min(pageBottom, opening.y + opening.height);
  for (let nextY = y + pitch; nextY < end - EPS; nextY += pitch) {
    const row = rowGeometry(strips, nextY, pitch, pageBottom);
    if (row && availableBeside(row, nextY, pitch, opening).width > currentWidth + EPS) return nextY;
  }
  return null;
}

function tokensOf(text) {
  return [...text.matchAll(/\r\n|[\r\n]|[^\s]+/gu)]
    .filter(m => !isV9StandaloneDirectionControlOnly(m[0]))
    .map(m => ({
    text: m[0], start: m.index, end: m.index + m[0].length,
    type: /[\r\n]/.test(m[0]) ? 'break' : 'word',
  }));
}

function overflowEntry(entry, start) {
  const refs = (entry.mainRefs || []).filter(r => referenceInV9Range(r, start, entry.text.length, entry.text.length)).map(r => {
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


const TAIL_REBALANCE_MAX_WORD_SPACING_PX = 8;
const TAIL_REBALANCE_SCORE_EPS = 0.001;

function continuationTailGentleSpacing(context) {
  const fontSize = number(context?.fontSize, 13);
  return Math.max(3.6, Math.min(TAIL_REBALANCE_MAX_WORD_SPACING_PX, fontSize * 0.65));
}

function continuationTailPressure(metric) {
  if (!metric) return Number.POSITIVE_INFINITY;
  if (metric.deficit <= EPS) return 0;
  if (metric.gaps > 0) return metric.deficit / metric.gaps;
  return 1000 + metric.deficit;
}

function resolveSpecialV9JustificationSpacing(context, body, naturalWidth, targetWidth, gaps) {
  const initial = gaps > 0 ? Math.max(0, (targetWidth - naturalWidth) / gaps) : 0;
  if (!(initial > 0) || !hasSpecialV9JustificationSeparator(body?.text)) return initial;

  const widthAt = spacing => context.measure({
    ...body,
    style: { ...(body.style || context.typography || {}), wordSpacing: `${spacing}px` },
  }).width;

  // The browser does not expand every Unicode separator identically. Measure
  // the real painted width and solve for the spacing that reaches the row edge.
  let lo = 0;
  let hi = Math.max(1, initial);
  let hiWidth = widthAt(hi);
  while (hiWidth < targetWidth - EPS && hi < 512) {
    lo = hi;
    hi *= 2;
    hiWidth = widthAt(hi);
  }
  if (hiWidth < targetWidth - EPS) return initial;

  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (widthAt(mid) < targetWidth) lo = mid;
    else hi = mid;
  }

  const candidates = [lo, hi, initial];
  let best = initial, bestError = Number.POSITIVE_INFINITY;
  for (const spacing of candidates) {
    const error = Math.abs(widthAt(spacing) - targetWidth);
    if (error < bestError) { bestError = error; best = spacing; }
  }
  return best;
}

/**
 * A page cut is not a paragraph end.
 *
 * The historical renderer tried to hide a short page-ending line by stretching
 * that one row (word spacing, then letter spacing, then scaleX). That creates
 * the conspicuous "rubber last line" failure.
 *
 * Rebalance only the final paragraph segment on this page: from the real
 * paragraph start, or from the source line break immediately before it. The
 * already-consumed words stay on the same page; only boundaries between the
 * existing rows may move backwards, one word at a time. This preserves page
 * ownership, note anchors, vertical geometry and source order while spreading
 * the required justification across the whole tail.
 */
function rebalanceContinuationTail(lines, paragraphLineStart, entry, cursor, context, diagnostics) {
  if (!Array.isArray(lines) || !entry || !context || !(cursor > 0)) return null;

  const paragraphLines = lines.slice(paragraphLineStart);
  if (!paragraphLines.length) return null;
  const last = paragraphLines[paragraphLines.length - 1];
  if (last?.forcedBreak || last?.isLast) return null;

  let tailOffset = 0;
  for (let i = paragraphLines.length - 1; i >= 0; i--) {
    if (paragraphLines[i]?.forcedBreak) {
      tailOffset = i + 1;
      break;
    }
  }
  const tail = paragraphLines.slice(tailOffset);
  if (!tail.length) return null;

  // Opening-word geometry is immutable, but it is NOT a paragraph boundary.
  // The body text beside the opening, and every narrow window row below it,
  // participate in the same tail rebalance using each row's real allocated
  // width. The opening glyph itself stays fixed and is never duplicated.
  if (tail.some(line =>
    !Array.isArray(line?.wordTokens) ||
    (line.wordTokens.length === 0 && !line?.render?.opening)
  )) return null;

  const words = tail.flatMap(line => line.wordTokens);
  if (!words.length) return null;
  for (let i = 1; i < words.length; i++) {
    if (!(words[i].start >= words[i - 1].end)) return null;
  }

  const sourceBase = number(entry.sourceOffset ?? entry._v9SourceOffset, 0);
  const sourceStart = Number(tail[0]?.source?.start);
  const sourceSegmentStart = Number.isFinite(sourceStart)
    ? Math.max(0, sourceStart - sourceBase)
    : (words[0]?.start ?? 0);
  // Partition at the exact end of the opening's source, not at the first
  // body word. The intervening whitespace/direction controls and their note
  // anchors still belong to this paragraph. Count semantic edge text too:
  // the opening's visible text alone can omit a source prefix.
  const openingPart = tail[0]?.render?.opening?.part;
  const bodySegmentStart = openingPart
    ? sourceSegmentStart + (openingPart.leadingText || '').length +
      openingPart.text.length + (openingPart.trailingText || '').length
    : sourceSegmentStart;
  const openingOnlyHost = !!openingPart && tail[0].wordTokens.length === 0;
  const segmentEnd = Math.max(bodySegmentStart, Math.min(entry.text.length, cursor));

  const boundaries = [];
  let consumedWords = 0;
  for (let i = 0; i < tail.length - 1; i++) {
    consumedWords += tail[i].wordTokens.length;
    boundaries.push(consumedWords);
  }
  const initialBoundaries = boundaries.slice();
  const cache = new Map();

  const metricFor = (lineIndex, fromWord, toWord) => {
    if (fromWord < 0 || toWord < fromWord || toWord > words.length) return null;
    const key = `${lineIndex}:${fromWord}:${toWord}`;
    if (cache.has(key)) return cache.get(key);

    const openingOnly = toWord === fromWord && !!tail[lineIndex]?.render?.opening;
    if (!(toWord > fromWord) && !openingOnly) return null;
    // An opening-only host has the GLYPH's box, not a free body slot. Leave
    // it empty; its following source glue/anchors belong to the first body row.
    if (openingOnlyHost && lineIndex === 0 && !openingOnly) return null;

    const start = lineIndex === 0 || (openingOnlyHost && fromWord === 0)
      ? bodySegmentStart
      : (words[fromWord]?.start ?? segmentEnd);
    const visibleEnd = toWord > fromWord ? words[toWord - 1].end : start;
    const consumedEnd = openingOnlyHost && lineIndex === 0 ? start
      : toWord < words.length ? (words[toWord]?.start ?? segmentEnd) : segmentEnd;
    const body = partForRange(entry, start, visibleEnd, consumedEnd);
    const measured = context.measure(body);
    const target = number(tail[lineIndex]?.width, 0);
    const maxHeight = number(tail[lineIndex]?.lineHeightPx, context.lineHeight);

    if (!(target > 0) || !measured || measured.width > target + EPS ||
        (measured.height > 0 && maxHeight > 0 && measured.height > maxHeight + EPS)) {
      cache.set(key, null);
      return null;
    }

    const specialSeparators = hasSpecialV9JustificationSeparator(body.text);
    const gaps = specialSeparators
      ? countV9JustificationGaps(body.text)
      : (body.text.match(/ /g) || []).length;
    const deficit = Math.max(0, target - measured.width);
    const metric = {
      start, end: consumedEnd, visibleEnd, body, measured, target, gaps, deficit,
      wordTokens: words.slice(fromWord, toWord),
      openingOnly,
    };
    metric.pressure = openingOnly ? 0
      : (specialSeparators
        ? resolveSpecialV9JustificationSpacing(context, body, measured.width, target, gaps)
        : continuationTailPressure(metric));
    cache.set(key, metric);
    return metric;
  };

  const evaluate = (candidateBoundaries) => {
    const metrics = [];
    let from = 0;
    let maxPressure = 0;
    let sumSquares = 0;
    for (let i = 0; i < tail.length; i++) {
      const to = i < candidateBoundaries.length ? candidateBoundaries[i] : words.length;
      const metric = metricFor(i, from, to);
      if (!metric) return null;
      metrics.push(metric);
      maxPressure = Math.max(maxPressure, metric.pressure);
      sumSquares += metric.pressure * metric.pressure;
      from = to;
    }
    return {
      metrics,
      maxPressure,
      sumSquares,
      score: maxPressure * 100000 + sumSquares,
    };
  };

  let current = evaluate(boundaries);
  if (!current) return null;
  const before = current;

  // Local minimax search across ALL row boundaries. A page-tail shortage
  // usually moves words forward (boundary -1), but opening-window rows can
  // benefit from moving one word back beside the opening (boundary +1).
  // Both directions are considered; every candidate is re-measured against the
  // row's actual width, so the opening host and its following narrow row remain
  // part of one paragraph instead of becoming an artificial sub-paragraph.
  for (let pass = 0; pass < words.length * 2; pass++) {
    let chosen = null;
    for (let bi = boundaries.length - 1; bi >= 0; bi--) {
      const previous = bi === 0 ? 0 : boundaries[bi - 1];
      const next = bi + 1 < boundaries.length ? boundaries[bi + 1] : words.length;

      for (const delta of [-1, 1]) {
        const moved = boundaries[bi] + delta;
        const minWordsHere = tail[bi]?.render?.opening ? 0 : 1;
        if (moved - previous < minWordsHere) continue;
        if (next - moved < 1) continue;

        const candidate = boundaries.slice();
        candidate[bi] = moved;
        const evaluated = evaluate(candidate);
        if (!evaluated) continue;
        if (evaluated.score + TAIL_REBALANCE_SCORE_EPS >= current.score) continue;

        if (!chosen || evaluated.score < chosen.evaluated.score) {
          chosen = { boundaries: candidate, evaluated };
        }
      }
    }
    if (!chosen) break;
    boundaries.splice(0, boundaries.length, ...chosen.boundaries);
    current = chosen.evaluated;
  }

  const gentleMax = continuationTailGentleSpacing(context);
  let exactPartition = null;
  if (current.metrics.some(m => m.gaps > 0 && m.pressure > gentleMax + EPS)) {
    // One-word local moves can be trapped: two or more boundaries may need
    // to change together. Before clipping a row, search complete measured
    // partitions of this same source interval under the existing gentle cap.
    const exactCache = exactTailCacheFor(context);
    const exactKey = exactTailCacheKey({
      context,
      entry,
      sourceBase,
      sourceSegmentStart,
      bodySegmentStart,
      segmentEnd,
      words,
      tail,
      gentleMax,
    });
    let search = exactCache.get(exactKey);
    if (!search) {
      search = rememberExactTailSearch(exactCache, exactKey, findV9ExactTailPartition({
        wordCount: words.length,
        rows: tail.map(line => ({allowsEmpty: !!line.render?.opening && line.wordTokens.length === 0})),
        maxSpacing: gentleMax,
        metricFor,
      }));
    }
    if (search.status === 'complete') {
      const alternative = evaluate(search.boundaries);
      const exactPaint = alternative && alternative.metrics.every((metric, i) => {
        if (metric.pressure > gentleMax + 1e-9) return false;
        if (metric.openingOnly) return true;
        // Counted ASCII gaps are not a sufficient paint-width oracle for tabs,
        // nonbreaking spaces or differently styled runs. Re-measure the actual
        // resolved part with the proposed spacing before accepting the path.
        const painted = context.measure({
          ...metric.body,
          style: {...(metric.body.style || context.typography || {}), wordSpacing: `${metric.pressure}px`},
        });
        return Math.abs(painted.width - metric.target) <= EPS &&
          painted.height <= tail[i].lineHeightPx + EPS;
      });
      if (exactPaint) {
        boundaries.splice(0, boundaries.length, ...search.boundaries);
        current = alternative;
        exactPartition = search;
      }
    }
  }
  const changed = boundaries.some((v, i) => v !== initialBoundaries[i]);
  const needsCap = current.metrics.some(m => m.gaps > 0 && m.pressure > gentleMax + EPS);
  if (!changed && !needsCap) return null;

  const absoluteStart = paragraphLineStart + tailOffset;
  for (let i = 0; i < tail.length; i++) {
    const old = tail[i];
    const metric = current.metrics[i];
    const isLast = metric.end >= entry.text.length && !entry.continuesAfter;
    const rawSpacing = (!isLast && metric.gaps > 0) ? metric.pressure : 0;
    // Pull words between existing rows first. If no complete partition can
    // bring the row below the gentle cap, finish justification with the exact
    // measured word spacing instead of deliberately leaving a visible hole.
    // This is word-spacing only: glyphs are never scaled or letter-spaced.
    const fallbackStretch = Number.isFinite(rawSpacing) && rawSpacing > gentleMax + EPS;
    const wordSpacing = Number.isFinite(rawSpacing) ? rawSpacing : 0;

    const ownsOpening = !!old.render?.opening;
    const sourceRangeStart = ownsOpening ? sourceSegmentStart : metric.start;
    const lineSourceText = entry.text.slice(sourceRangeStart, metric.end);

    lines[absoluteStart + i] = {
      ...old,
      text: lineSourceText,
      runs: sliceRuns(entry.runs || [], sourceRangeStart, metric.end),
      words: lineSourceText.trim().split(/\s+/u).filter(Boolean),
      wordTokens: metric.wordTokens,
      naturalWidth: metric.measured.width,
      forcedBreak: false,
      isLast,
      source: sourceMetadata(entry, sourceRangeStart, metric.end),
      sourceText: lineSourceText,
      render: {
        ...old.render,
        body: metric.body,
        topInset: metric.measured.topInset || 0,
        // Keep the measured opening object on its original host row. Only the
        // ordinary body words are redistributed.
        opening: old.render?.opening || null,
        wordSpacing,
        alignment: isLast ? 'center' : 'right',
      },
      tailRebalanced: true,
      ...(exactPartition ? {tailExactRebalanced: true} : {}),
      tailWordSpacingTarget: Number.isFinite(rawSpacing) ? rawSpacing : null,
      // Historical diagnostic kept explicit: the final plan no longer clips
      // required spacing. A separate flag records rows that needed the fallback.
      tailWordSpacingCapped: false,
      ...(fallbackStretch ? { tailWordSpacingFallbackStretched: true } : {}),
    };
  }

  const result = {
    code: 'paragraph-tail-rebalanced',
    paragraphId: String(entry.id || ''),
    lineCount: tail.length,
    changedBoundaries: changed,
    maxWordSpacingBefore: before.maxPressure,
    maxWordSpacingAfter: current.maxPressure,
    gentleCap: gentleMax,
    ...(exactPartition ? {exactPartitionEvaluations: exactPartition.evaluations} : {}),
    ...(() => {
      const count = current.metrics.filter((metric) => {
        if (metric.end >= entry.text.length && !entry.continuesAfter) return false;
        return metric.gaps > 0 && metric.pressure > gentleMax + EPS;
      }).length;
      return count > 0 ? { fallbackStretchedRows: count } : {};
    })(),
  };
  diagnostics?.push?.(result);
  return result;
}

/** Main paragraphs, including their openings, are planned by this ONE flow.
 * `context.measure(part)` and the final painter use the same styled content.
 * No DOM node, browser float, scale, or guessed safety percentage is in a plan.
 */
export function layoutV9MainParagraphs(rawEntries, rawStrips, context, pageBottom, options = {}) {
  const strips = rawStrips.map(s => ({ ...s })).sort((a, b) => a.y_start - b.y_start);
  const lines = [], diagnostics = [];
  let y = strips[0]?.y_start || 0;
  const finish = (entryIndex = rawEntries.length, offset = 0, reason = '') => {
    const remaining = rawEntries.slice(entryIndex).map((e, i) => overflowEntry(e, i ? 0 : offset));
    const overflowText = remaining.map(e => e.text).join('\n');
    // Search can visit later strips without placing anything there. Only
    // committed rows and opening windows occupy the page; a rejected candidate
    // must not reserve empty space or push neighbouring streams/footers down.
    // Keep real source-break rows and the FULL window of an emitted opening,
    // including early page/row-limit returns before its body has finished.
    const endY = lines.reduce((bottom, line) => Math.max(
      bottom, line.y + line.lineHeightPx,
      line.render.opening ? line.render.opening.y + line.render.opening.height : bottom
    ), strips[0]?.y_start || 0);
    return { lines: lines.map(l => freezeLine(structuredClone(l))), endY, overflowText, overflowParagraphs: remaining, diagnostics, overflowReason: reason, debug: null };
  };
  for (let ei = 0; ei < rawEntries.length; ei++) {
    const entry = { ...rawEntries[ei], runs: [...(rawEntries[ei].runs || [])] };
    if (!entry.text) continue;
    const pitch = context.lineHeight;
    const paragraphLineStart = lines.length;
    const tokens = tokensOf(entry.text);
    let cursor = 0, ti = 0, opening = null, openingAttached = false;
    let descriptor = context.describeOpening(entry);
    if (descriptor?.skipPolicy && (
      descriptor.skipPolicy.skipShortLine ||
      descriptor.skipPolicy.skipSingleLine ||
      descriptor.skipPolicy.skipFewerThanLines
    )) {
      // B5: evaluate eligibility against the real V9 row geometry BEFORE the
      // opening word changes widths. The preview is the same paragraph with
      // opening disabled, so it cannot recurse into this policy again.
      const previewStrips = strips
        .filter(strip => strip.y_end > y + EPS)
        .map(strip => ({ ...strip, y_start: Math.max(strip.y_start, y) }))
        .filter(strip => strip.y_end > strip.y_start + EPS);
      if (previewStrips.length) {
        const previewEntry = { ...entry, _v9OpeningWordAllowed: false };
        const preview = layoutV9MainParagraphs(
          [previewEntry],
          previewStrips,
          context,
          pageBottom,
          { maxLines: 0, openingPolicyPreview: true }
        );
        const first = preview.lines[0] || null;
        const reason = openingWordSkipReason(descriptor.skipPolicy, {
          lineCount: preview.lines.length,
          complete: (preview.overflowParagraphs || []).length === 0,
          firstLineFill: first && first.width > 0 ? first.naturalWidth / first.width : 0,
        });
        if (reason) {
          diagnostics.push({
            code: 'opening-skipped-policy',
            paragraphId: entry.id,
            reason,
            lineCount: preview.lines.length,
            firstLineFill: first && first.width > 0 ? first.naturalWidth / first.width : 0,
          });
          descriptor = null;
        }
      }
    }
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

        if (droppedOpeningCrossesRightEdgeTransition(strips, slot.y, height, pitch, pageBottom)) {
          // A single dropped glyph cannot occupy two different right edges.
          // Keeping it dropped would strand the later widened row at the old
          // narrow width. Preserve the configured opening style as an inline
          // raised range and let normal row planning widen on the next grid row.
          entry.runs = [...entry.runs, {
            start: descriptor.start,
            end: descriptor.end,
            marks: descriptor.marks,
          }];
          diagnostics.push({
            code: 'opening-raised-at-right-edge-transition',
            paragraphId: entry.id,
            y: slot.y,
            dropLines: descriptor.dropLines,
          });
        } else {
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
    }
    const emit = (body, start, end, geometry, rowY, m, forcedBreak, wordTokens) => {
      const attached = opening && !openingAttached ? opening : null;
      const sourceStart = attached ? 0 : start;
      const isLast = end >= entry.text.length && !entry.continuesAfter;
      const specialSeparators = hasSpecialV9JustificationSeparator(body.text);
      const gaps = specialSeparators
        ? countV9JustificationGaps(body.text)
        : (body.text.match(/ /g) || []).length;
      const justify = !isLast && !forcedBreak && gaps > 0;
      const natural = m.width;
      const openingWindow = !!opening && rowY < opening.y + opening.height - EPS;
      const line = {
        layoutVersion: V9_INLINE_PLAN_VERSION,
        x: geometry.x, y: rowY, width: geometry.width, lineHeightPx: Math.max(pitch, m.height),
        fontSize: number(entry.typography?.fontSize, context.fontSize),
        text: entry.text.slice(sourceStart, end), runs: sliceRuns(entry.runs, sourceStart, end),
        words: entry.text.slice(sourceStart, end).trim().split(/\s+/u).filter(Boolean),
        wordTokens, naturalWidth: natural, forcedBreak, isLast,
        openingWindow,
        openingHostFullWidth: rowGeometry(strips, rowY, Math.max(pitch, m.height), pageBottom)?.width || geometry.width,
        source: sourceMetadata(entry, sourceStart, end),
        sourceText: entry.text.slice(sourceStart, end),
        render: { body, topInset: m.topInset || 0, opening: attached,
          wordSpacing: justify
            ? (specialSeparators
              ? resolveSpecialV9JustificationSpacing(context, body, natural, geometry.width, gaps)
              : Math.max(0, (geometry.width - natural) / gaps))
            : 0,
          // The opening already reserves its width and gap in geometry. A
          // final body row inherits the paragraph's ordinary centering inside
          // that free slot; it is not an independent opening+body composite.
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
        rebalanceContinuationTail(lines, paragraphLineStart, entry, cursor, context, diagnostics);
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
          const retryY = nextWiderOpeningRow(strips, y, pitch, opening, pageBottom);
          if (retryY !== null) {
            diagnostics.push({ code: 'opening-body-retry-at-wider-row', paragraphId: entry.id, fromY: y, toY: retryY });
            y = retryY;
          } else {
            y = opening.y + opening.height;
            diagnostics.push({ code: 'opening-body-below', paragraphId: entry.id });
          }
          continue;
        }
        const next = strips.find(s => s.y_start > y + EPS && s.y_start < pageBottom && s.width > (slot?.width || 0));
        if (next) { y = next.y_start; continue; }
        rebalanceContinuationTail(lines, paragraphLineStart, entry, cursor, context, diagnostics);
        return finish(ei, cursor, 'unbreakable-content-or-no-row-space');
      }
      const line = emit(selected.body, cursor, selected.end, g, y, selected.m, selected.forcedBreak, selected.wordTokens);
      line.lineHeightPx = rowH;
      cursor = selected.end; ti = selected.next; y += rowH;
      if (options.maxLines > 0 && lines.length >= options.maxLines) return finish(ei,cursor,'row-limit');
    }
    if (opening && !openingAttached) {
      emit(partForRange(entry, cursor, entry.text.length), cursor, entry.text.length, { x: opening.x, width: opening.width }, opening.y,
        { width: 0, height: pitch }, false, []);
    }
    if (opening) {
      y = Math.max(y, opening.y + opening.height);
      const sole = lines.length === paragraphLineStart + 1 ? lines[paragraphLineStart] : null;
      if (sole?.render.opening && sole.isLast) {
        // A hard source break is already centered by V9. If that one-row
        // paragraph also owns the opening word, center the SAME visual segment
        // (opening + gap + body) instead of centering the body alone.
        const base = rowGeometry(strips, opening.y, opening.height, pageBottom);
        const total = opening.width + (sole.render.body.text ? opening.gap : 0) + sole.naturalWidth;
        if (base && total <= base.width + EPS) {
          sole.x = base.x + (base.width - total) / 2;
          sole.width = Math.max(0, sole.naturalWidth);
          // Read-only diagnostics metadata: records the exact geometry used by
          // the planner so the report never has to infer opening centering from
          // post-paint DOM heuristics.
          sole.openingCompositeCentered = true;
          sole.openingHostX = base.x;
          sole.openingHostFullWidth = base.width;
          sole.openingCompositeWidth = total;
          sole.render.opening = { ...opening, x: sole.x + sole.naturalWidth + (sole.render.body.text ? opening.gap : 0) };
          sole.render.alignment = 'right';
        }
      }

      // Any complete multi-row paragraph shares one alignment frame, including
      // its dropped opening. Centre the final body in that frame whenever it
      // still overlaps the opening window AND the measured centered body clears
      // the fixed opening+gap. A one-row paragraph is handled above as one
      // opening+body composite. Wide endings keep their existing free slot.
      const paragraphLines = lines.slice(paragraphLineStart);
      const first = paragraphLines[0] || null;
      const last = paragraphLines.length > 1 ? paragraphLines.at(-1) : null;
      if (!entry.continues && !entry.continuesAfter && first?.render.opening &&
          !first.forcedBreak && last?.isLast && last.openingWindow &&
          !last.render.opening && last.wordTokens.length && last.naturalWidth > 0) {
        const frame = rowGeometry(strips, last.y, last.lineHeightPx, pageBottom);
        if (frame) {
          const x = frame.x + (frame.width - last.naturalWidth) / 2;
          const end = x + last.naturalWidth;
          const clearance = opening.x - opening.gap;
          if (x >= frame.x - EPS && end <= clearance + EPS) {
            last.x = x;
            last.width = last.naturalWidth;
            last.openingParagraphCentered = true;
            last.openingHostX = frame.x;
            last.openingHostFullWidth = frame.width;
            last.render.alignment = 'center';
          }
        }
      }

    }
    // A following original paragraph never inherits an opening window.
    if (entry.continuesAfter) rebalanceContinuationTail(lines, paragraphLineStart, entry, cursor, context, diagnostics);

  }
  return finish();
}
