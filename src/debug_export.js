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

// משה 2026-05-15: צילום מלא = CSS אמיתי + פונטים מוטבעים base64. בלי זה
// הצילום נפתח עם פונט ברירת־מחדל ורוחב האותיות שונה → באגי מתיחה נעלמים.

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf|eot)(\?[^"')]*)?$/i;
const FONT_URL_IN_CSS_RE = /url\((['"]?)([^"')]+\.(?:woff2|woff|ttf|otf|eot)(?:\?[^"')]*)?)\1\)/gi;

function fontMimeFromUrl(url) {
  const lower = String(url).toLowerCase().split("?")[0];
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".otf")) return "font/otf";
  if (lower.endsWith(".eot")) return "application/vnd.ms-fontobject";
  return "application/octet-stream";
}

async function fetchCssText(href) {
  const res = await fetch(href, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`fetch ${href} → ${res.status}`);
  return await res.text();
}

async function fetchAsBase64(href) {
  const res = await fetch(href, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`fetch ${href} → ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.onload = () => {
      const s = String(reader.result || "");
      const comma = s.indexOf(",");
      resolve(comma >= 0 ? s.slice(comma + 1) : "");
    };
    reader.readAsDataURL(blob);
  });
}

async function collectCssText() {
  const parts = [];
  for (const sheet of document.styleSheets) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const r of rules) parts.push(r.cssText);
    } catch (_corsErr) {
      const href = sheet.href;
      if (!href) {
        parts.push(`/* (inline sheet blocked: ${_corsErr.message}) */`);
        continue;
      }
      try {
        const text = await fetchCssText(href);
        parts.push(`/* === fetched: ${href} === */`);
        parts.push(text);
      } catch (fetchErr) {
        parts.push(`/* (CSS sheet ${href} unavailable: ${fetchErr.message}) */`);
      }
    }
  }
  return parts.join("\n");
}

async function inlineFontsInCss(cssText, baseHref) {
  const urls = new Set();
  let m;
  FONT_URL_IN_CSS_RE.lastIndex = 0;
  while ((m = FONT_URL_IN_CSS_RE.exec(cssText)) !== null) {
    urls.add(m[2]);
  }
  if (urls.size === 0) return cssText;

  const replacements = new Map();
  await Promise.all(
    Array.from(urls).map(async (rawUrl) => {
      try {
        const abs = new URL(rawUrl, baseHref || window.location.href).toString();
        const b64 = await fetchAsBase64(abs);
        if (b64) {
          replacements.set(rawUrl, `data:${fontMimeFromUrl(rawUrl)};base64,${b64}`);
        }
      } catch (_err) {
        // משה: אם פונט יחיד נכשל — להמשיך, רק לרשום פתק.
      }
    })
  );

  return cssText.replace(FONT_URL_IN_CSS_RE, (full, quote, url) => {
    const dataUrl = replacements.get(url);
    return dataUrl ? `url(${quote}${dataUrl}${quote})` : full;
  });
}

async function buildSelfContainedSnapshot(container) {
  let cssBlob = await collectCssText();
  cssBlob = await inlineFontsInCss(cssBlob, window.location.href);
  return cssBlob;
}

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
  const cssBlob = await buildSelfContainedSnapshot(container);
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
