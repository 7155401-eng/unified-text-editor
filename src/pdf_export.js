const PAGE_CSS_WIDTH = 380;
const PAGE_CSS_HEIGHT = 537;
const PDF_PAGE_WIDTH = 595.28;
const PDF_PAGE_HEIGHT = 841.89;

function stringBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
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

function collectCssText() {
  const css = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules || [])) {
        css.push(rule.cssText);
      }
    } catch {
      // Cross-origin font stylesheets are not readable; the page still renders with fallback fonts.
    }
  }

  const root = getComputedStyle(document.documentElement);
  const vars = [
    "--ravtext-page-font-family",
    "--ravtext-page-main-size",
    "--ravtext-page-stream-size",
  ]
    .map((name) => `${name}: ${root.getPropertyValue(name).trim()};`)
    .join("");

  css.push(`:root{${vars}}`);
  css.push("html,body{margin:0;padding:0;background:#fff;}");
  css.push(".page{margin:0!important;box-shadow:none!important;zoom:1!important;}");
  return css.join("\n");
}

function imageLoaded(img) {
  if (img.decode) return img.decode();
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
}

async function renderPageToJpeg(pageEl, cssText, scale = 2) {
  const clone = pageEl.cloneNode(true);
  clone.style.zoom = "1";
  clone.style.width = `${PAGE_CSS_WIDTH}px`;
  clone.style.height = `${PAGE_CSS_HEIGHT}px`;
  clone.style.flex = "none";
  clone.style.margin = "0";
  clone.style.boxShadow = "none";

  const bodyClass = document.body.className || "";
  const html =
    `<html xmlns="http://www.w3.org/1999/xhtml" dir="rtl">` +
    `<head><style>${cssText}</style></head>` +
    `<body class="${bodyClass}">${clone.outerHTML}</body></html>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_CSS_WIDTH}" height="${PAGE_CSS_HEIGHT}" viewBox="0 0 ${PAGE_CSS_WIDTH} ${PAGE_CSS_HEIGHT}">` +
    `<foreignObject width="100%" height="100%">${html}</foreignObject>` +
    `</svg>`;

  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await imageLoaded(img);

    const canvas = document.createElement("canvas");
    canvas.width = PAGE_CSS_WIDTH * scale;
    canvas.height = PAGE_CSS_HEIGHT * scale;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
    return {
      width: canvas.width,
      height: canvas.height,
      bytes: base64ToBytes(base64),
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
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`
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

export async function downloadPagesAsPdf(pagesContainer, { filename = "ravtext-preview.pdf" } = {}) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const pages = Array.from(pagesContainer.querySelectorAll(".page:not(.page-placeholder)"));
  if (pages.length === 0) throw new Error("אין עמודים מוכנים להורדה");

  const cssText = collectCssText();
  const images = [];
  for (const page of pages) {
    images.push(await renderPageToJpeg(page, cssText));
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
}
