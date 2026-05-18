// Pure helpers for V9 page-break decisions.
// Runtime wiring into vilna_v9.js should be done in a follow-up PR after debug comparison.

export const V9_BREAK_PRIORITY = Object.freeze({
  "paragraph-end": 1000,
  "visual-line-end": 900,
  "adjusted-line-end": 820,
  "sentence-end": 600,
  "punctuation-end": 580,
  "word-gap": 100,
  "bad": -1000,
});

export function buildV9SplitPolicy(cfg = {}) {
  const noMidParagraphHard = !!cfg.noMidLineSplits;
  const noMidParagraphSoft = !!cfg.noMidParagraphSoft;
  return {
    forbidNormalParagraphSplit: noMidParagraphHard || noMidParagraphSoft,
    allowSafeParagraphSplit: !noMidParagraphHard,
    preventMidLineSplit: cfg.preventMidLineSplit !== false,
    allowAnchoredNotePrefixSplit: true,
    allowEmergencyLongParagraphSplit: true,
    allowWordGapOnlyInEmergency: cfg.allowEmergencyWordGap === true,
    minLineEdgeFill: Math.max(Number(cfg.minLineEdgeFill) || 0.82, 0.82),
    maxAdjustedLineEdgeFill: Number(cfg.maxAdjustedLineEdgeFill) > 0 ? Number(cfg.maxAdjustedLineEdgeFill) : 1.06,
    minGoodPageFill: Math.max(Number(cfg.gapFillMinRatio) || 0.82, 0.82),
    minAcceptablePageFill: 0.68,
    rejectSparsePages: true,
    keepAnchoredNotesWithMain: true,
    splitNotesOnlyIfNoteTooLong: true,
  };
}

export function makeBreakCandidate({ kind, offset, priority, paragraphIndex = null, source = "normal", reason = "" } = {}) {
  const k = kind || "bad";
  return {
    kind: k,
    offset,
    priority: Number.isFinite(priority) ? priority : (V9_BREAK_PRIORITY[k] ?? V9_BREAK_PRIORITY.bad),
    paragraphIndex,
    source,
    reason,
  };
}

export function uniqueCandidatesByOffset(candidates = []) {
  const best = new Map();
  for (const c of candidates) {
    if (!c || !Number.isFinite(c.offset)) continue;
    const prev = best.get(c.offset);
    if (!prev || c.priority > prev.priority) best.set(c.offset, c);
  }
  return [...best.values()].sort((a, b) => b.priority - a.priority || b.offset - a.offset);
}

export function acceptableV9LineEdge({ lineWidth, widthPx, wordsInLine }, policy = {}) {
  if (!widthPx || !Number.isFinite(lineWidth) || lineWidth <= 0) return false;
  const fill = lineWidth / widthPx;
  const minFill = Number(policy.minLineEdgeFill) || 0.82;
  if (wordsInLine < 2) return fill >= Math.max(0.96, minFill);
  return fill >= minFill;
}

export function mainLineEndCandidatesForV9(text, metrics, widthPx, policy = {}) {
  if (!text || !metrics || !widthPx) return [];
  const out = [];
  const re = /\S+/g;
  let m, lineWidth = 0, wordsInLine = 0, lastEnd = 0;
  const spaceW = Number(metrics.spaceWidth) || 0;
  while ((m = re.exec(text)) !== null) {
    const wordW = metrics.measureWord(m[0]);
    const nextWidth = wordsInLine === 0 ? wordW : lineWidth + spaceW + wordW;
    if (nextWidth <= widthPx || wordsInLine === 0) {
      lineWidth = nextWidth;
      wordsInLine += 1;
      lastEnd = m.index + m[0].length;
    } else {
      if (lastEnd > 0 && acceptableV9LineEdge({ lineWidth, widthPx, wordsInLine }, policy)) out.push(lastEnd);
      lineWidth = wordW;
      wordsInLine = 1;
      lastEnd = m.index + m[0].length;
    }
  }
  if (lastEnd > 0 && acceptableV9LineEdge({ lineWidth, widthPx, wordsInLine }, policy)) out.push(lastEnd);
  return out;
}

function regexEndCandidates(text, re) {
  const out = [];
  if (!text) return out;
  let m;
  while ((m = re.exec(text)) !== null) {
    const offset = re.lastIndex;
    if (offset > 0 && offset < text.length) out.push(offset);
  }
  return out;
}

export function sentenceEndCandidatesForV9(text) {
  return regexEndCandidates(text, /[.!?…׃:;][\s\u00A0]*/g);
}

export function punctuationEndCandidatesForV9(text) {
  return regexEndCandidates(text, /[,،؛][\s\u00A0]*/g);
}

export function wordEndCandidatesForV9(text) {
  if (!text) return [];
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m.index + m[0].length);
  return out;
}

export function acceptableV9AdjustedBreakTail({ lineWidth, widthPx, wordsInLine }, policy = {}) {
  if (!widthPx || wordsInLine < 2) return false;
  const fill = lineWidth / widthPx;
  const minFill = Number(policy.minLineEdgeFill) || 0.82;
  const maxFill = Number(policy.maxAdjustedLineEdgeFill) || 1.06;
  return fill >= minFill && fill <= maxFill;
}

export function adjustableSafeBreakCandidates(text, metrics, widthPx, visualLineEnds = [], policy = {}) {
  if (!text || !metrics || !widthPx) return [];
  const visualSet = new Set(visualLineEnds || []);
  const out = [];
  const words = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) words.push({ text: m[0], end: m.index + m[0].length });

  const spaceW = Number(metrics.spaceWidth) || 0;
  let lineWords = [], lineWidth = 0;
  for (const w of words) {
    const wordW = metrics.measureWord(w.text);
    const nextWidth = lineWords.length === 0 ? wordW : lineWidth + spaceW + wordW;
    if (nextWidth <= widthPx || lineWords.length === 0) {
      lineWords.push(w);
      lineWidth = nextWidth;
      continue;
    }
    const last = lineWords[lineWords.length - 1];
    if (last && acceptableV9AdjustedBreakTail({ lineWidth, widthPx, wordsInLine: lineWords.length }, policy)) out.push(last.end);
    lineWords = [w];
    lineWidth = wordW;
  }
  return [...new Set(out)].filter(offset => !visualSet.has(offset));
}

export function buildParagraphBreakCandidates(text, metrics, widthPx, policy = {}, opts = {}) {
  const source = opts.source || "normal";
  const visual = mainLineEndCandidatesForV9(text, metrics, widthPx, policy);
  const adjusted = adjustableSafeBreakCandidates(text, metrics, widthPx, visual, policy);
  const lineSafeOffsets = new Set([...visual, ...adjusted]);
  const candidates = [];

  for (const offset of visual) candidates.push(makeBreakCandidate({ kind: "visual-line-end", offset, source, reason: "filled visual line edge" }));
  for (const offset of adjusted) candidates.push(makeBreakCandidate({ kind: "adjusted-line-end", offset, source, reason: "justifiable line edge" }));

  for (const offset of sentenceEndCandidatesForV9(text)) {
    if (!lineSafeOffsets.has(offset)) continue;
    candidates.push(makeBreakCandidate({ kind: "sentence-end", offset, source, reason: "sentence end on line-safe boundary" }));
  }

  for (const offset of punctuationEndCandidatesForV9(text)) {
    if (!lineSafeOffsets.has(offset)) continue;
    candidates.push(makeBreakCandidate({ kind: "punctuation-end", offset, source, reason: "punctuation end on line-safe boundary" }));
  }

  if (opts.emergency && policy.allowWordGapOnlyInEmergency === true) {
    for (const offset of wordEndCandidatesForV9(text)) {
      if (lineSafeOffsets.has(offset)) continue;
      candidates.push(makeBreakCandidate({ kind: "word-gap", offset, source: "emergency", reason: "explicitly enabled emergency word gap" }));
    }
  }

  return uniqueCandidatesByOffset(candidates).filter(c => c.offset > 0 && c.offset < String(text || "").length);
}

export function splitMainTextAtOffset(fullText, offset) {
  const text = String(fullText || "");
  const splitOffset = Math.max(0, Math.min(text.length, Number(offset) || 0));
  const prefixRaw = text.slice(0, splitOffset);
  const suffixRaw = text.slice(splitOffset);
  const suffixLeadingSpaces = (suffixRaw.match(/^\s+/u) || [""])[0].length;
  return {
    splitOffset,
    prefixText: prefixRaw.replace(/\s+$/u, ""),
    suffixText: suffixRaw.slice(suffixLeadingSpaces),
    suffixBaseOffset: splitOffset + suffixLeadingSpaces,
  };
}

export function splitNotesByAnchor(notes = [], splitOffset, fullTextLength, suffixBaseOffset = splitOffset) {
  const anchored = [], anchorless = [];
  for (const note of notes || []) (typeof note?.anchor === "number" ? anchored : anchorless).push(note);
  const ratio = fullTextLength > 0 ? splitOffset / fullTextLength : 0;
  const anchorlessShare = Math.max(0, Math.min(anchorless.length, Math.round(anchorless.length * ratio)));
  const before = [
    ...anchorless.slice(0, anchorlessShare),
    ...anchored.filter(n => n.anchor < splitOffset),
  ].sort(compareNotesByAnchor);
  const after = [
    ...anchorless.slice(anchorlessShare),
    ...anchored.filter(n => n.anchor >= splitOffset).map(n => ({ ...n, anchor: Math.max(0, n.anchor - suffixBaseOffset) })),
  ].sort(compareNotesByAnchor);
  return { before, after };
}

function compareNotesByAnchor(a, b) {
  const aa = typeof a?.anchor === "number" ? a.anchor : -1;
  const bb = typeof b?.anchor === "number" ? b.anchor : -1;
  return aa - bb;
}

function overflowText(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return typeof entry.text === "string" ? entry.text : "";
}

export function hasV9StreamOverflow(plan) {
  return Object.values(plan?.overflow?.streams || {}).some(entry => overflowText(entry).trim());
}

export function planBottomY(plan) {
  let bottom = 0;
  const visit = lines => { for (const line of lines || []) bottom = Math.max(bottom, (line.y || 0) + (line.lineHeightPx || line.height || 0)); };
  visit(plan?.mainBox?.lines);
  for (const box of plan?.streamBoxes || []) visit(box?.lines);
  for (const box of plan?.footerBoxes || []) {
    bottom = Math.max(bottom, (box.titleY || 0) + (box.titleHeight || 0));
    visit(box?.lines);
  }
  return bottom;
}

export function planFillRatio(plan, cfg = {}) {
  const height = Number(cfg.pageHeight) || Number(plan?.pageBox?.height) || 1;
  const padding = Number(cfg.padding) || Number(plan?.pageBox?.padding) || 0;
  const reservedBottom = Number(cfg.reservedBottom) || 0;
  return planBottomY(plan) / Math.max(1, height - padding - reservedBottom);
}

export function planMainLineCount(plan) {
  return Array.isArray(plan?.mainBox?.lines) ? plan.mainBox.lines.length : 0;
}

export function planCommentaryLineCount(plan) {
  const streamCount = (plan?.streamBoxes || []).reduce((sum, box) => sum + (box?.lines?.length || 0), 0);
  const footerCount = (plan?.footerBoxes || []).reduce((sum, box) => sum + (box?.lines?.length || 0), 0);
  return streamCount + footerCount;
}

export function getLastMainLineInfo(plan, policy = {}) {
  const lines = plan?.mainBox?.lines || [];
  const last = lines[lines.length - 1];

  if (!last) {
    return {
      ok: true,
      reason: "no-main-lines",
    };
  }

  const width = Number(last.width) || 0;
  const naturalWidth = Number(last.naturalWidth) || 0;
  const fillRatio = width > 0 ? naturalWidth / width : 1;
  const continues = plan?.mainBox?.continues === true;

  const isParagraphEnd =
    (!continues && last.isLast === true) ||
    last.forcedBreak === true ||
    last._v9ParagraphEnd === true;

  const isFilledLineEdge =
    fillRatio >= (Number(policy.minLineEdgeFill) || 0.82);

  const isAdjustedLineEdge =
    last._v9AdjustedLineEnd === true ||
    last._v9AdjustedLineEdge === true;

  const ok = isParagraphEnd || isFilledLineEdge || isAdjustedLineEdge;

  return {
    ok,
    reason: ok ? "ok" : "last-main-line-not-filled",
    lastMainLineText: last.text || "",
    lastMainLineFillRatio: fillRatio,
    isParagraphEnd,
    isFilledLineEdge,
    isAdjustedLineEdge,
    rejectedBecause: ok ? "" : "last-main-line-not-filled",
  };
}

export function finalMainLineGuard(plan, policy = {}, meta = {}) {
  const info = getLastMainLineInfo(plan, policy);
  const fill = planFillRatio(plan, meta.cfg || {});
  const mainLines = planMainLineCount(plan);
  const commentaryLines = planCommentaryLineCount(plan);
  const debug = {
    page: meta.pageIdx,
    selectedSource: meta.selectedSource || meta.source || meta.candidateSource || "",
    breakKind: meta.breakKind || meta.kind || meta.candidateKind || "",
    finalMainLine: {
      text: info.lastMainLineText || "",
      fillRatio: info.lastMainLineFillRatio,
      isParagraphEnd: info.isParagraphEnd,
      isLineEdge: info.isFilledLineEdge || info.isAdjustedLineEdge,
      rejectedBecause: info.rejectedBecause || "",
    },
    sparse: {
      fill,
      mainLines,
      commentaryLines,
      rejectedBecause: "",
    },
    streams: [],
  };

  if (typeof window !== "undefined") {
    window.__ravtextLastV9PageGuard = debug;
  }

  if (!info.ok) {
    if (typeof console !== "undefined") {
      console.warn("[v9] rejected page: last main line not filled", debug);
    }
    return {
      accept: false,
      reason: "last-main-line-not-filled",
      debug,
    };
  }

  return {
    accept: true,
    reason: "ok",
    debug,
  };
}

export function isSparseV9Page(plan, policy = {}, meta = {}) {
  if (meta.isPhysicallyUnavoidable) return false;
  const fill = Number.isFinite(meta.fill) ? meta.fill : planFillRatio(plan, meta.cfg || {});
  const mainLines = Number.isFinite(meta.mainLines) ? meta.mainLines : planMainLineCount(plan);
  const commentaryLines = Number.isFinite(meta.commentaryLines) ? meta.commentaryLines : planCommentaryLineCount(plan);
  if (fill >= (Number(policy.minAcceptablePageFill) || 0.68)) return false;
  return (mainLines <= 1 && commentaryLines <= 3) || fill < 0.45;
}

export function scoreV9PageCandidate(plan, candidate, policy = {}, meta = {}) {
  if (!plan?.overflow) return { accept: false, score: -Infinity, reason: "no-plan" };
  if (plan.overflow.exceedsPage) return { accept: false, score: -Infinity, reason: "exceeds-page" };
  if (overflowText(plan.overflow.mainText).trim()) return { accept: false, score: -Infinity, reason: "main-overflow" };
  const lineEdgeGuard = finalMainLineGuard(plan, policy, {
    ...meta,
    selectedSource: meta.selectedSource || meta.source || candidate?.source || "",
    breakKind: meta.breakKind || candidate?.kind || "",
  });
  if (!lineEdgeGuard.accept) {
    return { accept: false, score: -Infinity, reason: lineEdgeGuard.reason, debug: lineEdgeGuard.debug };
  }
  const streamOverflow = hasV9StreamOverflow(plan);
  if (streamOverflow && Array.isArray(meta.movedNotes) && meta.movedNotes.length) return { accept: false, score: -Infinity, reason: "moved-notes-overflow" };
  const fill = planFillRatio(plan, meta.cfg || {});
  const mainLines = planMainLineCount(plan);
  const commentaryLines = planCommentaryLineCount(plan);
  if (policy.rejectSparsePages && isSparseV9Page(plan, policy, { ...meta, fill, mainLines, commentaryLines })) return { accept: false, score: -Infinity, reason: "sparse-page" };
  let score = (candidate?.priority || 0) * 10 + Math.round(fill * 1000);
  if (candidate?.kind === "word-gap") score -= 3000;
  if (mainLines <= 1 && fill < 0.72) score -= 2000;
  if (commentaryLines > 0 && mainLines <= 1) score -= 1000;
  if (streamOverflow) score -= 500;
  return { accept: true, score, fill, mainLines, commentaryLines, reason: "ok" };
}

export function debugV9SplitDecision(payload) {
  if (typeof window !== "undefined") window.__ravtextLastV9SplitDecision = payload;
  return payload;
}
