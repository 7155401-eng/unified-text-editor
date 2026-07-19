import { logMove, logEvent } from "./settings_pane.js";
import { pullBackwardAcrossAllPages } from "./talmud_pull_backward.js";

// talmud_repagination.js — v34 integrated pagination hook.
//
// Previous ad-hoc cross-page moves caused text duplication via ledger conflicts.
// Current strategy keeps one engine pipeline and coordinates only safe operations
// on the transient layout DOM after all render/style changes have settled.
//
//   • IN-PAGE VISUAL CAP for catastrophic overflow.
//     Cap the height of an oversized body via overflow: hidden + a marker
//     "←המשך בעמוד הבא". Content remains in DOM (lossless), only visually
//     truncated. The engine on the next render starts fresh; on user edit
//     the engine repaginates and overflow may resolve naturally.
//
//   • SAFE PULL-BACKWARD for large gaps lives in talmud_pull_backward.js and is
//     called from this hook so gap filling is synchronized with the same engine.
//
// All operations leave the source ledger untouched. They mutate only transient layout DOM that lives between renders.

const CATASTROPHIC_RATIO = 2;     // overflow > 2× page-height counts as catastrophic
const CONTINUATION_LABEL = " ←המשך בעמוד הבא";

function pageOverflowRatio(pageEl) {
  const overflow = pageEl.scrollHeight - pageEl.clientHeight;
  const pageH = Math.max(400, pageEl.clientHeight || 537);
  return overflow / pageH;
}

// In-page visual cap: limits visible height of huge bodies without removing.
function capOverflowingBodies(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return false;
  const pageH = Math.max(400, pageEl.clientHeight || 537);
  const maxBodyH = Math.floor(pageH * 0.95); // leave a thin band

  let didCap = false;
  // v33-restructure: bodies may be nested inside .page-main; deep query.
  const candidates = block.querySelectorAll(
    ".talmud-body-expanded, .talmud-body-portion"
  );
  for (const el of candidates) {
    const h = el.getBoundingClientRect().height;
    if (h > maxBodyH) {
      logMove("cap-body-height", {
        el,
        trigger: "catastrophic overflow > 2× page-height",
        reason: `body was ${Math.round(h)}px, capped at ${Math.round(maxBodyH)}px`,
      });
      el.style.maxHeight = `${maxBodyH}px`;
      el.style.overflow = "hidden";
      el.dataset.talmudCappedAt = String(Math.round(maxBodyH));
      el.dataset.talmudFullHeight = String(Math.round(h));
      if (!el.querySelector(":scope > .talmud-continuation-marker")) {
        const marker = document.createElement("span");
        marker.className = "talmud-continuation-marker";
        marker.textContent = CONTINUATION_LABEL;
        marker.style.cssText =
          "display:block;font-size:0.85em;color:#888;text-align:center;" +
          "padding:2px 0;font-style:italic;";
        el.appendChild(marker);
      }
      didCap = true;
    }
  }
  return didCap;
}

function uncapBodies(pageEl) {
  const block = pageEl.querySelector(":scope > .talmud-layout");
  if (!block) return;
  block.querySelectorAll("[data-talmud-capped-at]").forEach(el => {
    el.style.maxHeight = "";
    el.style.overflow = "";
    delete el.dataset.talmudCappedAt;
    delete el.dataset.talmudFullHeight;
    const m = el.querySelector(":scope > .talmud-continuation-marker");
    if (m) m.remove();
  });
}

export function correctOnePage(pageEl) {
  if (!pageEl) return false;
  uncapBodies(pageEl);
  if (pageOverflowRatio(pageEl) >= CATASTROPHIC_RATIO) {
    return capOverflowingBodies(pageEl);
  }
  return false;
}

export function correctTalmudOverflow(container) {
  if (!container) return 0;
  let count = 0;
  container.querySelectorAll(
    ".pages-container .page:not(.page-placeholder), .page:not(.page-placeholder)"
  ).forEach(p => { if (correctOnePage(p)) count++; });
  return count;
}

export function correctTalmudOverflowOnPage(pageEl) {
  return correctOnePage(pageEl) ? 1 : 0;
}

// Public surface kept for engine_bridge.js: this is still the same pagination
// pipeline hook, not a second engine. It runs after render/style application, so
// measurements are taken from the actual styled DOM. First cap truly catastrophic
// overflows, then let the existing safe pull-back pass fill page gaps.
export function repaginateCatastrophicPages(container) {
  if (!container) return { passes: 0, fixed: 0 };

  let passes = 0;
  let fixed = 0;
  const MAX_PASSES = 3;

  for (let i = 0; i < MAX_PASSES; i++) {
    const capped = correctTalmudOverflow(container);
    const pulled = pullBackwardAcrossAllPages(container);
    const changed = (capped || 0) + (pulled || 0);

    if (!changed) break;
    passes++;
    fixed += changed;
  }

  return { passes, fixed };
}
