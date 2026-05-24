import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-column-split-line-edge-guard";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function fail(label) {
  throw new Error(`[${MARKER}] ${label}`);
}

function patchHelper(source) {
  if (source.includes("function splitWordsByStripsWithLineEdgeGuard(")) return source;

  const helper = `
// ${MARKER}: same-stream column split must use the same line-edge standard
// as the main V9 page-break guard. The first/right column may end only on a
// filled line edge, not on a short technical box ending that later gets centered
// or leaves visible blank space.
function splitWordsByStripsWithLineEdgeGuard(text, metrics, rightStrips, opts = {}) {
  const fallback = splitWordsByStrips(text, metrics, rightStrips);
  const words = (text || '').split(/\\s+/).filter(Boolean);
  if (!fallback || words.length < 2 || !metrics || !Array.isArray(rightStrips) || rightStrips.length === 0) {
    return fallback;
  }

  const lineH = Number(metrics.lineHeight) || 0;
  if (!(lineH > 0)) return fallback;

  const strips = rightStrips.filter(s =>
    s && Number(s.width) > 0 && Number(s.height) > 0 && Math.floor(Number(s.height) / lineH) > 0
  );
  if (!strips.length) return fallback;

  const minLineEdgeFill = Math.max(Number(opts.minLineEdgeFill) || 0.82, 0.82);
  const oneWordFill = Math.max(0.96, minLineEdgeFill);

  function statsForPrefix(count) {
    const target = Math.max(0, Math.min(words.length, Number(count) || 0));
    if (target <= 0) {
      return { fits: true, totalLines: 0, capacity: 0, lastFill: 1, lastWords: 0, acceptable: false };
    }

    let cursor = 0;
    let totalLines = 0;
    let capacity = 0;
    let fits = true;
    let lastLine = null;

    for (let i = 0; i < strips.length; i++) {
      const strip = strips[i];
      const maxLines = Math.max(0, Math.floor(Number(strip.height) / lineH));
      capacity += maxLines;
      if (cursor >= target || maxLines <= 0) continue;

      const remaining = words.slice(cursor, target).join(' ');
      const lines = metrics.layoutLines(remaining, Number(strip.width));
      if (!lines || !lines.length) break;

      const linesUsed = Math.min(maxLines, lines.length);
      for (let j = 0; j < linesUsed; j++) {
        const line = lines[j];
        if (line && Array.isArray(line.words)) cursor += line.words.length;
        lastLine = {
          width: Number(strip.width) || 0,
          naturalWidth: Number(line?.width) || 0,
          words: Array.isArray(line?.words) ? line.words : [],
        };
      }
      totalLines += linesUsed;

      if (lines.length <= maxLines) break;
      if (i === strips.length - 1) {
        fits = false;
        break;
      }
    }

    if (cursor < target) fits = false;

    const lastFill = lastLine && lastLine.width > 0
      ? Math.min(1, Math.max(0, lastLine.naturalWidth / lastLine.width))
      : 0;
    const lastWords = lastLine?.words?.length || 0;
    const acceptable = !!lastLine && fits && (
      lastWords < 2 ? lastFill >= oneWordFill : lastFill >= minLineEdgeFill
    );

    return { fits, totalLines, capacity, lastFill, lastWords, acceptable };
  }

  function lineEndCandidates() {
    const out = [];
    let cursor = 0;
    let totalLines = 0;

    for (const strip of strips) {
      const maxLines = Math.max(0, Math.floor(Number(strip.height) / lineH));
      if (maxLines <= 0 || cursor >= words.length) continue;

      const remaining = words.slice(cursor).join(' ');
      const lines = metrics.layoutLines(remaining, Number(strip.width));
      if (!lines || !lines.length) break;

      const linesUsed = Math.min(maxLines, lines.length);
      for (let j = 0; j < linesUsed && cursor < words.length; j++) {
        const lineWords = Array.isArray(lines[j]?.words) ? lines[j].words.length : 0;
        if (lineWords <= 0) continue;
        cursor += lineWords;
        totalLines++;
        if (cursor > 0 && cursor < words.length) {
          out.push({ count: cursor, totalLines });
        }
      }

      if (lines.length <= maxLines || cursor >= words.length) break;
    }

    return out;
  }

  function approxLinesForSuffix(start) {
    const suffix = words.slice(start).join(' ');
    if (!suffix) return 0;
    const width = Number(strips[0]?.width) || Number(rightStrips[0]?.width) || 1;
    const lines = metrics.layoutLines(suffix, width);
    return Array.isArray(lines) ? lines.length : 0;
  }

  const candidates = lineEndCandidates();
  let best = null;

  for (const cand of candidates) {
    // Leave meaningful content for column B. One trailing word usually creates
    // the same problem on the other side.
    if (words.length - cand.count < 2) continue;
    const st = statsForPrefix(cand.count);
    if (!st.fits || !st.acceptable) continue;

    const suffixLines = approxLinesForSuffix(cand.count);
    const balancePenalty = Math.abs(st.totalLines - suffixLines);
    const fillScore = st.lastFill;
    const wordScore = Math.min(3, st.lastWords) * 0.03;
    const laterTieBreaker = cand.count / Math.max(1, words.length) * 0.02;
    const score = fillScore + wordScore + laterTieBreaker - balancePenalty * 0.08;

    if (!best || score > best.score) {
      best = { count: cand.count, score, stats: st, suffixLines };
    }
  }

  if (!best) return fallback;

  const fallbackCount = (fallback.first || '').split(/\\s+/).filter(Boolean).length;
  const fallbackStats = statsForPrefix(fallbackCount);

  // Keep the old split if it already satisfies the stronger main-line-edge
  // guard and is not materially worse. Otherwise use the guarded split.
  if (fallbackStats.acceptable) {
    const fallbackSuffixLines = approxLinesForSuffix(fallbackCount);
    const fallbackBalance = Math.abs(fallbackStats.totalLines - fallbackSuffixLines);
    const bestBalance = Math.abs(best.stats.totalLines - best.suffixLines);
    if (fallbackBalance <= bestBalance + 1 && fallbackStats.lastFill >= best.stats.lastFill - 0.04) {
      return fallback;
    }
  }

  return {
    first: words.slice(0, best.count).join(' '),
    second: words.slice(best.count).join(' '),
    _v9ColumnSplitLineEdgeGuard: {
      selectedWordCount: best.count,
      lastFill: best.stats.lastFill,
      lastWords: best.stats.lastWords,
      totalLines: best.stats.totalLines,
      suffixLines: best.suffixLines,
    },
  };
}
`;

  const anchor = `
// =====================================================================
// בונה strips לראשי לפי בר־מצרא: כשפרשן נגמר, הראשי מתפשט לתוך שטחו.
// =====================================================================`;

  if (!source.includes(anchor)) fail("missing post splitWordsByStrips insertion anchor");
  return source.replace(anchor, helper + anchor);
}

function patchCallSite(source) {
  const after = `let parts = splitWordsByStripsWithLineEdgeGuard(allText, splitMetricsForStream, rightStrips, {
        minLineEdgeFill: 0.82,
      });`;
  if (source.includes(after)) return source;

  const before = `let parts = splitWordsByStrips(allText, splitMetricsForStream, rightStrips);`;
  if (!source.includes(before)) fail("missing splitWordsByStrips call site");
  return source.replace(before, after);
}

function patchSplitMetadata(source) {
  const after = `pageContent.rightStream = {
        id: single.id,
        items: [parts.first],
        runs: firstRuns,
        syntheticContinuationAfter: true,
        originalStreamWasSplit: true,
        columnSplitLineEdgeGuard: parts._v9ColumnSplitLineEdgeGuard || null,
      };
      pageContent.leftStream  = {
        id: single.id,
        items: [parts.second],
        runs: secondRuns,
        syntheticContinuationFrom: 'right',
        originalStreamWasSplit: true,
      };`;
  if (source.includes(after)) return source;

  const before = `pageContent.rightStream = { id: single.id, items: [parts.first], runs: firstRuns };
      pageContent.leftStream  = { id: single.id, items: [parts.second], runs: secondRuns };`;
  if (!source.includes(before)) fail("missing one_long_split stream assignment anchor");
  return source.replace(before, after);
}

function patchSideBoxMetadata(source) {
  const after = `columnSplitLineEdgeGuard: streamData.columnSplitLineEdgeGuard || null,
      syntheticContinuationAfter: !!streamData.syntheticContinuationAfter,
      syntheticContinuationFrom: streamData.syntheticContinuationFrom || "",
      originalStreamWasSplit: !!streamData.originalStreamWasSplit,
      continues: !!flowResult.overflowText || !!streamData.syntheticContinuationAfter,`;
  if (source.includes(after)) return source;

  const before = `continues: !!flowResult.overflowText,`;
  if (!source.includes(before)) fail("missing side box continues anchor");
  return source.replace(before, after);
}

function patchRenderPredicate(source) {
  if (source.includes("const isSourceContinuationEnd = !!box.syntheticContinuationAfter")) return source;

  const replacement = `      // ${MARKER}: line.isLast can be only a technical end of column A.
      // If the source continues into column B, render this as a mid-paragraph
      // continuation cut and allow stretch/justify instead of centering.
      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isSourceContinuationEnd = !!box.syntheticContinuationAfter && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`;

  const variants = [
    `      // v9-column-a-continuation: the first column of a same-stream split
      // is a synthetic transition into column B. Its last line is never a real
      // paragraph/page ending, even if the generic box.continues flag is lost.
      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isColumnAContinuation || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`,
    `      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isColumnAContinuation || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`,
    `      // v9-column-continuation-cut: a synthetic column/page cut is not a paragraph end.
      // Even a one-word final line in column A must not be centered as a real last line.
      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;`,
    `      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1
        && line.naturalWidth < line.width - 2;`,
  ];

  for (const before of variants) {
    if (source.includes(before)) return source.replace(before, replacement);
  }
  fail("missing continuation predicate anchor");
}

function patchDebugDataset(source) {
  if (source.includes("lineEl.dataset.v9SourceContinuationEnd = \"1\"")) return source;

  const afterWithColumnFlag = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (isColumnAContinuation) lineEl.dataset.v9ColumnAContinuation = "1";
      if (isSourceContinuationEnd) {
        lineEl.dataset.v9SourceContinuationEnd = "1";
        if (box.columnSplitLineEdgeGuard) {
          lineEl.dataset.v9ColumnSplitLastFill = String(box.columnSplitLineEdgeGuard.lastFill || "");
          lineEl.dataset.v9ColumnSplitLastWords = String(box.columnSplitLineEdgeGuard.lastWords || "");
        }
      }`;

  const existingColumnFlag = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (isColumnAContinuation) lineEl.dataset.v9ColumnAContinuation = "1";`;
  if (source.includes(existingColumnFlag)) return source.replace(existingColumnFlag, afterWithColumnFlag);

  const plainBoxId = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);`;
  const afterPlain = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (isSourceContinuationEnd) {
        lineEl.dataset.v9SourceContinuationEnd = "1";
        if (box.columnSplitLineEdgeGuard) {
          lineEl.dataset.v9ColumnSplitLastFill = String(box.columnSplitLineEdgeGuard.lastFill || "");
          lineEl.dataset.v9ColumnSplitLastWords = String(box.columnSplitLineEdgeGuard.lastWords || "");
        }
      }`;
  if (!source.includes(plainBoxId)) fail("missing dataset anchor");
  return source.replace(plainBoxId, afterPlain);
}

function verify(source) {
  const required = [
    "function splitWordsByStripsWithLineEdgeGuard(",
    "acceptable = !!lastLine && fits && (",
    "lastWords < 2 ? lastFill >= oneWordFill : lastFill >= minLineEdgeFill",
    "splitWordsByStripsWithLineEdgeGuard(allText, splitMetricsForStream, rightStrips",
    "syntheticContinuationAfter: true",
    "columnSplitLineEdgeGuard: parts._v9ColumnSplitLineEdgeGuard || null",
    "continues: !!flowResult.overflowText || !!streamData.syntheticContinuationAfter",
    "const isSourceContinuationEnd = !!box.syntheticContinuationAfter",
    "const isContinuationCut = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues)",
    "lineEl.dataset.v9SourceContinuationEnd = \"1\"",
  ];
  for (const needle of required) {
    if (!source.includes(needle)) fail(`missing ${needle}`);
  }
}

const before = readFile(TARGET);
let after = before;
after = patchHelper(after);
after = patchCallSite(after);
after = patchSplitMetadata(after);
after = patchSideBoxMetadata(after);
after = patchRenderPredicate(after);
after = patchDebugDataset(after);
verify(after);

if (after !== before) {
  fs.writeFileSync(TARGET, after);
  console.log(`[${MARKER}] patched ${TARGET}`);
} else {
  console.log(`[${MARKER}] patch noop for ${TARGET}`);
}
