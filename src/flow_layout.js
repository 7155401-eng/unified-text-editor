export function streamTextLength(streamEl) {
  const clone = streamEl.cloneNode(true);
  clone.querySelector(".stream-title")?.remove();
  return (clone.textContent || "").trim().length;
}

export function originalOrder(streamEl, idx) {
  if (!streamEl.dataset.originalOrder) {
    streamEl.dataset.originalOrder = String(idx);
  }
  return parseInt(streamEl.dataset.originalOrder, 10) || 0;
}

export function widthForFlowFloat(levelCount) {
  const count = Math.max(1, levelCount || 1);
  const percent = 100 / count;
  return `calc(${percent.toFixed(4)}% - 8px)`;
}

export function applyFloatFlowLevel({
  container,
  streams,
  streamsWrap,
  sideForStream,
  floatClass,
  flowClass,
  rightClass,
  leftClass,
  roleDataset,
  floatRole = "float",
  flowRole = "flow",
  widthForStream = widthForFlowFloat,
}) {
  if (!container || !streams || streams.length === 0) return null;
  const measured = streams
    .map((stream) => ({ stream, len: streamTextLength(stream) }))
    .sort((a, b) => b.len - a.len);
  const flow = measured[0].stream;
  const floats = measured
    .slice(1)
    .sort((a, b) => originalOrder(a.stream, 0) - originalOrder(b.stream, 0))
    .map((item) => item.stream);

  for (const stream of floats) container.appendChild(stream);
  container.appendChild(flow);

  floats.forEach((stream, idx) => {
    const side = sideForStream(stream, idx, streamsWrap);
    stream.classList.add(floatClass);
    stream.classList.add(side === "right" ? rightClass : leftClass);
    stream.dataset[roleDataset] = floatRole;
    stream.style.float = side;
    stream.style.width = widthForStream(stream, streams.length);
  });

  flow.classList.add(flowClass);
  flow.dataset[roleDataset] = flowRole;
  return { flow, floats };
}
