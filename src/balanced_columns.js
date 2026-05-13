import { getEffectiveStreamSettings } from "./original_stream_columns.js";

function getStreamSettings(code) {
  return getEffectiveStreamSettings(code);
}

function hasTwoColumnStreams() {
  const settings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};
  return Object.keys(settings).some((code) => (getStreamSettings(code)?.cols || 1) === 2);
}

function streamTextWithoutTitle(streamEl) {
  const clone = streamEl.cloneNode(true);
  clone.querySelector(".stream-title")?.remove();
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function numericLineHeight(style) {
  const direct = parseFloat(style.lineHeight);
  if (Number.isFinite(direct)) return direct;
  const fs = parseFloat(style.fontSize);
  return Number.isFinite(fs) ? fs * 1.4 : 14;
}

function makeMeasureEl(streamEl, columnWidth) {
  const style = getComputedStyle(streamEl);
  const measure = document.createElement("div");
  measure.className = "stream-balance-measure";
  measure.style.position = "absolute";
  measure.style.visibility = "hidden";
  measure.style.pointerEvents = "none";
  measure.style.contain = "layout style";
  measure.style.width = `${Math.max(20, columnWidth)}px`;
  measure.style.fontFamily = style.fontFamily;
  measure.style.fontSize = style.fontSize;
  measure.style.fontWeight = style.fontWeight;
  measure.style.letterSpacing = style.letterSpacing;
  measure.style.lineHeight = style.lineHeight;
  measure.style.direction = "rtl";
  measure.style.textAlign = "justify";
  measure.style.whiteSpace = "normal";
  measure.style.padding = "0";
  measure.style.border = "0";
  document.body.appendChild(measure);
  return measure;
}

function lineCountFor(measure, text, lineHeight) {
  measure.textContent = text || "";
  const height = measure.getBoundingClientRect().height || measure.scrollHeight || 0;
  return Math.max(1, Math.round(height / lineHeight));
}

function splitTextIntoLines(text, measure, lineHeight) {
  const tokens = String(text || "").match(/\S+\s*/g) || [];
  const lines = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current + token;
    if (current && lineCountFor(measure, candidate, lineHeight) > 1) {
      lines.push(current.trimEnd());
      current = token;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) lines.push(current.trimEnd());
  return lines;
}

function appendLines(parent, lines, { naturalLast = false, centerLast = true } = {}) {
  lines.forEach((line, idx) => {
    const row = document.createElement("span");
    row.className = "stream-balanced-line stream-balanced-justified";
    if (naturalLast && idx === lines.length - 1) {
      row.classList.remove("stream-balanced-justified");
      row.classList.add(centerLast ? "stream-balanced-natural-last" : "stream-balanced-natural-last-right");
    }
    row.textContent = line;
    parent.appendChild(row);
  });
}

async function fetchBalanceDecision(lineCount, settings) {
  const { getNonceHeader } = await import('./render_preflight.js');
  const res = await fetch('/api/balance/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...getNonceHeader() },
    body: JSON.stringify({ lineCount, settings }),
  });
  if (!res.ok) throw new Error(`balance decide failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Prepares the balancing decision for a single stream.
 * Returns an 'apply' function to be executed serially for DOM updates.
 */
async function prepareTwoColumnBalance(streamEl, settings) {
  if (!streamEl || streamEl.dataset.balancedColumns === "1") return null;
  if (streamEl.closest(".mishna-wrap-page")) return null;

  const text = streamTextWithoutTitle(streamEl);
  if (!text) return null;

  const style = getComputedStyle(streamEl);
  const gap = parseFloat(style.columnGap) || 8;
  const width = streamEl.clientWidth || streamEl.getBoundingClientRect().width || 0;
  if (width <= 40) return null;

  const columnWidth = (width - gap) / 2;
  const measure = makeMeasureEl(streamEl, columnWidth);
  const lineHeight = numericLineHeight(style);

  try {
    const lines = splitTextIntoLines(text, measure, lineHeight);
    // משה 2026-05-07: ההחלטה (האם לאזן, איפה לחתוך, איך לטפל ביתום) רצה בשרת.
    const decision = await fetchBalanceDecision(lines.length, settings);
    if (!decision.balance) return null;

    return () => {
      const rightLines = lines.slice(decision.rightStart, decision.rightEnd);
      const leftLines = lines.slice(decision.leftStart, decision.leftEnd);
      const orphan = decision.hasOrphan ? lines[lines.length - 1] || "" : "";
      const title = streamEl.querySelector(".stream-title")?.cloneNode(true);

      streamEl.textContent = "";
      streamEl.style.columnCount = "";
      streamEl.style.columnGap = "";
      streamEl.dataset.balancedColumns = "1";
      streamEl.classList.add("stream-balanced");
      if (title) streamEl.appendChild(title);

      const cols = document.createElement("div");
      cols.className = "stream-balanced-columns";
      cols.style.columnGap = `${gap}px`;

      const right = document.createElement("div");
      right.className = "stream-balanced-col stream-balanced-right";
      appendLines(right, rightLines);

      const left = document.createElement("div");
      left.className = "stream-balanced-col stream-balanced-left";
      appendLines(left, leftLines, { naturalLast: !orphan, centerLast: decision.centerLast });

      cols.appendChild(right);
      cols.appendChild(left);
      streamEl.appendChild(cols);

      if (orphan) {
        const orphanEl = document.createElement("div");
        orphanEl.className = `stream-orphan-line ${decision.centerLast ? "stream-balanced-natural-last" : "stream-balanced-natural-last-right"}`;
        orphanEl.textContent = orphan;
        streamEl.appendChild(orphanEl);
      }
    };
  } finally {
    measure.remove();
  }
}

/**
 * Prepares all streams on a page in parallel.
 * Returns an 'apply' function for the entire page.
 */
async function preparePageBalancedColumns(pageEl) {
  if (!pageEl || pageEl.classList.contains("page-placeholder")) return null;
  const streams = Array.from(pageEl.querySelectorAll(".stream[data-stream]"));
  const appliers = await Promise.all(streams.map(async (streamEl) => {
    if (streamEl.closest(".talmud-layout")) return null;
    const code = streamEl.getAttribute("data-stream");
    const settings = getStreamSettings(code);
    if ((settings.cols || 1) !== 2) return null;
    return prepareTwoColumnBalance(streamEl, settings);
  }));

  return () => {
    for (const apply of appliers) {
      if (typeof apply === "function") apply();
    }
  };
}

export async function applyBalancedColumnsToPage(pageEl) {
  const apply = await preparePageBalancedColumns(pageEl);
  if (typeof apply === "function") apply();
}

export async function applyBalancedColumnsToPages(container) {
  if (!hasTwoColumnStreams()) return;
  const pages = Array.from(container.querySelectorAll(".page:not(.page-placeholder)"));

  // משה 2026-05-13: "Parallel Weighing, Serial Confirming".
  // Phase 1: Parallel Weighing (Concurrent network requests for all pages)
  const pageAppliers = await Promise.all(pages.map(page => preparePageBalancedColumns(page)));

  // Phase 2: Serial Confirming (DOM updates from first page to last)
  for (const applyPage of pageAppliers) {
    if (typeof applyPage === "function") applyPage();
  }

  const prevProcessor = container.__processRealizedPage;
  if (!prevProcessor || !prevProcessor.__balancedColumnsWrapped) {
    const processor = function (page, idx) {
      if (typeof prevProcessor === "function") prevProcessor(page, idx);
      applyBalancedColumnsToPage(page);
    };
    processor.__balancedColumnsWrapped = true;
    container.__processRealizedPage = processor;
  }

  const baseRealize = container.__realizePage;
  if (typeof baseRealize !== "function" || baseRealize.__balancedColumnsWrapped) return;

  const wrapped = function (idx) {
    baseRealize(idx);
    const page = typeof container.__getPageElement === "function"
      ? container.__getPageElement(idx)
      : container.querySelector(`.page[data-page-index="${idx}"]`);
    if (page) applyBalancedColumnsToPage(page);
  };
  wrapped.__balancedColumnsWrapped = true;
  container.__realizePage = wrapped;
}
