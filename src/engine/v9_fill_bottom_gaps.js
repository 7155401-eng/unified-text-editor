// v9_fill_bottom_gaps.js — V9 post-layout pass for real bottom-of-page blank space.
// This fixes vertical blank space at the bottom of V9 pages. It does not touch
// word spacing, browser justify, main text, side columns, or page height.

const EPS = 0.5;
const DEFAULT_BLANK_THRESHOLD_PX = 60;
const DEFAULT_BOTTOM_RESERVE_PX = 20;
const DEFAULT_MAX_PASSES = 4;
const FOOTER_GAP_PX = 10;

const px = (v, fb = 0) => {
  const n = Number.parseFloat(String(v || ""));
  return Number.isFinite(n) ? n : fb;
};

const topOf = (el) => px(el?.style?.top, el?.offsetTop || 0);
const leftOf = (el) => px(el?.style?.left, el?.offsetLeft || 0);
const widthOf = (el) => px(el?.style?.width, el?.getBoundingClientRect?.().width || 0);
const heightOf = (el) => px(el?.style?.height, el?.getBoundingClientRect?.().height || 0);
const bottomOf = (el) => topOf(el) + heightOf(el);

function setTop(el, top) {
  if (el?.style) el.style.top = `${Math.round(top * 100) / 100}px`;
}

function isHidden(el) {
  if (!el) return true;
  if (el.dataset?.talmudPageHidden || el.style?.display === "none") return true;
  try {
    return typeof getComputedStyle === "function" && getComputedStyle(el).display === "none";
  } catch {
    return false;
  }
}

function pagePadding(pageEl) {
  return px(pageEl?.style?.padding, 12);
}

function pageUsableBottom(pageEl) {
  const h = px(pageEl?.style?.height, pageEl?.clientHeight || 0);
  return h > 0 ? h - pagePadding(pageEl) : 0;
}

function roleOf(el) {
  return String(el?.dataset?.v9Role || "").toLowerCase();
}

function isFooterLine(el) {
  return el?.classList?.contains("v9-line") && roleOf(el) === "stream" && !isHidden(el);
}

function streamCodeOf(el) {
  return String(el?.dataset?.v9SourceStream || el?.dataset?.v9BoxId || "");
}

function titleStreamCode(titleEl) {
  const cls = Array.from(titleEl?.classList || []).find((c) => /^stream-color-\d+$/.test(c));
  const n = cls ? cls.match(/\d+/)?.[0] : "";
  return n ? String(Number.parseInt(n, 10)).padStart(2, "0") : "";
}

function isFooterTitle(pageEl, el) {
  if (!el?.classList?.contains("v9-stream-title")) return false;
  const pageW = px(pageEl?.style?.width, pageEl?.clientWidth || 0);
  const innerW = Math.max(0, pageW - pagePadding(pageEl) * 2);
  return innerW > 0 && leftOf(el) <= pagePadding(pageEl) + 4 && widthOf(el) >= innerW - 10;
}

function allContentBottom(pageEl) {
  let max = pagePadding(pageEl);
  for (const el of pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator")) {
    if (!isHidden(el)) max = Math.max(max, bottomOf(el));
  }
  return max;
}

function nonFooterBottom(pageEl) {
  let max = pagePadding(pageEl);
  for (const el of pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator")) {
    if (isHidden(el)) continue;
    if (isFooterLine(el) || isFooterTitle(pageEl, el)) continue;
    max = Math.max(max, bottomOf(el));
  }
  return max;
}

function bottomBlank(pageEl) {
  return pageUsableBottom(pageEl) - allContentBottom(pageEl);
}

function blockHeight(elements) {
  if (!elements?.length) return 0;
  return Math.max(...elements.map(bottomOf)) - Math.min(...elements.map(topOf));
}

function collectFooterSections(pageEl) {
  const items = Array.from(pageEl.querySelectorAll(".v9-stream-title, .v9-line"))
    .filter((el) => !isHidden(el))
    .sort((a, b) => topOf(a) - topOf(b) || leftOf(a) - leftOf(b));

  const sections = [];
  let current = null;

  for (const el of items) {
    if (el.classList?.contains("v9-stream-title")) {
      if (!isFooterTitle(pageEl, el)) continue;
      current = { code: titleStreamCode(el), title: el, lines: [] };
      sections.push(current);
      continue;
    }

    if (!isFooterLine(el)) continue;

    const code = streamCodeOf(el);
    if (!current || (current.code && code && current.code !== code)) {
      current = { code, title: null, lines: [] };
      sections.push(current);
    }
    if (current && !current.code && code) current.code = code;
    current.lines.push(el);
  }

  return sections.filter((s) => s.title || s.lines.length);
}

function currentFooterCodes(pageEl) {
  const codes = new Set();
  for (const line of pageEl.querySelectorAll('.v9-line[data-v9-role="stream"]')) {
    if (!isFooterLine(line)) continue;
    const code = streamCodeOf(line);
    if (code) codes.add(code);
  }
  return codes;
}

function chooseCandidate(currentPage, nextPage, availablePx, allowNewFooterStreams) {
  const currentCodes = currentFooterCodes(currentPage);
  const nextSections = collectFooterSections(nextPage);

  for (const section of nextSections) {
    const line = section.lines[0];
    if (!line) continue;
    const code = section.code || streamCodeOf(line);
    if (!code || !currentCodes.has(code)) continue;
    if (heightOf(line) <= availablePx + EPS) {
      return { code, elements: [line], reason: "same-stream-continuation", needsGap: false };
    }
  }

  if (!allowNewFooterStreams) return null;

  for (const section of nextSections) {
    const line = section.lines[0];
    if (!line) continue;
    const code = section.code || streamCodeOf(line);
    if (code && currentCodes.has(code)) continue;
    const elements = section.title ? [section.title, line] : [line];
    if (blockHeight(elements) + FOOTER_GAP_PX <= availablePx + EPS) {
      return { code, elements, reason: "new-footer-stream-start", needsGap: true };
    }
  }

  return null;
}

function moveCandidate(currentPage, nextPage, candidate, startTop) {
  const elements = candidate?.elements || [];
  if (!elements.length) return 0;

  const sourceTop = Math.min(...elements.map(topOf));
  for (const el of elements) {
    const rel = topOf(el) - sourceTop;
    currentPage.appendChild(el);
    setTop(el, startTop + rel);
    el.dataset.v9PulledFromNextPage = "1";
    el.dataset.v9PullReason = candidate.reason || "";
    el.dataset.v9PulledStream = candidate.code || "";
    el.dataset.v9PulledFromPage = nextPage.dataset.pageIndex || nextPage.dataset.page || "";
    el.dataset.v9PulledToPage = currentPage.dataset.pageIndex || currentPage.dataset.page || "";
  }
  return elements.length;
}

function compactFooter(pageEl) {
  const sections = collectFooterSections(pageEl);
  if (!sections.length) return 0;

  let y = Math.max(nonFooterBottom(pageEl) + FOOTER_GAP_PX, pagePadding(pageEl));
  let moved = 0;

  for (const section of sections) {
    const elements = section.title ? [section.title, ...section.lines] : [...section.lines];
    if (!elements.length) continue;

    const sourceTop = Math.min(...elements.map(topOf));
    for (const el of elements) {
      const oldTop = topOf(el);
      const newTop = y + (oldTop - sourceTop);
      if (Math.abs(newTop - oldTop) > EPS) {
        setTop(el, newTop);
        moved++;
      }
    }
    y += blockHeight(elements) + FOOTER_GAP_PX;
  }

  pageEl.dataset.v9FooterCompacted = String(moved);
  return moved;
}

const pageIndexOf = (pageEl) => pageEl?.dataset?.pageIndex || pageEl?.dataset?.page || "";

export function fillV9BottomGapsFromNextPages(container, options = {}) {
  if (!container?.querySelectorAll) return { moved: 0, pages: [] };

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

  const pages = Array.from(container.querySelectorAll(".page.v9-page, .v9-page"))
    .filter((page) => !isHidden(page));

  let totalMoved = 0;
  const reports = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    let movedThisPass = 0;

    for (let i = 0; i < pages.length - 1; i++) {
      const currentPage = pages[i];
      const nextPage = pages[i + 1];

      const blankBefore = bottomBlank(currentPage);
      let blank = blankBefore;
      let movedForPage = 0;
      const pulls = [];

      while (blank > blankThresholdPx) {
        const available = blank - bottomReservePx;
        if (available <= 0) break;

        const candidate = chooseCandidate(currentPage, nextPage, available, allowNewFooterStreams);
        if (!candidate) break;

        let startTop = allContentBottom(currentPage);
        if (candidate.needsGap) startTop += FOOTER_GAP_PX;

        const moved = moveCandidate(currentPage, nextPage, candidate, startTop);
        if (!moved) break;

        compactFooter(nextPage);
        totalMoved += moved;
        movedThisPass += moved;
        movedForPage += moved;
        pulls.push({ stream: candidate.code || "", reason: candidate.reason, elements: moved });

        blank = bottomBlank(currentPage);
      }

      const report = movedForPage > 0
        ? {
            pageIndex: pageIndexOf(currentPage),
            fromPageIndex: pageIndexOf(nextPage),
            moved: movedForPage,
            blankBefore: Math.round(blankBefore * 100) / 100,
            blankAfter: Math.round(bottomBlank(currentPage) * 100) / 100,
            pulls,
          }
        : {
            pageIndex: pageIndexOf(currentPage),
            moved: 0,
            blank: Math.round(blankBefore * 100) / 100,
            reason: blankBefore > blankThresholdPx ? "no-safe-candidate" : "below-threshold",
          };

      currentPage.dataset.v9PageFill = JSON.stringify(report);
      if (movedForPage > 0) reports.push(report);
    }

    if (movedThisPass === 0) break;
  }

  const result = { moved: totalMoved, changedPages: reports.length, pages: reports };
  container.dataset.v9PageFill = JSON.stringify({
    moved: result.moved,
    changedPages: result.changedPages,
  });

  if (typeof window !== "undefined") window.__ravtextLastV9PageFill = result;
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-fill-bottom-gaps]", result);
  }

  return result;
}
