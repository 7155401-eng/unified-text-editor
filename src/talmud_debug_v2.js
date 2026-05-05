// talmud_debug_v2.js — spec-compliant window.__talmudDebug API.
//
// Per v3 spec part 8 + GPT-9. Provides inspectPage, inspectAllPages,
// validatePage, validateAllPages, explainPlan, textHash, exportSnapshot.
//
// Coexists with the older window.__talmudDebugApi (different surface).

import {
  runAllInvariants,
  hashPageText,
  findLeftovers,
} from "./talmud_invariants.js";

function pages() {
  return Array.from(document.querySelectorAll(".page:not(.page-placeholder)"));
}

function getPage(index) {
  return pages()[index] || null;
}

function getCrownLines() {
  const v = parseInt(
    localStorage.getItem("ravtext.talmudLayout.crownLines") || "4",
    10
  );
  return Number.isFinite(v) ? v : 4;
}

function collectCrownInfo(block) {
  const crowns = Array.from(
    block.querySelectorAll(
      ":scope > .talmud-crown-portion:not(.talmud-body-portion):not(.talmud-body-expanded)"
    )
  );
  return crowns.map(c => ({
    stream: c.getAttribute("data-stream") || "",
    role: c.classList.contains("talmud-right") ? "right" : "left",
    height: Math.round(c.getBoundingClientRect().height),
    text: (c.textContent || "").trim().slice(0, 80),
  }));
}

function collectBodyInfo(block) {
  const bodies = Array.from(
    block.querySelectorAll(":scope > .talmud-body-portion[data-talmud-body-of]")
  );
  return bodies.map(b => ({
    stream: b.getAttribute("data-stream") || "",
    role: b.classList.contains("talmud-right") ? "right" : "left",
    height: Math.round(b.getBoundingClientRect().height),
  }));
}

function collectExpandedInfo(block) {
  const exps = Array.from(
    block.querySelectorAll(":scope > .talmud-body-expanded")
  );
  return exps.map(e => ({
    stream: e.getAttribute("data-stream") || "",
    role: e.classList.contains("talmud-right") ? "right" : "left",
    widthCss: e.style.width || "",
  }));
}

function inspectPage(index = 0) {
  const page = getPage(index);
  if (!page) return null;
  const block = page.querySelector(":scope > .talmud-layout");
  if (!block) {
    return {
      pageIndex: index,
      mode: "skip",
      overflow: Math.max(0, page.scrollHeight - page.clientHeight),
      textHash: hashPageText(page),
      crown: [],
      body: [],
      expanded: [],
      leftovers: findLeftovers(page).length,
      warnings: [],
    };
  }
  const mode =
    block.dataset.talmudMode ||
    Array.from(block.classList).find(c => c.startsWith("talmud-")) ||
    "classic";
  return {
    pageIndex: index,
    mode,
    overflow: Math.max(0, page.scrollHeight - page.clientHeight),
    textHash: hashPageText(page),
    crown: collectCrownInfo(block),
    body: collectBodyInfo(block),
    expanded: collectExpandedInfo(block),
    leftovers: findLeftovers(page).length - 1, // minus the .talmud-layout itself
    warnings: [],
  };
}

function inspectAllPages() {
  return pages()
    .map((_, i) => inspectPage(i))
    .filter(Boolean);
}

function validatePage(index = 0) {
  const page = getPage(index);
  if (!page) {
    return { ok: false, errors: [{ pageIndex: index, message: "no page" }], warnings: [] };
  }
  const result = runAllInvariants(page, { crownLines: getCrownLines() });
  return {
    ok: result.ok,
    errors: result.errors.map(e => ({
      pageIndex: index,
      invariant: e.invariant,
      message: `${e.name}: ${e.detail}`,
      severity: "error",
    })),
    warnings: [],
    checks: result.checks,
  };
}

function validateAllPages() {
  let ok = true;
  const errors = [];
  const warnings = [];
  const allChecks = [];
  pages().forEach((_, i) => {
    const r = validatePage(i);
    if (!r.ok) ok = false;
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    allChecks.push({ pageIndex: i, checks: r.checks });
  });
  return { ok, errors, warnings, checks: allChecks };
}

function textHash(index = 0) {
  const page = getPage(index);
  return page ? hashPageText(page) : "";
}

function exportSnapshot() {
  return {
    at: new Date().toISOString(),
    url: location.href,
    pageCount: pages().length,
    pages: inspectAllPages(),
    validations: validateAllPages(),
  };
}

export function installTalmudDebugV2() {
  if (typeof window === "undefined") return;
  window.__talmudDebug = {
    inspectPage,
    inspectAllPages,
    validatePage,
    validateAllPages,
    textHash,
    exportSnapshot,
    explainPlan(index = 0) {
      const page = getPage(index);
      if (!page) return null;
      const block = page.querySelector(":scope > .talmud-layout");
      if (!block) return { pageIndex: index, mode: "skip" };
      return {
        pageIndex: index,
        mode: block.dataset.talmudMode || "classic",
        classes: Array.from(block.classList),
        children: Array.from(block.children).map(c => ({
          tag: c.tagName,
          className: c.className,
          stream: c.getAttribute("data-stream") || "",
          role: c.dataset.talmudRole || "",
          part: c.dataset.talmudPart || "",
          height: Math.round(c.getBoundingClientRect().height),
        })),
      };
    },
  };
}
