// talmud_repagination.js — wires the dead Solver/Lab modules to fix
// catastrophic overflow caused by asymmetric mode with huge expanded bodies.
//
// Approach (per chat 2026-05-06): hybrid
//   1. AFTER applyTalmudLayoutToPages, scan for catastrophic overflow
//      (page.scrollHeight > 2× page.clientHeight)
//   2. Find the heaviest body/expanded element on that page
//   3. Use Range API (findSplitAtPixelYInElement) to find a safe text-level
//      split point at TARGET_FILL_RATIO of page height. This handles the
//      common case where the body has a single huge .note child containing
//      all text — child-level splitting wouldn't work there.
//   4. Use Range.extractContents to cut the tail.
//   5. Move the tail to the NEXT page's page-streams as a stream with the
//      same data-stream code (or prepend to existing stream of same code).
//   6. Re-run applyTalmudLayoutToPage on both pages so they reflect new content.
//   7. Iterate up to MAX_PASSES times — pages may cascade.
//
// Lossless: no DOM elements are ever .remove()'d; content is only moved.
// Engine-safe: runs synchronously each render cycle.

import { findSplitAtPixelYInElement, applyTalmudLayoutToPage } from "./talmud_layout.js";

const CATASTROPHIC_RATIO = 2;   // overflow > 2× page-height counts as catastrophic
const TARGET_FILL_RATIO = 0.85; // leave 15% safety margin in the body we trim
const MAX_PASSES = 200;         // generous — one body may need 50+ splits

function pageOverflowRatio(pageEl) {
  const overflow = pageEl.scrollHeight - pageEl.clientHeight;
  const pageH = Math.max(400, pageEl.clientHeight || 537);
  return overflow / pageH;
}

function findHeaviestSplittable(block, minHeightPx) {
  // Look at direct talmud-body-* descendants AND repaginated-tail elements
  // (which we may have appended in earlier passes).
  const candidates = Array.from(
    block.querySelectorAll(
      ":scope > .talmud-body-expanded, :scope > .talmud-body-portion, :scope > .talmud-repaginated-tail"
    )
  );
  let best = null;
  let bestH = 0;
  for (const c of candidates) {
    const h = c.getBoundingClientRect().height;
    if (h <= minHeightPx) continue;
    // Must have non-empty text to be splittable.
    if (!(c.textContent || "").trim()) continue;
    if (h > bestH) { best = c; bestH = h; }
  }
  return best;
}

function moveTailToNextPageStream(currentPageEl, nextPageEl, sourceBody, targetHeightPx) {
  const code = sourceBody.dataset.talmudBodyOf || sourceBody.getAttribute("data-stream") || "";
  if (!code) return null;

  // Use the same proven Range-based split as the crown-body machinery.
  const split = findSplitAtPixelYInElement(sourceBody, targetHeightPx);
  if (!split) return null;

  const range = document.createRange();
  range.setStart(split.node, split.offset);
  range.setEndAfter(sourceBody.lastChild);
  const tailFragment = range.extractContents();
  if (!tailFragment.firstChild) return null;

  // Critical: the next page is already laid out — its streams live INSIDE
  // its .talmud-layout block (crown/body/expanded/leftover), not in page-streams.
  // So we look for an existing body for the same code inside the next page's
  // layout and prepend to it. If not found, create a new "leftover" body
  // inside the next layout so text appears (even if not perfectly styled).
  const nextBlock = nextPageEl.querySelector(":scope > .talmud-layout");
  if (!nextBlock) {
    // Page hasn't been laid out yet — push back to its raw streams.
    const destStreams = nextPageEl.querySelector(":scope > .page-streams");
    if (!destStreams) return null;
    // Find raw stream by code.
    const raw = destStreams.querySelector(`:scope > .stream[data-stream="${code}"]`);
    if (raw) {
      const titleEl = raw.querySelector(":scope > .stream-title");
      const insertBefore = titleEl ? titleEl.nextSibling : raw.firstChild;
      raw.insertBefore(tailFragment, insertBefore);
      raw.dataset.talmudRepaginatedFrom = String(currentPageEl.dataset.pageIndex || "?");
      return raw;
    }
    return null;
  }

  // The next page IS laid out. Look for its body for the same code.
  const existingBody = nextBlock.querySelector(
    `:scope > .talmud-body-portion[data-talmud-body-of="${code}"], ` +
    `:scope > .talmud-body-expanded[data-talmud-body-of="${code}"]`
  );
  if (existingBody) {
    // Prepend tail BEFORE the existing body's content (preserves narrative order).
    existingBody.insertBefore(tailFragment, existingBody.firstChild);
    existingBody.dataset.talmudRepaginatedFrom = String(currentPageEl.dataset.pageIndex || "?");
    return existingBody;
  }

  // No matching body — append a new leftover stream inside the layout block.
  const newStream = document.createElement("div");
  const baseClasses = (sourceBody.className || "").split(/\s+/).filter(c =>
    c &&
    c !== "talmud-body-portion" &&
    c !== "talmud-body-expanded" &&
    c !== "talmud-crown-portion" &&
    c !== "talmud-crown-full"
  );
  newStream.className = `${baseClasses.join(" ")} stream talmud-repaginated-tail`.trim();
  newStream.setAttribute("data-stream", code);
  newStream.dataset.talmudRepaginatedFrom = String(currentPageEl.dataset.pageIndex || "?");
  newStream.style.cssText = "clear: both; width: 100%; margin-top: 8px;";
  newStream.appendChild(tailFragment);
  nextBlock.appendChild(newStream);
  return newStream;
}

function repaginateOnePage(currentPageEl, nextPageEl, pageH) {
  const block = currentPageEl.querySelector(":scope > .talmud-layout");
  if (!block) {
    if (typeof console !== "undefined") console.warn("[repag] no talmud-layout on page", currentPageEl.dataset.pageIndex);
    return false;
  }
  const target = findHeaviestSplittable(block, pageH);
  if (!target) {
    if (typeof console !== "undefined") {
      const allBodies = Array.from(block.querySelectorAll(":scope > .talmud-body-expanded, :scope > .talmud-body-portion"));
      const sum = allBodies.map(b => `${b.dataset.talmudBodyOf || b.getAttribute("data-stream") || "?"}:${Math.round(b.getBoundingClientRect().height)}`).join(",");
      console.warn(`[repag] no splittable on page ${currentPageEl.dataset.pageIndex} (minH=${pageH}) bodies: ${sum}`);
    }
    return false;
  }

  const targetHeight = pageH * TARGET_FILL_RATIO;
  const moved = moveTailToNextPageStream(currentPageEl, nextPageEl, target, targetHeight);
  if (!moved && typeof console !== "undefined") {
    console.warn("[repag] move failed for page", currentPageEl.dataset.pageIndex, "target h:", Math.round(target.getBoundingClientRect().height));
  }
  return Boolean(moved);
}

export function repaginateCatastrophicPages(container) {
  if (!container) return { passes: 0, fixed: 0 };
  const pages = Array.from(
    container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)")
  );
  if (pages.length < 2) return { passes: 0, fixed: 0 };

  const pageH = Math.max(400, pages[0].clientHeight || 537);
  let totalFixed = 0;
  let passes = 0;

  // Per-page cascading: process pages left→right. For each page, repeatedly
  // cut and forward to the next until the source page is no longer catastrophic.
  // This avoids needing many global passes for a single huge body.
  for (let i = 0; i < pages.length - 1; i++) {
    const cur = pages[i];
    let perPageBudget = MAX_PASSES;
    while (pageOverflowRatio(cur) >= CATASTROPHIC_RATIO && perPageBudget-- > 0) {
      const next = pages[i + 1];
      const moved = repaginateOnePage(cur, next, pageH);
      if (!moved) break;
      // קריטי: NOT calling applyTalmudLayoutToPage on either page!
      //   - cur: the ledger snapshot has the FULL original body. Re-layout
      //     would restore from snapshot → tail comes back → duplication.
      //   - next: same reason. Re-layout would restore the body from snapshot
      //     and lose our prepended tail.
      // Instead, we only mutated DOM in place. Both pages remain laid out.
      cur.dataset.talmudRepaginated = "true";
      next.dataset.talmudRepaginatedTarget = "true";
      totalFixed++;
      passes++;
    }
  }

  return { passes, fixed: totalFixed };
}
