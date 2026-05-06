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
  // v28-merge / משה: לא מוחקים תוכן! מסמנים בלבד את הבעיה לטובת הדיבוג
  // וה-engine. מחיקת תוכן = איבוד טקסט בלתי הפיך, שמשה אסר עליו במפורש
  // ("שמירה על טקסט מלא"). הפתרון האמיתי הוא Budget Solver שיפעל לפני הפיצול,
  // לא post-process שמוחק.
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return false;
  const overflow = pageEl.scrollHeight - pageEl.clientHeight;
  if (overflow <= OVERFLOW_THRESHOLD_PX) return false;

  // Find the tallest descendant that's an expanded body or body-portion.
  const candidates = Array.from(
    block.querySelectorAll(":scope > .talmud-body-expanded, :scope > .talmud-body-portion")
  );
  if (candidates.length === 0) {
    pageEl.dataset.talmudOverflowCorrected = "no-candidates";
    return false;
  }
  candidates.sort(
    (a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height
  );
  const heaviest = candidates[0];
  const heaviestH = heaviest.getBoundingClientRect().height;
  if (heaviestH <= pageHeightPx(pageEl)) return false;

  // סימון בלבד — אסור למחוק תוכן. ה-engine ידע על הסטייה דרך ה-attribute הזה.
  pageEl.dataset.talmudOverflowCorrected = `flagged-px-${Math.round(overflow)}`;
  pageEl.dataset.talmudOverflowHeaviestPx = String(Math.round(heaviestH));
  if (typeof console !== "undefined" && console.warn) {
    console.warn(
      `[talmud overflow] page exceeds frame by ${Math.round(overflow)}px — ` +
      `heaviest body: ${Math.round(heaviestH)}px. Budget Solver integration ` +
      `needed for proper fix; not deleting content.`
    );
  }
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
