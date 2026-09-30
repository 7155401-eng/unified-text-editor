// v9_main_bottom_gap.js — V9 main/footer gap policy + post-render diagnostics.
//
// Visible V9 geometry is planned before paint. This module may resolve the user's
// requested gap and audit the painted result, but it must not move lines after
// layout. A post-render Y shift would create a second geometry authority and can
// manufacture blank rows at narrow→wide commentary knees.

import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js";
import { normalizeV9StretchPolicy } from "./v9_stretch_policy.js";

export const DEFAULT_V9_MAIN_BOTTOM_GAP_PX = 16;
export const MAX_V9_MAIN_BOTTOM_GAP_PX = 60;
const EPS = 0.5;

function px(value, fallback = 0) {
  const n = Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

export function resolveV9MainBottomGapPx(container, explicitGap) {
  if (Number.isFinite(Number(explicitGap))) {
    return clamp(Number(explicitGap), 0, MAX_V9_MAIN_BOTTOM_GAP_PX);
  }

  try {
    const raw = window.localStorage?.getItem("ravtext.talmudLayout.mainBottomGap");
    if (raw !== null && raw !== "") {
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n)) return clamp(n, 0, MAX_V9_MAIN_BOTTOM_GAP_PX);
    }
  } catch (_) {}

  try {
    const cssValue = window.getComputedStyle?.(container)
      ?.getPropertyValue("--ravtext-v9-main-bottom-gap");
    const n = Number.parseFloat(cssValue || "");
    if (Number.isFinite(n)) return clamp(n, 0, MAX_V9_MAIN_BOTTOM_GAP_PX);
  } catch (_) {}

  return DEFAULT_V9_MAIN_BOTTOM_GAP_PX;
}

function topOf(el) {
  return px(el.style.top, el.offsetTop || 0);
}

function heightOf(el) {
  return px(el.style.height, el.getBoundingClientRect?.().height || 0);
}

function leftOf(el) {
  return px(el?.style?.left, el?.offsetLeft || 0);
}

function widthOf(el) {
  return px(el?.style?.width, el?.getBoundingClientRect?.().width || 0);
}

function bottomOf(el) {
  return topOf(el) + heightOf(el);
}

function isMainLine(el) {
  return el?.dataset?.v9Role === "main" || el?.classList?.contains("v9-role-main");
}

function applyGapToPage(pageEl, desiredGapPx) {
  if (!pageEl || desiredGapPx < 0) return null;

  const mainLines = Array.from(pageEl.querySelectorAll(".v9-line"))
    .filter(isMainLine);
  if (!mainLines.length) return null;

  const mainBottom = Math.max(...mainLines.map(el => topOf(el) + heightOf(el)));
  const footerTitles = Array.from(pageEl.querySelectorAll(".v9-stream-title"))
    .filter(el => topOf(el) >= mainBottom - EPS);

  if (!footerTitles.length) {
    const result = {
      desired: desiredGapPx,
      current: null,
      applied: 0,
      reason: "no-footer-apparatus",
      authority: "planner",
    };
    pageEl.dataset.v9MainBottomGap = JSON.stringify(result);
    return result;
  }

  const firstFooterTop = Math.min(...footerTitles.map(topOf));
  const currentGap = firstFooterTop - mainBottom;
  const result = {
    desired: desiredGapPx,
    current: Math.round(currentGap * 100) / 100,
    applied: 0,
    after: Math.round(currentGap * 100) / 100,
    reason: currentGap + EPS >= desiredGapPx ? "planned-enough" : "planner-gap-shortfall",
    authority: "planner",
  };

  // Diagnostic only. V9 geometry is immutable after render. In particular this
  // function must NEVER shift a side-stream continuation or footer line: doing
  // so creates a second vertical grid and can re-introduce blank knee rows.
  pageEl.dataset.v9MainBottomGap = JSON.stringify(result);
  return result;
}

function v9RectRelativeToPage(pageEl, el) {
  const pageRect = pageEl?.getBoundingClientRect?.();
  if (!pageRect || !el) return null;

  let rect = null;
  try {
    if (typeof document !== "undefined" && typeof document.createRange === "function") {
      const range = document.createRange();
      range.selectNodeContents(el);
      rect = range.getBoundingClientRect?.() || null;
      range.detach?.();
    }
  } catch (_) {}

  if (!rect || (!rect.width && !rect.height)) {
    try { rect = el.getBoundingClientRect?.() || null; } catch (_) {}
  }
  if (!rect) return null;

  return {
    top: rect.top - pageRect.top,
    right: rect.right - pageRect.left,
    bottom: rect.bottom - pageRect.top,
    left: rect.left - pageRect.left,
    width: rect.width,
    height: rect.height,
  };
}

function v9LogicalRect(el) {
  const left = leftOf(el);
  const top = topOf(el);
  const width = widthOf(el);
  const height = heightOf(el);
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function v9VisualRect(pageEl, el) {
  const logical = v9LogicalRect(el);
  const measured = v9RectRelativeToPage(pageEl, el);
  if (!measured) return logical;
  return {
    left: Math.min(logical.left, measured.left),
    right: Math.max(logical.right, measured.right),
    top: Math.min(logical.top, measured.top),
    bottom: Math.max(logical.bottom, measured.bottom),
    width: Math.max(logical.width, measured.width),
    height: Math.max(logical.height, measured.height),
  };
}

function v9HorizontalOverlap(a, b, pad = 0.75) {
  return a.left < b.right - pad && a.right > b.left + pad;
}

function v9VerticalOverlapOrNear(a, b, gapPx) {
  return a.top < b.bottom + gapPx && a.bottom > b.top - gapPx;
}

function v9HasPaintedBackground(el) {
  try {
    const bg = window.getComputedStyle?.(el)?.backgroundColor || "";
    return bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
  } catch (_) {
    return false;
  }
}

function v9MakeBackgroundTransparent(el) {
  if (!el?.style) return;
  if (v9HasPaintedBackground(el)) {
    el.dataset.v9VisualSafetyTransparentBackground = "1";
    el.style.backgroundColor = "transparent";
  }
}

function applyV9VisualSafetyGapToPage(pageEl, desiredGapPx) {
  if (!pageEl?.querySelectorAll) return null;

  const mainLines = Array.from(pageEl.querySelectorAll(".v9-line")).filter(isMainLine);
  if (!mainLines.length) return null;

  const mainRects = mainLines.map(line => ({ line, rect: v9VisualRect(pageEl, line), logicalBottom: bottomOf(line) }));
  const logicalMainBottom = Math.max(...mainRects.map(item => item.logicalBottom));
  const visualMainBottom = Math.max(...mainRects.map(item => item.rect.bottom));
  const visualBleed = Math.max(0, visualMainBottom - logicalMainBottom);

  const protectBandPx = Math.max(24, desiredGapPx + 8, visualBleed + desiredGapPx);
  const protectedMain = mainRects.filter(item => item.rect.bottom >= visualMainBottom - protectBandPx);
  if (!protectedMain.length) return null;

  const protectTop = Math.min(...protectedMain.map(item => item.rect.top));
  const protectBottom = Math.max(...protectedMain.map(item => item.rect.bottom));
  const dynamicGap = Math.max(4, Math.ceil(visualBleed + Math.max(3, desiredGapPx * 0.35)));

  for (const item of protectedMain) {
    item.line.dataset.v9VisualSafetyMainLayer = "1";
    item.line.style.zIndex = "3";
  }

  const candidates = Array.from(pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator"))
    .filter(el => !isMainLine(el))
    .map(el => ({ el, rect: v9VisualRect(pageEl, el) }))
    .filter(item => {
      if (!v9VerticalOverlapOrNear(item.rect, { top: protectTop, bottom: protectBottom }, dynamicGap)) return false;
      return protectedMain.some(main => v9HorizontalOverlap(item.rect, main.rect));
    });

  if (!candidates.length) {
    const result = {
      reason: "no-overlap-candidates",
      desired: dynamicGap,
      logicalMainBottom: Math.round(logicalMainBottom * 100) / 100,
      visualMainBottom: Math.round(visualMainBottom * 100) / 100,
      visualBleed: Math.round(visualBleed * 100) / 100,
    };
    pageEl.dataset.v9VisualSafetyGap = JSON.stringify(result);
    return null;
  }

  const firstTop = Math.min(...candidates.map(item => item.rect.top));
  const requestedShift = protectBottom + dynamicGap - firstTop;

  let appliedShift = 0;
  if (requestedShift > EPS) {
    const pageHeight = px(pageEl.style.height, pageEl.clientHeight || 0);
    const pagePadding = px(pageEl.style.padding, 12);
    const bottomLimit = pageHeight > 0 ? pageHeight - pagePadding : Infinity;
    const movableTop = Math.min(...candidates.map(item => topOf(item.el)));
    const movable = Array.from(pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator"))
      .filter(el => !isMainLine(el) && topOf(el) >= movableTop - EPS);
    const movableBottom = movable.length ? Math.max(...movable.map(bottomOf)) : 0;
    const availableShift = Math.max(0, bottomLimit - movableBottom);
    appliedShift = Math.min(requestedShift, availableShift);

    if (appliedShift > EPS) {
      // v9-disable-visual-safety-dom-shift: the visual-safety pass may still diagnose unsafe overlap and
      // may still use the transparent-background fallback, but it must not move
      // already-rendered side/footer lines. Moving those DOM nodes creates real
      // gaps inside side columns near the end of rendering.
      const suppressedShift = appliedShift;
      appliedShift = 0;
      pageEl.dataset.v9VisualSafetyShiftSuppressed = JSON.stringify({
        marker: "v9-disable-visual-safety-dom-shift",
        requested: Math.round(requestedShift * 100) / 100,
        available: Math.round(availableShift * 100) / 100,
        suppressed: Math.round(suppressedShift * 100) / 100
      });
    }
  }

  const stillUnsafe = requestedShift - appliedShift > EPS;
  if (stillUnsafe) {
    for (const item of candidates) v9MakeBackgroundTransparent(item.el);
  }

  const result = {
    reason: stillUnsafe ? "limited-room-transparent-background" : "shifted",
    desired: dynamicGap,
    before: Math.round((firstTop - protectBottom) * 100) / 100,
    applied: Math.round(Math.max(0, appliedShift) * 100) / 100,
    after: Math.round((firstTop + Math.max(0, appliedShift) - protectBottom) * 100) / 100,
    visualBleed: Math.round(visualBleed * 100) / 100,
    candidates: candidates.length,
  };
  pageEl.dataset.v9VisualSafetyGap = JSON.stringify(result);
  return result;
}

function applyV9VisualSafetyGap(container, desiredGapPx) {
  const pages = Array.from(container?.querySelectorAll?.(".page.v9-page, .v9-page") || []);
  const results = [];
  for (const pageEl of pages) {
    const result = applyV9VisualSafetyGapToPage(pageEl, desiredGapPx);
    if (result) results.push({ pageIndex: pageEl.dataset.pageIndex || "", ...result });
  }
  return results;
}

// משה 24/09/2026: „אני רוצה שכל עמוד לא יתחיל עד שמסתיים כל העבודה
// של העמודים שלפניו. ראיתי הרבה בעיות ממנוע שעובר רק אחרי כל הרינדור
// וצריך לבטל אותו, למזג אותו בשעת אמת."
//
// המעבר הזה אכן רץ עד היום רק בסוף, על כל העמודים ביחד — ולכן עמוד
// שכבר נראה מוכן היה עוד זז אחר כך. נמדד: שני עמודים השתנו אחרי
// שכבר צוירו, אחד מהם שלוש פעמים.
//
// הפונקציה הזו מריצה את אותה עבודה בדיוק על **עמוד אחד**, כדי שאפשר
// יהיה לקרוא לה ברגע שהעמוד נגמר. העבודה עצמה לא השתנתה — רק העיתוי.
//
// Geometry is planner-owned. This per-page hook is now diagnostic-only and is
// safe to call more than once because it never changes element positions.
export function applyV9MainBottomGapToPage(pageEl, options = {}) {
  if (!pageEl) return null;
  const scope = pageEl.parentElement || pageEl;
  const desiredGapPx = resolveV9MainBottomGapPx(scope, options.gapPx);
  // ⚠️ ניסיתי להוסיף לכאן גם את שמירת המרווח הוויזואלי, והחמרתי:
  // העמודים הלא-יציבים קפצו מ-1 ל-12. הסיבה: אותה שמירה **אינה**
  // בטוחה להרצה כפולה — היא מזיזה שורות לפי מדידה, וכשהיא רצה שוב
  // בסוף היא מזיזה אותן שוב. החזרתי אותה למקומה בסוף.
  //
  // ההבדל בין השתיים: applyGapToPage בודק קודם כמה מרווח כבר יש
  // ומוותר אם מספיק, ולכן אפשר להריץ אותו פעמיים בלי נזק.
  return applyGapToPage(pageEl, desiredGapPx);
}

export function applyV9MainBottomGap(container, options = {}) {
  if (!container || !container.querySelectorAll) return [];
  const desiredGapPx = resolveV9MainBottomGapPx(container, options.gapPx);
  const pages = Array.from(container.querySelectorAll(".page.v9-page, .v9-page"));
  const results = [];

  for (const pageEl of pages) {
    const result = applyGapToPage(pageEl, desiredGapPx);
    if (result) results.push({ pageIndex: pageEl.dataset.pageIndex || "", ...result });
  }

  const openingWords = applyV9OpeningWordsFromMetadata(container);
  const stretchPolicy = normalizeV9StretchPolicy(container);
  const visualSafety = applyV9VisualSafetyGap(container, desiredGapPx);

  if (typeof console !== "undefined" && console.debug) {
    console.debug("[v9-main-bottom-gap]", { desiredGapPx, changedPages: results.length, results, openingWords, stretchPolicy, visualSafety });
  }
  return results;
}
