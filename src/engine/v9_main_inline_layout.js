import { sliceRuns } from './runs_dom.js';
import { sourceMetadata, referenceInV9Range } from './v9_source_fragments.js';
import { openingWordSkipReason } from '../opening_word.js';
import { isV9StandaloneDirectionControlOnly, splitV9EdgeGlue } from './v9_bidi_controls.js';

export const V9_INLINE_PLAN_VERSION = 'v9-inline-1';
const EPS = 1 / 64;
const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const refAnchor = r => Number(r.anchor ?? r.absoluteAnchor ?? r.localAnchor);

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
  // When the first row owns a dropped opening, its body starts AFTER the
  // opening source range. Re-measuring from sourceSegmentStart would duplicate
  // the opening inside the body span.
  const bodySegmentStart = tail[0]?.render?.opening
    ? (words[0]?.start ?? Math.max(sourceSegmentStart, Number(tail[0].render.opening?.part?.text?.length) || 0))
    : sourceSegmentStart;
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

    const start = lineIndex === 0
      ? bodySegmentStart
      : (words[fromWord]?.start ?? segmentEnd);
    const visibleEnd = toWord > fromWord ? words[toWord - 1].end : start;
    const consumedEnd = toWord < words.length ? (words[toWord]?.start ?? segmentEnd) : segmentEnd;
    const body = partForRange(entry, start, visibleEnd, consumedEnd);
    const measured = context.measure(body);
    const target = number(tail[lineIndex]?.width, 0);
    const maxHeight = number(tail[lineIndex]?.lineHeightPx, context.lineHeight);

    if (!(target > 0) || !measured || measured.width > target + EPS ||
        (measured.height > 0 && maxHeight > 0 && measured.height > maxHeight + EPS)) {
      cache.set(key, null);
      return null;
    }

    const gaps = (body.text.match(/ /g) || []).length;
    const deficit = Math.max(0, target - measured.width);
    const metric = {
      start, end: consumedEnd, visibleEnd, body, measured, target, gaps, deficit,
      wordTokens: words.slice(fromWord, toWord),
      openingOnly,
    };
    metric.pressure = openingOnly ? 0 : continuationTailPressure(metric);
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
  const changed = boundaries.some((v, i) => v !== initialBoundaries[i]);
  const needsCap = current.metrics.some(m => m.gaps > 0 && m.pressure > gentleMax + EPS);
  if (!changed && !needsCap) return null;

  const absoluteStart = paragraphLineStart + tailOffset;
  for (let i = 0; i < tail.length; i++) {
    const old = tail[i];
    const metric = current.metrics[i];
    const isLast = metric.end >= entry.text.length && !entry.continuesAfter;
    const rawSpacing = (!isLast && metric.gaps > 0) ? metric.pressure : 0;
    const wordSpacing = Number.isFinite(rawSpacing) ? Math.min(rawSpacing, gentleMax) : 0;

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
      tailWordSpacingTarget: Number.isFinite(rawSpacing) ? rawSpacing : null,
      tailWordSpacingCapped: Number.isFinite(rawSpacing) && rawSpacing > gentleMax + EPS,
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
  };
  diagnostics?.push?.(result);
  return result;
}


function centerCompletedOpeningWindowTail(lines, paragraphLineStart, opening, strips, entry, context, pageBottom, diagnostics) {
  if (!opening || paragraphLineStart < 0 || paragraphLineStart >= lines.length) return false;
  const paragraphLines = lines.slice(paragraphLineStart);
  if (!paragraphLines.length) return false;

  const last = paragraphLines[paragraphLines.length - 1];
  if (!(last?.isLast || last?.forcedBreak)) return false;

  const windowLines = paragraphLines.filter(line =>
    line.y < opening.y + opening.height - EPS &&
    line.y + line.lineHeightPx > opening.y + EPS
  );
  if (!windowLines.length || windowLines[windowLines.length - 1] !== last) return false;

  // One-row paragraph: opening + gap + body are one movable visual object.
  // This is the long-standing orphan-line rule and is safe because no second
  // row shares the dropped glyph.
  if (windowLines.length === 1) {
    const line = windowLines[0];
    const base = rowGeometry(strips, line.y, line.lineHeightPx, pageBottom);
    if (!base) return false;
    const bodyWidth = Math.max(0, number(line.naturalWidth));
    const gap = bodyWidth > EPS ? Math.max(0, number(opening.gap)) : 0;
    const total = opening.width + gap + bodyWidth;
    if (total > base.width + EPS) return false;

    line.x = base.x + (base.width - total) / 2;
    line.width = bodyWidth;
    line.render.opening = { ...line.render.opening, x: line.x + bodyWidth + gap };
    opening.x = line.render.opening.x;
    line.render.alignment = 'right';
    line.render.wordSpacing = 0;
    line.openingCompositeCentered = true;
    line.openingHostX = base.x;
    line.openingHostFullWidth = base.width;
    line.openingCompositeWidth = total;
    diagnostics?.push?.({
      code: 'opening-window-final-composite-centered',
      paragraphId: entry.id,
      rows: 1,
      compositeWidth: total,
      rowWidth: base.width,
    });
    return true;
  }

  const fallbackAdjacentLastBody = (reason, extra = {}) => {
    // No legal gentle composite balance exists. The unsafe historical behavior
    // is to center the LAST BODY by itself inside the leftover window, visually
    // detaching it from the shared opening glyph. Keep source/geometry untouched
    // and only cancel that independent centering: RTL right alignment makes the
    // body remain adjacent to the opening without stretching or moving it.
    last.render.alignment = 'right';
    last.render.wordSpacing = 0;
    last.openingWindowCenterFallback = true;
    diagnostics?.push?.({
      code: 'opening-window-final-adjacent-fallback',
      paragraphId: entry.id,
      reason,
      rows: windowLines.length,
      ...extra,
    });
    return true;
  };

  // Multi-row dropped opening: the glyph belongs to EVERY row in its drop
  // window. Moving it to center only the last row would steal width from an
  // earlier row and can recreate the "wide row became half width" regression.
  // Keep the opening fixed and rebalance word boundaries across all window rows
  // so the final body fills the remaining left-hand window with gentle spacing.
  if (windowLines.some(line => !Array.isArray(line.wordTokens))) {
    return fallbackAdjacentLastBody('missing-word-tokens');
  }
  const words = windowLines.flatMap(line => line.wordTokens);
  if (!words.length) return fallbackAdjacentLastBody('no-body-words');
  for (let i = 1; i < words.length; i++) {
    if (!(words[i].start >= words[i - 1].end)) {
      return fallbackAdjacentLastBody('non-monotonic-word-offsets');
    }
  }

  const sourceBase = number(entry.sourceOffset ?? entry._v9SourceOffset, 0);
  const sourceStartAbs = Number(windowLines[0]?.source?.start);
  const sourceSegmentStart = Number.isFinite(sourceStartAbs)
    ? Math.max(0, sourceStartAbs - sourceBase)
    : 0;
  const firstLeadingLength = String(windowLines[0]?.render?.body?.leadingText || '').length;
  const bodySegmentStart = Math.max(
    sourceSegmentStart,
    (words[0]?.start ?? sourceSegmentStart) - firstLeadingLength
  );
  const lastSourceEndAbs = Number(last?.source?.end);
  const segmentEnd = Number.isFinite(lastSourceEndAbs)
    ? Math.max(bodySegmentStart, Math.min(entry.text.length, lastSourceEndAbs - sourceBase))
    : entry.text.length;

  const rowGeometries = windowLines.map(line =>
    rowGeometry(strips, line.y, line.lineHeightPx, pageBottom)
  );
  if (rowGeometries.some(g => !g)) return fallbackAdjacentLastBody('missing-row-geometry');

  // The existing opening position is authoritative. Each row's usable body
  // width is the contiguous RTL interval to its left.
  const targets = rowGeometries.map(g =>
    Math.max(0, Math.min(g.x + g.width, opening.x - opening.gap) - g.x)
  );
  if (targets.some(w => !(w > EPS))) return fallbackAdjacentLastBody('no-body-window');

  const cache = new Map();
  const metricFor = (lineIndex, fromWord, toWord) => {
    if (fromWord < 0 || toWord <= fromWord || toWord > words.length) return null;
    const key = `${lineIndex}:${fromWord}:${toWord}`;
    if (cache.has(key)) return cache.get(key);

    const start = lineIndex === 0
      ? bodySegmentStart
      : (words[fromWord]?.start ?? segmentEnd);
    const visibleEnd = words[toWord - 1].end;
    const consumedEnd = toWord < words.length
      ? (words[toWord]?.start ?? segmentEnd)
      : segmentEnd;
    const body = partForRange(entry, start, visibleEnd, consumedEnd);
    const measured = context.measure(body);
    const maxHeight = number(windowLines[lineIndex]?.lineHeightPx, context.lineHeight);
    if (!measured ||
        measured.width > targets[lineIndex] + EPS ||
        measured.height > maxHeight + EPS) {
      cache.set(key, null);
      return null;
    }

    const gaps = (body.text.match(/ /g) || []).length;
    const deficit = Math.max(0, targets[lineIndex] - measured.width);
    const pressure = deficit <= EPS
      ? 0
      : (gaps > 0 ? deficit / gaps : Number.POSITIVE_INFINITY);
    const metric = {
      start, visibleEnd, end: consumedEnd, body, measured,
      gaps, deficit, pressure,
      wordTokens: words.slice(fromWord, toWord),
    };
    cache.set(key, metric);
    return metric;
  };

  const lineCount = windowLines.length;
  if (words.length < lineCount) return fallbackAdjacentLastBody('too-few-words');

  // Dynamic programming over ordered word boundaries. Score the worst required
  // word-space expansion first, then total squared pressure. This is the same
  // "spread gently across the paragraph" principle used for page tails, but
  // here the REAL final row also participates instead of being centered alone.
  let states = new Map([[0, { score: 0, maxPressure: 0, sumSquares: 0, metrics: [] }]]);
  for (let li = 0; li < lineCount; li++) {
    const nextStates = new Map();
    for (const [from, state] of states) {
      const rowsAfter = lineCount - li - 1;
      const maxTo = words.length - rowsAfter;
      for (let to = from + 1; to <= maxTo; to++) {
        const metric = metricFor(li, from, to);
        if (!metric || !Number.isFinite(metric.pressure)) continue;
        const maxPressure = Math.max(state.maxPressure, metric.pressure);
        const sumSquares = state.sumSquares + metric.pressure * metric.pressure;
        const score = maxPressure * 100000 + sumSquares;
        const existing = nextStates.get(to);
        if (!existing || score + TAIL_REBALANCE_SCORE_EPS < existing.score) {
          nextStates.set(to, {
            score, maxPressure, sumSquares,
            metrics: [...state.metrics, metric],
          });
        }
      }
    }
    states = nextStates;
    if (!states.size) return fallbackAdjacentLastBody('no-legal-partition');
  }

  const best = states.get(words.length);
  if (!best) return fallbackAdjacentLastBody('no-complete-partition');

  const gentleMax = continuationTailGentleSpacing(context);
  if (best.maxPressure > gentleMax + EPS) {
    return fallbackAdjacentLastBody('excessive-word-spacing', {
      requiredWordSpacing: best.maxPressure,
      gentleCap: gentleMax,
    });
  }

  for (let li = 0; li < lineCount; li++) {
    const old = windowLines[li];
    const metric = best.metrics[li];
    const ownsOpening = !!old.render?.opening;
    const sourceRangeStart = ownsOpening ? sourceSegmentStart : metric.start;
    const lineSourceText = entry.text.slice(sourceRangeStart, metric.end);
    const absoluteIndex = lines.indexOf(old);
    if (absoluteIndex < 0) return false;

    lines[absoluteIndex] = {
      ...old,
      x: rowGeometries[li].x,
      width: targets[li],
      text: lineSourceText,
      runs: sliceRuns(entry.runs || [], sourceRangeStart, metric.end),
      words: lineSourceText.trim().split(/\s+/u).filter(Boolean),
      wordTokens: metric.wordTokens,
      naturalWidth: metric.measured.width,
      source: sourceMetadata(entry, sourceRangeStart, metric.end),
      sourceText: lineSourceText,
      render: {
        ...old.render,
        body: metric.body,
        topInset: metric.measured.topInset || 0,
        opening: ownsOpening ? { ...old.render.opening, x: opening.x } : null,
        // The final row inside the opening window is not an independent centered
        // line. It is the left half of one visual row whose right half is the
        // opening glyph. Fill that left interval gently so the WHOLE visual row
        // is centered without moving the shared glyph.
        wordSpacing: metric.gaps > 0 ? metric.pressure : 0,
        alignment: 'right',
      },
      openingWindow: true,
      openingWindowBalanced: true,
    };
  }

  // Find the rebuilt final row by semantic identity, not stale object identity.
  const balancedLast = lines.slice(paragraphLineStart).find(line =>
    line.isLast &&
    line.y < opening.y + opening.height - EPS &&
    line.source?.paragraphId === last.source?.paragraphId
  );
  if (balancedLast) {
    balancedLast.openingCompositeCentered = true;
    balancedLast.openingHostX = rowGeometries[lineCount - 1].x;
    balancedLast.openingHostFullWidth =
      targets[lineCount - 1] + opening.gap + opening.width;
    balancedLast.openingCompositeWidth =
      targets[lineCount - 1] + opening.gap + opening.width;
  }

  diagnostics?.push?.({
    code: 'opening-window-final-composite-centered',
    paragraphId: entry.id,
    rows: lineCount,
    maxWordSpacing: best.maxPressure,
    gentleCap: gentleMax,
  });
  return true;
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
    return { lines: lines.map(l => freezeLine(structuredClone(l))), endY: y, overflowText, overflowParagraphs: remaining, diagnostics, overflowReason: reason, debug: null };
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
          y = opening.y + opening.height;
          diagnostics.push({ code: 'opening-body-below', paragraphId: entry.id });
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
      centerCompletedOpeningWindowTail(
        lines, paragraphLineStart, opening, strips, entry, context, pageBottom, diagnostics
      );
      y = Math.max(y, opening.y + opening.height);
    }
    // A following original paragraph never inherits an opening window.
    if (entry.continuesAfter) rebalanceContinuationTail(lines, paragraphLineStart, entry, cursor, context, diagnostics);

  }
  return finish();
}
