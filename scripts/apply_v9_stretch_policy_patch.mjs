import fs from "node:fs";

const TARGET = "src/engine/v9_main_bottom_gap.js";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function writeIfChanged(path, before, after) {
  if (after !== before) {
    fs.writeFileSync(path, after);
    console.log(`[v9-stretch-policy] patched ${path}`);
  } else {
    console.log(`[v9-stretch-policy] no changes needed for ${path}`);
  }
}

function insertOnce(source, marker, anchor, insertion, label) {
  if (source.includes(marker)) return source;
  if (!source.includes(anchor)) {
    console.warn(`[v9-stretch-policy] anchor not found: ${label}; skipped`);
    return source;
  }
  return source.replace(anchor, insertion);
}

function replaceOnce(source, marker, pattern, replacer, label) {
  if (source.includes(marker)) return source;
  const after = source.replace(pattern, replacer);
  if (after === source) {
    console.warn(`[v9-stretch-policy] anchor not found: ${label}; skipped`);
  }
  return after;
}

const VISUAL_SAFETY_HELPERS = `
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
      for (const el of movable) setTop(el, topOf(el) + appliedShift);
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

`;

function patchMainBottomGap(source) {
  source = source.replace(/\r\n/g, "\n");

  source = replaceOnce(
    source,
    `normalizeV9StretchPolicy`,
    /import\s+\{\s*applyV9OpeningWordsFromMetadata\s*\}\s+from\s+["']\.\/v9_opening_words_from_metadata\.js["'];/,
    match => `${match}\nimport { normalizeV9StretchPolicy } from "./v9_stretch_policy.js";`,
    "stretch policy import"
  );

  source = insertOnce(
    source,
    `function applyV9VisualSafetyGapToPage`,
    `export function applyV9MainBottomGap(container, options = {}) {`,
    `${VISUAL_SAFETY_HELPERS}export function applyV9MainBottomGap(container, options = {}) {`,
    "visual safety helpers"
  );

  if (!source.includes(`const stretchPolicy = normalizeV9StretchPolicy(container);`)) {
    source = replaceOnce(
      source,
      `const stretchPolicy = normalizeV9StretchPolicy(container);`,
      /const openingWords = applyV9OpeningWordsFromMetadata\(container\);/,
      match => `${match}\n  const stretchPolicy = normalizeV9StretchPolicy(container);`,
      "stretch policy post-window hook"
    );
  }

  if (!source.includes(`const visualSafety = applyV9VisualSafetyGap(container, desiredGapPx);`)) {
    source = replaceOnce(
      source,
      `const visualSafety = applyV9VisualSafetyGap(container, desiredGapPx);`,
      /const stretchPolicy = normalizeV9StretchPolicy\(container\);/,
      match => `${match}\n  const visualSafety = applyV9VisualSafetyGap(container, desiredGapPx);`,
      "visual safety post-window hook"
    );
  }

  if (source.includes(`const visualSafety = applyV9VisualSafetyGap(container, desiredGapPx);`) && !source.includes(`visualSafety, scenario1BridgeRuleFixes`)) {
    source = source.replace(/openingWords,\s*scenario1BridgeRuleFixes/g, "openingWords, stretchPolicy, visualSafety, scenario1BridgeRuleFixes");
    source = source.replace(/openingWords\s*\}\);/g, "openingWords, stretchPolicy, visualSafety });");
  }

  return source;
}

const before = readFile(TARGET);
const after = patchMainBottomGap(before);
writeIfChanged(TARGET, before, after);
