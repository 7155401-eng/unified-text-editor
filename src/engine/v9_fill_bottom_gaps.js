// v9_fill_bottom_gaps.js — post-layout V9 page-fill pass.
//
// Purpose:
//   Fill large visual blank space at the bottom of V9 pages by pulling safe
//   footer-stream content from the next page into the current page.
//
// This pass intentionally does NOT touch:
//   - main text
//   - side columns
//   - browser justification / word spacing
//   - page height
//
// It only moves V9 footer stream rows that are already rendered in the next page.

const EPS = 0.5;
const DEFAULT_BLANK_THRESHOLD_PX = 60;
const DEFAULT_BOTTOM_RESERVE_PX = 20;
const DEFAULT_MAX_PASSES = 4;
const INTER_STREAM_GAP_PX = 10;

function px(value, fallback = 0) {
  const n = Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
}

function topOf(el) {
  return px(el?.style?.top, el?.offsetTop || 0);
}

function leftOf(el) {
  return px(el?.style?.left, el?.offsetLeft || 0);
}

function widthOf(el) {
  return px(el?.style?.width, el?.getBoundingClientRect?.().width || 0);
}

function heightOf(el) {
  return px(el?.style?.height, el?.getBoundingClientRect?.().height || 0);
}

function bottomOf(el) {
  return topOf(el) + heightOf(el);
}

function setTop(el, top) {
  if (!el?.style) return;
  el.style.top = `${Math.round(top * 100) / 100}px`;
}

function pageHeight(pageEl) {
  return px(pageEl?.style?.height, pageEl?.clientHeight || 0);
}

function pageWidth(pageEl) {
  return px(pageEl?.style?.width, pageEl?.clientWidth || 0);
}

function pagePadding(pageEl) {
  return px(pageEl?.style?.padding, 12);
}

function pageUsableBottom(pageEl) {
  const h = pageHeight(pageEl);
  return h > 0 ? h - pagePadding(pageEl) : 0;
}

function isHidden(el) {
  if (!el) return true;
  if (el.dataset?.talmudPageHidden) return true;
  if (el.style?.display === "none") return true;
  try {
    return typeof getComputedStyle === "function" && getComputedStyle(el).display === "none";
  } catch {
    return false;
  }
}

function isV9Line(el) {
  return el?.classList?.contains("v9-line");
}

function roleOf(el) {
  return String(el?.dataset?.v9Role || "").toLowerCase();
}

function isFooterStreamLine(el) {
  return isV9Line(el) && roleOf(el) === "stream" && !isHidden(el);
}

function streamCodeOfLine(el) {
  return String(
    el?.dataset?.v9SourceStream ||
    el?.dataset?.v9BoxId ||
    ""
  );
}

function streamCodeFromColorClass(el) {
  const cls = Array.from(el?.classList || []).find((c) => /^stream-color-\d+$/.test(c));
  const n = cls ? cls.match(/\d+/)?.[0] : "";
  return n ? String(Number.parseInt(n, 10)).padStart(2, "0") : "";
}

function innerWidthOf(pageEl) {
  return Math.max(0, pageWidth(pageEl) - pagePadding(pageEl) * 2);
}

function isFullWidthFooterTitle(pageEl, titleEl) {
  if (!titleEl?.classList?.contains("v9-stream-title")) return false;

  const padding = pagePadding(pageEl);
  const innerWidth = innerWidthOf(pageEl);
  if (innerWidth <= 0) return false;

  return (
    leftOf(titleEl) <= padding + 4 &&
    widthOf(titleEl) >= innerWidth - 10
  );
}

function nonFooterContentBottom(pageEl) {
  let max = pagePadding(pageEl);

  for (const el of pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator")) {
    if (isHidden(el)) continue;
    if (isFooterStreamLine(el)) continue;
    if (isFullWidthFooterTitle(pageEl, el)) continue;
    max = Math.max(max, bottomOf(el));
  }

  return max;
}

function allContentBottom(pageEl) {
  let max = pagePadding(pageEl);

  for (const el of pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator")) {
    if (isHidden(el)) continue;
    max = Math.max(max, bottomOf(el));
  }

  return max;
}

function bottomBlank(pageEl) {
  const usable = pageUsableBottom(pageEl);
  if (usable <= 0) return 0;
  return usable - allContentBottom(pageEl);
}

function blockHeight(elements) {
  if (!elements?.length) return 0;
  const minTop = Math.min(...elements.map(topOf));
  const maxBottom = Math.max(...elements.map(bottomOf));
  return maxBottom - minTop;
}

function collectFooterSections(pageEl) {
  if (!pageEl?.querySelectorAll) return [];

  const items = Array.from(pageEl.querySelectorAll(".v9-stream-title, .v9-line"))
    .filter((el) => !isHidden(el))
    .sort((a, b) => topOf(a) - topOf(b) || leftOf(a) - leftOf(b));

  const sections = [];
  let current = null;

  for (const el of items) {
    if (el.classList?.contains("v9-stream-title")) {
      if (!isFullWidthFooterTitle(pageEl, el)) continue;

      const code = streamCodeFromColorClass(el);
      current = { code, title: el, lines: [] };
      sections.push(current);
      continue;
    }

    if (!isFooterStreamLine(el)) continue;

    const code = streamCodeOfLine(el);
    if (!current || (current.code && code && current.code !== code)) {
      current = { code, title: null, lines: [] };
      sections.push(current);
    } else if (current && !current.code && code) {
      current.code = code;
    }

    current.lines.push(el);
  }

  return sections.filter((section) => section.title || section.lines.length > 0);
}

function existingFooterStreamCodes(pageEl) {
  const codes = new Set();

  for (const line of pageEl.querySelectorAll('.v9-line[data-v9-role="stream"]')) {
    if (!isFooterStreamLine(line)) continue;
    const code = streamCodeOfLine(line);
    if (code) codes.add(code);
  }

  return codes;
}

function choosePullCandidate(currentPage, nextPage, availablePx, options = {}) {
  const allowNewFooterStreams = options.allowNewFooterStreams !== false;
  const currentCodes = existingFooterStreamCodes(currentPage);
  const nextSections = collectFooterSections(nextPage);

  // First and safest: continue a footer stream that already appears on the current page.
  for (const section of nextSections) {
    const firstLine = section.lines[0];
    if (!firstLine) continue;

    const code = section.code || streamCodeOfLine(firstLine);
    if (!code || !currentCodes.has(code)) continue;

    const h = heightOf(firstLine);
    if (h <= availablePx + EPS) {
      return {
        code,
        elements: [firstLine],
        reason: "same-stream-continuation",
        needsGapBefore: false,
      };
    }
  }

  // Second: start a new footer stream only when its title + first line fit safely.
  if (!allowNewFooterStreams) return null;

  for (const section of nextSections) {
    const firstLine = section.lines[0];
    if (!firstLine) continue;

    const code = section.code || streamCodeOfLine(firstLine);
    if (code && currentCodes.has(code)) continue;

    const elements = [];
    if (section.title) elements.push(section.title);
    elements.push(firstLine);

    const h = blockHeight(elements) + INTER_STREAM_GAP_PX;
    if (h <= availablePx + EPS) {
      return {
        code,
        elements,
        reason: "new-footer-stream-start",
        needsGapBefore: true,
      };
    }
  }

  return null;
}

function moveBlockToPage({ currentPage, nextPage, candidate, startTop }) {
  const elements = candidate?.elements || [];
  if (!elements.length) return 0;

  const sourceMinTop = Math.min(...elements.map(topOf));
  let moved = 0;

  for (const el of elements) {
    const relativeTop = topOf(el) - sourceMinTop;
    currentPage.appendChild(el);
    setTop(el, startTop + relativeTop);

    el.dataset.v9PulledFromNextPage = "1";
    el.dataset.v9PullReason = candidate.reason || "";
    el.dataset.v9PulledStream = candidate.code || "";
    el.dataset.v9PulledFromPage = nextPage.dataset.pageIndex || nextPage.dataset.page || "";
    el.dataset.v9PulledToPage = currentPage.dataset.pageIndex || currentPage.dataset.page || "";
    moved++;
  }

  return moved;
}

function compactFooterOnPage(pageEl) {
  const sections = collectFooterSections(pageEl);
  if (!sections.length) return 0;

  let y = Math.max(
    nonFooterContentBottom(pageEl) + INTER_STREAM_GAP_PX,
    pagePadding(pageEl)
  );

  let moved = 0;

  for (const section of sections) {
    const elements = [];
    if (section.title) elements.push(section.title);
    elements.push(...section.lines);

    if (!elements.length) continue;

    const sourceMinTop = Math.min(...elements.map(topOf));

    for (const el of elements) {
      const oldTop = topOf(el);
      const relativeTop = oldTop - sourceMinTop;
      const newTop = y + relativeTop;

      if (Math.abs(newTop - oldTop) > EPS) {
        setTop(el, newTop);
        moved++;
      }
    }

    y += blockHeight(elements) + INTER_STREAM_GAP_PX;
  }

  pageEl.dataset.v9FooterCompacted = String(moved);
  return moved;
}

function pageIndexOf(pageEl) {
  return pageEl?.dataset?.pageIndex || pageEl?.dataset?.page || "";
}

export function fillV9BottomGapsFromNextPages(container, options = {}) {
  if (!container?.querySelectorAll) {
    return { moved: 0, pages: [] };
  }

  const blankThresholdPx = Number.isFinite(Number(options.blankThresholdPx))
    ? Number(options.blankThresholdPx)
    : DEFAULT_BLANK_THRESHOLD_PX;

  const bottomReservePx = Number.isFinite(Number(options.bottomReservePx))
    ? Number(options.bottomReservePx)
    : DEFAULT_BOTTOM_RESERVE_PX;

  const maxPasses = Number.isFinite(Number(options.maxPasses))
    ? Number(options.maxPasses)
    : DEFAULT_MAX_PASSES;

  const allowNewFooterStreams = options.allowNewFooterStreams !== false;

  const pages = Array.from(
    container.querySelectorAll(".page.v9-page, .v9-page")
  ).filter((page) => !isHidden(page));

  let totalMoved = 0;
  const pageReports = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    let movedThisPass = 0;

    for (let i = 0; i < pages.length - 1; i++) {
      const currentPage = pages[i];
      const nextPage = pages[i + 1];

      let blankBefore = bottomBlank(currentPage);
      const originalBlank = blankBefore;
      let movedForPage = 0;
      const pulls = [];

      while (blankBefore > blankThresholdPx) {
        const available = blankBefore - bottomReservePx;
        if (available <= 0) break;

        const candidate = choosePullCandidate(currentPage, nextPage, available, {
          allowNewFooterStreams,
        });
        if (!candidate) break;

        let startTop = allContentBottom(currentPage);
        if (candidate.needsGapBefore) op = startTop = startTop + INTER_STREAM_GAP_PX;

        const movedNow = moveBlockToPage({
          currentPage,
          nextPage,
          candidate,
          startTop,
        });

        if (!movedNow) break;

        compactFooterOnPage(nextPage);

        totalMoved += movedNow;
        movedThisPass += movedNow;
        movedForPage += movedNow;
        pulls.push({
          stream: candidate.code || "",
          reason: candidate.reason || "",
          elements: movedNow,
        });

        blankBefore = bottomBlank(currentPage);
      }

      if (movedForPage > 0) {
        const report = {
          pageIndex: pageIndexOf(currentPage),
          fromPageIndex: pageIndexOf(nextPage),
          moved: movedForPage,
          blankBefore: Math.round(originalBlank * 100) / 100,
          blankAfter: Math.round(bottomBlank(currentPage) * 100) / 100,
          pulls,
        };

        currentPage.dataset.v9PageFill = JSON.stringify(report);
        pageReports.push(report);
      } else {
        currentPage.dataset.v9PageFill = JSON.stringify({
          pageIndex: pageIndexOf(currentPage),
          moved: 0,
          blank: Math.round(blankBefore * 100) / 100,
          reason: blankBefore > blankThresholdPx ? "no-safe-candidate" : "below-threshold",
        });
      }
    }

    if (movedThisPass === 0) break;
  }

  const result = {
    moved: totalMoved,
    changedPages: pageReports.length,
    pages: pageReports,
  };

  container.dataset.v9PageFill = JSON.stringify({
    moved: result.moved,
    changedPages: result.changedPages,
  });

  if (typeof window !== "undefined") {
    window.__ravtextLastV9PageFill = result;
  }

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-fill-bottom-gaps]", result);
  }

  return result;
}
