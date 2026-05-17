import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js";

const DEFAULT_GAP_PX = 16;
const MAX_GAP_PX = 60;
const EPS = 0.5;

function px(value, fallback = 0) {
  const n = Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
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
    const cssValue = window.getComputedStyle?.(container)?.getPropertyValue("--ravtext-v9-main-bottom-gap");
    const n = Number.parseFloat(cssValue || "");
    if (Number.isFinite(n)) return clamp(n, 0, MAX_GAP_PX);
  } catch (_) {}
  return DEFAULT_GAP_PX;
}
function topOf(el) { return px(el.style.top, el.offsetTop || 0); }
function heightOf(el) { return px(el.style.height, el.getBoundingClientRect?.().height || 0); }
function setTop(el, top) { el.style.top = `${Math.round(top * 100) / 100}px`; }
function isMainLine(el) { return el?.dataset?.v9Role === "main" || el?.classList?.contains("v9-role-main"); }

function applyGapToPage(pageEl, desiredGapPx) {
  if (!pageEl || desiredGapPx <= 0) return null;
  const mainLines = Array.from(pageEl.querySelectorAll(".v9-line")).filter(isMainLine);
  if (!mainLines.length) return null;
  const mainBottom = Math.max(...mainLines.map(el => topOf(el) + heightOf(el)));
  const footerTitles = Array.from(pageEl.querySelectorAll(".v9-stream-title")).filter(el => topOf(el) >= mainBottom - EPS);
  if (!footerTitles.length) return null;
  const firstFooterTop = Math.min(...footerTitles.map(topOf));
  const currentGap = firstFooterTop - mainBottom;
  const requestedShift = desiredGapPx - currentGap;
  if (requestedShift <= EPS) {
    pageEl.dataset.v9MainBottomGap = JSON.stringify({ desired: desiredGapPx, current: Math.round(currentGap * 100) / 100, applied: 0, reason: "already-enough" });
    return null;
  }
  const allPositioned = Array.from(pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator"));
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
    pageEl.dataset.v9MainBottomGap = JSON.stringify({ desired: desiredGapPx, current: Math.round(currentGap * 100) / 100, applied: 0, reason: "no-room" });
    return null;
  }
  for (const el of movable) setTop(el, topOf(el) + appliedShift);
  const sep = pageEl.querySelector(".v9-main-separator");
  if (sep) {
    const sepH = heightOf(sep);
    const shiftedFooterTop = firstFooterTop + appliedShift;
    setTop(sep, Math.round((mainBottom + shiftedFooterTop) / 2 - sepH / 2));
  }
  const result = { desired: desiredGapPx, before: Math.round(currentGap * 100) / 100, applied: Math.round(appliedShift * 100) / 100, after: Math.round((currentGap + appliedShift) * 100) / 100 };
  pageEl.dataset.v9MainBottomGap = JSON.stringify(result);
  return result;
}

export function applyV9MainBottomGap(container, options = {}) {
  if (!container || !container.querySelectorAll) return [];
  const desiredGapPx = readGapPx(container, options.gapPx);
  const pages = Array.from(container.querySelectorAll(".page.v9-page, .v9-page"));
  const results = [];
  for (const pageEl of pages) {
    const result = applyGapToPage(pageEl, desiredGapPx);
    if (result) results.push({ pageIndex: pageEl.dataset.pageIndex || "", ...result });
  }
  const openingWords = applyV9OpeningWordsFromMetadata(container);
  if (typeof console !== "undefined" && console.debug) console.debug("[v9-main-bottom-gap]", { desiredGapPx, changedPages: results.length, results, openingWords });
  return results;
}
