import fs from "node:fs";

const path = "src/vilna_v9.js";
let text = fs.readFileSync(path, "utf8").replace(/^\uFEFF/, "");
const before = text;

function fail(msg) {
  throw new Error(`[v9-adjusted-spacing] ${msg}`);
}

function replaceBetween(startNeedle, endNeedle, replacement, label) {
  const start = text.indexOf(startNeedle);
  if (start < 0) fail(`missing start for ${label}`);
  const end = text.indexOf(endNeedle, start);
  if (end < 0) fail(`missing end for ${label}`);
  text = text.slice(0, start) + replacement + "\n\n" + text.slice(end);
  console.log(`[v9-adjusted-spacing] patched ${label}`);
}

function replaceOnce(oldText, newText, label) {
  if (text.includes(newText)) {
    console.log(`[v9-adjusted-spacing] already patched ${label}`);
    return;
  }
  if (!text.includes(oldText)) fail(`missing block for ${label}`);
  text = text.replace(oldText, newText);
  console.log(`[v9-adjusted-spacing] patched ${label}`);
}

function insertBefore(needle, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) {
    console.log(`[v9-adjusted-spacing] already patched ${label}`);
    return;
  }
  const idx = text.indexOf(needle);
  if (idx < 0) fail(`missing anchor for ${label}`);
  text = text.slice(0, idx) + addition + "\n" + text.slice(idx);
  console.log(`[v9-adjusted-spacing] patched ${label}`);
}

function insertAfter(needle, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) {
    console.log(`[v9-adjusted-spacing] already patched ${label}`);
    return;
  }
  const idx = text.indexOf(needle);
  if (idx < 0) fail(`missing anchor for ${label}`);
  text = text.slice(0, idx + needle.length) + addition + text.slice(idx + needle.length);
  console.log(`[v9-adjusted-spacing] patched ${label}`);
}

function mustContain(marker) {
  if (!text.includes(marker)) fail(`missing marker after patch: ${marker}`);
}

// 1) Allow classifiedBreakCandidates to receive candidate objects, not only numeric offsets.
replaceBetween(
  "function classifiedBreakCandidates(text, offsets, visualLineEnds) {",
  "function safeBreakCandidates(text, visualLineEnds, opts = {}) {",
`function classifiedBreakCandidates(text, offsets, visualLineEnds) {
  const seen = new Set();
  const list = [];

  for (const raw of offsets || []) {
    const offset = typeof raw === "object" ? raw.offset : raw;
    if (!Number.isFinite(offset) || seen.has(offset)) continue;
    seen.add(offset);

    const kind = typeof raw === "object" && raw.kind
      ? raw.kind
      : classifyV9SafeBreakOffset(text, offset, visualLineEnds || []);

    const priority = typeof raw === "object" && Number.isFinite(raw.priority)
      ? raw.priority
      : priorityForBreakKind(kind);

    if (priority <= 0) continue;

    list.push({
      ...(typeof raw === "object" ? raw : {}),
      offset,
      kind,
      priority,
    });
  }

  list.sort((a, b) => b.priority - a.priority || b.offset - a.offset);
  return list;
}`,
  "classifiedBreakCandidates object support"
);

// 2) Emit conservative visual-line-end-spread candidates.
insertBefore(
  "// buildPages: בונה דפים מרובים מרצף פסקאות (כמו V8)",
`function adjustedSpreadBreakCandidates(text, visualLineEnds, metrics, widthPx, opts = {}) {
  if (!text || !metrics || !Number.isFinite(widthPx) || widthPx <= 0) return [];

  const min = opts.min || 1;
  const max = opts.max || text.length;
  const minRatio = opts.minRatio || 0.56;
  const maxRatio = opts.maxRatio || 0.96;
  const minWords = opts.minWords || 3;
  const maxExtraPerGapPx = opts.maxExtraPerGapPx || Math.max(5, (metrics.fontSize || 12) * 0.55);

  const visualSet = new Set(visualLineEnds || []);
  const out = [];

  for (const offset of uniqueSortedBreakOffsets(wordGapCandidates(text), min, max)) {
    if (visualSet.has(offset)) continue;

    const prefix = text.slice(0, offset).trimEnd();
    if (!prefix) continue;

    const lines = metrics.layoutLines(prefix, widthPx);
    if (!lines || !lines.length) continue;

    const last = lines[lines.length - 1];
    const words = last.words || [];
    if (words.length < minWords) continue;

    const naturalWidth = Number(last.width) || 0;
    if (naturalWidth <= 0) continue;

    const ratio = naturalWidth / widthPx;
    if (ratio < minRatio || ratio > maxRatio) continue;

    const gaps = Math.max(1, words.length - 1);
    const extraPerGap = (widthPx - naturalWidth) / gaps;
    if (extraPerGap > maxExtraPerGapPx) continue;

    out.push({
      offset,
      kind: "visual-line-end-spread",
      priority: priorityForBreakKind("visual-line-end-spread"),
      spacing: {
        mode: "spread",
        ratio,
        extraPerGap,
      },
    });
  }

  return out;
}

`,
  "adjustedSpreadBreakCandidates"
);

// 3) Carry spacing metadata through splitInfo.
replaceOnce(
`        const makeSplit = (len, movedNotes) => ({
          firstHalf: { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes, _continues: true },
          secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },
          sliceIdx,
          baseN,
        });`,
`        const makeSplit = (len, movedNotes, candidate = null) => {
          const firstHalf = {
            ...target,
            mainText: fullText.substring(0, len).trimEnd(),
            notes: movedNotes,
            _continues: true,
          };
          if (candidate && candidate.spacing && candidate.spacing.mode) {
            firstHalf._v9SpacingMode = candidate.spacing.mode;
            firstHalf._v9BreakKind = candidate.kind || "";
          }
          return {
            firstHalf,
            secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },
            sliceIdx,
            baseN,
          };
        };`,
  "makeSplit spacing metadata"
);
replaceOnce(
  "firstOverflowByPriority.set(cand.priority, makeSplit(cand.offset, movedNotes));",
  "firstOverflowByPriority.set(cand.priority, makeSplit(cand.offset, movedNotes, cand));",
  "overflow split candidate metadata"
);
replaceOnce(
  "split: makeSplit(cand.offset, movedNotes),",
  "split: makeSplit(cand.offset, movedNotes, cand),",
  "clean split candidate metadata"
);

// 4) Insert adjusted spread candidates between visual-line-end and semantic fallbacks.
replaceOnce(
`        const semanticEnds = safeBreakCandidates(fullText, lineEnds, {
          min: MIN_SPLIT,
          max: fullText.length,
          includeVisual: false,
          includeSentence: true,
          includePunctuation: true,
          includeWordGap: false,
        });
        // משה 2026-05-17: רשימה מאוחדת עם priority — visual-line-end קודם semantic
        const unifiedCandidates = classifiedBreakCandidates(
          fullText,
          allowParagraphSplit ? [...lineEnds, ...semanticEnds] : lineEnds,
          lineEnds
        );`,
`        const semanticEnds = safeBreakCandidates(fullText, lineEnds, {
          min: MIN_SPLIT,
          max: fullText.length,
          includeVisual: false,
          includeSentence: true,
          includePunctuation: true,
          includeWordGap: false,
        });
        const adjustedSpreadEnds = allowParagraphSplit
          ? adjustedSpreadBreakCandidates(fullText, lineEnds, splitMetrics, splitMainWidth, {
              min: MIN_SPLIT,
              max: fullText.length,
              minRatio: 0.56,
              maxRatio: 0.96,
              minWords: 3,
            })
          : [];
        // משה 2026-05-18: רשימה מאוחדת עם priority — visual-line-end קודם,
        // adjusted spread שני, ורק אחר כך semantic punctuation.
        const unifiedCandidates = classifiedBreakCandidates(
          fullText,
          allowParagraphSplit ? [...lineEnds, ...adjustedSpreadEnds, ...semanticEnds] : lineEnds,
          lineEnds
        );`,
  "regular split adjusted spread candidates"
);

// 5) Add adjusted spread candidates to gap rescue too.
replaceOnce(
`          const semanticRescueEnds = safeBreakCandidates(fullText, visualRescueEnds, {
            min: 2,
            max: fullText.length,
            includeVisual: false,
            includeSentence: true,
            includePunctuation: true,
            includeWordGap: false,
          });
          // משה 2026-05-17: רשימה מאוחדת עם priority. visual-line-end (900)
          // קודם semantic ends (600/580). priority מתווסף לציון כקבוע גדול
          // (× 0.01) כך שעדיפות תמיד מנצחת fill בתוך אותו tournament.
          const rescueClassified = classifiedBreakCandidates(
            fullText,
            [...visualRescueEnds, ...semanticRescueEnds],
            visualRescueEnds
          );
          const rescuePriorityByOffset = new Map(rescueClassified.map(c => [c.offset, c.priority]));`,
`          const semanticRescueEnds = safeBreakCandidates(fullText, visualRescueEnds, {
            min: 2,
            max: fullText.length,
            includeVisual: false,
            includeSentence: true,
            includePunctuation: true,
            includeWordGap: false,
          });
          const adjustedRescueEnds = adjustedSpreadBreakCandidates(
            fullText,
            visualRescueEnds,
            splitMetrics,
            splitMainWidth,
            {
              min: 2,
              max: fullText.length,
              minRatio: 0.56,
              maxRatio: 0.96,
              minWords: 3,
            }
          );
          // משה 2026-05-18: rescue משתמש באותה היררכיה:
          // visual-line-end → adjusted spread → semantic punctuation.
          const rescueClassified = classifiedBreakCandidates(
            fullText,
            [...visualRescueEnds, ...adjustedRescueEnds, ...semanticRescueEnds],
            visualRescueEnds
          );
          const rescuePriorityByOffset = new Map(rescueClassified.map(c => [c.offset, c.priority]));
          const rescueCandidateByOffset = new Map(rescueClassified.map(c => [c.offset, c]));`,
  "gap rescue adjusted spread candidates"
);
replaceOnce(
`            const firstHalf = { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes, _continues: true };`,
`            const rescueCandidate = rescueCandidateByOffset.get(len);
            const firstHalf = { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes, _continues: true };
            if (rescueCandidate && rescueCandidate.spacing && rescueCandidate.spacing.mode) {
              firstHalf._v9SpacingMode = rescueCandidate.spacing.mode;
              firstHalf._v9BreakKind = rescueCandidate.kind || "";
            }`,
  "gap rescue spacing metadata"
);

// 6) Pass continuation spacing metadata through aggregateForV9.
insertAfter(
  "  const mainContinues = paragraphs.some(p => p && p._continues);",
`
  const mainContinuationSpacingMode =
    (paragraphs.find(p => p && p._continues && p._v9SpacingMode) || {})._v9SpacingMode || "";
  const mainContinuationBreakKind =
    (paragraphs.find(p => p && p._continues && p._v9BreakKind) || {})._v9BreakKind || "";
`,
  "aggregate continuation spacing metadata"
);
text = text.replaceAll(
  "return { mainText, mainRuns, mainContinues, rightStream, leftStream, footerStreams, titles };",
  "return { mainText, mainRuns, mainContinues, mainContinuationSpacingMode, mainContinuationBreakKind, rightStream, leftStream, footerStreams, titles };"
);

// 7) Pass metadata into mainBox.
insertAfter(
  "      continues: !!mainFlow.overflowText || !!pageContent.mainContinues,",
`
      continuationSpacingMode: pageContent.mainContinuationSpacingMode || "",
      continuationBreakKind: pageContent.mainContinuationBreakKind || "",
`,
  "mainBox continuation spacing metadata"
);

// 8) Renderer: justify only the adjusted continuation line when bounded.
replaceOnce(
`      const isContinuationCut = box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1
        && line.naturalWidth >= line.width * 0.65
        && line.naturalWidth < line.width - 2;
      const shouldJustify = ((!line.isLast && !line.forcedBreak) || isContinuationCut)
                             && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);`,
`      const continuationWords = line.words || [];
      const continuationGaps = Math.max(1, continuationWords.length - 1);
      const continuationExtraPerGap = line && line.width && line.naturalWidth
        ? (line.width - line.naturalWidth) / continuationGaps
        : Infinity;
      const isAdjustedSpreadContinuation = box.continues
        && box.continuationSpacingMode === "spread"
        && line.isLast
        && !line.forcedBreak
        && continuationWords.length >= 3
        && line.naturalWidth >= line.width * 0.56
        && line.naturalWidth < line.width - 2
        && continuationExtraPerGap <= Math.max(5, fontSize * 0.55);
      const isContinuationCut = box.continues && line.isLast && !line.forcedBreak
        && continuationWords.length > 1
        && line.naturalWidth >= line.width * 0.65
        && line.naturalWidth < line.width - 2;
      const shouldAdjustedSpread = isAdjustedSpreadContinuation;
      const shouldJustify = ((!line.isLast && !line.forcedBreak) || isContinuationCut || shouldAdjustedSpread)
                             && continuationWords.length > 1
                             && (line.naturalWidth < line.width - 2);`,
  "renderer adjusted spread calculation"
);
replaceOnce(
`      if (!isContinuationCut && (isFullWidthOrphan || isParagraphEnd)) lineEl.className += ' center';
      else if (shouldJustify) lineEl.className += ' justify';`,
`      if (shouldAdjustedSpread) {
        lineEl.className += ' justify';
        lineEl.dataset.v9AdjustedBreak = "spread";
      } else if (!isContinuationCut && (isFullWidthOrphan || isParagraphEnd)) {
        lineEl.className += ' center';
      } else if (shouldJustify) {
        lineEl.className += ' justify';
      }`,
  "renderer adjusted spread class"
);

mustContain("function adjustedSpreadBreakCandidates");
mustContain("visual-line-end-spread");
mustContain("adjustedSpreadEnds");
mustContain("adjustedRescueEnds");
mustContain("_v9SpacingMode");
mustContain("continuationSpacingMode");
mustContain("v9AdjustedBreak");

if (text !== before) {
  fs.writeFileSync(path, text, "utf8");
  console.log("[v9-adjusted-spacing] src/vilna_v9.js updated.");
} else {
  console.log("[v9-adjusted-spacing] no changes needed.");
}
