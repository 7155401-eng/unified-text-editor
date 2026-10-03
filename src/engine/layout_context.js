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
  // fixed, not absolute - see dom_packer.getMeasureRoot(). Appended to
  // <body> (position:static), an absolute box here would hang off the
  // initial containing block and inflate documentElement.scrollWidth by
  // 99999px in this RTL document. Explicit width keeps measuring identical.
  page.style.cssText = [
    "position:fixed",
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

function measureOverlayBox(className, isTop, text = "מידה") {
  if (typeof document === "undefined") {
    return { height: 0, offset: 0, padding: 0, reserve: 0 };
  }

  const page = ensureMeasurePage();
  const el = document.createElement("div");
  el.className = className;
  el.textContent = String(text || "מידה");
  page.appendChild(el);

  // Force layout once, so the result represents the real current CSS.
  void el.offsetHeight;

  const cs = getComputedStyle(el);
  const height = el.getBoundingClientRect().height;
  const offset = parseFloat(cs[isTop ? "top" : "bottom"] || "0") || 0;

  const pageCs = getComputedStyle(page);
  const padding = parseFloat(pageCs[isTop ? "paddingTop" : "paddingBottom"] || "0") || 0;

  el.remove();

  return {
    height,
    offset,
    padding,
    reserve: Math.max(0, Math.ceil(offset + height - padding)),
  };
}

function reserveOverlayAtOffset(box, offset = box?.offset || 0) {
  if (!box) return 0;
  return Math.max(0, Math.ceil(Math.max(0, Number(offset) || 0) + box.height - box.padding));
}

function measureOverlayReserve(className, isTop, text = "מידה") {
  return measureOverlayBox(className, isTop, text).reserve;
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

  const footerBox = footerText
    ? measureOverlayBox("ravtext-page-footer", false, footerText)
    : null;
  // Page-number width does not affect vertical reserve; use a representative
  // multi-glyph label so the shared measurement path still exercises the real class.
  const pageNumberBox = pageNumbersOn
    ? measureOverlayBox("ravtext-page-number-overlay", false, "תתקצט")
    : null;

  // Keep the page number in its historical 4mm position. When both overlays
  // are enabled, move the footer ABOVE the measured page-number box instead of
  // letting two centered overlays occupy the same vertical band. The gap is an
  // explicit CSS design token; all variable heights remain live measurements.
  const footerPageNumberGap = pageNumberBox && footerBox
    ? Math.max(0, cssPx("--ravtext-document-overlay-gap", 2))
    : 0;
  const footerBottom = footerBox
    ? (pageNumberBox
      ? Math.max(
          footerBox.offset,
          pageNumberBox.offset + pageNumberBox.height + footerPageNumberGap
        )
      : footerBox.offset)
    : null;

  const features = {
    header: headerText ? measureOverlayReserve("ravtext-page-header", true, headerText) : 0,
    footer: footerBox ? reserveOverlayAtOffset(footerBox, footerBottom) : 0,
    pageNumber: pageNumberBox?.reserve || 0,
    footerBottom,
    footerPageNumberGap,
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

export function layoutContextReserveValues(context = createLayoutContext()) {
  const features = context?.features || {};
  return {
    header: Math.max(0, Math.ceil(features.header || 0)),
    footer: Math.max(0, Math.ceil(features.footer || 0)),
    pageNumber: Math.max(0, Math.ceil(features.pageNumber || 0)),
  };
}

export function publishLayoutContextToCssVars(context = createLayoutContext()) {
  if (typeof document === "undefined") return context;

  const root = document.documentElement;
  const reserves = layoutContextReserveValues(context);
  root.style.setProperty("--ravtext-features-header-reserved", `${reserves.header}px`);
  root.style.setProperty("--ravtext-features-footer-reserved", `${reserves.footer}px`);
  root.style.setProperty("--ravtext-features-pagenumber-reserved", `${reserves.pageNumber}px`);

  return context;
}

export function currentLayoutMeasureSignature() {
  const context = createLayoutContext();
  publishLayoutContextToCssVars(context);
  return context.signature;
}
