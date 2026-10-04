const POSITIONED_ROLES = new Set(["onkelos", "side_notes"]);
const POSITIONS = new Set(["inner", "outer", "right", "left"]);

export function v9PhysicalSideForLayoutPosition(position, pageIndex = 0) {
  const value = String(position || "");
  if (value === "right" || value === "left") return value;
  const isOddPage = (Math.max(0, Number(pageIndex) || 0) + 1) % 2 === 1;
  if (value === "inner") return isOddPage ? "right" : "left";
  if (value === "outer") return isOddPage ? "left" : "right";
  return "";
}

function requestedSide(streamId, streamSettings, pageIndex) {
  if (!streamId) return "";
  const settings = streamSettings?.[streamId] || {};
  if (!POSITIONED_ROLES.has(String(settings.layoutRole || ""))) return "";
  const position = String(settings.layoutPosition || "");
  if (!POSITIONS.has(position)) return "";
  return v9PhysicalSideForLayoutPosition(position, pageIndex);
}

export function resolveV9TalmudStreamSlots({
  streams,
  streamSettings = {},
  pageIndex = 0,
  sideMode = "",
} = {}) {
  if (!Array.isArray(streams) || streams.length === 0) {
    return Object.freeze({ streams, conflicts: Object.freeze([]) });
  }

  const selected = streams.slice(0, 2);
  const tail = streams.slice(2);
  const isOddPage = (Math.max(0, Number(pageIndex) || 0) + 1) % 2 === 1;

  // Preserve the historical global inner/outer behavior exactly when no
  // per-stream explicit position applies.
  const defaultSlots = selected.length < 2
    ? { right: selected[0] || null, left: null }
    : (sideMode === "inner-outer" && !isOddPage
      ? { right: selected[1] || null, left: selected[0] || null }
      : { right: selected[0] || null, left: selected[1] || null });

  const requests = selected.map(id => ({ id, side: requestedSide(id, streamSettings, pageIndex) }));
  if (!requests.some(x => x.side)) {
    const ordered = selected.length < 2
      ? [...selected, ...tail]
      : [defaultSlots.right, defaultSlots.left, ...tail];
    return Object.freeze({ streams: Object.freeze(ordered), conflicts: Object.freeze([]) });
  }

  const slots = { right: null, left: null };
  const conflicts = [];
  const unassigned = [];

  // Explicit per-stream position wins over the global side mode. If two
  // selected streams request the same physical side, preserve source/stream
  // priority: the first selected stream gets that side and the other remains
  // visible on the remaining side instead of disappearing.
  for (const req of requests) {
    if (!req.id) continue;
    if (req.side && !slots[req.side]) {
      slots[req.side] = req.id;
    } else {
      if (req.side && slots[req.side]) {
        conflicts.push(Object.freeze({
          side: req.side,
          keptStream: slots[req.side],
          displacedStream: req.id,
        }));
      }
      unassigned.push(req.id);
    }
  }

  for (const id of unassigned) {
    const preferred = defaultSlots.right === id ? "right"
      : defaultSlots.left === id ? "left"
      : "";
    if (preferred && !slots[preferred]) {
      slots[preferred] = id;
    } else if (!slots.right) {
      slots.right = id;
    } else if (!slots.left) {
      slots.left = id;
    }
  }

  // A single explicitly-left stream needs an empty right slot so
  // aggregateForV9 can assign it to left without paint-time relocation.
  const ordered = [
    slots.right || null,
    slots.left || null,
    ...tail,
  ];
  while (ordered.length > 1 && ordered.at(-1) == null) ordered.pop();

  return Object.freeze({
    streams: Object.freeze(ordered),
    conflicts: Object.freeze(conflicts),
  });
}
