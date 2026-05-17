import fs from "node:fs";
import path from "node:path";

const file = path.resolve("src/vilna_v9.js");
let src = fs.readFileSync(file, "utf8");
let changed = false;

function patchOnce(name, oldText, newText, marker) {
  if (src.includes(marker)) {
    console.log(`[v9-split-hierarchy] ${name}: already patched`);
    return;
  }
  if (!src.includes(oldText)) {
    throw new Error(`[v9-split-hierarchy] ${name}: expected source block not found`);
  }
  src = src.replace(oldText, newText);
  changed = true;
  console.log(`[v9-split-hierarchy] ${name}: patched`);
}

patchOnce(
  "gap-rescue-priority-buckets",
`        let rescueBest = null;
        let rescueBestScore = currentHasNoteOverflow ? -Infinity : currentFill;
        for (let sliceIdx = 0; sliceIdx < Math.min(totalAvail, 3); sliceIdx++) {`,
`        let rescueBest = null;
        let rescueBestScore = currentHasNoteOverflow ? -Infinity : currentFill;
        // 2026-05-17: Gap rescue now honors the same break hierarchy as the
        // main splitter. Priority is a bucket selector, not a score bonus:
        // visual-line-end beats sentence/punctuation when both are valid.
        let rescueBestPriority = -Infinity;
        for (let sliceIdx = 0; sliceIdx < Math.min(totalAvail, 3); sliceIdx++) {`,
  "let rescueBestPriority = -Infinity;"
);

patchOnce(
  "gap-rescue-candidate-list",
`          let rescueEnds = uniqueSortedBreakOffsets([
            ...visualRescueEnds,
            ...semanticRescueEnds,
          ], 2, fullText.length);
          if (carryActive) {
            rescueEnds = visualRescueEnds.length
              ? visualRescueEnds.slice(0, carryGapMaxMainLines())
              : rescueEnds.slice(0, carryGapMaxMainLines() + 1);
          }
          for (const len of rescueEnds) {`,
`          let rescueCandidates = classifiedBreakCandidates(
            fullText,
            [...visualRescueEnds, ...semanticRescueEnds],
            visualRescueEnds
          );
          if (carryActive) {
            const carryLimit = carryGapMaxMainLines();
            rescueCandidates = visualRescueEnds.length
              ? rescueCandidates.filter(c => c.kind === "visual-line-end").slice(0, carryLimit)
              : rescueCandidates.slice(0, carryLimit + 1);
          }
          for (const cand of rescueCandidates) {
            const len = cand.offset;`,
  "let rescueCandidates = classifiedBreakCandidates("
);

patchOnce(
  "gap-rescue-priority-selection",
`            if (score < rescueBestScore) continue;
            rescueBestScore = score;
            rescueBest = {
              firstHalf,
              secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },
              sliceIdx,
              baseN,
            };`,
`            if (cand.priority < rescueBestPriority) continue;
            if (cand.priority === rescueBestPriority && score < rescueBestScore) continue;
            if (cand.priority > rescueBestPriority) {
              const minScore = currentHasNoteOverflow ? -Infinity : currentFill;
              if (score < minScore) continue;
            }
            rescueBestPriority = cand.priority;
            rescueBestScore = score;
            rescueBest = {
              firstHalf,
              secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },
              sliceIdx,
              baseN,
            };`,
  "rescueBestPriority = cand.priority;"
);

patchOnce(
  "emergency-priority-selection",
`        const fallbackLen = lineEnds[0] || semanticEnds[0] || wordEnds[0] || null;

        if (fallbackLen) {
          const movedNotes = notesBeforeAnchor(fallbackLen);
          if (typeof console !== "undefined") {
            console.warn(
              "[v9] emergency paragraph split: paragraph is larger than one page; " +
              (lineEnds[0]
                ? "using natural line-end split."
                : semanticEnds[0]
                  ? "using semantic safe split."
                  : "using word-end split emergency fallback.")
            );
          }

          splitInfo = {
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
        } else if (typeof console !== "undefined") {`,
`        const emergencyCandidates = classifiedBreakCandidates(
          fullText,
          [...lineEnds, ...semanticEnds, ...wordEnds],
          lineEnds
        );
        let emergencyBest = null;
        let emergencyBestPriority = -Infinity;
        let emergencyBestScore = -Infinity;
        for (const cand of emergencyCandidates) {
          const len = cand.offset;
          const movedNotes = notesBeforeAnchor(len);
          const firstHalf = {
            ...target,
            mainText: fullText.substring(0, len).trimEnd(),
            notes: movedNotes,
            _continues: true,
            _emergencySplit: true,
          };
          const tp = buildPagePlan(
            aggregateForV9([firstHalf], cfg.titles, cfg.streamSettings, cfg.levels, cfg.talmudStreams, carryOver),
            cfg
          );
          if (!tp || !tp.overflow || tp.overflow.mainText) continue;
          const noteOverflow = Object.keys(tp.overflow.streams || {}).some(k => tp.overflow.streams[k]);
          if (noteOverflow) continue;
          const score = planFillRatio(tp);
          if (cand.priority < emergencyBestPriority) continue;
          if (cand.priority === emergencyBestPriority && score <= emergencyBestScore) continue;
          emergencyBestPriority = cand.priority;
          emergencyBestScore = score;
          emergencyBest = { len, movedNotes, kind: cand.kind };
        }

        if (emergencyBest) {
          const fallbackLen = emergencyBest.len;
          const movedNotes = emergencyBest.movedNotes;
          if (typeof console !== "undefined") {
            console.warn(
              "[v9] emergency paragraph split: paragraph is larger than one page; " +
              `using ${emergencyBest.kind} split.`
            );
          }

          splitInfo = {
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
        } else if (typeof console !== "undefined") {`,
  "const emergencyCandidates = classifiedBreakCandidates("
);

if (changed) {
  fs.writeFileSync(file, src, "utf8");
  console.log("[v9-split-hierarchy] src/vilna_v9.js updated for build");
} else {
  console.log("[v9-split-hierarchy] no changes needed");
}
