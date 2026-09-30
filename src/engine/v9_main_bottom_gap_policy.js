// Pure V9 main/footer gap policy.
//
// IMPORTANT: this module is safe to import from the planner/render entry path.
// It must have no DOM-mutation helpers, decorators, stretch normalization, or
// post-render side effects. It only resolves the requested numeric gap.

export const DEFAULT_V9_MAIN_BOTTOM_GAP_PX = 16;
export const MAX_V9_MAIN_BOTTOM_GAP_PX = 60;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function resolveV9MainBottomGapPx(container, explicitGap) {
  if (Number.isFinite(Number(explicitGap))) {
    return clamp(Number(explicitGap), 0, MAX_V9_MAIN_BOTTOM_GAP_PX);
  }

  try {
    const raw = window.localStorage?.getItem("ravtext.talmudLayout.mainBottomGap");
    if (raw !== null && raw !== "") {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n)) return clamp(n, 0, MAX_V9_MAIN_BOTTOM_GAP_PX);
    }
  } catch (_) {}

  try {
    const cssValue = window.getComputedStyle?.(container)
      ?.getPropertyValue("--ravtext-v9-main-bottom-gap");
    const n = Number.parseFloat(cssValue || "");
    if (Number.isFinite(n)) return clamp(n, 0, MAX_V9_MAIN_BOTTOM_GAP_PX);
  } catch (_) {}

  return DEFAULT_V9_MAIN_BOTTOM_GAP_PX;
}
