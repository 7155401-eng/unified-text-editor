// debug_export.js — debugging tools for diagnosing layout bugs.
//
// Three exports:
//   downloadPagesAsHtml(container)       — full self-contained HTML snapshot
//   downloadDebugSnapshot(container)     — JSON snapshot of all pages with metrics
//   toggleProblemHighlight(container)    — overlays colored borders on problems

import { buildSelfContainedCssSnapshot } from "./export_snapshot_css.js";
import { buildExportCoverPage } from "./export_cover_page.js";

const PRINTABLE_PAGE_SELECTOR = ".page:not(.page-placeholder):not(.ravtext-empty-page)";

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function triggerDownload(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}

// משה 2026-05-15: צילום מלא = CSS אמיתי + פונטים מוטבעים base64. בלי זה
// הצילום נפתח עם פונט ברירת־מחדל ורוחב האותיות שונה → באגי מתיחה נעלמים.
async function buildSelfContainedSnapshot() {
  return await buildSelfContainedCssSnapshot();
}

function buildContainerHtmlWithCover(container, filename) {
  const clone = container.cloneNode(true);
  clone.querySelectorAll(".page-placeholder,.ravtext-empty-page").forEach((el) => el.remove());
  const contentPageCount = clone.querySelectorAll(PRINTABLE_PAGE_SELECTOR).length;
  const cover = buildExportCoverPage({
    mode: "HTML Debug / Print",
    contentPageCount,
    filename,
    includePrintPatch: true,
  });
  clone.insertBefore(cover, clone.firstChild);
  return { html: clone.outerHTML, contentPageCount };
}

const PRINT_SAFE_SNAPSHOT_CSS = `
/* RavText standalone HTML print isolation: print the rendered pages only. */
@page { size: a4; margin: 0; }
@media print {
  html,
  body.ravtext-debug-snapshot {
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    display: block !important;
    background: #fff !important;
  }

  body.ravtext-debug-snapshot > *:not(#pages-container) {
    display: none !important;
  }

  body.ravtext-debug-snapshot .debug-meta,
  body.ravtext-debug-snapshot .empty-hint,
  body.ravtext-debug-snapshot .error-hint,
  body.ravtext-debug-snapshot .page-placeholder,
  body.ravtext-debug-snapshot .ravtext-empty-page {
    display: none !important;
  }

  body.ravtext-debug-snapshot #pages-container,
  body.ravtext-debug-snapshot #pages-container.pages-container {
    display: block !important;
    position: static !important;
    width: 210mm !important;
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    background: #fff !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    gap: 0 !important;
    transform: none !important;
    transform-origin: left top !important;
    scrollbar-gutter: auto !important;
    direction: ltr !important;
  }

  body.ravtext-debug-snapshot #pages-container > .page,
  body.ravtext-debug-snapshot #pages-container > .page:not(.measure-page) {
    display: flex !important;
    position: relative !important;
    direction: rtl !important;
    width: var(--ravtext-page-width, 380px) !important;
    height: var(--ravtext-page-height, 537px) !important;
    min-height: 0 !important;
    max-height: var(--ravtext-page-height, 537px) !important;
    flex: none !important;
    margin: 0 !important;
    padding:
      var(--ravtext-page-margin-top)
      var(--ravtext-page-margin-right)
      var(--ravtext-page-margin-bottom)
      var(--ravtext-page-margin-left) !important;
    overflow: hidden !important;
    background-color: #fff !important;
    box-shadow: none !important;
    border: 0 !important;
    outline: none !important;
    zoom: 2.0887 !important;
    transform: none !important;
    transform-origin: left top !important;
    content-visibility: visible !important;
    contain-intrinsic-size: auto !important;
    break-before: auto !important;
    page-break-before: auto !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
    break-after: page !important;
    page-break-after: always !important;
  }

  body.ravtext-debug-snapshot #pages-container > .page:first-of-type,
  body.ravtext-debug-snapshot #pages-container > .ravtext-export-cover-page {
    margin-top: 0 !important;
    break-before: auto !important;
    page-break-before: auto !important;
  }

  body.ravtext-debug-snapshot #pages-container > .page:last-of-type {
    break-after: auto !important;
    page-break-after: auto !important;
  }

  body.ravtext-debug-snapshot:not(.print-with-background) #pages-container > .page,
  body.ravtext-debug-snapshot:not(.print-with-background) #pages-container > .page :not(.ravtext-demo-print-mark) {
    background-image: none !important;
    box-shadow: none !important;
  }
}
`;

/**
 * Build a self-contained HTML document containing ALL pages, with all CSS
 * AND all font files inlined as base64 data: URLs. The result renders with
 * the exact same fonts (so justify stretching reproduces) without internet.
 */
export async function downloadPagesAsHtml(container) {
  if (!container) {
    alert("אין pagesContainer לייצוא");
    return;
  }
  const cssBlob = await buildSelfContainedSnapshot();
  const outputFilename = `ravtext-debug-${timestamp()}.html`;
  const { html: containerHTML, contentPageCount } = buildContainerHtmlWithCover(container, outputFilename);
  const meta = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    pageCount: contentPageCount,
    includesTechnicalCover: true,
    talmudEnabled: localStorage.getItem("ravtext.talmudLayout") === "1",
  };

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8" />
<title>RavText Debug Snapshot ${timestamp()}</title>
<style>
body { font-family: "David Libre", Frank Ruhl Libre, serif; margin: 20px; background: #ddd; }
.debug-meta { background: #fff; padding: 12px; margin-bottom: 20px; border: 1px solid #999; font-size: 13px; font-family: monospace; }
.debug-meta dt { font-weight: bold; }
${cssBlob}
${PRINT_SAFE_SNAPSHOT_CSS}
</style>
</head>
<body class="ravtext-debug-snapshot">
<div class="debug-meta">
<dl>
${Object.entries(meta).map(([k, v]) => `<dt>${k}</dt><dd>${String(v).slice(0, 200)}</dd>`).join("\n")}
</dl>
</div>
${containerHTML}
</body>
</html>`;
  triggerDownload(outputFilename, html, "text/html");
}

/**
 * Capture a JSON snapshot of every page: dimensions, content, talmud state,
 * data attributes. Useful for diff'ing across versions or reproducing bugs.
 */
export function downloadDebugSnapshot(container) {
  if (!container) return;
  const pages = Array.from(
    container.querySelectorAll(PRINTABLE_PAGE_SELECTOR)
  );
  const snapshot = {
    timestamp: new Date().toISOString(),
    talmudEnabled: localStorage.getItem("ravtext.talmudLayout") === "1",
    settings: {
      streams: localStorage.getItem("ravtext.talmudLayout.streams"),
      crownLines: localStorage.getItem("ravtext.talmudLayout.crownLines"),
      sideGap: localStorage.getItem("ravtext.talmudLayout.sideGap"),
      mainWidth: localStorage.getItem("ravtext.talmudLayout.mainWidth"),
    },
    pageCount: pages.length,
    pages: pages.map((p, i) => {
      const block = p.querySelector(":scope > .talmud-layout");
      const main = p.querySelector(".page-main");
      const overflow = p.scrollHeight - p.clientHeight;
      const blockH = block ? block.getBoundingClientRect().height : 0;
      const pageH = p.clientHeight;
      const gap = block ? Math.round(p.getBoundingClientRect().bottom - block.getBoundingClientRect().bottom) : 0;
      const blockChildren = block ? Array.from(block.children).map(c => ({
        tag: c.tagName,
        cls: c.className,
        h: Math.round(c.getBoundingClientRect().height),
        textLen: (c.textContent || "").length,
        dataset: { ...c.dataset },
      })) : [];
      const mainText = main ? (main.textContent || "").trim() : "";
      return {
        idx: i,
        pageH: Math.round(pageH),
        scrollH: p.scrollHeight,
        overflow,
        gap,
        mode: block ? (block.dataset.talmudMode || "unknown") : "no-block",
        repaginated: p.dataset.talmudRepaginated || null,
        repaginatedTarget: p.dataset.talmudRepaginatedTarget || null,
        shrunkFrom: p.dataset.talmudPageShrunk || null,
        blockH: Math.round(blockH),
        blockChildren,
        mainTextPreview: mainText.slice(0, 200),
        mainTextLen: mainText.length,
        mainParagraphCount: main ? main.children.length : 0,
        streamCount: p.querySelectorAll(".stream").length,
        hasOpeningWord: !!p.querySelector(".opw-host"),
        cssClasses: p.className,
      };
    }),
  };
  triggerDownload(
    `ravtext-snapshot-${timestamp()}.json`,
    JSON.stringify(snapshot, null, 2),
    "application/json"
  );
}

const HIGHLIGHT_CSS = `
.debug-overlay-overflow { outline: 3px solid red !important; }
.debug-overlay-gap { outline: 3px dashed orange !important; }
.debug-overlay-orphan { outline: 3px dotted purple !important; }
.debug-overlay-displaced { outline: 3px solid magenta !important; }
.debug-overlay-cap { outline: 3px solid blue !important; }
.debug-overlay-shrunk { outline: 2px solid green !important; }
.debug-overlay-pulled { outline: 2px solid teal !important; }
.debug-overlay-mid-word { outline: 3px solid darkred !important; }
.debug-label {
  position: absolute;
  top: 0; right: 0;
  background: rgba(0,0,0,0.85);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  pointer-events: none;
  z-index: 99999;
  font-family: monospace;
}
`;

let _highlightActive = false;

/**
 * Add colored outlines to problematic pages so user can visually identify
 * which page has which bug. Toggle on/off.
 */
export function toggleProblemHighlight(container) {
  if (!container) return;
  if (_highlightActive) {
    // Remove all highlights.
    container.querySelectorAll(".debug-overlay-overflow,.debug-overlay-gap,.debug-overlay-orphan,.debug-overlay-displaced,.debug-overlay-cap,.debug-overlay-shrunk,.debug-overlay-pulled,.debug-overlay-mid-word").forEach(el => {
      el.classList.remove("debug-overlay-overflow", "debug-overlay-gap", "debug-overlay-orphan", "debug-overlay-displaced", "debug-overlay-cap", "debug-overlay-shrunk", "debug-overlay-pulled", "debug-overlay-mid-word");
    });
    container.querySelectorAll(".debug-label").forEach(el => el.remove());
    document.getElementById("debug-overlay-style")?.remove();
    _highlightActive = false;
    return;
  }
  let style = document.getElementById("debug-overlay-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "debug-overlay-style";
    style.textContent = HIGHLIGHT_CSS;
    document.head.appendChild(style);
  }
  const pages = container.querySelectorAll(PRINTABLE_PAGE_SELECTOR);
  pages.forEach((p, i) => {
    const block = p.querySelector(":scope > .talmud-layout");
    const issues = [];
    if (p.scrollHeight - p.clientHeight > 2) {
      p.classList.add("debug-overlay-overflow");
      issues.push(`OVR+${p.scrollHeight - p.clientHeight}`);
    }
    if (block) {
      const gap = p.getBoundingClientRect().bottom - block.getBoundingClientRect().bottom;
      if (gap > 100) {
        p.classList.add("debug-overlay-gap");
        issues.push(`GAP+${Math.round(gap)}`);
      }
    }
    if (p.dataset.talmudPageShrunk) issues.push("SHRUNK");
    if (p.dataset.talmudRepaginated) issues.push("REPAG");
    if (p.dataset.talmudOverflowCorrected) issues.push("CORR");
    if (p.querySelector("[data-talmud-capped-at]")) {
      p.classList.add("debug-overlay-cap");
      issues.push("CAP");
    }
    if (issues.length > 0) {
      const label = document.createElement("div");
      label.className = "debug-label";
      label.textContent = `p${i}: ${issues.join("|")}`;
      if (getComputedStyle(p).position === "static") p.style.position = "relative";
      p.appendChild(label);
    }
    // Mark moved/pulled streams individually
    p.querySelectorAll("[data-talmud-pulled-backwards],[data-talmud-moved-from-prev-page]").forEach(s => {
      s.classList.add("debug-overlay-pulled");
    });
  });
  _highlightActive = true;
}
