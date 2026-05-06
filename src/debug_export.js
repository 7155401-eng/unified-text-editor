// debug_export.js — debugging tools for diagnosing layout bugs.
//
// Three exports:
//   downloadPagesAsHtml(container)       — full self-contained HTML snapshot
//   downloadDebugSnapshot(container)     — JSON snapshot of all pages with metrics
//   toggleProblemHighlight(container)    — overlays colored borders on problems

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

/**
 * Build a self-contained HTML document containing ALL pages, with all CSS
 * inlined (so it renders identically without the engine). For debugging:
 * open this in browser, inspect with devtools, share with developer.
 */
export function downloadPagesAsHtml(container) {
  if (!container) {
    alert("אין pagesContainer לייצוא");
    return;
  }
  // Collect all stylesheets — read .cssText if accessible, fallback to <link href>.
  let cssBlob = "";
  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const r of rules) cssBlob += r.cssText + "\n";
    } catch (e) {
      // CORS-blocked sheet — note as comment.
      cssBlob += `/* (CSS sheet ${sheet.href || "inline"} blocked: ${e.message}) */\n`;
    }
  }
  const containerHTML = container.outerHTML;
  const meta = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    pageCount: container.querySelectorAll(".page:not(.page-placeholder)").length,
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
</style>
</head>
<body>
<div class="debug-meta">
<dl>
${Object.entries(meta).map(([k, v]) => `<dt>${k}</dt><dd>${String(v).slice(0, 200)}</dd>`).join("\n")}
</dl>
</div>
${containerHTML}
</body>
</html>`;
  triggerDownload(`ravtext-debug-${timestamp()}.html`, html, "text/html");
}

/**
 * Capture a JSON snapshot of every page: dimensions, content, talmud state,
 * data attributes. Useful for diff'ing across versions or reproducing bugs.
 */
export function downloadDebugSnapshot(container) {
  if (!container) return;
  const pages = Array.from(
    container.querySelectorAll(".page:not(.page-placeholder)")
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
  const pages = container.querySelectorAll(".page:not(.page-placeholder)");
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
