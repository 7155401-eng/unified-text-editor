// talmud_overflow_repagination.js — v33 NEW APPROACH per משה + bot consensus.
//
// When a Talmud page overflows (scrollHeight > clientHeight + 1), the
// original engine packed too much content. Without modifying the engine,
// we MOVE the overflowing tail of MAIN text to the next page.
//
// IMPORTANT: This module touches ONLY page-main.talmud-main. It does NOT
// move streams (which caused word deletion last time). Stream content is
// preserved as-is.
//
// Algorithm per page:
//   1. Measure overflow.
//   2. If no overflow → done.
//   3. Walk main text BACKWARD removing whole words/sentences until page fits.
//   4. Insert removed text into the FRONT of next page's main.
//   5. Repeat for cascading.
//
// Lossless: text moves only between adjacent main blocks. No deletion.

import { logEvent, logMove } from "./settings_pane.js";

const MAX_PAGE_PASSES = 30; // generous

function pageHasOverflow(pageEl) {
  return pageEl.scrollHeight - pageEl.clientHeight > 1;
}

function findMain(pageEl) {
  return pageEl.querySelector(".page-main.talmud-main, .page-main");
}

// Walk back word-by-word until page fits. Move all walked-back words to
// destMain (next page's main). Returns number of words moved.
function trimMainUntilFits(pageEl, destMain) {
  const main = findMain(pageEl);
  if (!main || !destMain) return 0;
  let movedWords = 0;
  let safety = 5000;
  while (pageHasOverflow(pageEl) && safety-- > 0) {
    // Find the LAST text node in main with at least one word.
    const lastTextNode = findLastTextNode(main);
    if (!lastTextNode || !lastTextNode.nodeValue || !lastTextNode.nodeValue.trim()) {
      // No more text to move. If main is empty, stop.
      const childPara = main.lastElementChild;
      if (childPara && childPara.tagName === "P") {
        // Move the entire empty paragraph to next page (it might just have a comma).
        if (!destMain.firstElementChild) {
          destMain.appendChild(childPara);
        } else {
          destMain.insertBefore(childPara, destMain.firstChild);
        }
        movedWords++;
      } else {
        break;
      }
      continue;
    }
    const text = lastTextNode.nodeValue;
    // Find the last word boundary.
    let i = text.length;
    while (i > 0 && /\s/.test(text[i - 1])) i--; // skip trailing spaces
    if (i === 0) {
      lastTextNode.nodeValue = "";
      continue;
    }
    let wordEnd = i;
    while (i > 0 && !/\s/.test(text[i - 1])) i--;
    const word = text.substring(i, wordEnd);
    if (!word.trim()) break;
    // Remove word from current
    lastTextNode.nodeValue = text.substring(0, i);
    // Prepend to destMain's first text/paragraph
    prependWordToMain(destMain, word + " ");
    movedWords++;
  }
  return movedWords;
}

function findLastTextNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let last = null;
  let n;
  while ((n = walker.nextNode())) {
    if (n.nodeValue && n.nodeValue.trim()) last = n;
  }
  return last;
}

function prependWordToMain(destMain, word) {
  const firstP = destMain.firstElementChild;
  if (firstP && firstP.tagName === "P") {
    // Prepend to first paragraph's text content.
    const firstText = firstP.firstChild;
    if (firstText && firstText.nodeType === 3) {
      firstText.nodeValue = word + firstText.nodeValue;
    } else {
      firstP.insertBefore(document.createTextNode(word), firstP.firstChild);
    }
  } else {
    // No paragraph — wrap word in a new <p> at top.
    const p = document.createElement("p");
    p.dataset.talmudOverflowMoved = "1";
    p.textContent = word;
    destMain.insertBefore(p, destMain.firstChild);
  }
}

export function repaginateMainOverflow(container) {
  if (!container) return 0;
  const pages = Array.from(container.querySelectorAll(
    ".page.talmud-layout-page:not(.page-placeholder), .pages-container .page.talmud-layout-page:not(.page-placeholder)"
  ));
  if (pages.length < 2) return 0;
  let totalMoved = 0;
  let totalPagesFixed = 0;
  for (let pass = 0; pass < MAX_PAGE_PASSES; pass++) {
    let movedThisPass = false;
    for (let i = 0; i < pages.length - 1; i++) {
      const cur = pages[i];
      if (!pageHasOverflow(cur)) continue;
      const next = pages[i + 1];
      const nextMain = findMain(next);
      if (!nextMain) {
        // Next page has no main — create one (don't touch streams).
        // Skip for safety; user-side fix.
        continue;
      }
      const overflowBefore = cur.scrollHeight - cur.clientHeight;
      const moved = trimMainUntilFits(cur, nextMain);
      if (moved > 0) {
        totalMoved += moved;
        totalPagesFixed++;
        movedThisPass = true;
        logMove("repaginate-main-overflow", {
          el: findMain(cur),
          fromPage: parseInt(cur.dataset.pageIndex || String(i), 10),
          toPage: parseInt(next.dataset.pageIndex || String(i + 1), 10),
          trigger: `page overflow ${overflowBefore}px`,
          reason: `moved ${moved} words from main to next page main`,
        });
      }
    }
    if (!movedThisPass) break;
  }
  if (totalMoved > 0) {
    logEvent("overflow-repagination-summary", { wordsMoved: totalMoved, pagesFixed: totalPagesFixed });
  }
  return totalMoved;
}
