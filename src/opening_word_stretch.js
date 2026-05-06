// opening_word_stretch.js — enforces the 250% stretch cap (bugs 17 & 18).
//
// Per v3 spec part 12 + GPT-13. Runs AFTER applyOpeningWordsToPages.
// It walks every .opening-word inside .talmud-main, decides whether the word
// needs stretching, and replaces it with an SVG that uses textLength +
// lengthAdjust='spacingAndGlyphs' so the glyphs themselves stretch
// proportionally — capped at 250% of the word's natural width.

const STRETCH_CAP = 2.5;
const MIN_REMAINING_CHAR_RATIO = 2; // if at least 2 average char-widths fit, don't stretch

function getNaturalWidth(originalEl) {
  // Clone into an off-screen span to measure unstretched.
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
  const fontSize = parseFloat(cs.fontSize) || 16;
  // משה 2026-05-06: גובה SVG לפי מדידה אמיתית של הטקסט המקורי, לא לפי הערכת
  // fontSize × 1.3. המדידה דרך getBoundingClientRect של refEl.
  const refRect = refEl.getBoundingClientRect();
  const heightPx = (refRect && refRect.height > 0)
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

function lineEndsAtRight(opwEl, parentEl) {
  // For RTL, the line "ends" at the left edge. We need to know how much
  // space is left on the line after this opw, on the *trailing* side.
  const opwRect = opwEl.getBoundingClientRect();
  const parentRect = parentEl.getBoundingClientRect();
  // Distance from this word's leading edge to the line's leading edge.
  const remaining = opwRect.left - parentRect.left;
  // For RTL: the word starts at the right; remaining = parent.left to word.left
  return remaining;
}

/**
 * @param {HTMLElement} root  — the .talmud-main element
 */
function processMain(root) {
  const opws = Array.from(root.querySelectorAll(".opening-word, .opw"));
  for (const opw of opws) {
    if (opw.dataset.opwStretchProcessed === "1") continue;
    if (opw.tagName.toLowerCase() === "svg") continue; // already an svg
    const word = (opw.textContent || "").trim();
    if (!word) continue;

    const wordRect = opw.getBoundingClientRect();
    const naturalWidth = wordRect.width || getNaturalWidth(opw);
    if (!naturalWidth) continue;

    // Find the line container — usually the immediate paragraph
    const line = opw.closest("p, div, .opening-word-line, .talmud-main") || root;
    const lineRect = line.getBoundingClientRect();
    if (!lineRect.width) continue;

    // How much trailing space is empty on this line?
    // Heuristic: compute via Range to the *end* of the parent-line's first
    // visual line.
    const range = document.createRange();
    range.selectNodeContents(line);
    const lineRects = Array.from(range.getClientRects()).filter(
      r => r.width || r.height
    );
    if (!lineRects.length) continue;
    const firstLineY = Math.round(lineRects[0].top);
    const firstLine = lineRects.filter(r => Math.abs(r.top - firstLineY) < 2);
    const usedW = Math.max(...firstLine.map(r => r.right)) -
      Math.min(...firstLine.map(r => r.left));
    const remaining = lineRect.width - usedW;
    const avgCharW = naturalWidth / Math.max(1, word.length);

    if (remaining > avgCharW * MIN_REMAINING_CHAR_RATIO) {
      // There's room for more text — don't stretch.
      opw.dataset.opwStretchProcessed = "1";
      continue;
    }

    // Stretch is justified.
    const targetWidth = lineRect.width;
    const { svg, cappedWidth } = buildStretchedSvg(
      word,
      naturalWidth,
      targetWidth,
      opw
    );
    svg.dataset.opwStretchProcessed = "1";
    // Preserve any inline classes from the source so styles cascade.
    if (opw.classList.length) {
      svg.classList.add(...Array.from(opw.classList));
    }
    opw.replaceWith(svg);
  }
}

/**
 * Apply the stretch logic to every .talmud-main on the page.
 */
export function applyOpeningWordStretchToPage(pageEl) {
  if (!pageEl) return;
  const mains = pageEl.querySelectorAll(".talmud-main");
  for (const main of mains) processMain(main);
}

export function applyOpeningWordStretchToPages(container) {
  if (!container) return;
  container.querySelectorAll(".page:not(.page-placeholder)").forEach(p => {
    applyOpeningWordStretchToPage(p);
  });
}
