// talmud_measurement_lab.js — hidden DOM region for measuring layout.
//
// Per v3 spec part 3: measurements taken on the live page are unreliable
// because the CSS being measured is itself in the middle of changing.
// The lab is a fixed off-screen div with the same width as the target page.
// Clones are appended, measured, and discarded.

let _lab = null;

function ensureLab(referenceWidthPx) {
  if (_lab && _lab.isConnected) {
    if (referenceWidthPx) _lab.style.width = `${referenceWidthPx}px`;
    _lab.innerHTML = "";
    return _lab;
  }
  _lab = document.createElement("div");
  _lab.id = "talmud-measurement-lab";
  _lab.style.cssText = `
    position: fixed;
    inset-inline-start: -10000px;
    top: 0;
    width: ${referenceWidthPx || 800}px;
    visibility: hidden;
    pointer-events: none;
    contain: layout style;
    z-index: -1;
  `;
  document.body.appendChild(_lab);
  return _lab;
}

export function destroyLab() {
  if (_lab) {
    _lab.remove();
    _lab = null;
  }
}

/**
 * Measure an element by cloning it into the lab.
 * The original is untouched.
 *
 * @param {HTMLElement} el
 * @param {{pageEl: HTMLElement, classes?: string[], style?: Object}} opts
 * @returns {{width: number, height: number, lineCount: number, lineHeight: number}}
 */
export function measure(el, opts = {}) {
  const refWidth = opts.pageEl
    ? opts.pageEl.getBoundingClientRect().width
    : 800;
  const lab = ensureLab(refWidth);
  const clone = el.cloneNode(true);
  if (opts.classes) clone.classList.add(...opts.classes);
  if (opts.style) {
    for (const [k, v] of Object.entries(opts.style)) {
      clone.style[k] = v;
    }
  }
  lab.appendChild(clone);
  const rect = clone.getBoundingClientRect();
  const lineCount = countVisualLines(clone);
  const lineHeight = getLineHeight(clone);
  const result = {
    width: rect.width,
    height: rect.height,
    lineCount,
    lineHeight,
  };
  return result;
}

export function countVisualLines(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects())
    .filter(r => r.width > 0 || r.height > 0);
  const distinctTops = new Set(rects.map(r => Math.round(r.top)));
  return distinctTops.size;
}

export function getLineHeight(el) {
  const cs = getComputedStyle(el);
  return (
    parseFloat(cs.lineHeight) ||
    (parseFloat(cs.fontSize) * 1.4) ||
    14
  );
}

/**
 * Convenience: measure a commentary at 50% width with crown classes applied.
 */
export function measureCommentaryAt50pct(commentaryEl, pageEl, sideGapPx = 12) {
  const halfGap = sideGapPx / 2;
  return measure(commentaryEl, {
    pageEl,
    classes: ["talmud-crown-portion"],
    style: {
      width: `calc(50% - ${halfGap}px)`,
      float: "right",
      clear: "right",
    },
  });
}

export function measureCommentaryAtFullWidth(commentaryEl, pageEl) {
  return measure(commentaryEl, {
    pageEl,
    classes: ["talmud-crown-portion", "talmud-crown-full"],
    style: { width: "100%", float: "right", clear: "right" },
  });
}

export function measureCommentaryAtSideWidth(commentaryEl, pageEl, sideWidthPct = 29) {
  return measure(commentaryEl, {
    pageEl,
    classes: ["talmud-body-portion"],
    style: {
      width: `${sideWidthPct}%`,
      float: "right",
      clear: "right",
    },
  });
}
