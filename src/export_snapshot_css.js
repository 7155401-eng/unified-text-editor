// export_snapshot_css.js — shared CSS/font snapshot helpers for HTML/PDF export.
//
// PDF export renders each page as an image through SVG <foreignObject>.
// For that image to match the live preview, the SVG must receive the same CSS
// and the same font files as the browser page. This module collects readable
// stylesheets, fetches blocked stylesheet URLs when possible, and inlines font
// files as base64 data: URLs so the snapshot is self-contained.

const FONT_URL_IN_CSS_RE = /url\((['"]?)([^"')]+\.(?:woff2|woff|ttf|otf|eot)(?:\?[^"')]*)?)\1\)/gi;

export function fontMimeFromUrl(url) {
  const lower = String(url || "").toLowerCase().split("?")[0];
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

function absUrl(rawUrl, baseHref) {
  try {
    return new URL(rawUrl, baseHref || window.location.href).toString();
  } catch (_) {
    return rawUrl;
  }
}

export async function collectDocumentCssText() {
  const parts = [];
  for (const sheet of Array.from(document.styleSheets || [])) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule?.cssText) parts.push(rule.cssText);
      }
    } catch (corsErr) {
      const href = sheet.href;
      if (!href) {
        parts.push(`/* (inline sheet blocked: ${corsErr?.message || corsErr}) */`);
        continue;
      }
      try {
        const text = await fetchCssText(href);
        parts.push(`/* === fetched: ${href} === */`);
        parts.push(text);
      } catch (fetchErr) {
        parts.push(`/* (CSS sheet ${href} unavailable: ${fetchErr?.message || fetchErr}) */`);
      }
    }
  }
  return parts.join("\n");
}

export async function inlineFontsInCss(cssText, baseHref = window.location.href) {
  const css = String(cssText || "");
  const urls = new Set();
  let match;
  FONT_URL_IN_CSS_RE.lastIndex = 0;
  while ((match = FONT_URL_IN_CSS_RE.exec(css)) !== null) {
    if (!/^data:/i.test(match[2])) urls.add(match[2]);
  }
  if (urls.size === 0) return css;

  const replacements = new Map();
  await Promise.all(Array.from(urls).map(async (rawUrl) => {
    try {
      const absolute = absUrl(rawUrl, baseHref);
      const b64 = await fetchAsBase64(absolute);
      if (b64) replacements.set(rawUrl, `data:${fontMimeFromUrl(rawUrl)};base64,${b64}`);
    } catch (_) {
      // Keep the original URL if one font cannot be fetched. A partial export
      // is better than failing the whole PDF/HTML export.
    }
  }));

  return css.replace(FONT_URL_IN_CSS_RE, (full, quote, url) => {
    const dataUrl = replacements.get(url);
    return dataUrl ? `url(${quote}${dataUrl}${quote})` : full;
  });
}

export function collectComputedCssVariables(names, source = document.documentElement) {
  const computed = getComputedStyle(source || document.documentElement);
  return (names || [])
    .map((name) => {
      const value = computed.getPropertyValue(name).trim();
      return value ? `${name}: ${value};` : "";
    })
    .filter(Boolean)
    .join("");
}

export async function buildSelfContainedCssSnapshot({ extraCss = "", baseHref = window.location.href } = {}) {
  let cssText = await collectDocumentCssText();
  if (extraCss) cssText += `\n/* === RavText export overrides === */\n${extraCss}`;
  cssText = await inlineFontsInCss(cssText, baseHref);
  return cssText;
}
