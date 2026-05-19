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

function patchMainBottomGap(source) {
  source = source.replace(/\r\n/g, "\n");

  source = insertOnce(
    source,
    `normalizeV9StretchPolicy`,
    `import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js";`,
    `import { applyV9OpeningWordsFromMetadata } from "./v9_opening_words_from_metadata.js"; import { normalizeV9StretchPolicy } from "./v9_stretch_policy.js";`,
    "stretch policy import"
  );

  const visualSafetyHelpers = `
function v9VisualRectRelativeToPage(pageEl, el) {
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
    bottom: rect.bottom - pageRect.top,
    height: rect.height,
  };
}

function visualBottomOf(pageEl, el) {
  const rect = v9VisualRectRelativeToPage(pageEl, el);
  return rect ? Math.max(bottomOf(el), rect.bottom) : bottomOf(el);
}

function visualTopOf(pageEl, el) {
  const rect = v9VisualRectRelativeToPage(pageEl, el);
  return rect ? Math.min(topOf(el), rect.top) : topOf(el);
}

function hasPaintedBackground(el) {
  try {
    const bg = window.getComputedStyle?.(el)?.backgroundColor || "";
    return bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
  } catch (_) {
    return false;
  }
}

function applyV9VisualSafetyGapToPage(pageEl, desiredGapPx) {
  if (!pageEl?.querySelectorAll) return null;

  const mainLines = Array.from(pageEl.querySelectorAll(".v9-line")).filter(isMainLine);
  if (!mainLines.length) return null;

  const logicalMainBottom = Math.max(...mainLines.map(bottomOf));
  const visualMainBottom = Math.max(...mainLines.map(line => visualBottomOf(pageEl, line)));
  const visualBleed = Math.max(0, visualMainBottom - logicalMainBottom);

  const dynamicGap = Math.max(3, Math.ceil(visualBleed + Math.max(2, desiredGapPx * 0.25)));
  const pageHeight = px(pageEl.style.height, pageEl.clientHeight || 0);
  const pagePadding = px(pageEl.style.padding, 12);
  const bottomLimit = pageHeight > 0 ? pageHeight - pagePadding : Infinity;

  const leadIn = Math.max(4, dynamicGap);
  const candidateStart = logicalMainBottom - leadIn - EPS;

  const candidates = Array.from(pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-main-separator"))
    .filter(el => {
      if (isMainLine(el)) return false;
      if (el.classList?.contains("v9-main-separator")) return topOf(el) >= candidateStart;
      return topOf(el) >= candidateStart;
    });

  if (!candidates.length) {
    pageEl.dataset.v9VisualSafetyGap = JSON.stringify({
      reason: "no-candidates",
      logicalMainBottom: Math.round(logicalMainBottom * 100) / 100,
      visualMainBottom: Math.round(visualMainBottom * 100) / 100,
      visualBleed: Math.round(visualBleed * 100) / 100,
    });
    return null;
  }

  const firstNextTop = Math.min(...candidates.map(topOf));
  const currentGap = firstNextTop - visualMainBottom;
  const requestedShift = dynamicGap - currentGap;

  if (requestedShift <= EPS) {
    const result = {
      reason: "already-enough",
      desired: dynamicGap,
      current: Math.round(currentGap * 100) / 100,
      visualBleed: Math.round(visualBleed * 100) / 100,
      applied: 0,
    };
    pageEl.dataset.v9VisualSafetyGap = JSON.stringify(result);
    return null;
  }

  const movable = candidates.filter(el => topOf(el) >= firstNextTop - EPS);
  if (!movable.length) return null;

  const movableBottom = Math.max(...movable.map(bottomOf));
  const availableShift = Math.max(0, bottomLimit - movableBottom);
  const appliedShift = Math.min(requestedShift, availableShift);

  if (appliedShift > EPS) {
    for (const el of movable) setTop(el, topOf(el) + appliedShift);
  }

  const stillOverlapping = appliedShift + currentGap < dynamicGap - EPS;
  if (stillOverlapping) {
    for (const el of movable) {
      if (hasPaintedBackground(el) && visualTopOf(pageEl, el) < visualMainBottom + dynamicGap) {
        el.dataset.v9VisualSafetyTransparentBackground = "1";
        el.style.backgroundColor = "transparent";
      }
    }
  }

  const result = {
    desired: dynamicGap,
    before: Math.round(currentGap * 100) / 100,
    applied: Math.round(Math.max(0, appliedShift) * 100) / 100,
    after: Math.round((currentGap + Math.max(0, appliedShift)) * 100) / 100,
    visualBleed: Math.round(visualBleed * 100) / 100,
    reason: stillOverlapping ? "limited-room-transparent-background" : "shifted",
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

  source = insertOnce(
    source,
    `function applyV9VisualSafetyGapToPage`,
    ` export function applyV9MainBottomGap(container, options = {}) {`,
    `${visualSafetyHelpers} export function applyV9MainBottomGap(container, options = {}) {`,
    "visual safety helpers"
  );

  if (!source.includes(`const stretchPolicy = normalizeV9StretchPolicy(container);`)) {
    source = insertOnce(
      source,
      `const stretchPolicy = normalizeV9StretchPolicy(container);`,
      `const openingWords = applyV9OpeningWordsFromMetadata(container);`,
      `const openingWords = applyV9OpeningWordsFromMetadata(container); const stretchPolicy = normalizeV9StretchPolicy(container); const visualSafety = applyV9VisualSafetyGap(container, desiredGapPx);`,
      "stretch policy post-window hook"
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
