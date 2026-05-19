// v9_main_bottom_gap.js — measured post-layout gap and V9 RTL split-bridge guard.
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
  if (Number.isFinite(Number(explicitGap))) return clamp(Number(explicitGap), 0, MAX_GAP_PX);

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

function bottomOf(el) {
  return topOf(el) + heightOf(el);
}

function setTop(el, top) {
  el.style.top = `${Math.round(top * 100) / 100}px`;
}

function isMainLine(el) {
  return el?.dataset?.v9Role === "main" || el?.classList?.contains("v9-role-main");
}

function sortLines(lines) {
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

function wordCount(el) {
  return String(el?.textContent || "").trim().split(/\s+/).filter(Boolean).length;
}

function justifyLine(el) {
  if (!el) return;
  el.classList?.remove("center");
  if (wordCount(el) > 1) el.classList?.add("justify");
}

function centerLine(el) {
  if (!el) return;
  el.classList?.remove("justify");
  el.classList?.add("center");
}

function setRole(el, role) {
  if (!el || !role) return;
  el.dataset.v9Role = role;
  el.classList?.remove("v9-role-right");
  el.classList?.remove("v9-role-left");
  el.classList?.add(`v9-role-${role}`);
}

function overlapsMainVertically(pageEl, top, height) {
  const bottom = top + height;
  return Array.from(pageEl.querySelectorAll(".v9-line"))
    .filter(isMainLine)
    .some(line => top < bottomOf(line) - EPS && bottom > topOf(line) + EPS);
}

function columnFallback(pageEl, role, oppositeLines) {
  const padding = px(pageEl.style.padding, 12);
  const ref = sortLines(oppositeLines)[0];
  const width = ref ? widthOf(ref) : Math.max(0, (pageInnerWidth(pageEl) - 8) / 2);
  if (role === "left") return { left: padding, width };
  return { left: padding + pageInnerWidth(pageEl) - width, width };
}

function moveLineIntoColumn(line, refs, role, pageEl, oppositeLines = []) {
  const ordered = sortLines(refs);
  const lineH = Math.max(heightOf(line), ordered.length ? heightOf(ordered.at(-1)) : 1, 1);

  let left;
  let width;
  let top;

  if (ordered.length) {
    const ref = ordered.at(-1);
    left = leftOf(ref);
    width = widthOf(ref);
    top = bottomOf(ref);
  } else {
    const fallback = columnFallback(pageEl, role, oppositeLines);
    left = fallback.left;
    width = fallback.width;
    top = px(pageEl.style.padding, 12);
  }

  line.style.left = `${Math.round(left * 100) / 100}px`;
  line.style.width = `${Math.round(width * 100) / 100}px`;
  setTop(line, top);
  setRole(line, role);
  justifyLine(line);
  line.dataset.v9Scenario1BridgeRule = `returned-to-${role}`;
  return true;
}

// V9 RTL split rule:
// At most one full-width bridge row may exist for a split stream.
// It must be the last row from the left column, never a right-column row.
function normalizeV9Scenario1BridgeRules(pages) {
  const fixes = [];

  for (const pageEl of pages || []) {
    if (!pageEl?.querySelectorAll) continue;

    const innerW = pageInnerWidth(pageEl);
    if (innerW <= 0) continue;

    const padding = px(pageEl.style.padding, 12);
    const pageHeight = px(pageEl.style.height, pageEl.clientHeight || 0);
    const bottomLimit = pageHeight > 0 ? pageHeight - padding : Infinity;
    const groups = new Map();

    for (const line of Array.from(pageEl.querySelectorAll(".v9-line[data-v9-role][data-v9-box-id]"))) {
      const role = String(line.dataset.v9Role || "").toLowerCase();
      if (role !== "right" && role !== "left") continue;

      const streamId = String(line.dataset.v9BoxId || "");
      if (!streamId || streamId === "main") continue;

      if (!groups.has(streamId)) groups.set(streamId, []);
      groups.get(streamId).push(line);
    }

    for (const [streamId, lines] of groups) {
      const byRole = role => sortLines(lines.filter(line =>
        String(line.dataset.v9Role || "").toLowerCase() === role
      ));

      const right = byRole("right");
      const left = byRole("left");
      if (!right.length || !left.length) continue;

      const isFullWidth = line => widthOf(line) >= innerW - 5 && leftOf(line) <= padding + 5;
      const rightFull = right.filter(isFullWidth);
      const leftFull = sortLines(left.filter(isFullWidth));
      const rightNarrow = right.filter(line => !isFullWidth(line));
      const leftNarrow = left.filter(line => !isFullWidth(line));

      for (const line of rightFull) {
        moveLineIntoColumn(line, rightNarrow, "right", pageEl, leftNarrow);
        rightNarrow.push(line);
        fixes.push({
          pageIndex: pageEl.dataset.pageIndex || "",
          streamId,
          action: "right-full-width-returned",
        });
      }

      if (!leftFull.length) continue;

      // The critical rule: never two bridge rows.
      // If several full-width left rows exist, only the bottommost can remain a bridge.
      // Every earlier full-width row is put back into the left column first, and then
      // becomes part of the left column stack for the one remaining candidate.
      const bridge = leftFull.at(-1);
      for (const extra of leftFull.slice(0, -1)) {
        moveLineIntoColumn(extra, leftNarrow, "left", pageEl, rightNarrow);
        leftNarrow.push(extra);
        fixes.push({
          pageIndex: pageEl.dataset.pageIndex || "",
          streamId,
          action: "extra-left-bridge-returned",
        });
      }

      const priorRight = rightNarrow.filter(line => bottomOf(line) <= topOf(bridge) + heightOf(bridge) + EPS);
      const priorLeft = leftNarrow.filter(line => bottomOf(line) <= topOf(bridge) + heightOf(bridge) + EPS);

      if (!priorRight.length || !priorLeft.length) {
        moveLineIntoColumn(bridge, leftNarrow, "left", pageEl, rightNarrow);
        fixes.push({
          pageIndex: pageEl.dataset.pageIndex || "",
          streamId,
          action: "left-bridge-no-pair-returned",
        });
        continue;
      }

      const lastRight = sortLines(priorRight).at(-1);
      const lastLeft = sortLines(priorLeft).at(-1);
      const lineH = Math.max(heightOf(bridge), heightOf(lastRight), heightOf(lastLeft), 1);
      const targetTop = Math.max(bottomOf(lastRight), bottomOf(lastLeft));
      const attached = topOf(bridge) <= targetTop + lineH * 0.75;
      const safe = targetTop + lineH <= bottomLimit + EPS && !overlapsMainVertically(pageEl, targetTop, lineH);

      if (!attached || !safe) {
        moveLineIntoColumn(bridge, leftNarrow, "left", pageEl, rightNarrow);
        fixes.push({
          pageIndex: pageEl.dataset.pageIndex || "",
          streamId,
          action: attached ? "left-bridge-over-main-returned" : "left-bridge-detached-returned",
        });
        continue;
      }

      justifyLine(lastLeft);
      bridge.style.left = `${padding}px`;
      bridge.style.width = `${innerW}px`;
      setTop(bridge, targetTop);
      setRole(bridge, "left");
      centerLine(bridge);
      bridge.dataset.v9Scenario1BridgeRule = "single-valid-left-bridge";
      fixes.push({
        pageIndex: pageEl.dataset.pageIndex || "",
        streamId,
        action: "single-left-bridge-valid",
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

  const mainBottom = Math.max(...mainLines.map(bottomOf));

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
  const movableBottom = Math.max(...movable.map(bottomOf));
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

  for (const el of movable) setTop(el, topOf(el) + appliedShift);

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
  const scenario1BridgeRuleFixes = normalizeV9Scenario1BridgeRules(pages);
  const results = [];

  for (const pageEl of pages) {
    const result = applyGapToPage(pageEl, desiredGapPx);
    if (result) results.push({ pageIndex: pageEl.dataset.pageIndex || "", ...result });
  }

  const openingWords = applyV9OpeningWordsFromMetadata(container);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-main-bottom-gap]", {
      desiredGapPx,
      changedPages: results.length,
      results,
      openingWords,
      scenario1BridgeRuleFixes,
    });
  }

  return results;
}
