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
    return px(b.style.left) - px(a.style.left);
  });
}

function pageInnerWidth(pageEl) {
  const padding = px(pageEl.style.padding, 12);
  const styleWidth = px(pageEl.style.width, pageEl.clientWidth || 0);
  return Math.max(0, styleWidth - padding * 2);
}

function normalizeV9Scenario1SplitOrphans(pages) {
  const fixes = [];

  for (const pageEl of pages || []) {
    if (!pageEl?.querySelectorAll) continue;

    const groups = new Map();
    const sideLines = Array.from(pageEl.querySelectorAll(".v9-line[data-v9-role][data-v9-box-id]"))
      .filter(el => {
        const role = String(el.dataset.v9Role || "").toLowerCase();
        return role === "right" || role === "left";
      });

    for (const line of sideLines) {
      const id = String(line.dataset.v9BoxId || "");
      if (!id || id === "main") continue;
      const role = String(line.dataset.v9Role || "").toLowerCase();
      if (!groups.has(id)) groups.set(id, { right: [], left: [] });
      groups.get(id)[role].push(line);
    }

    for (const [streamId, group] of groups) {
      const right = sortLinesTopDown(group.right);
      const left = sortLinesTopDown(group.left);

      if (right.length < 2 || left.length < 1) continue;
      if (right.length !== left.length + 1) continue;

      const orphanLine = right[right.length - 1];
      if (orphanLine.dataset.v9Scenario1OrphanFix === "1") continue;

      const innerW = pageInnerWidth(pageEl);
      if (innerW <= 0) continue;

      const orphanWidth = px(orphanLine.style.width, orphanLine.getBoundingClientRect?.().width || 0);
      if (orphanWidth >= innerW - 5) continue;

      const padding = px(pageEl.style.padding, 12);
      const lineHeight = Math.max(
        heightOf(orphanLine),
        heightOf(left[left.length - 1]),
        heightOf(right[right.length - 2]),
        1,
      );
      const targetTop = Math.max(topOf(right[right.length - 2]), topOf(left[left.length - 1])) + lineHeight;
      const pageHeight = px(pageEl.style.height, pageEl.clientHeight || 0);
      if (pageHeight > 0 && targetTop + lineHeight > pageHeight - padding + EPS) continue;

      let carry = cloneLineNodes(orphanLine);
      for (const leftLine of left) {
        const nextCarry = cloneLineNodes(leftLine);
        replaceLineNodes(leftLine, carry);
        carry = nextCarry;
      }
      replaceLineNodes(orphanLine, carry);

      orphanLine.style.left = `${padding}px`;
      orphanLine.style.width = `${innerW}px`;
      setTop(orphanLine, targetTop);
      orphanLine.classList?.remove("justify");
      orphanLine.classList?.add("center");
      orphanLine.dataset.v9Role = "left";
      orphanLine.classList?.remove("v9-role-right");
      orphanLine.classList?.add("v9-role-left");
      orphanLine.dataset.v9Scenario1OrphanFix = "1";

      const detail = {
        streamId,
        rightLines: right.length,
        leftLines: left.length,
        targetTop: Math.round(targetTop * 100) / 100,
        width: Math.round(innerW * 100) / 100,
      };
      pageEl.dataset.v9Scenario1OrphanFix = JSON.stringify(detail);
      fixes.push({ pageIndex: pageEl.dataset.pageIndex || "", ...detail });
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
    if (el.classList?.contains("v9-main-separator")) return false;
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
  const scenario1OrphanFixes = normalizeV9Scenario1SplitOrphans(pages);
  const results = [];

  for (const pageEl of pages) {
    const result = applyGapToPage(pageEl, desiredGapPx);
    if (result) results.push({ pageIndex: pageEl.dataset.pageIndex || "", ...result });
  }

  const openingWords = applyV9OpeningWordsFromMetadata(container);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-main-bottom-gap]", { desiredGapPx, changedPages: results.length, results, openingWords, scenario1OrphanFixes });
  }
  return results;
}
