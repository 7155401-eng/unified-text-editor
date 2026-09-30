import { getEffectiveStreamSettings, MAIN_STREAM_CODE } from "./original_stream_columns.js";

export function normalizeMainStreamColumnCount(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 2 ? 2 : 1;
}

export function getMainStreamColumnCount(explicit = null) {
  if (explicit !== null && explicit !== undefined && explicit !== "") {
    return normalizeMainStreamColumnCount(explicit);
  }
  return normalizeMainStreamColumnCount(
    getEffectiveStreamSettings(MAIN_STREAM_CODE)?.cols || 1
  );
}

export function applyMainStreamColumnsToElement(el, {
  columns = null,
  gap = "var(--ravtext-stream-horizontal-gap, 8px)",
} = {}) {
  if (!el) return 1;
  const count = getMainStreamColumnCount(columns);
  el.dataset.mainCols = String(count);
  if (count > 1) {
    el.style.columnCount = String(count);
    el.style.columnGap = String(gap);
  } else {
    el.style.columnCount = "";
    el.style.columnGap = "";
  }
  return count;
}
