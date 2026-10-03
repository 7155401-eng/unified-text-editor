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
    for (const [from, state] of states) {
      const minimumEnd = i === rows.length - 1 ? wordCount : from + (rows[i].allowsEmpty ? 0 : 1);
      for (let to = minimumEnd; to <= maximumEnd; to++) {
        // Never return a partially searched alternative when the budget ends.
        // Dominance pruning below deliberately still consumes this logical
        // evaluation, preserving the exact 4096-budget traversal semantics.
        if (evaluations >= maxEvaluations) return {status: 'budget-exhausted', evaluations};
        evaluations++;

        // Every transition adds pressure² >= 0. If this state's accumulated
        // cost already cannot beat the best path known for the SAME endpoint,
        // even a zero-pressure transition cannot replace it. Skip only the
        // expensive caller measurement; traversal order and evaluation count
        // remain identical to the unpruned solver.
        const known = next.get(to);
        if (known && state.cost >= known.cost - 1e-9) continue;

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
