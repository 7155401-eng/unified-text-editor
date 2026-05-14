/*
  layout_context.js

  Single source of truth for page layout measurements before pagination.

  This module does not rerender and does not listen to mutations.
  It measures the current live settings once, publishes the CSS variables
  that the packer already reads, and gives dom_packer a cache signature so
  stale measurements are not reused after font/page/feature changes.
*/

const PAGE_NUM_KEY = "ravtext.pageNumbers";
const HEADER_KEY = "ravtext.pageHeader";
const FOOTER_KEY = "ravtext.pageFooter";

function cssPx(name, fallback) {
  if (typeof window === "undefined" || !window.getComputedStyle) return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw || "");
  return Number.isFinite(n) ? n : fallback;
}

function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch (_) {
    return false;
  }
}

function lsGet(key) {
  if (!hasLocalStorage()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

function ensureMeasurePage() {
  let page = document.getElementById("ravtext-layout-context-measure-page");
  if (page) return page;

  page = document.createElement("div");
  page.id = "ravtext-layout-context-measure-page";
  page.className = "page measure-page";
  page.setAttribute("dir", "rtl");
  page.style.cssText = [
    "position:absolute",
    "left:-99999px",
    "top:0",
    "width:var(--ravtext-page-width,380px)",
    "height:var(--ravtext-page-height,537px)",
    "visibility:hidden",
    "overflow:hidden",
    "box-sizing:border-box",
    "content-visibility:visible",
    "contain-intrinsic-size:auto",
    "pointer-events:none",
  ].join(";");

  page.style.paddingTop = `var(--ravtext-page-margin-top, ${cssPx("--ravtext-page-margin-top", 22)}px)`;
  page.style.paddingBottom = `var(--ravtext-page-margin-bottom, ${cssPx("--ravtext-page-margin-bottom", 18)}px)`;
  page.style.paddingLeft = `var(--ravtext-page-margin-left, ${cssPx("--ravtext-page-margin-left", 24)}px)`;
  page.style.paddingRight = `var(--ravtext-page-margin-right, ${cssPx("--ravtext-page-margin-right", 24)}px)`;

  document.body.appendChild(page);
  return page;
}

function measureOverlayReserve(className, isTop) {
  if (typeof document === "undefined") return 0;

  const page = ensureMeasurePage();
  const el = document.createElement("div");
  el.className = className;
  el.textContent = "מידה";
  page.appendChild(el);

  // Force layout once, so the result represents the real current CSS.
  void el.offsetHeight;

  const cs = getComputedStyle(el);
  const height = el.getBoundingClientRect().height;
  const offset = parseFloat(cs[isTop ? "top" : "bottom"] || "0") || 0;

  const pageCs = getComputedStyle(page);
  const padding = parseFloat(pageCs[isTop ? "paddingTop" : "paddingBottom"] || "0") || 0;

  el.remove();

  // Reserve only the part that actually invades the content area.
  // This avoids the old arbitrary padding behavior while still protecting
  // text from page-number/header/footer overlap.
  return Math.max(0, Math.ceil(offset + height - padding));
}

export function createLayoutContext() {
  const headerText = lsGet(HEADER_KEY) || "";
  const footerText = lsGet(FOOTER_KEY) || "";
  const pageNumbersOn = lsGet(PAGE_NUM_KEY) === "1";

  const page = {
    width: cssPx("--ravtext-page-width", 380),
    height: cssPx("--ravtext-page-height", 537),
    marginTop: cssPx("--ravtext-page-margin-top", 22),
    marginRight: cssPx("--ravtext-page-margin-right", 24),
    marginBottom: cssPx("--ravtext-page-margin-bottom", 18),
    marginLeft: cssPx("--ravtext-page-margin-left", 24),
    packSafety: cssPx("--ravtext-page-pack-safety", 12),
  };

  const features = {
    header: headerText ? measureOverlayReserve("ravtext-page-header", true) : 0,
    footer: footerText ? measureOverlayReserve("ravtext-page-footer", false) : 0,
    pageNumber: pageNumbersOn ? measureOverlayReserve("ravtext-page-number-overlay", false) : 0,
  };

  const context = Object.freeze({
    page,
    features,
    maxAttemptsPerPage: 4,
    overflowTolerance: 1.5,
    signature: JSON.stringify({ page, features }),
  });

  if (typeof window !== "undefined") {
    window.__RAVTEXT_LAYOUT_CONTEXT__ = context;
  }

  return context;
}

export function publishLayoutContextToCssVars(context = createLayoutContext()) {
  if (typeof document === "undefined") return context;

  const root = document.documentElement;
  root.style.setProperty("--ravtext-features-header-reserved", `${Math.max(0, Math.ceil(context.features.header || 0))}px`);
  root.style.setProperty("--ravtext-features-footer-reserved", `${Math.max(0, Math.ceil(context.features.footer || 0))}px`);
  root.style.setProperty("--ravtext-features-pagenumber-reserved", `${Math.max(0, Math.ceil(context.features.pageNumber || 0))}px`);

  return context;
}

export function currentLayoutMeasureSignature() {
  const context = createLayoutContext();
  publishLayoutContextToCssVars(context);
  return context.signature;
}
