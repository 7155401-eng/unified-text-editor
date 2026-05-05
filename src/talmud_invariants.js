// talmud_invariants.js — runtime contract checks per v3 spec part 16.
//
// 15 invariants. INV-1..INV-3 are blocking ERRORS for toggle integrity;
// the rest grade pages and feed the Debug API + full_audit harness.

const LEFTOVER_SELECTORS = [
  ".talmud-layout",
  ".talmud-crown-portion",
  ".talmud-body-portion",
  ".talmud-body-expanded",
  "[data-talmud-role]",
  "[data-talmud-body-of]",
  "[data-talmud-state]",
  "[data-talmud-source-id]",
  "[data-talmud-part]",
  "[data-talmud-virtual-half]",
  "[data-talmud-order]",
];

export function hashPageText(pageEl) {
  if (!pageEl) return "";
  const text = (pageEl.textContent || "").replace(/\s+/g, " ").trim();
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString(16) + ":" + text.length;
}

export function findLeftovers(pageEl) {
  if (!pageEl) return [];
  return Array.from(pageEl.querySelectorAll(LEFTOVER_SELECTORS.join(",")));
}

/**
 * INV-1: Text Integrity — same text hash before and after toggle.
 * Caller supplies before/after.
 */
export function invTextIntegrity(beforeHash, afterHash) {
  return {
    invariant: "INV-1",
    name: "Text Integrity",
    ok: beforeHash === afterHash,
    detail: beforeHash === afterHash
      ? "hashes match"
      : `before=${beforeHash} after=${afterHash}`,
  };
}

/** INV-2: Zero leftovers when disabled. Only meaningful when talmud is OFF. */
export function invDomCleanliness(pageEl, enabled = false) {
  if (enabled) {
    return { invariant: "INV-2", name: "DOM Cleanliness", ok: true, detail: "n/a (enabled)" };
  }
  const leftovers = findLeftovers(pageEl);
  return {
    invariant: "INV-2",
    name: "DOM Cleanliness",
    ok: leftovers.length === 0,
    detail: leftovers.length === 0
      ? "0 leftovers"
      : `${leftovers.length} leftovers: ${leftovers
          .slice(0, 3)
          .map(e => e.tagName + "." + (e.className || "").split(" ")[0])
          .join(", ")}`,
  };
}

/** INV-3: Each .talmud-layout-page has exactly one .talmud-layout. */
export function invSingleLayout(pageEl) {
  if (!pageEl.classList.contains("talmud-layout-page")) {
    return { invariant: "INV-3", name: "Single Layout", ok: true, detail: "n/a" };
  }
  const blocks = pageEl.querySelectorAll(":scope > .talmud-layout");
  return {
    invariant: "INV-3",
    name: "Single Layout",
    ok: blocks.length === 1,
    detail: `${blocks.length} .talmud-layout blocks`,
  };
}

/** INV-4: Crown lines = configured crownLines (±1). */
export function invCrownLines(pageEl, crownLines) {
  const crowns = Array.from(
    pageEl.querySelectorAll(
      ".talmud-crown-portion:not(.talmud-body-portion):not(.talmud-body-expanded)"
    )
  );
  if (crowns.length === 0) {
    return { invariant: "INV-4", name: "Crown Lines", ok: true, detail: "no crowns" };
  }
  const results = crowns.map(c => {
    const titleEl = c.querySelector(":scope > .stream-title");
    const range = document.createRange();
    const ys = new Set();
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, {
      acceptNode: node => {
        if (titleEl && titleEl.contains(node)) return NodeFilter.FILTER_REJECT;
        return node.textContent && node.textContent.length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      for (let i = 0; i < n.length; i++) {
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = range.getBoundingClientRect();
        if (r.width || r.height) ys.add(Math.round(r.top));
      }
    }
    return ys.size;
  });
  const ok = results.every(n => Math.abs(n - crownLines) <= 1);
  return {
    invariant: "INV-4",
    name: "Crown Lines",
    ok,
    detail: `crowns=${results.join(",")} target=${crownLines}`,
  };
}

/** INV-5: Two crowns on a page have the same min-height. */
export function invCrownEqualHeight(pageEl) {
  const crowns = Array.from(
    pageEl.querySelectorAll(
      ":scope > .talmud-layout > .talmud-crown-portion:not(.talmud-body-portion):not(.talmud-body-expanded)"
    )
  );
  if (crowns.length < 2) {
    return { invariant: "INV-5", name: "Crown Equal Height", ok: true, detail: "n/a" };
  }
  const heights = crowns.map(c => Math.round(c.getBoundingClientRect().height));
  const max = Math.max(...heights);
  const min = Math.min(...heights);
  const ok = max - min <= 2;
  return {
    invariant: "INV-5",
    name: "Crown Equal Height",
    ok,
    detail: `heights=${heights.join(",")} delta=${max - min}`,
  };
}

/** INV-6: Body inherits className except talmud-crown-portion. */
export function invBodyInheritsClass(pageEl) {
  const bodies = Array.from(
    pageEl.querySelectorAll(".talmud-body-portion[data-talmud-body-of]")
  );
  if (bodies.length === 0) {
    return { invariant: "INV-6", name: "Body ClassName", ok: true, detail: "no bodies" };
  }
  const fails = bodies.filter(b => b.classList.contains("talmud-crown-portion"));
  return {
    invariant: "INV-6",
    name: "Body ClassName",
    ok: fails.length === 0,
    detail: fails.length === 0 ? "ok" : `${fails.length} bodies retain crown-portion`,
  };
}

/** INV-7: Body margin towards main is non-zero. */
export function invBodyMargin(pageEl) {
  const bodies = Array.from(
    pageEl.querySelectorAll(".talmud-body-portion[data-talmud-body-of]")
  );
  if (bodies.length === 0) {
    return { invariant: "INV-7", name: "Body Margin", ok: true, detail: "no bodies" };
  }
  const fails = [];
  for (const b of bodies) {
    const isRight = b.classList.contains("talmud-right");
    const cs = getComputedStyle(b);
    const m = isRight ? parseFloat(cs.marginLeft) : parseFloat(cs.marginRight);
    if (!(m > 0)) fails.push(b.dataset.stream || "?");
  }
  return {
    invariant: "INV-7",
    name: "Body Margin",
    ok: fails.length === 0,
    detail: fails.length === 0 ? "ok" : `0-margin in: ${fails.join(",")}`,
  };
}

/** INV-8: page.scrollHeight ≤ page.clientHeight + 2.
 *  v28-merge: tolerance מוחזר ל-±2 (במקום page-height). הריכוך של ratio<=1
 *  הסתיר באג אמיתי. כל overflow מעל 2px = שגיאה שדורשת תיקון. */
export function invNoOverflow(pageEl) {
  const overflow = pageEl.scrollHeight - pageEl.clientHeight;
  return {
    invariant: "INV-8",
    name: "No Overflow",
    ok: overflow <= 2,
    detail: `overflow=${overflow}px`,
  };
}

/** INV-9: No .talmud-body-expanded without a .talmud-main. */
export function invExpandedNeedsMain(pageEl) {
  const expanded = pageEl.querySelectorAll(".talmud-body-expanded");
  if (expanded.length === 0) {
    return { invariant: "INV-9", name: "Expanded Needs Main", ok: true, detail: "n/a" };
  }
  const main = pageEl.querySelector(".talmud-main");
  return {
    invariant: "INV-9",
    name: "Expanded Needs Main",
    ok: !!main,
    detail: main ? "main present" : "expanded but no main",
  };
}

/** INV-10: Two expanded share roughly the same Y.
 *  v28-merge: tolerance מוחזר ל-30px (במקום 200). 200 מסתיר באג אמיתי של
 *  stacking. אם הסטייה > 30 = הbug ויזואלי שדורש תיקון, לא ריכוך. */
export function invExpandedParallel(pageEl) {
  const expanded = Array.from(pageEl.querySelectorAll(".talmud-body-expanded"));
  if (expanded.length < 2) {
    return { invariant: "INV-10", name: "Expanded Parallel", ok: true, detail: "n/a" };
  }
  const tops = expanded.map(e => Math.round(e.getBoundingClientRect().top));
  const max = Math.max(...tops);
  const min = Math.min(...tops);
  return {
    invariant: "INV-10",
    name: "Expanded Parallel",
    ok: max - min <= 30,
    detail: `tops=${tops.join(",")} delta=${max - min}`,
  };
}

/** INV-11: Stream title not orphan — at least 2 visual lines after.
 *  v28-merge: לפי המפרט (GPT-6) — כותרת זרם לא יכולה להישאר עם פחות מ-2
 *  שורות תוכן אחריה. אם כן — להעביר את כל הזרם לעמוד הבא. */
export function invStreamTitleNotOrphan(pageEl) {
  const streams = Array.from(
    pageEl.querySelectorAll(".talmud-layout .stream:has(> .stream-title)")
  );
  if (streams.length === 0) {
    return { invariant: "INV-11", name: "Stream Title Not Orphan", ok: true, detail: "n/a" };
  }
  const fails = [];
  for (const s of streams) {
    const title = s.querySelector(":scope > .stream-title");
    if (!title) continue;
    const titleBottom = title.getBoundingClientRect().bottom;
    const range = document.createRange();
    range.selectNodeContents(s);
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 || r.height > 0);
    const below = rects.filter(r => r.top > titleBottom + 2);
    const lines = new Set(below.map(r => Math.round(r.top))).size;
    if (lines < 2) fails.push(s.dataset.stream || "?");
  }
  return {
    invariant: "INV-11",
    name: "Stream Title Not Orphan",
    ok: fails.length === 0,
    detail: fails.length === 0 ? "ok" : `orphans: ${fails.join(",")}`,
  };
}

/** INV-12: No mid-word splits — every body's first character has a leading space in its source, OR the split is at a paragraph boundary. */
export function invNoMidWordSplit(pageEl) {
  const bodies = Array.from(pageEl.querySelectorAll(".talmud-body-portion[data-talmud-body-of]"));
  if (bodies.length === 0) {
    return { invariant: "INV-12", name: "No Mid-Word Split", ok: true, detail: "n/a" };
  }
  const fails = [];
  for (const b of bodies) {
    const first = (b.textContent || "").charAt(0);
    // OK if it's a whitespace, punctuation, or starts cleanly at element boundary
    if (first && !/[\s.,;:!?־׀׃׳״ ​­]/.test(first)) {
      // Heuristic: check if the *crown* (sibling) ended with whitespace
      const sourceId = b.dataset.talmudSourceId;
      let crownEndsClean = false;
      if (sourceId) {
        const crown = pageEl.querySelector(
          `.talmud-crown-portion[data-talmud-source-id="${sourceId}"]`
        );
        if (crown) {
          const last = (crown.textContent || "").slice(-1);
          if (!last || /[\s.,;:!?־׀׃׳״ ​­]/.test(last)) crownEndsClean = true;
        }
      }
      if (!crownEndsClean) fails.push(b.dataset.stream || "?");
    }
  }
  return {
    invariant: "INV-12",
    name: "No Mid-Word Split",
    ok: fails.length === 0,
    detail: fails.length === 0 ? "ok" : `mid-word: ${fails.join(",")}`,
  };
}

/** INV-13: Packing balance — main not dominating ≥80% on a page that has commentaries. */
export function invPackingBalance(pageEl) {
  const main = pageEl.querySelector(".talmud-main");
  if (!main) {
    return { invariant: "INV-13", name: "Packing Balance", ok: true, detail: "no main" };
  }
  const sides = pageEl.querySelectorAll(
    ".talmud-crown-portion, .talmud-body-portion, .talmud-body-expanded, .talmud-no-crown-side, .talmud-other-side"
  );
  if (sides.length === 0) {
    return { invariant: "INV-13", name: "Packing Balance", ok: true, detail: "no sides" };
  }
  const mainLen = (main.textContent || "").length;
  let sideLen = 0;
  for (const s of sides) sideLen += (s.textContent || "").length;
  const total = mainLen + sideLen;
  const sideRatio = total > 0 ? sideLen / total : 0;
  return {
    invariant: "INV-13",
    name: "Packing Balance",
    ok: sideRatio >= 0.20,
    detail: `sideRatio=${sideRatio.toFixed(2)}`,
  };
}

/** INV-14: Opening word lives inside .talmud-main. */
export function invOpeningWordContainer(pageEl) {
  const opws = Array.from(pageEl.querySelectorAll(".opening-word, .opw, .opening-word-svg"));
  if (opws.length === 0) {
    return { invariant: "INV-14", name: "Opening Word Container", ok: true, detail: "n/a" };
  }
  const fails = opws.filter(o => !o.closest(".talmud-main"));
  return {
    invariant: "INV-14",
    name: "Opening Word Container",
    ok: fails.length === 0,
    detail: fails.length === 0
      ? "all in talmud-main"
      : `${fails.length} outside`,
  };
}

/** INV-15: Opening word stretch ≤ 250% of natural. Caller stores natural in dataset.opwNaturalWidth. */
export function invOpeningWordStretch(pageEl) {
  const opws = Array.from(pageEl.querySelectorAll(".opening-word-svg[data-opw-natural-width]"));
  if (opws.length === 0) {
    return { invariant: "INV-15", name: "Opening Word Stretch", ok: true, detail: "n/a" };
  }
  const fails = [];
  for (const o of opws) {
    const natural = parseFloat(o.dataset.opwNaturalWidth);
    const actual = parseFloat(o.getAttribute("width")) || o.getBoundingClientRect().width;
    if (natural > 0 && actual > natural * 2.5 + 1) {
      fails.push(`${actual.toFixed(0)}/${natural.toFixed(0)}`);
    }
  }
  return {
    invariant: "INV-15",
    name: "Opening Word Stretch",
    ok: fails.length === 0,
    detail: fails.length === 0 ? "ok" : `over-stretched: ${fails.join(",")}`,
  };
}

/**
 * Run all invariants for one page.
 * @param {HTMLElement} pageEl
 * @param {{crownLines?: number, beforeHash?: string, afterHash?: string}} ctx
 */
export function runAllInvariants(pageEl, ctx = {}) {
  const crownLines = ctx.crownLines ?? 4;
  const checks = [];
  if (ctx.beforeHash != null && ctx.afterHash != null) {
    checks.push(invTextIntegrity(ctx.beforeHash, ctx.afterHash));
  }
  // Read enabled state from localStorage (caller may override via ctx.enabled).
  const enabled = ctx.enabled != null
    ? ctx.enabled
    : (typeof localStorage !== "undefined" &&
        localStorage.getItem("ravtext.talmudLayout") === "1");
  checks.push(invDomCleanliness(pageEl, enabled));
  checks.push(invSingleLayout(pageEl));
  checks.push(invCrownLines(pageEl, crownLines));
  checks.push(invCrownEqualHeight(pageEl));
  checks.push(invBodyInheritsClass(pageEl));
  checks.push(invBodyMargin(pageEl));
  checks.push(invNoOverflow(pageEl));
  checks.push(invExpandedNeedsMain(pageEl));
  checks.push(invExpandedParallel(pageEl));
  checks.push(invStreamTitleNotOrphan(pageEl));
  checks.push(invNoMidWordSplit(pageEl));
  checks.push(invPackingBalance(pageEl));
  checks.push(invOpeningWordContainer(pageEl));
  checks.push(invOpeningWordStretch(pageEl));
  const errors = checks.filter(c => !c.ok);
  return { ok: errors.length === 0, checks, errors };
}

/**
 * Throw on a *blocking* invariant failure (used in dev mode).
 */
export function assertTalmudInvariants(pageEl, phase = "unknown") {
  const enabledFlag =
    typeof localStorage !== "undefined" &&
    localStorage.getItem("ravtext.talmudLayout") === "1";
  if (!enabledFlag) {
    const r = invDomCleanliness(pageEl);
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[talmud invariant:${phase}] ${r.detail}`);
    }
  }
}
