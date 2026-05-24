import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-column-split-balance-expansion";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function fail(label) {
  throw new Error(`[${MARKER}] ${label}`);
}

function patchCallOptions(source) {
  const before = `let parts = splitWordsByStripsWithLineEdgeGuard(allText, splitMetricsForStream, rightStrips, {
        minLineEdgeFill: 0.82,
      });`;
  const after = `let parts = splitWordsByStripsWithLineEdgeGuard(allText, splitMetricsForStream, rightStrips, {
        minLineEdgeFill: 0.82,
        halfWidth: sideHalfWidth,
        fullWidth: innerWidth,
      });`;
  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("missing splitWordsByStripsWithLineEdgeGuard options anchor");
  return source.replace(before, after);
}

function patchSuffixEstimator(source) {
  const before = `  function approxLinesForSuffix(start) {
    const suffix = words.slice(start).join(' ');
    if (!suffix) return 0;
    const width = Number(strips[0]?.width) || Number(rightStrips[0]?.width) || 1;
    const lines = metrics.layoutLines(suffix, width);
    return Array.isArray(lines) ? lines.length : 0;
  }`;
  const after = `  function approxLinesForSuffix(start, rightLineCount = 0) {
    const suffixWords = words.slice(start);
    if (!suffixWords.length) return 0;

    const halfWidth = Number(opts.halfWidth) || Number(strips[0]?.width) || Number(rightStrips[0]?.width) || 1;
    const fullWidth = Number(opts.fullWidth) || halfWidth;
    const halfLimit = Math.max(0, Math.floor(Number(rightLineCount) || 0));

    let cursor = 0;
    let totalLines = 0;

    // Column B first shares the page with column A. If it still has content
    // after column A ends, it may expand to full width. Estimating the suffix
    // this way prevents the split chooser from accepting a very short column A
    // just because the suffix was measured as if it stayed narrow forever.
    if (halfLimit > 0) {
      const halfLines = metrics.layoutLines(suffixWords.join(' '), halfWidth) || [];
      const useHalf = Math.min(halfLimit, halfLines.length);
      for (let i = 0; i < useHalf; i++) {
        const n = Array.isArray(halfLines[i]?.words) ? halfLines[i].words.length : 0;
        if (n <= 0) break;
        cursor += n;
        totalLines++;
      }
      if (cursor >= suffixWords.length || halfLines.length <= halfLimit) return totalLines;
    }

    const remaining = suffixWords.slice(cursor).join(' ');
    if (!remaining) return totalLines;
    const fullLines = metrics.layoutLines(remaining, fullWidth) || [];
    return totalLines + fullLines.length;
  }`;

  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("missing approxLinesForSuffix anchor");
  return source.replace(before, after);
}

function patchCandidateScoring(source) {
  const before = `    const suffixLines = approxLinesForSuffix(cand.count);
    const balancePenalty = Math.abs(st.totalLines - suffixLines);
    const fillScore = st.lastFill;
    const wordScore = Math.min(3, st.lastWords) * 0.03;
    const laterTieBreaker = cand.count / Math.max(1, words.length) * 0.02;
    const score = fillScore + wordScore + laterTieBreaker - balancePenalty * 0.08;

    if (!best || score > best.score) {
      best = { count: cand.count, score, stats: st, suffixLines };
    }`;
  const after = `    const suffixLines = approxLinesForSuffix(cand.count, st.totalLines);
    const balancePenalty = Math.abs(st.totalLines - suffixLines);
    const leftLongPenalty = Math.max(0, suffixLines - st.totalLines);
    const fillScore = st.lastFill;
    const wordScore = Math.min(3, st.lastWords) * 0.03;
    const laterTieBreaker = cand.count / Math.max(1, words.length) * 0.12;
    // Balance is now the primary criterion. A split that leaves column B much
    // longer than column A is exactly the visual bug reported by the user.
    const score = fillScore * 0.30 + wordScore + laterTieBreaker
      - balancePenalty * 0.75
      - leftLongPenalty * 0.85;

    if (!best || score > best.score) {
      best = { count: cand.count, score, stats: st, suffixLines, leftLongPenalty };
    }`;

  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("missing candidate scoring anchor");
  return source.replace(before, after);
}

function patchFallbackSelection(source) {
  const before = `  if (fallbackStats.acceptable) {
    const fallbackSuffixLines = approxLinesForSuffix(fallbackCount);
    const fallbackBalance = Math.abs(fallbackStats.totalLines - fallbackSuffixLines);
    const bestBalance = Math.abs(best.stats.totalLines - best.suffixLines);
    if (fallbackBalance <= bestBalance + 1 && fallbackStats.lastFill >= best.stats.lastFill - 0.04) {
      return fallback;
    }
  }`;
  const after = `  if (fallbackStats.acceptable) {
    const fallbackSuffixLines = approxLinesForSuffix(fallbackCount, fallbackStats.totalLines);
    const fallbackBalance = Math.abs(fallbackStats.totalLines - fallbackSuffixLines);
    const fallbackLeftLong = Math.max(0, fallbackSuffixLines - fallbackStats.totalLines);
    const bestBalance = Math.abs(best.stats.totalLines - best.suffixLines);
    const bestLeftLong = Math.max(0, best.suffixLines - best.stats.totalLines);
    if (
      fallbackLeftLong <= bestLeftLong + 1 &&
      fallbackBalance <= bestBalance + 1 &&
      fallbackStats.lastFill >= best.stats.lastFill - 0.04
    ) {
      return fallback;
    }
  }`;

  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("missing fallback selection anchor");
  return source.replace(before, after);
}

function patchDebugMetadata(source) {
  const before = `      suffixLines: best.suffixLines,
    },`;
  const after = `      suffixLines: best.suffixLines,
      leftLongPenalty: best.leftLongPenalty || 0,
    },`;
  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("missing debug metadata anchor");
  return source.replace(before, after);
}

function patchSameStreamLeftExpansion(source) {
  const before = `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      maxFullStrip3Lines: isSameStreamSideSplit && (pass2Right || pass1Right) ? 1 : 0,
      lockFullStrip3Start: !!(pass2Right || pass1Right),
    });`;
  const after = `pass2Left = buildSideStream(pageContent.leftStream, 'left', {
      mainBottomY,
      otherSideEndY: otherEnd,
      // Column B may expand after column A ends. The old one-line cap solved
      // centered orphan rows, but after source-continuation rendering exists it
      // incorrectly prevents the surviving second column from using full width.
      maxFullStrip3Lines: 0,
      lockFullStrip3Start: !!(pass2Right || pass1Right),
    });`;
  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("missing same-stream left expansion anchor");
  return source.replace(before, after);
}

function patchDebugDataset(source) {
  const before = `          lineEl.dataset.v9ColumnSplitLastWords = String(box.columnSplitLineEdgeGuard.lastWords || "");`;
  const after = `          lineEl.dataset.v9ColumnSplitLastWords = String(box.columnSplitLineEdgeGuard.lastWords || "");
          lineEl.dataset.v9ColumnSplitLeftLongPenalty = String(box.columnSplitLineEdgeGuard.leftLongPenalty || "0");`;
  if (source.includes(after)) return source;
  if (!source.includes(before)) return source;
  return source.replace(before, after);
}

function verify(source) {
  const required = [
    "halfWidth: sideHalfWidth",
    "fullWidth: innerWidth",
    "function approxLinesForSuffix(start, rightLineCount = 0)",
    "leftLongPenalty = Math.max(0, suffixLines - st.totalLines)",
    "maxFullStrip3Lines: 0",
    "v9ColumnSplitLeftLongPenalty",
  ];
  for (const needle of required) {
    if (!source.includes(needle)) fail(`missing ${needle}`);
  }
  if (source.includes("maxFullStrip3Lines: isSameStreamSideSplit && (pass2Right || pass1Right) ? 1 : 0")) {
    fail("same-stream column B is still one-line capped");
  }
}

const before = readFile(TARGET);
let after = before;
after = patchCallOptions(after);
after = patchSuffixEstimator(after);
after = patchCandidateScoring(after);
after = patchFallbackSelection(after);
after = patchDebugMetadata(after);
after = patchSameStreamLeftExpansion(after);
after = patchDebugDataset(after);
verify(after);

if (after !== before) {
  fs.writeFileSync(TARGET, after);
  console.log(`[${MARKER}] patched ${TARGET}`);
} else {
  console.log(`[${MARKER}] patch noop for ${TARGET}`);
}
