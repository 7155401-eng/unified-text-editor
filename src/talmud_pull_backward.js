// talmud_pull_backward.js — fills gaps at bottom of pages by pulling content
// from the next page IF the next page has talmud content for the same stream.
//
// Why: the engine sometimes packs less than fits because it estimates talmud
// overhead conservatively. Result: gap > 100px at bottom of one page, while
// next page has tiny content (just the leftover that didn't fit).
//
// Strategy: per-page, after layout settles, if gap > THRESHOLD AND next page
// has a body of the same data-stream, MOVE content from next page's body
// (one paragraph at a time) into current page's body.
//
// Lossless: we only move children between bodies — both bodies remain in DOM.
// We update neither ledger nor talmud-layout structure. Repeat each render.

const GAP_THRESHOLD_PX = 100;
const CHUNK_LIMIT      = 50; // safety: max chunks pulled per call

function pageGap(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return 0;
  return pageEl.getBoundingClientRect().bottom - block.getBoundingClientRect().bottom;
}

function findBodyByCode(pageEl, code) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return null;
  return block.querySelector(
    `:scope > .talmud-body-portion[data-talmud-body-of="${code}"], ` +
    `:scope > .talmud-body-expanded[data-talmud-body-of="${code}"]`
  );
}

function bodyCodes(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return [];
  return Array.from(block.querySelectorAll(
    ":scope > .talmud-body-portion[data-talmud-body-of], " +
    ":scope > .talmud-body-expanded[data-talmud-body-of]"
  )).map(el => el.dataset.talmudBodyOf).filter(Boolean);
}

function pullOnePage(curPageEl, nextPageEl) {
  let gap = pageGap(curPageEl);
  if (gap <= GAP_THRESHOLD_PX) return 0;

  let pulled = 0;

  // STRATEGY 1: Pull content from matching-code bodies (the typical case).
  const codes = bodyCodes(curPageEl);
  if (codes.length > 0) {
    for (let safety = 0; safety < CHUNK_LIMIT && gap > GAP_THRESHOLD_PX; safety++) {
      let movedThisRound = false;
      for (const code of codes) {
        const curBody = findBodyByCode(curPageEl, code);
        const nextBody = findBodyByCode(nextPageEl, code);
        if (!curBody || !nextBody) continue;
        const first = nextBody.firstElementChild;
        if (!first) continue;
        if (first.classList?.contains("stream-title")) continue;
        const childH = first.getBoundingClientRect().height;
        if (childH >= gap - 20) continue;
        curBody.appendChild(first);
        gap = pageGap(curPageEl);
        pulled++;
        movedThisRound = true;
      }
      if (!movedThisRound) break;
    }
  }

  // STRATEGY 2: If gap still big and next page has tiny total content,
  // pull entire matching streams backward.
  if (gap > GAP_THRESHOLD_PX) {
    const nextBlock = nextPageEl.querySelector(":scope > .talmud-layout");
    if (nextBlock) {
      const nextStreams = Array.from(
        nextBlock.querySelectorAll(":scope > .stream[data-stream]")
      );
      const totalNextH = nextStreams.reduce((s, e) => s + e.getBoundingClientRect().height, 0);
      if (totalNextH <= gap - 20 && totalNextH > 0) {
        for (const ns of nextStreams) {
          const code = ns.getAttribute("data-stream");
          if (!code) continue;
          const curBlock = curPageEl.querySelector(":scope > .talmud-layout");
          if (!curBlock) continue;
          const target = curBlock.querySelector(`:scope > .stream[data-stream="${code}"]`);
          if (target) {
            const nsTitle = ns.querySelector(":scope > .stream-title");
            if (nsTitle) nsTitle.remove();
            while (ns.firstChild) target.appendChild(ns.firstChild);
            ns.dataset.talmudPulledBackwards = "true";
            ns.style.display = "none";
            pulled++;
          }
        }
      }
    }
  }

  // STRATEGY 3: If gap still big, look at next page's page-streams (leftover
  // area) AND any stream that doesn't have a match on current page. Pull those
  // entirely, appending into current page's page-streams (or talmud-layout
  // bottom as a sibling). Used for streams (e.g. 03/04) that aren't in talmud
  // config but still need to be visible somewhere.
  if (gap > GAP_THRESHOLD_PX) {
    const nextBlock = nextPageEl.querySelector(":scope > .talmud-layout");
    const nextLeftoverWrap = nextPageEl.querySelector(":scope > .page-streams");
    const candidates = [];
    if (nextBlock) {
      candidates.push(...Array.from(nextBlock.querySelectorAll(":scope > .stream[data-stream]")));
    }
    if (nextLeftoverWrap) {
      candidates.push(...Array.from(nextLeftoverWrap.querySelectorAll(":scope > .stream[data-stream]")));
    }
    const curStreamsWrap = curPageEl.querySelector(":scope > .page-streams");
    const curBlock = curPageEl.querySelector(":scope > .talmud-layout");
    for (const ns of candidates) {
      if (ns.dataset.talmudPulledBackwards) continue;
      if (getComputedStyle(ns).display === "none") continue;
      const h = ns.getBoundingClientRect().height;
      if (h === 0 || h >= gap - 20) continue;
      // Move entire stream to current page.
      ns.dataset.talmudPulledBackwards = "true";
      // Prefer page-streams (leftover area below talmud-layout).
      if (curStreamsWrap) {
        curStreamsWrap.appendChild(ns);
      } else if (curBlock) {
        curBlock.appendChild(ns);
      }
      gap = pageGap(curPageEl);
      pulled++;
    }
  }

  return pulled;
}

// Determines if a page is now visually empty (after pull-backward emptied it).
function isPageEffectivelyEmpty(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return false;
  // Visible text on the page (excluding hidden pulled-backward streams).
  let visibleText = "";
  block.querySelectorAll(":scope > *").forEach(el => {
    if (el.dataset.talmudPulledBackwards) return;
    if (getComputedStyle(el).display === "none") return;
    visibleText += (el.textContent || "");
  });
  return visibleText.trim().length === 0;
}

function hideEmptyPages(container) {
  let hidden = 0;
  container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)").forEach(p => {
    if (isPageEffectivelyEmpty(p)) {
      p.style.display = "none";
      p.dataset.talmudPageHidden = "true";
      hidden++;
    } else if (p.dataset.talmudPageHidden) {
      p.style.display = "";
      delete p.dataset.talmudPageHidden;
    }
  });
  return hidden;
}

export function pullBackwardAcrossAllPages(container) {
  if (!container) return 0;
  const pages = Array.from(
    container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)")
  );
  if (pages.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < pages.length - 1; i++) {
    total += pullOnePage(pages[i], pages[i + 1]);
  }
  // After pulling, hide any pages that became empty (no visible content left).
  hideEmptyPages(container);
  return total;
}
