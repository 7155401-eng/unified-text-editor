#!/usr/bin/env node
/**
 * Surgical codemod for PR #374 -> PR #2.
 *
 * Goal:
 *   Connect src/engine/v9_split_policy.js into src/vilna_v9.js without a blind
 *   full-file rewrite.
 *
 * What it does:
 *   1. Adds imports for V9 split-policy helpers.
 *   2. Creates a v9SplitPolicy object inside buildPages.
 *   3. Routes candidate generation through buildParagraphBreakCandidates.
 *   4. Adds score/debug wrapping around chooseStepwiseSplit candidates.
 *
 * This script is intentionally strict: if an expected anchor is missing, it
 * exits with an error instead of guessing.
 */

import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const targetPath = path.join(repoRoot, "src", "vilna_v9.js");
let src = fs.readFileSync(targetPath, "utf8");

function fail(message) {
  console.error(`[wire_v9_split_policy] ${message}`);
  process.exit(1);
}

function replaceOnce(haystack, needle, replacement, label) {
  const first = haystack.indexOf(needle);
  if (first < 0) fail(`missing anchor: ${label}`);
  const second = haystack.indexOf(needle, first + needle.length);
  if (second >= 0) fail(`anchor is not unique: ${label}`);
  return haystack.slice(0, first) + replacement + haystack.slice(first + needle.length);
}

// 1. Import helpers from PR #374.
const importNeedle = `import { buildNoteContentNodes, nodesToTextRuns } from "./engine/note_content_builder.js";\n`;
const importBlock = `${importNeedle}import {\n  buildV9SplitPolicy,\n  buildParagraphBreakCandidates,\n  scoreV9PageCandidate,\n  splitMainTextAtOffset,\n  splitNotesByAnchor,\n  debugV9SplitDecision,\n} from "./engine/v9_split_policy.js";\n`;
if (!src.includes("./engine/v9_split_policy.js")) {
  src = replaceOnce(src, importNeedle, importBlock, "note_content_builder import");
}

// 2. Instantiate policy inside buildPages after cfg is built.
const policyNeedle = `  const noMidParagraphHard = !!cfg.noMidLineSplits;\n`;
const policyReplacement = `  const v9SplitPolicy = buildV9SplitPolicy(cfg);\n\n${policyNeedle}`;
if (!src.includes("const v9SplitPolicy = buildV9SplitPolicy(cfg);")) {
  src = replaceOnce(src, policyNeedle, policyReplacement, "buildPages policy creation");
}

// 3. Replace local unifiedCandidates generation with helper-backed candidates.
const unifiedOld = `        // משה 2026-05-17: רשימה מאוחדת עם priority — visual-line-end קודם semantic\n        const unifiedCandidates = classifiedBreakCandidates(\n          fullText,\n          allowParagraphSplit ? [...lineEnds, ...semanticEnds] : lineEnds,\n          lineEnds\n        );\n        splitInfo = chooseStepwiseSplit(unifiedCandidates);\n`;
const unifiedNew = `        // PR #374 wiring: generate candidates through centralized V9 split policy.\n        // The old lineEnds/semanticEnds variables remain above for fallback/debug parity.\n        const policyCandidates = buildParagraphBreakCandidates(\n          fullText,\n          splitMetrics,\n          splitMainWidth,\n          v9SplitPolicy,\n          { source: "primary" }\n        );\n        const unifiedCandidates = (allowParagraphSplit\n          ? policyCandidates\n          : policyCandidates.filter(c => c.kind === "visual-line-end" || c.kind === "adjusted-line-end")\n        );\n        splitInfo = chooseStepwiseSplit(unifiedCandidates);\n`;
if (!src.includes("const policyCandidates = buildParagraphBreakCandidates(")) {
  src = replaceOnce(src, unifiedOld, unifiedNew, "primary unifiedCandidates generation");
}

// 4. Make makeSplit use splitMainTextAtOffset + splitNotesByAnchor.
const makeSplitOld = `        const makeSplit = (len, movedNotes) => ({\n          firstHalf: { ...target, mainText: fullText.substring(0, len).trimEnd(), notes: movedNotes, _continues: true },\n          secondHalf: { ...target, mainText: fullText.substring(len).trimStart(), notes: notesFromAnchor(len, movedNotes) },\n          sliceIdx,\n          baseN,\n        });\n`;
const makeSplitNew = `        const makeSplit = (len, movedNotes) => {\n          const splitText = splitMainTextAtOffset(fullText, len);\n          const splitNotes = splitNotesByAnchor(\n            target?.notes || [],\n            splitText.splitOffset,\n            fullText.length,\n            splitText.suffixBaseOffset\n          );\n          return {\n            firstHalf: { ...target, mainText: splitText.prefixText, notes: movedNotes || splitNotes.before, _continues: true },\n            secondHalf: { ...target, mainText: splitText.suffixText, notes: splitNotes.after },\n            sliceIdx,\n            baseN,\n          };\n        };\n`;
if (!src.includes("const splitText = splitMainTextAtOffset(fullText, len);")) {
  src = replaceOnce(src, makeSplitOld, makeSplitNew, "makeSplit splitMainTextAtOffset wiring");
}

// 5. Wrap chooseStepwiseSplit with score + debug. This preserves the old chooser,
// but records the scoring result for each tested candidate.
const metaOld = `            const meta = splitPlanMeta(tryPrefix(cand.offset), movedNotes);\n            if (!meta) continue;\n`;
const metaNew = `            const tp = tryPrefix(cand.offset);\n            const meta = splitPlanMeta(tp, movedNotes);\n            const policyScore = scoreV9PageCandidate(tp, cand, v9SplitPolicy, {\n              cfg,\n              movedNotes,\n              pageIdx,\n              targetSliceIdx: sliceIdx,\n            });\n            v9PolicyDebug.candidates.push({\n              offset: cand.offset,\n              kind: cand.kind,\n              priority: cand.priority,\n              meta,\n              policyScore,\n            });\n            if (!meta || policyScore.accept === false) continue;\n`;
if (!src.includes("const policyScore = scoreV9PageCandidate(tp, cand, v9SplitPolicy")) {
  src = replaceOnce(src, metaOld, metaNew, "chooseStepwiseSplit candidate scoring");
}

const chooseDebugNeedle = `        const chooseStepwiseSplit = (prioritizedCandidates) => {\n          if (!prioritizedCandidates || !prioritizedCandidates.length) return null;\n`;
const chooseDebugReplacement = `        const chooseStepwiseSplit = (prioritizedCandidates) => {\n          const v9PolicyDebug = {\n            pageIdx,\n            targetSliceIdx: sliceIdx,\n            bestN_clean,\n            fullTextLength: fullText.length,\n            candidates: [],\n            selected: null,\n          };\n          if (!prioritizedCandidates || !prioritizedCandidates.length) {\n            debugV9SplitDecision({ ...v9PolicyDebug, reason: "no-candidates" });\n            return null;\n          }\n`;
if (!src.includes("const v9PolicyDebug = {")) {
  src = replaceOnce(src, chooseDebugNeedle, chooseDebugReplacement, "chooseStepwiseSplit debug init");
}

const cleanReturnOld = `          if (cleanPriorities.length) return bestCleanByPriority.get(cleanPriorities[0]).split;\n          const overflowPriorities = [...firstOverflowByPriority.keys()].sort((a, b) => b - a);\n          if (overflowPriorities.length) return firstOverflowByPriority.get(overflowPriorities[0]);\n          return null;\n`;
const cleanReturnNew = `          if (cleanPriorities.length) {\n            const selected = bestCleanByPriority.get(cleanPriorities[0]).split;\n            debugV9SplitDecision({ ...v9PolicyDebug, selected, selectedPriority: cleanPriorities[0], selectedMode: "clean" });\n            return selected;\n          }\n          const overflowPriorities = [...firstOverflowByPriority.keys()].sort((a, b) => b - a);\n          if (overflowPriorities.length) {\n            const selected = firstOverflowByPriority.get(overflowPriorities[0]);\n            debugV9SplitDecision({ ...v9PolicyDebug, selected, selectedPriority: overflowPriorities[0], selectedMode: "overflow-fallback" });\n            return selected;\n          }\n          debugV9SplitDecision({ ...v9PolicyDebug, reason: "no-accepted-candidate" });\n          return null;\n`;
if (!src.includes("selectedMode: \"clean\"")) {
  src = replaceOnce(src, cleanReturnOld, cleanReturnNew, "chooseStepwiseSplit debug return");
}

fs.writeFileSync(targetPath, src, "utf8");
console.log("[wire_v9_split_policy] patched src/vilna_v9.js successfully");
