// Per-document manual page constraints.
//
// This is the web translation of the desktop Page Tweaker's page_tweaks.json
// and page memory. It is document state, NOT a global user preference.
//
// Semantics:
//   linesDiff < 0  => reserve that many normal main-text rows at page bottom,
//                     forcing content to the following page.
//   linesDiff > 0  => ask V9 to pull up to that many extra rows from the next
//                     paragraph, but only through V9's existing fit/ownership/
//                     overflow guards. Never enlarge beyond the physical page.
//   footnoteShift  => reserved for the next parity step; persisted now so the
//                     schema does not need another incompatible migration.

export const PAGE_TWEAKS_VERSION = 1;
export const PAGE_TWEAK_STATUS_PENDING = "pending";
export const PAGE_TWEAK_STATUS_APPROVED = "approved";
export const PAGE_TWEAK_STATUS_CHANGED = "changed";

const MAX_LINES_DIFF = 30;
const MAX_FOOTNOTE_SHIFT_LINES = 30;

const int = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function normalizeFootnoteShift(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [stream, value] of Object.entries(raw)) {
    const code = String(stream || "").trim();
    if (!code) continue;
    const n = clamp(int(value), 0, MAX_FOOTNOTE_SHIFT_LINES);
    if (n > 0) out[code] = n;
  }
  return out;
}

export function emptyPageTweaks() {
  return { version: PAGE_TWEAKS_VERSION, pages: {} };
}

export function normalizePageTweakEntry(raw = {}) {
  const statusRaw = String(raw?.status || PAGE_TWEAK_STATUS_PENDING);
  const status = [
    PAGE_TWEAK_STATUS_PENDING,
    PAGE_TWEAK_STATUS_APPROVED,
    PAGE_TWEAK_STATUS_CHANGED,
  ].includes(statusRaw) ? statusRaw : PAGE_TWEAK_STATUS_PENDING;

  return {
    linesDiff: clamp(int(raw?.linesDiff ?? raw?.lines_diff), -MAX_LINES_DIFF, MAX_LINES_DIFF),
    status,
    spaceLines: Number.isFinite(Number(raw?.spaceLines)) ? Math.max(0, Number(raw.spaceLines)) : null,
    overflowPx: Number.isFinite(Number(raw?.overflowPx)) ? Math.max(0, Number(raw.overflowPx)) : null,
    notes: String(raw?.notes || "").slice(0, 2000),
    footnoteShift: normalizeFootnoteShift(raw?.footnoteShift ?? raw?.footnote_shift),
  };
}

export function normalizePageTweaks(raw) {
  const out = emptyPageTweaks();
  if (!raw || typeof raw !== "object") return out;

  // Desktop/early-web compatibility: a flat {"3":{"lines_diff":1}} map is
  // accepted as well as the versioned {pages:{...}} form.
  const pages = raw.pages && typeof raw.pages === "object" ? raw.pages : raw;
  for (const [key, value] of Object.entries(pages || {})) {
    if (!/^\d+$/u.test(String(key))) continue;
    const page = Math.max(1, int(key, 0));
    if (!page) continue;
    const entry = normalizePageTweakEntry(value);
    const meaningful =
      entry.linesDiff !== 0 ||
      entry.status !== PAGE_TWEAK_STATUS_PENDING ||
      entry.spaceLines !== null ||
      entry.overflowPx !== null ||
      entry.notes ||
      Object.keys(entry.footnoteShift).length;
    if (meaningful) out.pages[String(page)] = entry;
  }
  return out;
}

export function getPageTweak(raw, pageNumber) {
  const state = normalizePageTweaks(raw);
  return normalizePageTweakEntry(state.pages[String(Math.max(1, int(pageNumber, 1)))] || {});
}

export function withPageTweak(raw, pageNumber, patch = {}) {
  const state = normalizePageTweaks(raw);
  const key = String(Math.max(1, int(pageNumber, 1)));
  const previous = normalizePageTweakEntry(state.pages[key] || {});
  const next = normalizePageTweakEntry({ ...previous, ...patch });

  if (
    previous.status === PAGE_TWEAK_STATUS_APPROVED &&
    (patch.linesDiff !== undefined || patch.lines_diff !== undefined ||
     patch.footnoteShift !== undefined || patch.footnote_shift !== undefined)
  ) {
    next.status = PAGE_TWEAK_STATUS_CHANGED;
  }

  const meaningful =
    next.linesDiff !== 0 ||
    next.status !== PAGE_TWEAK_STATUS_PENDING ||
    next.spaceLines !== null ||
    next.overflowPx !== null ||
    next.notes ||
    Object.keys(next.footnoteShift).length;

  if (meaningful) state.pages[key] = next;
  else delete state.pages[key];
  return state;
}

export function pageFootnoteShiftLines(pageConstraint, streamId) {
  const id = String(streamId ?? "").trim();
  if (!id) return 0;
  const map = pageConstraint?.footnoteShift && typeof pageConstraint.footnoteShift === "object"
    ? pageConstraint.footnoteShift
    : {};
  return clamp(int(map[id]), 0, MAX_FOOTNOTE_SHIFT_LINES);
}

/**
 * Translate a per-page/per-stream manual note-line shift into planner geometry.
 *
 * This does not move any DOM nodes. It lowers the physical bottom available to
 * that commentary stream by N of THAT STREAM'S measured row pitches. The normal
 * V9 overflow/carry path then moves the remaining source to the next page.
 */
export function resolveV9StreamShiftBottom(pageConstraint, streamId, {
  pageBottom = 0,
  lineHeight = 0,
  minTop = 0,
} = {}) {
  const bottom = Math.max(0, Number(pageBottom) || 0);
  const top = Math.max(0, Math.min(bottom, Number(minTop) || 0));
  const pitch = Math.max(1, Number(lineHeight) || 1);
  const shiftLines = pageFootnoteShiftLines(pageConstraint, streamId);
  const shiftedBottom = Math.max(top, bottom - shiftLines * pitch);
  return Object.freeze({
    streamId: String(streamId ?? ""),
    shiftLines,
    lineHeight: pitch,
    pageBottom: bottom,
    minTop: top,
    bottom: shiftedBottom,
    reservedPx: Math.max(0, bottom - shiftedBottom),
  });
}

export function resolveV9PageConstraint(raw, pageIndex, {
  baseReservedBottom = 0,
  pageHeight = 0,
  padding = 0,
  lineHeight = 0,
} = {}) {
  const pageNumber = Math.max(1, int(pageIndex, 0) + 1);
  const tweak = getPageTweak(raw, pageNumber);
  const pitch = Math.max(1, Number(lineHeight) || 1);
  const baseReserve = Math.max(0, Number(baseReservedBottom) || 0);
  const physicalContentHeight = Math.max(0, (Number(pageHeight) || 0) - 2 * (Number(padding) || 0));

  let reservedBottom = baseReserve;
  let pushLines = 0;
  let pullLines = 0;

  if (tweak.linesDiff < 0) {
    pushLines = Math.min(MAX_LINES_DIFF, Math.abs(tweak.linesDiff));
    const wanted = baseReserve + pushLines * pitch;
    // Leave at least one normal row of physical content. If a document is
    // smaller than one row, V9's ordinary no-fit guard remains authoritative.
    const maxReserve = Math.max(baseReserve, physicalContentHeight - pitch);
    reservedBottom = Math.min(wanted, maxReserve);
  } else if (tweak.linesDiff > 0) {
    pullLines = Math.min(MAX_LINES_DIFF, tweak.linesDiff);
  }

  return Object.freeze({
    pageNumber,
    linesDiff: tweak.linesDiff,
    pushLines,
    pullLines,
    reservedBottom,
    baseReservedBottom: baseReserve,
    lineHeight: pitch,
    status: tweak.status,
    footnoteShift: Object.freeze({ ...tweak.footnoteShift }),
  });
}


export function updatePageTweakMeasurements(raw, pageNumber, {
  bottomGapLines = null,
  overflowPx = null,
  linePitchPx = null,
} = {}) {
  const state = normalizePageTweaks(raw);
  const key = String(Math.max(1, int(pageNumber, 1)));
  const previous = normalizePageTweakEntry(state.pages[key] || {});
  const next = { ...previous };

  const gap = Number(bottomGapLines);
  const overflow = Number(overflowPx);
  const pitch = Math.max(1, Number(linePitchPx) || 1);

  let preserveApprovedBaseline = false;
  if (previous.status === PAGE_TWEAK_STATUS_APPROVED) {
    const oldGap = Number(previous.spaceLines);
    const oldOverflow = Number(previous.overflowPx);
    let changed = false;

    // The measurements stored by approvePageTweakWithMeasurements() are the
    // approval baseline. Do NOT slide that baseline forward on every harmless
    // re-measurement: several sub-threshold typography changes could otherwise
    // accumulate into a large visual drift without ever marking the page
    // changed. Compare every approved render to the original approved snapshot
    // until a meaningful delta actually occurs.
    //
    // Desktop used 0.3cm. In the browser use the typography itself: half a
    // normal row is meaningful, while smaller antialias/font differences are
    // not. Overflow uses the same half-row physical threshold.
    if (Number.isFinite(oldGap) && Number.isFinite(gap) && Math.abs(gap - oldGap) > 0.5) changed = true;
    if (Number.isFinite(oldOverflow) && Number.isFinite(overflow) &&
        Math.abs(overflow - oldOverflow) > pitch * 0.5) changed = true;
    if ((!Number.isFinite(oldOverflow) || oldOverflow <= 1) && Number.isFinite(overflow) && overflow > pitch * 0.5) {
      changed = true;
    }
    if (changed) next.status = PAGE_TWEAK_STATUS_CHANGED;
    else preserveApprovedBaseline = true;
  }

  // Pending/changed pages keep the latest measurements. An approved page keeps
  // its exact approval snapshot until a meaningful delta is observed.
  if (!preserveApprovedBaseline) {
    if (Number.isFinite(gap)) next.spaceLines = Math.max(0, gap);
    if (Number.isFinite(overflow)) next.overflowPx = Math.max(0, overflow);
  }

  const meaningful =
    next.linesDiff !== 0 ||
    next.status !== PAGE_TWEAK_STATUS_PENDING ||
    next.spaceLines !== null ||
    next.overflowPx !== null ||
    next.notes ||
    Object.keys(next.footnoteShift).length;

  if (meaningful) state.pages[key] = normalizePageTweakEntry(next);
  else delete state.pages[key];
  return state;
}

export function approvePageTweakWithMeasurements(raw, pageNumber, {
  bottomGapLines = null,
  overflowPx = null,
} = {}) {
  let state = withPageTweak(raw, pageNumber, { status: PAGE_TWEAK_STATUS_APPROVED });
  const key = String(Math.max(1, int(pageNumber, 1)));
  const current = normalizePageTweakEntry(state.pages[key] || {});
  state.pages[key] = normalizePageTweakEntry({
    ...current,
    status: PAGE_TWEAK_STATUS_APPROVED,
    spaceLines: Number.isFinite(Number(bottomGapLines)) ? Math.max(0, Number(bottomGapLines)) : current.spaceLines,
    overflowPx: Number.isFinite(Number(overflowPx)) ? Math.max(0, Number(overflowPx)) : current.overflowPx,
  });
  return state;
}
