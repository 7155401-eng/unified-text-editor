import { logMove, logEvent } from "./settings_pane.js";

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
  // משה 2026-05-06: גם כשאין talmud-layout block (זרמים שלא 01/02), נמדוד
  // את הרווח התחתון לפי האלמנט הנמוך ביותר בעמוד.
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (block) {
    return pageEl.getBoundingClientRect().bottom - block.getBoundingClientRect().bottom;
  }
  // fallback: מצא את התחתון של page-streams או page-main
  const streams = pageEl.querySelector(":scope > .page-streams");
  const main = pageEl.querySelector(":scope > .page-main");
  let bottom = pageEl.getBoundingClientRect().top;
  if (streams) bottom = Math.max(bottom, streams.getBoundingClientRect().bottom);
  if (main) bottom = Math.max(bottom, main.getBoundingClientRect().bottom);
  return Math.max(0, pageEl.getBoundingClientRect().bottom - bottom);
}

function findBodyByCode(pageEl, code) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return null;
  // v33-restructure: bodies may be nested inside .page-main, not just direct
  // children of block. Use deep query.
  return block.querySelector(
    `.talmud-body-portion[data-talmud-body-of="${code}"], ` +
    `.talmud-body-expanded[data-talmud-body-of="${code}"]`
  );
}

function bodyCodes(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return [];
  return Array.from(block.querySelectorAll(
    ".talmud-body-portion[data-talmud-body-of], " +
    ".talmud-body-expanded[data-talmud-body-of]"
  )).map(el => el.dataset.talmudBodyOf).filter(Boolean);
}

// משה 2026-05-06: עדיפות 1 = אסור רווחים. עדיפות 2 = הצמדת הערות לראשי.
// כלל: הערות אסור שיופיעו לפני הראשי שלהן, אבל ראשי יכול להופיע לפני
// הערותיו (ההערות עוברות לעמוד הבא). לכן כשיש רווח: קודם מנסים למשוך
// טקסט ראשי מהעמוד הבא — גם אם הערותיו נשארות שם.
function pullMainParagraph(curPageEl, nextPageEl) {
  const curMain = curPageEl.querySelector(":scope > .page-main, :scope .page-main.talmud-main");
  const nextMain = nextPageEl.querySelector(":scope > .page-main, :scope .page-main.talmud-main");
  if (!curMain || !nextMain) return false;
  // קח את הפסקה/כותרת הראשונה של ראשי הבא ולא של גוף.
  const candidates = Array.from(nextMain.children).filter(c =>
    !c.classList?.contains("talmud-body-portion") &&
    !c.classList?.contains("talmud-body-expanded") &&
    !c.classList?.contains("stream") &&
    /^(P|H[1-6]|DIV|BLOCKQUOTE|PRE)$/i.test(c.tagName)
  );
  const first = candidates[0];
  if (!first) return false;
  const childH = first.getBoundingClientRect().height;
  const gap = pageGap(curPageEl);
  // אם הפסקה גדולה מהרווח, לא מעבירים — כדי לא לחרוג.
  if (childH >= gap - 10) return false;
  const fromIdx = parseInt(curPageEl.dataset.pageIndex || "?", 10);
  const toIdx = parseInt(nextPageEl.dataset.pageIndex || "?", 10);
  logMove("pull-main-forward", {
    el: first,
    fromPage: toIdx, toPage: fromIdx,
    trigger: `gap > ${GAP_THRESHOLD_PX}px on current page`,
    reason: `priority 1 = no gaps; main paragraph fits (${Math.round(childH)}px in ${Math.round(gap)}px gap)`,
  });
  // הזכרון של מיקום מקורי לחזרה אם התעלפה חריגה
  const prevSibling = first.nextSibling;
  curMain.appendChild(first);
  // בדיקת חריגה: אם אחרי ההעברה הדף חורג, מבטלים.
  void curPageEl.offsetHeight;
  const overflow = curPageEl.scrollHeight - curPageEl.clientHeight;
  if (overflow > 5) {
    // החזר את הפסקה למקומה
    if (prevSibling) nextMain.insertBefore(first, prevSibling);
    else nextMain.appendChild(first);
    return false;
  }
  return true;
}

function pullOnePage(curPageEl, nextPageEl) {
  let gap = pageGap(curPageEl);
  if (gap <= GAP_THRESHOLD_PX) return 0;

  let pulled = 0;

  // STRATEGY 0 (highest priority per משה 2026-05-06): pull MAIN TEXT first.
  // Notes can be left on next page; main can lead its notes by a page.
  for (let safety = 0; safety < CHUNK_LIMIT && gap > GAP_THRESHOLD_PX; safety++) {
    const moved = pullMainParagraph(curPageEl, nextPageEl);
    if (!moved) break;
    pulled++;
    gap = pageGap(curPageEl);
  }

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
        const fromIdx = parseInt(curPageEl.dataset.pageIndex || "?", 10);
        const toIdx = parseInt(nextPageEl.dataset.pageIndex || "?", 10);
        logMove("pull-backward-chunk", {
          el: first,
          fromPage: toIdx, toPage: fromIdx, // pulling FROM next TO current
          trigger: "gap > 100px in current page",
          reason: `gap was ${Math.round(gap)}px, child height ${Math.round(childH)}px fits`,
        });
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
            const fromIdx = parseInt(nextPageEl.dataset.pageIndex || "?", 10);
            const toIdx = parseInt(curPageEl.dataset.pageIndex || "?", 10);
            logMove("pull-backward-merge-stream", {
              el: ns,
              fromPage: fromIdx, toPage: toIdx,
              trigger: "next page has small content that fits in current gap",
              reason: `merging stream ${code} into matching stream on previous page`,
            });
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

  // STRATEGY 3 DISABLED (משה: word מהרבות deletion bug):
  // Moving entire streams between pages risked losing content when source
  // ledger restoration interacted oddly with cross-page merges. Until we
  // can prove no content is lost, this strategy is OFF. Strategy 1+2 still run.

  return pulled;
}

// Determines if a page is now visually empty (after pull-backward emptied it).
// v33-fix per משה: also count main text and page-streams content. We must
// NEVER hide a page that still has visible text of any kind.
function isPageEffectivelyEmpty(pageEl) {
  let visibleText = "";
  // Walk all direct + nested elements, skip those marked as pulled-backwards
  // or display:none. Count every visible text node.
  const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => {
      if (el.dataset && el.dataset.talmudPulledBackwards) return NodeFilter.FILTER_REJECT;
      if (typeof getComputedStyle === "function" && getComputedStyle(el).display === "none") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let n;
  while ((n = walker.nextNode())) {
    // Only count direct text from this element to avoid double counting.
    for (const child of n.childNodes) {
      if (child.nodeType === 3 /* TEXT_NODE */) visibleText += child.textContent;
    }
    if (visibleText.trim().length > 5) return false; // early exit
  }
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

// v33: shrink page height to its actual content height. The engine sets all
// pages to a fixed height (e.g. 537px) but in talmud mode many pages have
// less content. Without touching the engine's page allocation, we just shrink
// the visible page to fit its content — eliminating the visual gap entirely.
// Lossless: content unchanged. Reversible (engine resets on next render).
function shrinkPagesToContent(container) {
  let shrunk = 0;
  container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)").forEach(p => {
    if (p.dataset.talmudPageHidden) return;
    const block = p.querySelector(":scope > .talmud-layout");
    if (!block) {
      if (p.dataset.talmudPageShrunk) {
        p.style.flex = ""; p.style.height = ""; p.style.minHeight = "";
        delete p.dataset.talmudPageShrunk;
      }
      return;
    }
    if (p.querySelector("[data-talmud-capped-at]")) return;
    // v33: skip if any visible OVERFLOW exists (content beyond page bottom).
    // We measure overflow BEFORE shrinking, in original page bounds.
    if (p.scrollHeight > p.clientHeight + 2) return;

    // Compute the true bottom of all rendered content using getBoundingClientRect
    // on the deepest visible descendants. Floats may extend below their parent.
    const pageRect = p.getBoundingClientRect();
    let maxBottom = pageRect.top; // start from page top
    p.querySelectorAll("*").forEach(el => {
      if (getComputedStyle(el).display === "none") return;
      const r = el.getBoundingClientRect();
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    });
    const actualNeeded = maxBottom - pageRect.top;
    const orig = p.clientHeight;
    if (actualNeeded > 0 && actualNeeded + 8 < orig) {
      const target = Math.ceil(actualNeeded + 8);
      logEvent("page-shrink", {
        page: p.dataset.pageIndex || "?",
        from: orig, to: target, saved: orig - target,
      });
      // v33: shrink the page AND set overflow:visible so any miscalculation
      // doesn't clip content (lossless visual).
      p.style.flex = `0 0 ${target}px`;
      p.style.height = `${target}px`;
      p.style.minHeight = "auto";
      p.style.overflow = "visible";
      p.dataset.talmudPageShrunk = String(orig);
      shrunk++;
    } else if (p.dataset.talmudPageShrunk) {
      p.style.flex = ""; p.style.height = ""; p.style.minHeight = ""; p.style.overflow = "";
      delete p.dataset.talmudPageShrunk;
    }
  });
  return shrunk;
}

// v33-fix: per משה, hiding orphan titles is WRONG. Instead, when a stream's
// title appears on a page with < 2 visible lines of content, MOVE the entire
// stream to the next page's leftover area. The engine doesn't natively know
// to do this; we do it post-process.
function moveOrphanStreamsToNextPage(container) {
  let moved = 0;
  const pages = Array.from(container.querySelectorAll(
    ".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)"
  ));
  for (let i = 0; i < pages.length - 1; i++) {
    const cur = pages[i];
    const next = pages[i + 1];
    // Find streams on `cur` whose title is orphan (title + <2 lines below).
    const streams = Array.from(cur.querySelectorAll(".talmud-layout .stream, .page-streams > .stream"));
    for (const s of streams) {
      const totalText = (s.textContent || "").trim();
      if (totalText.length < 30) continue;
      const title = s.querySelector(":scope > .stream-title");
      if (!title) continue;
      const titleBottom = title.getBoundingClientRect().bottom;
      const range = document.createRange();
      range.selectNodeContents(s);
      const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
      const below = rects.filter(r => r.top > titleBottom + 2);
      const visualLines = new Set(below.map(r => Math.round(r.top))).size;
      if (visualLines >= 2) continue;
      // Orphan — move whole stream to next page's leftover area.
      const nextStreams = next.querySelector(":scope > .page-streams");
      if (!nextStreams) continue;
      // Avoid duplication: if next page already has a stream with same code at top,
      // prepend our content to it; otherwise insert as first.
      const code = s.getAttribute("data-stream") || "";
      const existing = code ? nextStreams.querySelector(`:scope > .stream[data-stream="${code}"]`) : null;
      if (existing) {
        // Merge: skip our title, prepend rest of children to existing.
        const ourTitle = s.querySelector(":scope > .stream-title");
        if (ourTitle) ourTitle.remove();
        const exTitle = existing.querySelector(":scope > .stream-title");
        const insertBefore = exTitle ? exTitle.nextSibling : existing.firstChild;
        while (s.firstChild) existing.insertBefore(s.firstChild, insertBefore);
        s.remove();
      } else {
        // Move whole stream to top of next page.
        nextStreams.insertBefore(s, nextStreams.firstChild);
        s.dataset.talmudMovedFromPrevPage = "true";
      }
      moved++;
    }
  }
  return moved;
}

// Bug 4 fix: מודד את הפער הויזואלי בין תחתית talmud-layout block לראש
// page-streams בעמוד נתון. אם הפער > 5px = יש "רווח לבן באמצע" שאסור
// לפי כלל 2 של משה ("פגישה באמצע").
function computeMiddleGap(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  const ps = pageEl.querySelector(":scope > .page-streams");
  if (!block || !ps) return 0;
  // לא לטפל אם page-streams ריק (לא יוצר חזות של פער)
  const visibleStreams = Array.from(ps.querySelectorAll(":scope > .stream"))
    .filter(s => {
      if (s.dataset?.talmudPulledBackwards) return false;
      if (typeof getComputedStyle === "function" && getComputedStyle(s).display === "none") return false;
      return (s.textContent || "").trim().length > 0;
    });
  if (visibleStreams.length === 0) return 0;
  const blockBottom = block.getBoundingClientRect().bottom;
  const psTop = ps.getBoundingClientRect().top;
  const gap = psTop - blockBottom;
  return gap > 0 ? gap : 0;
}

// Bug 4 fix: מעביר אלמנט אחד משטרים בעמוד הבא לתוך אותו זרם בעמוד הנוכחי.
// בטיחות: רק אלמנטים שלמים (לא חיתוך טקסט/מילים), רק כשהזרם יעד קיים,
// וביטול אוטומטי אם ההעברה גורמת לחריגה מגבולות העמוד.
function moveOneStreamItemBackward(curPageEl, nextPageEl) {
  const curPS = curPageEl.querySelector(":scope > .page-streams");
  const nextPS = nextPageEl.querySelector(":scope > .page-streams");
  if (!curPS || !nextPS) return false;
  const curStreams = Array.from(curPS.querySelectorAll(":scope > .stream[data-stream]"));
  for (const curStream of curStreams) {
    const code = curStream.getAttribute("data-stream");
    if (!code) continue;
    const nextStream = nextPS.querySelector(`:scope > .stream[data-stream="${code}"]`);
    if (!nextStream) continue;
    // מצא את האלמנט הראשון שאינו stream-title להעברה
    const candidates = Array.from(nextStream.children).filter(c =>
      !c.classList?.contains("stream-title")
    );
    const first = candidates[0];
    if (!first) continue;
    // snapshot למקרה ביטול
    const prevSibling = first.nextSibling;
    curStream.appendChild(first);
    void curPageEl.offsetHeight;
    const overflow = curPageEl.scrollHeight - curPageEl.clientHeight;
    if (overflow > 5) {
      // ביטול: החזר למקום
      if (prevSibling) nextStream.insertBefore(first, prevSibling);
      else nextStream.appendChild(first);
      return false;
    }
    logMove("pull-forward-middle-gap", {
      el: first,
      fromPage: parseInt(nextPageEl.dataset.pageIndex || "?", 10),
      toPage: parseInt(curPageEl.dataset.pageIndex || "?", 10),
      trigger: `middle gap > 5px on current page`,
      reason: `closing white-space between main and page-streams (Moshe rule 2)`,
    });
    return true;
  }
  return false;
}

// Bug 4 fix: ממלא את הפער הויזואלי באמצע העמוד (בין הראשי לזרמים התחתונים)
// ע"י משיכת תוכן מהעמוד הבא. אסור רווח לבן באמצע — כלל 2 של משה.
export function pullForwardWhenGap(container) {
  if (!container) return 0;
  const pages = Array.from(
    container.querySelectorAll(".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)")
  );
  if (pages.length < 2) return 0;
  let totalMoved = 0;
  for (let i = 0; i < pages.length - 1; i++) {
    const cur = pages[i];
    const next = pages[i + 1];
    let safety = 100;
    while (safety-- > 0) {
      const gap = computeMiddleGap(cur);
      if (gap < 5) break;
      const moved = moveOneStreamItemBackward(cur, next);
      if (!moved) break;
      totalMoved++;
    }
  }
  return totalMoved;
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
  // Bug 4: גם פערים באמצע עמוד צריכים מילוי, לא רק bottom-gap.
  total += pullForwardWhenGap(container);
  // After pulling, hide any pages that became empty (no visible content left).
  hideEmptyPages(container);
  // moveOrphanStreamsToNextPage DISABLED (suspected source of word deletion).
  // moveOrphanStreamsToNextPage(container);
  // shrinkPagesToContent DISABLED per משה: pages should be FILLED with content,
  // not made smaller. Smaller pages instead of full pages = wrong solution.
  // The right fix is to push more content into pages so they fill naturally.
  // shrinkPagesToContent(container);
  return total;
}
