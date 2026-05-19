// v9_main_bottom_gap.js — safe measured post-layout gap for Vilna V9.
//
// V9 positions every visible line absolutely. Therefore a CSS padding/margin
// below the main text is unsafe: the pagination algorithm will not know about it.
// This pass runs inside the V9 render pipeline after the page is built, measures
// the actual main/footer positions, and shifts only the footer apparatus down —
// only when there is real free space left inside the page.

import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js";

const DEFAULT_GAP_PX = 16;
const MAX_GAP_PX = 60;
const EPS = 0.5;

function px(value, fallback = 0) {
  const n = Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function readGapPx(container, explicitGap) {
  if (Number.isFinite(Number(explicitGap))) {
    return clamp(Number(explicitGap), 0, MAX_GAP_PX);
  }

  try {
    const raw = window.localStorage?.getItem("ravtext.talmudLayout.mainBottomGap");
    if (raw !== null && raw !== "") {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n)) return clamp(n, 0, MAX_GAP_PX);
    }
  } catch (_) {}

  try {
    const cssValue = window.getComputedStyle?.(container)
      ?.getPropertyValue("--ravtext-v9-main-bottom-gap");
    const n = Number.parseFloat(cssValue || "");
    if (Number.isFinite(n)) return clamp(n, 0, MAX_GAP_PX);
  } catch (_) {}

  return DEFAULT_GAP_PX;
}

function topOf(el) {
  return px(el.style.top, el.offsetTop || 0);
}

function leftOf(el) {
  return px(el.style.left, el.offsetLeft || 0);
}

function widthOf(el) {
  return px(el.style.width, el.getBoundingClientRect?.().width || 0);
}

function heightOf(el) {
  return px(el.style.height, el.getBoundingClientRect?.().height || 0);
}

function setTop(el, top) {
  el.style.top = `${Math.round(top * 100) / 100}px`;
}

function isMainLine(el) {
  return el?.dataset?.v9Role === "main" || el?.classList?.contains("v9-role-main");
}

function cloneLineNodes(el) {
  return Array.from(el?.childNodes || []).map(node => node.cloneNode(true));
}

function replaceLineNodes(el, nodes) {
  if (!el) return;
  const clones = (nodes || []).map(node => node.cloneNode(true));
  if (typeof el.replaceChildren === "function") {
    el.replaceChildren(...clones);
    return;
  }
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const node of clones) el.appendChild(node);
}

function sortLinesTopDown(lines) {
  return [...(lines || [])].sort((a, b) => {
    const byTop = topOf(a) - topOf(b);
    if (Math.abs(byTop) > EPS) return byTop;
    return leftOf(b) - leftOf(a);
  });
}

function pageInnerWidth(pageEl) {
  const padding = px(pageEl.style.padding, 12);
  const styleWidth = px(pageEl.style.width, pageEl.clientWidth || 0);
  return Math.max(0, styleWidth - padding * 2);
}

function overlapsMainVertically(pageEl, top, height) {
  const bottom = top + height;
  const mainLines = Array.from(pageEl.querySelectorAll(".v9-line"))
    .filter(isMainLine);

  return mainLines.some(line => {
    const lineTop = topOf(line);
    const lineBottom = lineTop + heightOf(line);
    return top < lineBottom - EPS && bottom > lineTop + EPS;
  });
}

function moveLineToRightColumn(line, rightLines) {
  const right = sortLinesTopDown(rightLines);
  if (!line || right.length === 0) return false;

  const ref = right[right.length - 1];
  const lineH = Math.max(heightOf(line), heightOf(ref), 1);
  line.style.left = `${leftOf(ref)}px`;
  line.style.width = `${widthOf(ref)}px`;
  setTop(line, topOf(ref) + lineH);
  line.classList?.remove("center");
  line.classList?.add("justify");
  line.dataset.v9Role = "right";
  line.classList?.remove("v9-role-left");
  line.classList?.add("v9-role-right");
  return true;
}

// V9 scenario 1 has one long side stream split into a right and a left column.
//
// The previous implementation here was too aggressive: it created a full-width
// "middle" line merely because the right side had one extra line. That is wrong.
// In RTL layout one extra right-side line may be perfectly legal. A full-width
// bottom line is only valid when the engine already produced such a bridge line.
// This pass only repairs an existing bridge line, and it never leaves it on top
// of the main text. If the bridge cannot safely sit under both columns, it is
// returned to the right column.
function normalizeV9Scenario1SplitBridgeLines(pages) {
  const fixes = [];

  for (const pageEl of pages || []) {
    if (!pageEl?.querySelectorAll) continue;

    const innerW = pageInnerWidth(pageEl);
    if (innerW <= 0) continue;

    const padding = px(pageEl.style.padding, 12);
    const groups = new Map();
    const sideLines = Array.from(pageEl.querySelectorAll(".v9-line[data-v9-role][data-v9-box-id]"))
      .filter(el => {
        const role = String(el.dataset.v9Role || "").toLowerCase();
        return role === "right" || role === "left";
      });

    for (const line of sideLines) {
      const id = String(line.dataset.v9BoxId || "");
      if (!id || id === "main") continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(line);
    }

    for (const [streamId, lines] of groups) {
      const fullWidth = sortLinesTopDown(lines)
        .filter(line => widthOf(line) >= innerW - 5 && leftOf(line) <= padding + 5);
      if (fullWidth.length !== 1) continue;

      const bridge = fullWidth[0];
      const narrow = lines.filter(line => line !== bridge);
      const right = sortLinesTopDown(narrow.filter(line => String(line.dataset.v9Role || "").toLowerCase() === "right"));
      const left = sortLinesTopDown(narrow.filter(line => String(line.dataset.v9Role || "").toLowerCase() === "left"));

      if (right.length === 0 || left.length === 0) {
        if (moveLineToRightColumn(bridge, right)) {
          fixes.push({ pageIndex: pageEl.dataset.pageIndex || "", streamId, action: "returned-to-right-no-pair" });
        }
        continue;
      }

      const lineHeight = Math.max(
        heightOf(bridge),
        heightOf(right[right.length - 1]),
        heightOf(left[left.length - 1]),
        1,
      );
      const targetTop = Math.max(
        topOf(right[right.length - 1]) + heightOf(right[right.length - 1]),
        topOf(left[left.length - 1]) + heightOf(left[left.length - 1]),
      );

      const pageHeight = px(pageEl.style.height, pageEl.clientHeight || 0);
      const fitsPage = pageHeight <= 0 || targetTop + lineHeight <= pageHeight - padding + EPS;
      const safeUnderMain = fitsPage && !overlapsMainVertically(pageEl, targetTop, lineHeight);

      if (!safeUnderMain) {
        if (moveLineToRightColumn(bridge, right)) {
          fixes.push({ pageIndex: pageEl.dataset.pageIndex || "", streamId, action: "returned-to-right-main-overlap" });
        }
        continue;
      }

      // Correct the text order only for the existing bridge line:
      // bridge text belongs at the start of the left continuation; the last left
      // text belongs in the bridge line under both columns.
      let carry = cloneLineNodes(bridge);
      for (const leftLine of left) {
        const nextCarry = cloneLineNodes(leftLine);
        replaceLineNodes(leftLine, carry);
        carry = nextCarry;
      }
      replaceLineNodes(bridge, carry);

      bridge.style.left = `${padding}px`;
      bridge.style.width = `${innerW}px`;
      setTop(bridge, targetTop);
      bridge.classList?.remove("justify");
      bridge.classList?.add("center");
      bridge.dataset.v9Role = "left";
      bridge.classList?.remove("v9-role-right");
      bridge.classList?.add("v9-role-left");
      bridge.dataset.v9Scenario1BridgeFix = "1";

      fixes.push({
        pageIndex: pageEl.dataset.pageIndex || "",
        streamId,
        action: "bridge-reordered",
        targetTop: Math.round(targetTop * 100) / 100,
      });
    }
  }

  return fixes;
}

function applyGapToPage(pageEl, desiredGapPx) {
  if (!pageEl || desiredGapPx <= 0) return null;

  const mainLines = Array.from(pageEl.querySelectorAll(".v9-line"))
    .filter(isMainLine);
  if (!mainLines.length) return null;

  const mainBottom = Math.max(...mainLines.map(el => topOf(el) + heightOf(el)));

  // Footer titles are the stream titles that start after the main text ends.
  // Side-stream titles are above/around the main area and are intentionally left untouched.
  const footerTitles = Array.from(pageEl.querySelectorAll(".v9-stream-title"))
    .filter(el => topOf(el) >= mainBottom - EPS);
  if (!footerTitles.length) return null;

  const firstFooterTop = Math.min(...footerTitles.map(topOf));
  const currentGap = firstFooterTop - mainBottom;
  const requestedShift = desiredGapPx - currentGap;
  if (requestedShift <= EPS) {
    pageEl.dataset.v9MainBottomGap = JSON.stringify({
      desired: desiredGapPx,
      current: Math.round(currentGap * 100) / 100,
      applied: 0,
      reason: "already-enough",
    });
    return null;
  }

  const allPositioned = Array.from(pageEl.querySelectorAll(
    ".v9-line, .v9-stream-title, .v9-main-separator"
  ));

  const movable = allPositioned.filter(el => {
    if (isMainLine(el)) return false;
    if (el.classList?.contains("v9-main-separator"))) return false;
    return topOf(el) >= firstFooterTop - EPS;
  });
  if (!movable.length) return null;

  const pageHeight = px(pageEl.style.height, pageEl.clientHeight || 0);
  const pagePadding = px(pageEl.style.padding, 12);
  const bottomLimit = pageHeight > 0 ? pageHeight - pagePadding : Infinity;
  const movableBottom = Math.max(...movable.map(el => topOf(el) + heightOf(el)));
  const availableShift = Math.max(0, bottomLimit - movableBottom);
  const appliedShift = Math.min(requestedShift, availableShift);

  if (appliedShift <= EPS) {
    pageEl.dataset.v9MainBottomGap = JSON.stringify({
      desired: desiredGapPx,
      current: Math.round(currentGap * 100) / 100,
      applied: 0,
      reason: "no-room",
    });
    return null;
  }

  for (const el of movable) {
    setTop(el, topOf(el) + appliedShift);
  }

  // If there is a main/footer separator, keep it centered between the main and the shifted footer.
  const sep = pageEl.querySelector(".v9-main-separator");
  if (sep) {
    const sepH = heightOf(sep);
    const shiftedFooterTop = firstFooterTop + appliedShift;
    setTop(sep, Math.round((mainBottom + shiftedFooterTop) / 2 - sepH / 2));
  }

  const result = {
    desired: desiredGapPx,
    before: Math.round(currentGap * 100) / 100,
    applied: Math.round(appliedShift * 100) / 100,
    after: Math.round((currentGap + appliedShift) * 100) / 100,
  };
  pageEl.dataset.v9MainBottomGap = JSON.stringify(result);
  return result;
}

export function applyV9MainBottomGap(container, options = {}) {
  if (!container || !container.querySelectorAll) return [];
  const desiredGapPx = readGapPx(container, options.gapPx);
  const pages = Array.from(container.querySelectorAll(".page.v9-page, .v9-page"));
  const scenario1BridgeFixes = normalizeV9Scenario1SplitBridgeLines(pages);
  const results = [];

  for (const pageEl of pages) {
    const result = applyGapToPage(pageEl, desiredGapPx);
    if (result) results.push({ pageIndex: pageEl.dataset.pageIndex || "", ...result });
  }

  const openingWords = applyV9OpeningWordsFromMetadata(container);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-main-bottom-gap]", { desiredGapPx, changedPages: results.length, results, openingWords, scenario1BridgeFixes });
  }
  return results;
}
