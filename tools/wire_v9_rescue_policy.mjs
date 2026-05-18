#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const targetPath = path.join(process.cwd(), "src", "vilna_v9.js");
let src = fs.readFileSync(targetPath, "utf8");

function fail(msg) {
  console.error(`[wire_v9_rescue_policy] ${msg}`);
  process.exit(1);
}

function replaceOnce(needle, replacement, label) {
  const first = src.indexOf(needle);
  if (first < 0) fail(`missing anchor: ${label}`);
  const second = src.indexOf(needle, first + needle.length);
  if (second >= 0) fail(`anchor not unique: ${label}`);
  src = src.slice(0, first) + replacement + src.slice(first + needle.length);
}

// 1. Primary fallback after chooseStepwiseSplit: route through splitMainTextAtOffset + splitNotesByAnchor.
replaceOnce(`              const firstHalf = { ...target, mainText: fullText.substring(0, fallbackLen).trimEnd(), notes: movedNotes, _continues: true };

              const secondHalf = { ...target, mainText: fullText.substring(fallbackLen).trimStart(), notes: notesFromAnchor(fallbackLen, movedNotes) };

              splitInfo = { firstHalf, secondHalf, sliceIdx, baseN };
`, `              const splitText = splitMainTextAtOffset(fullText, fallbackLen);
              const splitNotes = splitNotesByAnchor(
                target?.notes || [],
                splitText.splitOffset,
                fullText.length,
                splitText.suffixBaseOffset
              );
              const firstHalf = {
                ...target,
                mainText: splitText.prefixText,
                notes: splitNotes.before,
                _continues: true,
              };
              const secondHalf = {
                ...target,
                mainText: splitText.suffixText,
                notes: splitNotes.after,
              };

              splitInfo = { firstHalf, secondHalf, sliceIdx, baseN };
`, "primary fallback split construction");

// 2. Gap rescue: use centralized candidates instead of raw visual/semantic offsets.
replaceOnce(`          // gap rescue uses safe break candidates only
          const visualRescueEnds = mainLineEndCandidates(fullText, splitMetrics, splitMainWidth)
            .filter(n => n >= 2 && n < fullText.length)
            .sort((a, b) => a - b);
          const semanticRescueEnds = safeBreakCandidates(fullText, visualRescueEnds, {
            min: 2,
            max: fullText.length,
            includeVisual: false,
            includeSentence: true,
            includePunctuation: true,
            includeWordGap: false,
          });
          let rescueEnds = uniqueSortedBreakOffsets([
            ...visualRescueEnds,
            ...semanticRescueEnds,
          ], 2, fullText.length);
          if (carryActive) {
            rescueEnds = visualRescueEnds.length
              ? visualRescueEnds.slice(0, carryGapMaxMainLines())
              : rescueEnds.slice(0, carryGapMaxMainLines() + 1);
          }
          for (const len of rescueEnds) {
`, `          // Gap rescue also uses the centralized candidate engine from PR #374.
          // No raw word grabbing: visual/adjusted line end, sentence, punctuation.
          const rescueCandidates = buildParagraphBreakCandidates(
            fullText,
            splitMetrics,
            splitMainWidth,
            v9SplitPolicy,
            { source: "gap-rescue" }
          ).filter(c => c.offset >= 2 && c.offset < fullText.length && c.kind !== "word-gap");
          const limitedRescueCandidates = carryActive
            ? rescueCandidates.slice(0, carryGapMaxMainLines() + 1)
            : rescueCandidates;
          for (const cand of limitedRescueCandidates) {
            const len = cand.offset;
`, "gap rescue candidate source");

// 3. Gap rescue: firstHalf should use splitMainTextAtOffset + splitNotesByAnchor.
replaceOnce(`            const firstHalf = { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes, _continues: true };
            const slice = [...baseSlice, firstHalf];
`, `            const splitText = splitMainTextAtOffset(fullText, len);
            const splitNotes = splitNotesByAnchor(
              target?.notes || [],
              splitText.splitOffset,
              fullText.length,
              splitText.suffixBaseOffset
            );
            const firstHalf = {
              ...target,
              mainText: splitText.prefixText,
              notes: splitNotes.before,
              _continues: true,
            };
            const slice = [...baseSlice, firstHalf];
`, "gap rescue firstHalf construction");

replaceOnce(`              secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },
`, `              secondHalf: { ...target, mainText: splitText.suffixText, notes: splitNotes.after },
`, "gap rescue secondHalf construction");

// 4. Extension rescue: candidate source should be centralized; keep first two candidates only.
replaceOnce(`        const visualLineEnds = mainLineEndCandidates(secondText, splitMetrics, splitMainWidth)
          .filter(n => n >= 2 && n <= secondText.length)
          .sort((a, b) => a - b);
        const firstVisualEnd = visualLineEnds[0];
        const secondVisualEnd = visualLineEnds[1];
        const extendEnds = [...new Set([
          firstVisualEnd,
          secondVisualEnd && secondVisualEnd <= Math.max(firstVisualEnd || 0, 1) * 2 ? secondVisualEnd : null,
])]
          .filter(n => n && n >= 2 && n <= secondText.length)
          .sort((a, b) => a - b);
`, `        const extendCandidates = buildParagraphBreakCandidates(
          secondText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "extension-rescue" }
        ).filter(c => c.offset >= 2 && c.offset <= secondText.length && c.kind !== "word-gap");
        const extendEnds = extendCandidates
          .slice(0, 2)
          .map(c => c.offset)
          .sort((a, b) => a - b);
`, "extension candidate source");

// 5. Extension rescue: replace local split by centralized splitText/splitNotes.
replaceOnce(`          const prefix = secondText.substring(0, len).trim();
          const rest = secondText.substring(len).trim();
          if (!prefix) continue;
          const firstHalf = {
            ...splitInfo.firstHalf,
            mainText: `${(splitInfo.firstHalf.mainText || '').trim()} ${prefix}`.trim(),
            notes: [...(splitInfo.firstHalf.notes || []), ...movedNotes],
            _continues: true,
          };
          const secondHalf = {
            ...splitInfo.secondHalf,
            mainText: rest,
            notes: notesFromAnchor(len, movedNotes),
          };
`, `          const splitText = splitMainTextAtOffset(secondText, len);
          const splitNotes = splitNotesByAnchor(
            secondNotes,
            splitText.splitOffset,
            secondText.length,
            splitText.suffixBaseOffset
          );
          const prefix = splitText.prefixText;
          if (!prefix) continue;
          const firstHalf = {
            ...splitInfo.firstHalf,
            mainText: `${(splitInfo.firstHalf.mainText || '').trim()} ${prefix}`.trim(),
            notes: [...(splitInfo.firstHalf.notes || []), ...splitNotes.before],
            _continues: true,
          };
          const secondHalf = {
            ...splitInfo.secondHalf,
            mainText: splitText.suffixText,
            notes: splitNotes.after,
          };
`, "extension split construction");

// 6. Emergency split: use centralized candidates and centralized anchor-safe split.
replaceOnce(`        const lineEnds = mainLineEndCandidates(fullText, splitMetrics, splitMainWidth)
          .filter(n => n >= MIN_EMERGENCY_SPLIT && n < fullText.length)
          .sort((a, b) => a - b);

        const semanticEnds = safeBreakCandidates(fullText, lineEnds, {
          min: MIN_EMERGENCY_SPLIT,
          max: fullText.length,
          includeVisual: false,
          includeSentence: true,
          includePunctuation: true,
          includeWordGap: false,
        });

        const wordEnds = !cfg.preventMidLineSplit
          ? wordGapCandidates(fullText)
              .filter(n => n >= MIN_EMERGENCY_SPLIT && n < fullText.length)
              .sort((a, b) => a - b)
          : [];

        const fallbackLen = lineEnds[0] || semanticEnds[0] || wordEnds[0] || null;
`, `        const emergencyCandidates = buildParagraphBreakCandidates(
          fullText,
          splitMetrics,
          splitMainWidth,
          v9SplitPolicy,
          { source: "emergency", emergency: !cfg.preventMidLineSplit }
        ).filter(c => c.offset >= MIN_EMERGENCY_SPLIT && c.offset < fullText.length);
        const emergencyCandidate = emergencyCandidates.find(c =>
          c.kind !== "word-gap" || !cfg.preventMidLineSplit
        );
        const fallbackLen = emergencyCandidate?.offset || null;
`, "emergency candidate source");

replaceOnce(`              (lineEnds[0]
                ? "using natural line-end split."
                : semanticEnds[0]
                  ? "using semantic safe split."
                  : "using word-end split emergency fallback.")
`, `              (emergencyCandidate?.kind === "visual-line-end" || emergencyCandidate?.kind === "adjusted-line-end"
                ? "using line-end split."
                : emergencyCandidate?.kind === "word-gap"
                  ? "using word-end split emergency fallback."
                  : "using semantic safe split.")
`, "emergency console message");

replaceOnce(`          splitInfo = {
            firstHalf: {
              ...target,
              mainText: fullText.substring(0, fallbackLen).trimEnd(),
              notes: movedNotes,
              _continues: true,
              _emergencySplit: true,
            },
            secondHalf: {
              ...target,
              mainText: fullText.substring(fallbackLen).trimStart(),
              notes: notesFromAnchor(fallbackLen, movedNotes),
            },
            sliceIdx,
            baseN,
          };
`, `          const splitText = splitMainTextAtOffset(fullText, fallbackLen);
          const splitNotes = splitNotesByAnchor(
            target?.notes || [],
            splitText.splitOffset,
            fullText.length,
            splitText.suffixBaseOffset
          );
          splitInfo = {
            firstHalf: {
              ...target,
              mainText: splitText.prefixText,
              notes: splitNotes.before,
              _continues: true,
              _emergencySplit: true,
            },
            secondHalf: {
              ...target,
              mainText: splitText.suffixText,
              notes: splitNotes.after,
            },
            sliceIdx,
            baseN,
          };
`, "emergency split construction");

fs.writeFileSync(targetPath, src, "utf8");
console.log("[wire_v9_rescue_policy] patched rescue/fallback/emergency split paths");
