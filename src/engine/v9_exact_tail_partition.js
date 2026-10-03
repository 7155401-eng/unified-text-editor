// Find a complete, bounded partition of the SAME already-owned source words.
// It is used only after the existing local tail search would clip spacing.
// Every accepted row has been measured by the caller against its actual box.
// No approximate widths, extra words, new rows, or relaxed spacing are used.
export function findV9ExactTailPartition({
  wordCount, rows, maxSpacing, metricFor, metricMany = null, maxEvaluations = 4096,
}) {
  if (!Number.isInteger(wordCount) || wordCount < 1 || !Array.isArray(rows) ||
      !rows.length || !Number.isFinite(maxSpacing) || maxSpacing < 0 ||
      typeof metricFor !== 'function' || !Number.isInteger(maxEvaluations) || maxEvaluations < 1 ||
      (metricMany != null && typeof metricMany !== 'function')) {
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
    const requests = [];
    let budgetExhausted = false;

    // Build this DP layer first. When a batch provider is available the caller
    // can perform all DOM writes before the first geometry read, avoiding one
    // forced layout per candidate. Request order is identical to the historical
    // nested loops so tie-breaking and evaluation counts remain unchanged.
    gather:
    for (const [from, state] of states) {
      const minimumEnd = i === rows.length - 1 ? wordCount : from + (rows[i].allowsEmpty ? 0 : 1);
      for (let to = minimumEnd; to <= maximumEnd; to++) {
        // Never return a partially searched alternative when the budget ends.
        if (evaluations >= maxEvaluations) {
          budgetExhausted = true;
          break gather;
        }
        evaluations++;
        requests.push({lineIndex: i, from, to, state});
      }
    }

    let metrics;
    if (metricMany && requests.length > 1) {
      metrics = metricMany(requests.map(({lineIndex, from, to}) => ({lineIndex, from, to})));
      if (!Array.isArray(metrics) || metrics.length !== requests.length) {
        throw new Error('V9 exact tail metricMany returned an invalid result set');
      }
    } else {
      metrics = requests.map(({lineIndex, from, to}) => metricFor(lineIndex, from, to));
    }

    for (let ri = 0; ri < requests.length; ri++) {
      const {to, state} = requests[ri];
      const metric = metrics[ri];
      if (!metric || !Number.isFinite(metric.pressure) || metric.pressure < 0 ||
          metric.pressure > maxSpacing + 1e-9) continue;
      const cost = state.cost + metric.pressure * metric.pressure;
      const known = next.get(to);
      if (!known || cost < known.cost - 1e-9) {
        next.set(to, {cost, previous: state, end: to});
      }
    }

    if (budgetExhausted) return {status: 'budget-exhausted', evaluations};
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
