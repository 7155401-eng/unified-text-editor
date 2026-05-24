import fs from "node:fs";

const TARGET = "src/vilna_v9.js";
const MARKER = "v9-stream-line-stretch-guard";

function readFile(path) {
  return fs.readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function fail(label) {
  throw new Error(`[${MARKER}] ${label}`);
}

function patchContinuationAndJustifyPredicate(source) {
  if (source.includes("const isV9StreamLikeStretchBox =")) return source;

  const composedBefore = `      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isSourceContinuationEnd = !!box.syntheticContinuationAfter && line.isLast && !line.forcedBreak;
      const isContinuationCut = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues) && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;
      const useManualContinuationStretch = isContinuationCut && continuationFillRatio < 0.65;
      const shouldJustify = ((!line.isLast && !line.forcedBreak) || isContinuationCut)
                             && !useManualContinuationStretch
                             && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);`;

  const composedAfter = `      const isV9StreamLikeStretchBox = String(box.role || box.type || box.kind || (box.id === "main" ? "main" : (box.id ? "stream" : ""))).toLowerCase() !== "main";
      const isColumnAContinuation = !!box.isColumnAContinuation && line.isLast && !line.forcedBreak;
      const isSourceContinuationEnd = !!box.syntheticContinuationAfter && line.isLast && !line.forcedBreak;
      const isContinuationCandidate = (isSourceContinuationEnd || isColumnAContinuation || !!box.continues)
        && line.isLast && !line.forcedBreak;
      const isMetricsShort = (Number(line.naturalWidth) || 0) < (Number(line.width) || 0) - 2;
      const isContinuationCut = isContinuationCandidate
        && line.words && line.words.length > 0
        && (isMetricsShort || isV9StreamLikeStretchBox);
      const useManualContinuationStretch = isContinuationCut && continuationFillRatio < 0.65;
      const isRegularMidLine = !line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1;
      const isV9ForcedStreamJustify = isV9StreamLikeStretchBox && isRegularMidLine && !isMetricsShort;
      const shouldJustify = (isRegularMidLine || isContinuationCut)
                             && !useManualContinuationStretch
                             && line.words && line.words.length > 1
                             && (isMetricsShort || isV9StreamLikeStretchBox);`;

  if (source.includes(composedBefore)) return source.replace(composedBefore, composedAfter);

  const simpleBefore = `      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1
        && line.naturalWidth < line.width - 2;
      const useManualContinuationStretch = isContinuationCut && continuationFillRatio < 0.65;
      const shouldJustify = ((!line.isLast && !line.forcedBreak) || isContinuationCut)
                             && !useManualContinuationStretch
                             && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);`;

  const simpleAfter = `      const isV9StreamLikeStretchBox = String(box.role || box.type || box.kind || (box.id === "main" ? "main" : (box.id ? "stream" : ""))).toLowerCase() !== "main";
      const isColumnAContinuation = false;
      const isSourceContinuationEnd = false;
      const isContinuationCandidate = !!box.continues && line.isLast && !line.forcedBreak;
      const isMetricsShort = (Number(line.naturalWidth) || 0) < (Number(line.width) || 0) - 2;
      const isContinuationCut = isContinuationCandidate
        && line.words && line.words.length > 0
        && (isMetricsShort || isV9StreamLikeStretchBox);
      const useManualContinuationStretch = isContinuationCut && continuationFillRatio < 0.65;
      const isRegularMidLine = !line.isLast && !line.forcedBreak
        && line.words && line.words.length > 1;
      const isV9ForcedStreamJustify = isV9StreamLikeStretchBox && isRegularMidLine && !isMetricsShort;
      const shouldJustify = (isRegularMidLine || isContinuationCut)
                             && !useManualContinuationStretch
                             && line.words && line.words.length > 1
                             && (isMetricsShort || isV9StreamLikeStretchBox);`;

  if (source.includes(simpleBefore)) return source.replace(simpleBefore, simpleAfter);

  const simpleBeforeOneWord = `      const isContinuationCut = !!box.continues && line.isLast && !line.forcedBreak
        && line.words && line.words.length > 0
        && line.naturalWidth < line.width - 2;
      const useManualContinuationStretch = isContinuationCut && continuationFillRatio < 0.65;
      const shouldJustify = ((!line.isLast && !line.forcedBreak) || isContinuationCut)
                             && !useManualContinuationStretch
                             && line.words && line.words.length > 1
                             && (line.naturalWidth < line.width - 2);`;

  if (source.includes(simpleBeforeOneWord)) return source.replace(simpleBeforeOneWord, simpleAfter);

  fail("missing drawBox continuation/justify predicate anchor");
}

function patchDomMeasureHelper(source) {
  if (source.includes("function applyV9MeasuredStreamStretchGuard(")) return source;

  const helper = `
  function measureV9RenderedContentWidth(el) {
    try {
      if (!el || !el.firstChild) return 0;
      const r = document.createRange();
      r.selectNodeContents(el);
      const rect = r.getBoundingClientRect();
      r.detach && r.detach();
      return rect && Number.isFinite(rect.width) ? rect.width : 0;
    } catch (_) {
      return 0;
    }
  }

  function applyV9MeasuredStreamStretchGuard(lineEl, info) {
    if (!lineEl || !info || !info.isCandidate) return;
    if (lineEl.classList.contains('center')) return;
    if (lineEl.classList.contains('justify')) return;
    if (lineEl.classList.contains('v9-continuation-manual-stretch')) return;

    const targetWidth = Number(info.targetWidth) || Number.parseFloat(lineEl.style.width) || 0;
    if (!(targetWidth > 0)) return;

    const text = String(lineEl.textContent || '').trim();
    const wordCount = text ? text.split(/\\s+/).filter(Boolean).length : 0;
    if (wordCount < 2) return;

    const renderedWidth = measureV9RenderedContentWidth(lineEl);
    if (!(renderedWidth > 0)) return;

    const deficit = targetWidth - renderedWidth;
    const fill = renderedWidth / targetWidth;
    lineEl.dataset.v9RenderedFill = String(Math.max(0, Math.min(1, fill)).toFixed(4));

    if (deficit > 1.5) {
      lineEl.classList.add('justify');
      lineEl.dataset.v9MeasuredStreamStretch = '1';
      lineEl.dataset.v9MeasuredStretchDeficitPx = String(Math.round(deficit * 100) / 100);
    }
  }
`;

  const anchor = `
  function drawBox(box, fontSize, lineHeight, fontFamily, colorClass) {`;
  if (!source.includes(anchor)) fail("missing drawBox helper insertion anchor");
  return source.replace(anchor, helper + anchor);
}

function patchDebugDataset(source) {
  const after = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);
      if (isV9ForcedStreamJustify) lineEl.dataset.v9ForcedStreamJustify = "1";`;
  if (source.includes(after)) return source;

  const before = `      if (box.id) lineEl.dataset.v9BoxId = String(box.id);`;
  if (!source.includes(before)) fail("missing v9BoxId dataset anchor");
  return source.replace(before, after);
}

function patchAppendHook(source) {
  const after = `      pageEl.appendChild(lineEl);
      applyV9MeasuredStreamStretchGuard(lineEl, {
        isCandidate: isV9StreamLikeStretchBox && (isRegularMidLine || isContinuationCandidate),
        targetWidth: line.width,
      });`;
  if (source.includes(after)) return source;

  const before = `      pageEl.appendChild(lineEl);`;
  if (!source.includes(before)) fail("missing page append hook anchor");
  return source.replace(before, after);
}

function verify(source) {
  const required = [
    "const isV9StreamLikeStretchBox =",
    "const isMetricsShort =",
    "const isRegularMidLine =",
    "const isV9ForcedStreamJustify =",
    "&& (isMetricsShort || isV9StreamLikeStretchBox)",
    "function applyV9MeasuredStreamStretchGuard(",
    "lineEl.dataset.v9ForcedStreamJustify = \"1\"",
    "lineEl.dataset.v9MeasuredStreamStretch = '1'",
    "applyV9MeasuredStreamStretchGuard(lineEl",
  ];
  for (const needle of required) {
    if (!source.includes(needle)) fail(`missing ${needle}`);
  }
}

const before = readFile(TARGET);
let after = before;
after = patchContinuationAndJustifyPredicate(after);
after = patchDomMeasureHelper(after);
after = patchDebugDataset(after);
after = patchAppendHook(after);
verify(after);

if (after !== before) {
  fs.writeFileSync(TARGET, after);
  console.log(`[${MARKER}] patched ${TARGET}`);
} else {
  console.log(`[${MARKER}] patch noop for ${TARGET}`);
}
