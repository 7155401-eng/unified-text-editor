import { applyDemoWatermarkToElement, ensureDemoAccess, isDemoMode } from "./demo_mode.js";
import { buildSelfContainedCssSnapshot, collectComputedCssVariables } from "./export_snapshot_css.js";

const PAGE_CSS_WIDTH = 380;
const PAGE_CSS_HEIGHT = 537;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;
const EXPORT_FONT_STACK = '"David", "Times New Roman", "Arial", serif';
const PDF_EXPORT_DPI = 240;
const PDF_JPEG_QUALITY = 0.985;
const A4_WIDTH_INCHES = 210 / 25.4;
const PDF_EXPORT_SCALE = (PDF_EXPORT_DPI * A4_WIDTH_INCHES) / PAGE_CSS_WIDTH;

const EXPORT_CSS_VARS = [
  "--ravtext-page-font-family",
  "--ravtext-page-width",
  "--ravtext-page-height",
  "--ravtext-page-pack-safety",
  "--ravtext-page-main-size",
  "--ravtext-page-main-line-height",
  "--ravtext-page-main-paragraph-gap",
  "--ravtext-page-main-stream-gap",
  "--ravtext-page-stream-size",
  "--ravtext-page-stream-line-height",
  "--ravtext-page-stream-note-gap",
  "--ravtext-page-stream-title-gap",
  "--ravtext-stream-vertical-gap",
  "--ravtext-stream-horizontal-gap",
  "--ravtext-editor-stream-vertical-gap",
  "--ravtext-editor-stream-horizontal-gap",
  "--ravtext-page-margin-top",
  "--ravtext-page-margin-right",
  "--ravtext-page-margin-bottom",
  "--ravtext-page-margin-left",
];

function stringBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// נתיב fallback ישן ויציב: לא נאמן לכל הפונטים, אבל לא אמור להפיל PDF.
function collectLegacyCssText() {
  const css = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules || [])) {
        if (
          rule.cssText &&
          !/@font-face/i.test(rule.cssText) &&
          !/@import/i.test(rule.cssText) &&
          !/url\(/i.test(rule.cssText)
        ) {
          css.push(rule.cssText);
        }
      }
    } catch {
      // Cross-origin font stylesheets are not readable; the page still renders with fallback fonts.
    }
  }

  const root = getComputedStyle(document.documentElement);
  const vars = EXPORT_CSS_VARS
    .map((name) => `${name}: ${root.getPropertyValue(name).trim()};`)
    .join("");

  css.push(`:root{--ravtext-page-font-family:${EXPORT_FONT_STACK};${vars}}`);
  css.push("html,body{margin:0;padding:0;background:#fff;}");
  css.push(".page{font-family:var(--ravtext-page-font-family);background-image:none!important;}");
  css.push(".page *{background-image:none!important;}");
  css.push(".page{margin:0!important;box-shadow:none!important;zoom:1!important;content-visibility:visible!important;contain-intrinsic-size:auto!important;padding:var(--ravtext-page-margin-top) var(--ravtext-page-margin-right) var(--ravtext-page-margin-bottom) var(--ravtext-page-margin-left)!important;}");
  css.push(".pdf-export-media-placeholder{display:flex;align-items:center;justify-content:center;border:1px solid #bbb;background:#f5f5f5;color:#666;font:12px Arial,sans-serif;box-sizing:border-box;}");
  css.push("body.ravtext-export-clean .page,body.ravtext-export-clean .page *:not(.ravtext-demo-print-mark){background:transparent!important;background-color:transparent!important;background-image:none!important;box-shadow:none!important;}");
  return css.join("\n");
}

async function collectSnapshotCssText() {
  const vars = collectComputedCssVariables(EXPORT_CSS_VARS);
  const exportOverrides = `
:root{${vars}}
html,body{margin:0;padding:0;background:#fff;}
.page{
  font-family:var(--ravtext-page-font-family, "David Libre", "Frank Ruhl Libre", ${EXPORT_FONT_STACK});
  margin:0!important;
  box-shadow:none!important;
  zoom:1!important;
  content-visibility:visible!important;
  contain-intrinsic-size:auto!important;
  padding:var(--ravtext-page-margin-top) var(--ravtext-page-margin-right) var(--ravtext-page-margin-bottom) var(--ravtext-page-margin-left)!important;
}
.page *{content-visibility:visible!important;contain-intrinsic-size:auto!important;}
.pdf-export-media-placeholder{display:flex;align-items:center;justify-content:center;border:1px solid #bbb;background:#f5f5f5;color:#666;font:12px Arial,sans-serif;box-sizing:border-box;}
/* מנקים רק כרום של העמוד. לא מוחקים background-color מילדים כדי לא למחוק הדגשות ועיצובי זרמים. */
body.ravtext-export-clean .page{background-image:none!important;box-shadow:none!important;}
`;
  const cssText = await buildSelfContainedCssSnapshot({ extraCss: exportOverrides });
  return stripCanvasUnsafeCss(cssText);
}

function stripCanvasUnsafeCss(cssText) {
  return String(cssText || "")
    .replace(/@import[^;]+;/gi, "")
    .replace(/url\(\s*(['"]?)(?!data:)([^"')]+)\1\s*\)/gi, "none");
}

function safeStyleText(cssText) {
  return String(cssText || "").replace(/<\/style/gi, "<\\/style");
}

function isExternalResourceValue(value) {
  const s = String(value || "").trim();
  if (!s || s === "none") return false;
  if (/^(data:|#|about:blank)/i.test(s)) return false;
  return /^(https?:|\/\/|blob:|filesystem:|file:|\/)/i.test(s);
}

function stripExternalUrlsFromStyleText(styleText) {
  return String(styleText || "").replace(
    /url\(\s*(['"]?)(?!data:)([^"')]+)\1\s*\)/gi,
    "none"
  );
}

function neutralizeExternalUrlAttr(el, attr) {
  if (!el.hasAttribute(attr)) return;
  const value = el.getAttribute(attr) || "";
  if (isExternalResourceValue(value)) el.removeAttribute(attr);
}

function neutralizeStyleUrlProps(el) {
  const styleText = el.getAttribute("style") || "";
  if (/url\(/i.test(styleText)) {
    el.setAttribute("style", stripExternalUrlsFromStyleText(styleText));
  }

  const props = [
    "background",
    "backgroundImage",
    "borderImage",
    "borderImageSource",
    "clipPath",
    "cursor",
    "filter",
    "listStyleImage",
    "mask",
    "maskImage",
    "webkitMask",
    "webkitMaskImage",
  ];
  for (const prop of props) {
    try {
      const value = el.style?.[prop];
      if (value && /url\(/i.test(value)) el.style[prop] = "none";
    } catch (_) {
      // Ignore read-only or unsupported style properties.
    }
  }
}

function replaceWithPlaceholder(el, label = "") {
  const w = parseFloat(el.getAttribute("width") || el.style.width || "") || el.naturalWidth || el.videoWidth || 80;
  const h = parseFloat(el.getAttribute("height") || el.style.height || "") || el.naturalHeight || el.videoHeight || 40;
  const box = document.createElement("div");
  box.className = "pdf-export-media-placeholder";
  box.textContent = label;
  box.style.width = `${Math.max(24, w)}px`;
  box.style.height = `${Math.max(18, h)}px`;
  el.replaceWith(box);
}

function sanitizeCloneForPdf(clone) {
  clone.querySelectorAll("img, picture, source").forEach((img) => replaceWithPlaceholder(img, img.alt || ""));
  clone.querySelectorAll("video, iframe, canvas, object, embed").forEach((el) => replaceWithPlaceholder(el, ""));

  clone.querySelectorAll("*").forEach((el) => {
    neutralizeStyleUrlProps(el);
    [
      "src",
      "srcset",
      "href",
      "xlink:href",
      "poster",
      "data",
      "formaction",
    ].forEach((attr) => neutralizeExternalUrlAttr(el, attr));
  });

  clone.querySelectorAll("svg image, svg use, use, image").forEach((el) => {
    ["href", "xlink:href"].forEach((attr) => neutralizeExternalUrlAttr(el, attr));
  });
}

function imageLoaded(img) {
  if (img.decode) return img.decode();
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
}

function createSvgObjectUrl(svg) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  return URL.createObjectURL(blob);
}

function canvasToJpegBytes(canvas, quality = PDF_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          reject(new Error("לא ניתן ליצור תמונת PDF"));
          return;
        }
        try {
          resolve(new Uint8Array(await blob.arrayBuffer()));
        } catch (err) {
          reject(err);
        }
      }, "image/jpeg", quality);
    } catch (err) {
      reject(err);
    }
  });
}

async function deflateBytes(bytes) {
  if (!("CompressionStream" in window)) return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function canvasToRgbBytes(canvas, ctx) {
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  let out = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 255) {
      rgb[out++] = data[i];
      rgb[out++] = data[i + 1];
      rgb[out++] = data[i + 2];
    } else {
      const invAlpha = 255 - alpha;
      rgb[out++] = Math.round((data[i] * alpha + 255 * invAlpha) / 255);
      rgb[out++] = Math.round((data[i + 1] * alpha + 255 * invAlpha) / 255);
      rgb[out++] = Math.round((data[i + 2] * alpha + 255 * invAlpha) / 255);
    }
  }
  return rgb;
}

async function canvasToPdfImage(canvas, ctx) {
  try {
    const rgb = canvasToRgbBytes(canvas, ctx);
    const compressed = await deflateBytes(rgb);
    if (compressed) {
      return {
        bytes: compressed,
        filter: "FlateDecode",
      };
    }
  } catch (err) {
    console.warn("Lossless PDF image export failed, falling back to JPEG:", err);
  }
  return {
    bytes: await canvasToJpegBytes(canvas),
    filter: "DCTDecode",
  };
}

async function renderPageToPdfImage(pageEl, cssText, scale = PDF_EXPORT_SCALE, { includeBackgrounds = false } = {}) {
  const clone = pageEl.cloneNode(true);
  sanitizeCloneForPdf(clone);
  if (isDemoMode()) {
    ensureDemoAccess();
    applyDemoWatermarkToElement(clone);
  }
  clone.style.zoom = "1";
  clone.style.width = `${PAGE_CSS_WIDTH}px`;
  clone.style.height = `${PAGE_CSS_HEIGHT}px`;
  clone.style.flex = "none";
  clone.style.margin = "0";
  clone.style.boxShadow = "none";

  const bodyClass = [
    document.body.className || "",
    includeBackgrounds ? "" : "ravtext-export-clean",
  ].filter(Boolean).join(" ");
  const html =
    `<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl">` +
    `<head><style>${safeStyleText(cssText)}</style></head>` +
    `<body class="${bodyClass}">${clone.outerHTML}</body></html>`;
  const targetWidth = Math.round(PAGE_CSS_WIDTH * scale);
  const targetHeight = Math.round(PAGE_CSS_HEIGHT * scale);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${PAGE_CSS_WIDTH} ${PAGE_CSS_HEIGHT}">` +
    `<foreignObject width="${PAGE_CSS_WIDTH}" height="${PAGE_CSS_HEIGHT}">${html}</foreignObject>` +
    `</svg>`;

  const img = new Image();
  img.decoding = "sync";
  const url = createSvgObjectUrl(svg);
  try {
    img.src = url;
    await imageLoaded(img);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pdfImage = await canvasToPdfImage(canvas, ctx);

    return {
      width: canvas.width,
      height: canvas.height,
      ...pdfImage,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function buildPdf(images) {
  const objectChunks = [];
  const reserve = () => {
    objectChunks.push(null);
    return objectChunks.length;
  };

  const catalogObj = reserve();
  const pagesObj = reserve();
  const pageObjs = [];

  images.forEach((img, idx) => {
    const pageObj = reserve();
    const imageObj = reserve();
    const contentObj = reserve();
    pageObjs.push(pageObj);

    objectChunks[imageObj - 1] = [
      stringBytes(
        `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Interpolate false /Filter /${img.filter} /Length ${img.bytes.length} >>\nstream\n`
      ),
      img.bytes,
      stringBytes("\nendstream"),
    ];

    const content = `q\n${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0 cm\n/Im${idx + 1} Do\nQ`;
    objectChunks[contentObj - 1] = [
      stringBytes(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
    ];

    objectChunks[pageObj - 1] = [
      stringBytes(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] ` +
        `/Resources << /XObject << /Im${idx + 1} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>`
      ),
    ];
  });

  objectChunks[catalogObj - 1] = [
    stringBytes(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`),
  ];
  objectChunks[pagesObj - 1] = [
    stringBytes(`<< /Type /Pages /Count ${pageObjs.length} /Kids [${pageObjs.map((id) => `${id} 0 R`).join(" ")}] >>`),
  ];

  const chunks = [];
  const offsets = [0];
  let offset = 0;

  function push(part) {
    const bytes = typeof part === "string" ? stringBytes(part) : part;
    chunks.push(bytes);
    offset += bytes.length;
  }

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  objectChunks.forEach((parts, idx) => {
    const objNum = idx + 1;
    offsets[objNum] = offset;
    push(`${objNum} 0 obj\n`);
    for (const part of parts) push(part);
    push("\nendobj\n");
  });

  const xrefOffset = offset;
  push(`xref\n0 ${objectChunks.length + 1}\n`);
  push("0000000000 65535 f \n");
  for (let i = 1; i <= objectChunks.length; i++) {
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectChunks.length + 1} /Root ${catalogObj} 0 R >>\n`);
  push(`startxref\n${xrefOffset}\n%%EOF`);

  return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForExportFonts(timeoutMs = 2500) {
  if (!document.fonts || !document.fonts.ready) return;
  await Promise.race([
    document.fonts.ready,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

function isCanvasSecurityError(err) {
  return /tainted|toDataURL|canvas|SecurityError/i.test(err?.message || err?.name || "");
}

function isImageDecodeError(err) {
  const msg = String(err?.message || err || "");
  return /decode|source image|img/i.test(msg) || err?.name === "EncodingError";
}

function shouldRetryWithLegacyCss(err) {
  return isImageDecodeError(err) || isCanvasSecurityError(err);
}

async function renderAllPages(pages, cssText, { onProgress = null, includeBackgrounds = false } = {}) {
  const images = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress && onProgress(i + 1, pages.length);
    await nextFrame();
    images.push(await renderPageToPdfImage(pages[i], cssText, PDF_EXPORT_SCALE, { includeBackgrounds }));
  }
  return images;
}

export async function downloadPagesAsPdf(
  pagesContainer,
  { filename = "ravtext-preview.pdf", onProgress = null, fallbackToPrint = false, includeBackgrounds = false } = {}
) {
  await waitForExportFonts();
  const pages = Array.from(pagesContainer.querySelectorAll(".page:not(.page-placeholder)"));
  if (pages.length === 0) throw new Error("אין עמודים מוכנים להורדה");

  const legacyCssText = collectLegacyCssText();
  let cssText = legacyCssText;
  try {
    cssText = await collectSnapshotCssText();
  } catch (err) {
    console.warn("PDF self-contained CSS snapshot failed, using legacy CSS:", err);
  }

  let images;
  try {
    images = await renderAllPages(pages, cssText, { onProgress, includeBackgrounds });
  } catch (err) {
    if (cssText !== legacyCssText && shouldRetryWithLegacyCss(err)) {
      console.warn("PDF snapshot render failed, retrying with legacy CSS:", err);
      try {
        images = await renderAllPages(pages, legacyCssText, { onProgress, includeBackgrounds });
      } catch (legacyErr) {
        if (fallbackToPrint && isCanvasSecurityError(legacyErr)) {
          await nextFrame();
          window.print();
          return { fallback: "print" };
        }
        throw legacyErr;
      }
    } else if (fallbackToPrint && isCanvasSecurityError(err)) {
      await nextFrame();
      window.print();
      return { fallback: "print" };
    } else {
      throw err;
    }
  }

  const pdfBlob = buildPdf(images);
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { fallback: null };
}
