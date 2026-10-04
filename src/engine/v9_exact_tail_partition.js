// Find a complete, bounded partition of the SAME already-owned source words.
// It is used only after the existing local tail search would clip spacing.
// Every accepted row has been measured by the caller against its actual box.
// No approximate widths, extra words, new rows, or relaxed spacing are used.
export function findV9ExactTailPartition({
  wordCount, rows, maxSpacing, metricFor, maxEvaluations = 4096,
}) {
  if (!Number.isInteger(wordCount) || wordCount < 1 || !Array.isArray(rows) ||
      !rows.length || !Number.isFinite(maxSpacing) || maxSpacing < 0 ||
      typeof metricFor !== 'function' || !Number.isInteger(maxEvaluations) || maxEvaluations < 1) {
    return {status: 'invalid-input', evaluations: 0};
  }
  const minimumRemaining = new Array(rows.length + 1).fill(0);
  for (let i = rows.length - 1; i >= 0; i--) {
    minimumRemaining[i] = minimumRemaining[i + 1] + (rows[i].allowsEmpty ? 0 : 1);
  }
  if (minimumRemaining[0] > wordCount) return {status: 'infeasible', evaluations: 0};
  let states = new Map([[0, {cost: 0, previous: null, end: 0}]]), evaluations = 0;
  for (let i = 0; i < rows.length; i++) {
    const next = new Map();
    const maximumEnd = wordCount - minimumRemaining[i + 1];

    // evaluations advances for every candidate transition, regardless of
    // metric feasibility or dominance. Therefore if this whole row contains
    // more candidates than the remaining budget, the legacy loop is
    // guaranteed to stop mid-row with budget-exhausted and discard the
    // partially-built next map. Detect that outcome before any DOM-backed
    // metricFor() calls in the doomed row.
    const remainingBudget = maxEvaluations - evaluations;
    let rowEvaluations = 0;
    for (const [from] of states) {
      const minimumEnd = i === rows.length - 1
        ? wordCount
        : from + (rows[i].allowsEmpty ? 0 : 1);
      if (minimumEnd > maximumEnd) continue;
      rowEvaluations += maximumEnd - minimumEnd + 1;
      if (rowEvaluations > remainingBudget) {
        return {status: 'budget-exhausted', evaluations: maxEvaluations};
      }
    }

    for (const [from, state] of states) {
      const minimumEnd = i === rows.length - 1 ? wordCount : from + (rows[i].allowsEmpty ? 0 : 1);
      for (let to = minimumEnd; to <= maximumEnd; to++) {
        // Never return a partially searched alternative when the budget ends.
        if (evaluations >= maxEvaluations) return {status: 'budget-exhausted', evaluations};
        evaluations++;

        // pressure² is non-negative. If this destination already has a path
        // whose COMPLETE cost is no greater than the current state's cost
        // BEFORE adding this row, this transition cannot possibly improve it.
        // Count the evaluation exactly as before so the 4096 safety budget and
        // budget-exhausted boundary remain byte-for-byte compatible; skip only
        // the expensive DOM-backed metricFor() call.
        const known = next.get(to);
        if (known && known.cost <= state.cost) continue;

        const metric = metricFor(i, from, to);
        if (!metric || !Number.isFinite(metric.pressure) || metric.pressure < 0 ||
            metric.pressure > maxSpacing + 1e-9) continue;
        const cost = state.cost + metric.pressure * metric.pressure;
        if (!known || cost < known.cost - 1e-9) {
          next.set(to, {cost, previous: state, end: to});
        }
      }
    }
    if (!next.size) return {status: 'infeasible', evaluations};
    states = next;
  }
  let state = states.get(wordCount);
  if (!state) return {status: 'infeasible', evaluations};
  const boundaries = [];
  while (state.previous) { boundaries.push(state.end); state = state.previous; }
  boundaries.reverse(); boundaries.pop();
  return {status: 'complete', evaluations, boundaries};
}
