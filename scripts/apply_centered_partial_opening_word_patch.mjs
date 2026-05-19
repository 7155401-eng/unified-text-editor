import fs from 'node:fs';

const TARGET = 'src/opening_word.js';

function replaceOnce(source, search, replacement, label, marker) {
  if (marker && source.includes(marker)) return source;
  if (!source.includes(search)) {
    throw new Error(`[centered-partial-opening-word] anchor not found: ${label}`);
  }
  return source.replace(search, replacement);
}

const CENTERED_PARTIAL_HELPERS = `
const CENTERED_OPENING_LINE_FILL_RATIO = 0.92;

function numberOrZero(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function isCenterAlignedElement(el, options = {}) {
  if (options.centerFull) return true;
  if (!el || typeof getComputedStyle !== "function") return false;
  const cs = getComputedStyle(el);
  const textAlign = String(cs.textAlign || "").toLowerCase();
  const textAlignLast = String(cs.textAlignLast || "").toLowerCase();
  if (textAlign === "center" || textAlignLast === "center") return true;
  const display = String(cs.display || "").toLowerCase();
  const justifyContent = String(cs.justifyContent || "").toLowerCase();
  return (display.includes("flex") || display.includes("grid")) && justifyContent.includes("center");
}

function firstVisualLineWidth(el) {
  if (!el || typeof document === "undefined" || typeof document.createRange !== "function") return 0;
  const range = document.createRange();
  try {
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
    if (!rects.length) return 0;
    const firstTop = Math.round(rects[0].top);
    const firstLineRects = rects.filter((rect) => Math.abs(rect.top - firstTop) < 2);
    if (!firstLineRects.length) return 0;
    const left = Math.min(...firstLineRects.map((rect) => rect.left));
    const right = Math.max(...firstLineRects.map((rect) => rect.right));
    return Math.max(0, right - left);
  } finally {
    if (typeof range.detach === "function") range.detach();
  }
}

function measureSingleLineTextWidth(text, refEl, cs) {
  if (typeof document === "undefined" || !document.body || typeof getComputedStyle !== "function") return 0;
  const style = cs || getComputedStyle(refEl);
  const probe = document.createElement("span");
  probe.style.cssText = \`
    position: fixed;
    inset-inline-start: -10000px;
    top: 0;
    visibility: hidden;
    white-space: nowrap;
    pointer-events: none;
    font: \${style.font};
    letter-spacing: \${style.letterSpacing};
    word-spacing: \${style.wordSpacing};
  \`;
  probe.textContent = String(text || "");
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width || 0;
  probe.remove();
  return width;
}

function isCenteredPartialOpeningLine(el, text, options = {}) {
  if (!isCenterAlignedElement(el, options)) return false;
  if (!el || typeof getComputedStyle !== "function") return !!options.centerFull;

  const cs = getComputedStyle(el);
  const hostRect = typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
  const hostWidth = (hostRect && hostRect.width) || numberOrZero(cs.width);
  if (!hostWidth) return true;

  const lineWidth = firstVisualLineWidth(el) || measureSingleLineTextWidth(text, el, cs);
  if (!lineWidth) return true;

  return lineWidth < hostWidth * CENTERED_OPENING_LINE_FILL_RATIO;
}
`;

function patchOpeningWord(source) {
  source = source.replace(/\r\n/g, '\n');

  if (!source.includes('CENTERED_OPENING_LINE_FILL_RATIO')) {
    const helperAnchor = 'function applySpanStyle(span, settings, effectivePosition) {';
    if (!source.includes(helperAnchor)) {
      throw new Error('[centered-partial-opening-word] anchor not found: helper insertion');
    }
    source = source.replace(helperAnchor, `${CENTERED_PARTIAL_HELPERS}\n${helperAnchor}`);
  }

  source = replaceOnce(
    source,
    `  const shortFallback = (settings.skipHeadings && len < settings.headingMin) || options._forceRaised;
  const effectivePosition = settings.position === "dropped" && !shortFallback ? "dropped" : "raised";`,
    `  const centeredPartialLine = settings.position === "dropped" && isCenteredPartialOpeningLine(el, fullText, options);
  const shortFallback = (settings.skipHeadings && len < settings.headingMin) || options._forceRaised || centeredPartialLine;
  const effectivePosition = settings.position === "dropped" && !shortFallback ? "dropped" : "raised";`,
    'centered partial line fallback',
    'const centeredPartialLine = settings.position === "dropped"'
  );

  source = replaceOnce(
    source,
    `  if (options.centerFull && effectivePosition === "raised") {
    el.classList.add("opw-center-full");
  }`,
    `  if ((options.centerFull || centeredPartialLine) && effectivePosition === "raised") {
    el.classList.add("opw-center-full");
  }
  if (centeredPartialLine) {
    el.dataset.opwCenteredPartial = "1";
  }`,
    'centered partial line center class',
    'el.dataset.opwCenteredPartial = "1";'
  );

  return source;
}

const before = fs.readFileSync(TARGET, 'utf8');
const after = patchOpeningWord(before);

if (after !== before) {
  fs.writeFileSync(TARGET, after);
  console.log(`[centered-partial-opening-word] patched ${TARGET}`);
} else {
  console.log(`[centered-partial-opening-word] no changes needed for ${TARGET}`);
}
