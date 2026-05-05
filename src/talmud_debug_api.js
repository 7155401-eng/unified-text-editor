function rectOf(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
  };
}

function rectsOverlap(a, b, pad = 1) {
  if (!a || !b) return false;
  return a.x < b.right - pad &&
    a.right > b.x + pad &&
    a.y < b.bottom - pad &&
    a.bottom > b.y + pad;
}

function styleOf(el) {
  const s = getComputedStyle(el);
  return {
    display: s.display,
    position: s.position,
    float: s.float,
    clear: s.clear,
    width: s.width,
    maxWidth: s.maxWidth,
    height: s.height,
    margin: s.margin,
    marginLeft: s.marginLeft,
    marginRight: s.marginRight,
    overflow: s.overflow,
    gridColumn: s.gridColumn,
    gridTemplateColumns: s.gridTemplateColumns,
    columnCount: s.columnCount,
    columnGap: s.columnGap,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    direction: s.direction,
    textAlign: s.textAlign,
    textAlignLast: s.textAlignLast,
    padding: s.padding,
  };
}

function labelOf(el) {
  if (!el) return null;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || "",
    className: el.className || "",
    stream: el.dataset?.stream || "",
    talmudRole: el.dataset?.talmudRole || "",
    talmudClone: el.dataset?.talmudClone || "",
    talmudSide: el.dataset?.talmudSide || "",
    mishnaRole: el.dataset?.mishnaRole || "",
  };
}

function collectPage(page, pageIndex) {
  const pageRect = rectOf(page);
  const talmudBlocks = Array.from(page.querySelectorAll(":scope > .talmud-layout"));
  const crowns = Array.from(page.querySelectorAll(".talmud-crown"));
  const bodies = Array.from(page.querySelectorAll(".talmud-body"));
  const streams = Array.from(page.querySelectorAll(".stream"));

  return {
    pageIndex,
    page: labelOf(page),
    pageRect,
    talmudBlockCount: talmudBlocks.length,
    talmudBlocks: talmudBlocks.map((block) => ({
      label: labelOf(block),
      rect: rectOf(block),
      style: styleOf(block),
      directMainCount: block.querySelectorAll(":scope > .page-main").length,
      nestedMainCount: block.querySelectorAll(".page-main").length,
      crownCount: block.querySelectorAll(":scope > .talmud-crown").length,
      bodyCount: block.querySelectorAll(":scope > .talmud-body").length,
    })),
    crowns: crowns.map((crown) => ({
      label: labelOf(crown),
      rect: rectOf(crown),
      style: styleOf(crown),
      children: Array.from(crown.children).map((child) => ({
        label: labelOf(child),
        rect: rectOf(child),
        style: styleOf(child),
        text: (child.textContent || "").trim().slice(0, 180),
      })),
    })),
    bodies: bodies.map((body) => ({
      label: labelOf(body),
      rect: rectOf(body),
      style: styleOf(body),
      children: Array.from(body.children).map((child) => ({
        label: labelOf(child),
        rect: rectOf(child),
        style: styleOf(child),
        text: (child.textContent || "").trim().slice(0, 120),
      })),
    })),
    streams: streams.map((stream) => ({
      label: labelOf(stream),
      parent: labelOf(stream.parentElement),
      rect: rectOf(stream),
      style: styleOf(stream),
      overflowX: pageRect ? rectOf(stream).x < pageRect.x - 1 || rectOf(stream).right > pageRect.right + 1 : false,
      overflowY: pageRect ? rectOf(stream).y < pageRect.y - 1 || rectOf(stream).bottom > pageRect.bottom + 1 : false,
      text: (stream.textContent || "").trim().slice(0, 160),
    })),
  };
}

function snapshot(limit = 12) {
  const pages = Array.from(document.querySelectorAll(".page:not(.page-placeholder)"));
  return {
    at: new Date().toISOString(),
    url: location.href,
    bodyClass: document.body.className,
    pageCount: pages.length,
    pages: pages.slice(0, limit).map((page, idx) => collectPage(page, idx)),
  };
}

function findProblems(data = snapshot()) {
  const problems = [];
  for (const page of data.pages || []) {
    if (page.talmudBlockCount > 1) {
      problems.push({ type: "MULTIPLE_TALMUD_BLOCKS", pageIndex: page.pageIndex, count: page.talmudBlockCount });
    }

    for (const block of page.talmudBlocks || []) {
      if (block.style.padding !== "0px") {
        problems.push({ type: "TALMUD_BLOCK_HAS_PADDING", pageIndex: page.pageIndex, padding: block.style.padding });
      }
      if (block.nestedMainCount !== 1) {
        const hasCommentary = page.streams.some((stream) => stream.parent?.className?.includes("talmud-layout") && stream.label.className.includes("talmud-commentary"));
        if (!(block.nestedMainCount === 0 && hasCommentary)) {
          problems.push({ type: "BAD_MAIN_COUNT_IN_TALMUD_BLOCK", pageIndex: page.pageIndex, count: block.nestedMainCount });
        }
      }
      if (block.bodyCount > 1) {
        problems.push({ type: "BAD_BODY_COUNT_IN_TALMUD_BLOCK", pageIndex: page.pageIndex, count: block.bodyCount });
      }
    }

    const bodyStreams = page.streams.filter((stream) => stream.parent?.className?.includes("talmud-layout") && stream.label.tag === "div" && stream.label.className.includes("stream"));
    const brokenBodyStreams = bodyStreams.filter((stream) => !stream.label.talmudRole && !stream.label.className.includes("talmud-commentary"));
    brokenBodyStreams.forEach((stream) => {
      problems.push({ type: "TALMUD_BODY_STREAM_UNMARKED", pageIndex: page.pageIndex, stream: stream.label.stream, className: stream.label.className, rect: stream.rect, style: stream.style });
    });
    page.streams.filter((stream) => stream.label.talmudRole).forEach((stream) => {
      if (stream.overflowX || stream.overflowY) {
        problems.push({ type: "STREAM_OVERFLOW", pageIndex: page.pageIndex, stream: stream.label.stream, role: stream.label.talmudRole, overflowX: stream.overflowX, overflowY: stream.overflowY, rect: stream.rect, pageRect: page.pageRect });
      }
    });

    const talmudBlocks = page.talmudBlocks || [];
    talmudBlocks.forEach((block) => {
      const main = page.streams.length
        ? null
        : null;
      const pageEl = document.querySelectorAll(".page:not(.page-placeholder)")[page.pageIndex];
      const mainEl = pageEl?.querySelector(".page-main.talmud-main");
      const mainRect = rectOf(mainEl);
      const commentaryEls = Array.from(pageEl?.querySelectorAll(".stream.talmud-commentary") || []);
      if ((!mainEl || !mainRect || mainRect.w === 0 || mainRect.h === 0) && commentaryEls.length > 0) return;
      commentaryEls.forEach((streamEl) => {
        const streamRect = rectOf(streamEl);
        if (rectsOverlap(mainRect, streamRect, 4)) {
          problems.push({
            type: "TALMUD_MAIN_STREAM_OVERLAP",
            pageIndex: page.pageIndex,
            stream: streamEl.getAttribute("data-stream") || "",
            mainRect,
            streamRect,
          });
        }
      });
      const pageRect = page.pageRect;
      if (pageRect && mainRect && block.rect) {
        const usedBottom = Math.max(
          mainRect.bottom,
          block.rect.bottom,
          ...commentaryEls.map((el) => rectOf(el)?.bottom || 0)
        );
        const emptyBottom = Math.round(pageRect.bottom - usedBottom);
        const hasStreamOverflow = page.streams.some((stream) => stream.overflowX || stream.overflowY);
        if (emptyBottom > 160 && !hasStreamOverflow) {
          problems.push({ type: "TALMUD_LARGE_EMPTY_BOTTOM", pageIndex: page.pageIndex, emptyBottom, pageRect, mainRect, blockRect: block.rect });
        }
      }
    });
  }
  return problems;
}

function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

function downloadSnapshot(name = `talmud-debug-${Date.now()}.json`) {
  const data = snapshot();
  data.problems = findProblems(data);
  downloadJson(name, data);
  return data;
}

function watchDownloadButton() {
  const btn = document.getElementById("pdf-download");
  if (!btn) return false;
  if (btn.__talmudDebugWatcher) return true;
  btn.__talmudDebugWatcher = true;
  btn.addEventListener("click", () => {
    const before = snapshot();
    before.problems = findProblems(before);
    setTimeout(() => {
      const after = snapshot();
      after.problems = findProblems(after);
      const report = { at: new Date().toISOString(), before, after };
      downloadJson(`talmud-download-debug-${Date.now()}.json`, report);
      console.log("Talmud download debug report", report);
    }, 900);
  }, true);
  return true;
}

export function installTalmudDebugApi() {
  if (typeof window === "undefined") return;
  window.__talmudDebugApi = {
    snapshot,
    problems: () => findProblems(snapshot()),
    downloadSnapshot,
    watchDownloadButton,
  };
  watchDownloadButton();
}
