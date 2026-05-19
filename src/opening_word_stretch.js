// opening_word_stretch.js — post-processes opening words after opening_word.js.
// It now also stabilizes the RTL dropped-word "window": the large opening word
// floats on the right, reserves exactly N normal line-heights, and does not
// change the line-height of either the opening line or the following line.

const STRETCH_CAP = 2.5;
const MIN_REMAINING_CHAR_RATIO = 2; // if at least 2 average char-widths fit, don't stretch

function numberOrZero(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function computedLineHeightPx(el) {
  if (!el || typeof getComputedStyle !== "function") return 0;
  const cs = getComputedStyle(el);
  const explicit = numberOrZero(cs.lineHeight);
  if (explicit > 0) return explicit;
  const fontSize = numberOrZero(cs.fontSize);
  return fontSize > 0 ? fontSize * 1.4 : 0;
}

function openingHostFor(opw, root) {
  return (
    opw.closest?.(".opw-host, p, .note-part, .note, .v9-line, .page-main, .stream, .talmud-main") ||
    opw.parentElement ||
    root ||
    opw
  );
}

function dropLineCount(opw) {
  const cssValue = opw.style?.getPropertyValue("--opw-drop-lines");
  const value = numberOrZero(cssValue || opw.dataset?.opwDropLines || 0);
  return Math.max(1, Math.round(value || 1));
}

function spaceAfterValue(opw) {
  const cssValue = opw.style?.getPropertyValue("--opw-space-after");
  return cssValue && cssValue.trim() ? cssValue.trim() : "0.3em";
}

function stabilizeDroppedOpeningWord(opw, root) {
  if (!opw || !opw.classList?.contains("opw-dropped")) return;

  const host = openingHostFor(opw, root);
  const lineHeight = computedLineHeightPx(host);
  const lines = dropLineCount(opw);
  const windowHeight = lineHeight > 0 ? lineHeight * lines : 0;
  const spaceAfter = spaceAfterValue(opw);

  opw.style.float = "right";
  opw.style.marginRight = "0";
  opw.style.marginLeft = spaceAfter;
  opw.style.shapeMargin = spaceAfter;
  opw.style.verticalAlign = "top";
  opw.style.overflow = "visible";
  opw.style.contain = "layout paint";

  // The key fix: the dropped word reserves a window of normal text lines,
  // while its own glyph size remains controlled by the user's opening-word style.
  if (lineHeight > 0) {
    opw.style.setProperty("--opw-base-line-height", `${lineHeight}px`);
    opw.style.lineHeight = `${lineHeight}px`;
    opw.style.height = `${windowHeight}px`;
    opw.style.minHeight = `${windowHeight}px`;
  }

  // Do not let margins on the host change paragraph rhythm.
  if (host?.style) {
    host.style.marginTop = host.style.marginTop || "0px";
    host.style.marginBottom = host.style.marginBottom || "0px";
  }

  opw.dataset.opwWindowStable = "1";
}

function getNaturalWidth(originalEl) {
  const probe = document.createElement("span");
  probe.style.cssText = `
    position: fixed;
    inset-inline-start: -10000px;
    top: 0;
    visibility: hidden;
    white-space: nowrap;
    pointer-events: none;
    font: ${getComputedStyle(originalEl).font};
  `;
  probe.textContent = originalEl.textContent || "";
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

function buildStretchedSvg(word, naturalWidth, targetWidth, refEl) {
  const cappedWidth = Math.min(targetWidth, naturalWidth * STRETCH_CAP);
  const cs = getComputedStyle(refEl);
  const fontSize = numberOrZero(cs.fontSize) || 16;
  const refRect = refEl.getBoundingClientRect();
  const heightPx = refRect && refRect.height > 0
    ? refRect.height
    : Math.max(fontSize * 1.3, fontSize + 4);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(cappedWidth));
  svg.setAttribute("height", String(heightPx));
  svg.classList.add("opening-word-svg");
  svg.dataset.opwNaturalWidth = String(naturalWidth);
  svg.dataset.opwAppliedWidth = String(cappedWidth);
  svg.style.display = "inline-block";
  svg.style.verticalAlign = "baseline";
  svg.style.overflow = "visible";

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(cappedWidth));
  text.setAttribute("y", String(fontSize));
  text.setAttribute("direction", "rtl");
  text.setAttribute("text-anchor", "end");
  text.setAttribute("font-family", cs.fontFamily);
  text.setAttribute("font-size", String(fontSize));
  text.setAttribute("font-weight", cs.fontWeight);
  text.setAttribute("fill", cs.color);
  text.setAttribute("textLength", String(cappedWidth));
  text.setAttribute("lengthAdjust", "spacingAndGlyphs");
  text.textContent = word;
  svg.appendChild(text);

  return { svg, cappedWidth };
}

function firstVisualLineRects(line) {
  const range = document.createRange();
  range.selectNodeContents(line);
  const rects = Array.from(range.getClientRects()).filter(r => r.width || r.height);
  range.detach?.();
  if (!rects.length) return [];
  const firstLineY = Math.round(rects[0].top);
  return rects.filter(r => Math.abs(r.top - firstLineY) < 2);
}

function shouldStretch(opw, naturalWidth, line) {
  const lineRect = line.getBoundingClientRect();
  if (!lineRect.width || !naturalWidth) return false;

  const firstLine = firstVisualLineRects(line);
  if (!firstLine.length) return false;

  const usedW = Math.max(...firstLine.map(r => r.right)) - Math.min(...firstLine.map(r => r.left));
  const remaining = lineRect.width - usedW;
  const avgCharW = naturalWidth / Math.max(1, (opw.textContent || "").trim().length);
  return remaining <= avgCharW * MIN_REMAINING_CHAR_RATIO;
}

function copyOpeningMetadata(fromEl, toEl) {
  if (fromEl.classList?.length) {
    toEl.classList.add(...Array.from(fromEl.classList));
  }
  for (const name of ["--opw-drop-lines", "--opw-space-after", "--opw-base-line-height"]) {
    const value = fromEl.style?.getPropertyValue(name);
    if (value) toEl.style.setProperty(name, value);
  }
  if (fromEl.dataset?.opwDropLines) toEl.dataset.opwDropLines = fromEl.dataset.opwDropLines;
}

function processOpeningWord(opw, root) {
  if (!opw || opw.dataset.opwStretchProcessed === "1") return;
  if (opw.tagName?.toLowerCase() === "svg") {
    stabilizeDroppedOpeningWord(opw, root);
    opw.dataset.opwStretchProcessed = "1";
    return;
  }

  stabilizeDroppedOpeningWord(opw, root);

  const word = (opw.textContent || "").trim();
  if (!word) {
    opw.dataset.opwStretchProcessed = "1";
    return;
  }

  const naturalWidth = opw.getBoundingClientRect().width || getNaturalWidth(opw);
  if (!naturalWidth) {
    opw.dataset.opwStretchProcessed = "1";
    return;
  }

  const line = opw.closest("p, div, .opening-word-line, .talmud-main, .page-main, .stream") || root;
  if (!line || !shouldStretch(opw, naturalWidth, line)) {
    opw.dataset.opwStretchProcessed = "1";
    return;
  }

  const targetWidth = line.getBoundingClientRect().width || naturalWidth;
  const { svg } = buildStretchedSvg(word, naturalWidth, targetWidth, opw);
  copyOpeningMetadata(opw, svg);
  svg.dataset.opwStretchProcessed = "1";
  opw.replaceWith(svg);
  stabilizeDroppedOpeningWord(svg, root);
}

function processRoot(root) {
  if (!root) return;
  const opws = Array.from(root.querySelectorAll(".opening-word, .opw, .opw-segment"));
  for (const opw of opws) processOpeningWord(opw, root);
}

export function applyOpeningWordStretchToPage(pageEl) {
  if (!pageEl) return;
  const roots = Array.from(pageEl.querySelectorAll(".talmud-main, .page-main, .stream, .v9-page"));
  if (!roots.length) {
    processRoot(pageEl);
    return;
  }
  for (const root of roots) processRoot(root);
}

export function applyOpeningWordStretchToPages(container) {
  if (!container) return;
  container.querySelectorAll(".page:not(.page-placeholder)").forEach(page => {
    applyOpeningWordStretchToPage(page);
  });
}
