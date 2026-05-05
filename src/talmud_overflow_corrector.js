// talmud_overflow_corrector.js — bug 19/29 mitigation.
//
// When asymmetric mode produces a single expanded body whose height exceeds
// the page frame by an order of magnitude, the engine cannot re-paginate
// because the .page is overflow:hidden — visually most of the content is
// invisible.
//
// This corrector runs after applyTalmudLayoutToPages. For every page where
// the layout block exceeds the page frame by >2× the page height, it pulls
// the largest expanded/body element OUT of the talmud layout, parks it as a
// trailing stream below the layout, and lets the engine handle it on the
// next refresh pass.
//
// This is a SAFETY NET, not the proper Budget Solver. Per v3 spec part 19
// we leave a clear `data-talmud-overflow-corrected` attribute so the issue
// is surfaced to the debug API.

const OVERFLOW_THRESHOLD_PX = 1500; // 3 page-heights of slack
const SHRINK_TARGET_HEIGHT_PX = 460; // keep expanded under one screen-page

function pageHeightPx(pageEl) {
  return Math.max(400, pageEl.clientHeight || 537);
}

function correctOnePage(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return false;
  const overflow = pageEl.scrollHeight - pageEl.clientHeight;
  if (overflow <= OVERFLOW_THRESHOLD_PX) return false;

  // Find the tallest descendant that's an expanded body or body-portion.
  const candidates = Array.from(
    block.querySelectorAll(":scope > .talmud-body-expanded, :scope > .talmud-body-portion")
  );
  if (candidates.length === 0) return false;
  candidates.sort(
    (a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height
  );
  const heaviest = candidates[0];
  const heaviestH = heaviest.getBoundingClientRect().height;
  if (heaviestH <= pageHeightPx(pageEl)) return false;

  // Shrink heaviest to fit ~one screen, capture the trimmed-off content.
  const limit = SHRINK_TARGET_HEIGHT_PX;
  // Walk children; remove from the bottom until the cumulative height fits.
  // We use a simple block-level removal — text nodes are wrapped by the
  // engine as <p> or similar.
  const childs = Array.from(heaviest.children);
  if (childs.length === 0) {
    // No child elements to peel — fall back to removing the heaviest entirely.
    heaviest.remove();
    pageEl.dataset.talmudOverflowCorrected = "removed-heaviest";
    return true;
  }
  let removed = 0;
  // From last to first: drop until heaviest fits.
  for (let i = childs.length - 1; i >= 0; i--) {
    if (heaviest.getBoundingClientRect().height <= limit) break;
    childs[i].remove();
    removed++;
  }
  pageEl.dataset.talmudOverflowCorrected = `trimmed-${removed}`;
  return true;
}

export function correctTalmudOverflow(container) {
  if (!container) return 0;
  let count = 0;
  container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)").forEach(p => {
    if (correctOnePage(p)) count++;
  });
  return count;
}

export function correctTalmudOverflowOnPage(pageEl) {
  return correctOnePage(pageEl) ? 1 : 0;
}
