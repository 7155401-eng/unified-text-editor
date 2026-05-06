// talmud_budget_solver.js — pure function that allocates page height
// across main + right + left commentary streams.
//
// Per v3 spec parts 5 + CL-2 + CL-4 + CL-5.
//
// No DOM. No side effects. Unit-testable.

/**
 * @typedef {Object} TextSegment
 * @property {"paragraph"|"sentence"|"block"|"title"} type
 * @property {string} text
 * @property {number} [height]
 * @property {boolean} atomic
 */

function sum(arr, fn) {
  let s = 0;
  for (const item of arr) s += fn(item) || 0;
  return s;
}

/**
 * @typedef {Object} BudgetInput
 * @property {number} availableHeight
 * @property {TextSegment[]} mainSegments
 * @property {TextSegment[]} rightSegments
 * @property {TextSegment[]} leftSegments
 * @property {{main: number, right: number, left: number}} [targetRatio]
 */

/**
 * @param {BudgetInput} input
 * @returns {{
 *   fits: boolean,
 *   splits: {main: number, right: number, left: number} | null,
 *   overflow: {main: number, right: number, left: number},
 *   warnings: string[]
 * }}
 */
export function solveTalmudBudget(input) {
  const { availableHeight, mainSegments, rightSegments, leftSegments } = input;
  const ratio = input.targetRatio || { main: 0.5, right: 0.25, left: 0.25 };

  const naturalH = {
    main: sum(mainSegments, s => s.height),
    right: sum(rightSegments, s => s.height),
    left: sum(leftSegments, s => s.height),
  };

  // Page height = main + max(right, left) (sides share vertical space).
  const needed = naturalH.main + Math.max(naturalH.right, naturalH.left);

  if (needed <= availableHeight) {
    return {
      fits: true,
      splits: null,
      overflow: { main: 0, right: 0, left: 0 },
      warnings: [],
    };
  }

  const allocation = jointAllocate(availableHeight, naturalH, ratio);
  const splits = {
    main: findSegmentSplit(mainSegments, allocation.main),
    right: findSegmentSplit(rightSegments, allocation.right),
    left: findSegmentSplit(leftSegments, allocation.left),
  };
  const overflow = {
    main: Math.max(0, naturalH.main - allocation.main),
    right: Math.max(0, naturalH.right - allocation.right),
    left: Math.max(0, naturalH.left - allocation.left),
  };
  return { fits: false, splits, overflow, warnings: [] };
}

/**
 * Water-filling allocator. Each stream gets up to its ratio share, but never
 * more than its natural height. Surplus is redistributed to streams that still
 * want more, weighted by their unmet demand.
 *
 * @param {number} available
 * @param {{main: number, right: number, left: number}} natural
 * @param {{main: number, right: number, left: number}} ratio
 */
export function jointAllocate(available, natural, ratio) {
  const totalRatio = ratio.main + Math.max(ratio.right, ratio.left);
  if (totalRatio <= 0) {
    return { main: 0, right: 0, left: 0 };
  }
  const targetMain = (available * ratio.main) / totalRatio;
  const targetSide = (available * Math.max(ratio.right, ratio.left)) / totalRatio;

  let allocMain = Math.min(natural.main, targetMain);
  let allocRight = Math.min(natural.right, targetSide);
  let allocLeft = Math.min(natural.left, targetSide);

  const used = allocMain + Math.max(allocRight, allocLeft);
  let surplus = available - used;
  if (surplus > 0) {
    const wantMain = Math.max(0, natural.main - allocMain);
    const wantRight = Math.max(0, natural.right - allocRight);
    const wantLeft = Math.max(0, natural.left - allocLeft);
    const totalWant = wantMain + Math.max(wantRight, wantLeft);
    if (totalWant > 0) {
      const portion = Math.min(surplus, totalWant);
      allocMain += (wantMain / totalWant) * portion;
      allocRight += (wantRight / totalWant) * portion;
      allocLeft += (wantLeft / totalWant) * portion;
    }
  }
  return { main: allocMain, right: allocRight, left: allocLeft };
}

/**
 * How many atomic segments fit under maxHeight without exceeding it.
 *
 * @param {TextSegment[]} segments
 * @param {number} maxHeight
 * @returns {number}
 */
export function findSegmentSplit(segments, maxHeight) {
  let cum = 0;
  for (let i = 0; i < segments.length; i++) {
    const h = segments[i].height || 0;
    if (cum + h > maxHeight) return i;
    cum += h;
  }
  return segments.length;
}

/**
 * Atomic Stream Commitment (CL-5):
 * A stream is either fully deferred to next page, or committed with at least
 * its title + first paragraph. Never just-the-title (orphan).
 *
 * Assumes segments[0] is title (if present), [1] is first paragraph.
 *
 * @param {TextSegment[]} streamSegments
 * @param {number} availableHeight
 * @returns {{commit: number, defer: number}}
 */
export function commitStreamAtomically(streamSegments, availableHeight) {
  if (streamSegments.length === 0) return { commit: 0, defer: 0 };
  const titleH = streamSegments[0].height || 0;
  const firstParaH = (streamSegments[1] && streamSegments[1].height) || 0;
  const minimum = titleH + firstParaH;
  if (availableHeight < minimum) {
    return { commit: 0, defer: streamSegments.length };
  }
  const fittingCount = findSegmentSplit(streamSegments, availableHeight);
  const commit = Math.max(2, fittingCount);
  return {
    commit,
    defer: streamSegments.length - commit,
  };
}

/**
 * Find a safe text offset by walking backwards from desiredOffset until we
 * hit a whitespace or punctuation character. Used so we never cut mid-word.
 *
 * Per GPT-5: if no safe break exists, return -1 — the caller must defer the
 * whole unit to the next page.
 *
 * @param {string} text
 * @param {number} desiredOffset
 * @returns {number} safe offset, or -1 if none
 */
export function findSafeTextOffset(text, desiredOffset) {
  if (desiredOffset <= 0) return 0;
  if (desiredOffset >= text.length) return text.length;
  // Walk back to a break character.
  for (let i = desiredOffset; i > 0; i--) {
    const ch = text[i - 1];
    // Hebrew + Latin breaks: whitespace, sof-pasuq, geresh, paseq, comma, period, etc.
    if (/[\s.,;:!?־׀׃׳״ ​­]/.test(ch)) {
      return i;
    }
  }
  // No safe break found in the desired range.
  return -1;
}
