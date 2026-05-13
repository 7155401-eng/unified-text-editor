// Document-wide features: page numbers, headers/footers, watermark.
// Each feature is a Layout/View toggle that paints overlays on every
// .page element after each engine render.

const PAGE_NUM_KEY = "ravtext.pageNumbers";
const HEADER_KEY = "ravtext.pageHeader";
const FOOTER_KEY = "ravtext.pageFooter";
const WATERMARK_KEY = "ravtext.watermark";
const WATERMARK_OPACITY_KEY = "ravtext.watermarkOpacity";

function pageElements() {
  return document.querySelectorAll("#pages-container .page, .pages-container .page");
}

function applyPageNumbers() {
  const on = localStorage.getItem(PAGE_NUM_KEY) === "1";
  const HEB = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט", "י",
    "יא", "יב", "יג", "יד", "טו", "טז", "יז", "יח", "יט", "כ"];
  pageElements().forEach((page, i) => {
    let label = page.querySelector(".ravtext-page-number-overlay");
    if (!on) {
      if (label) label.remove();
      return;
    }
    if (!label) {
      label = document.createElement("div");
      label.className = "ravtext-page-number-overlay";
      page.appendChild(label);
    }
    const num = i + 1;
    label.textContent = HEB[num] || String(num);
  });
}

function applyHeaderFooter() {
  const headerText = localStorage.getItem(HEADER_KEY) || "";
  const footerText = localStorage.getItem(FOOTER_KEY) || "";
  pageElements().forEach((page) => {
    let header = page.querySelector(".ravtext-page-header");
    let footer = page.querySelector(".ravtext-page-footer");
    if (headerText) {
      if (!header) {
        header = document.createElement("div");
        header.className = "ravtext-page-header";
        page.insertBefore(header, page.firstChild);
      }
      header.textContent = headerText;
    } else {
      header?.remove();
    }
    if (footerText) {
      if (!footer) {
        footer = document.createElement("div");
        footer.className = "ravtext-page-footer";
        page.appendChild(footer);
      }
      footer.textContent = footerText;
    } else {
      footer?.remove();
    }
  });
}

function applyWatermark() {
  const text = localStorage.getItem(WATERMARK_KEY) || "";
  const opacity = parseFloat(localStorage.getItem(WATERMARK_OPACITY_KEY) || "0.12");
  pageElements().forEach((page) => {
    let mark = page.querySelector(".ravtext-watermark");
    if (!text) {
      mark?.remove();
      return;
    }
    if (!mark) {
      mark = document.createElement("div");
      mark.className = "ravtext-watermark";
      page.appendChild(mark);
    }
    mark.textContent = text;
    mark.style.opacity = String(opacity);
  });
}

function getOrCreateMeasurePage() {
  let page = document.querySelector(".page:not(.measure-page)");
  if (page) return page;
  page = document.createElement("div");
  page.className = "page";
  page.style.cssText = "position:relative;width:380px;height:537px;visibility:hidden;overflow:hidden;box-sizing:border-box;flex:none;";
  const rootStyle = getComputedStyle(document.documentElement);
  page.style.paddingTop = rootStyle.getPropertyValue("--ravtext-page-margin-top") || "22px";
  page.style.paddingBottom = rootStyle.getPropertyValue("--ravtext-page-margin-bottom") || "18px";
  page.style.paddingLeft = rootStyle.getPropertyValue("--ravtext-page-margin-left") || "24px";
  page.style.paddingRight = rootStyle.getPropertyValue("--ravtext-page-margin-right") || "24px";
  document.body.appendChild(page);
  return page;
}

function measureOverlayReserved(className, isTop) {
  const selector = "." + className;
  let el = document.querySelector(selector);
  const needsCleanup = !el;
  if (!el) {
    const page = getOrCreateMeasurePage();
    el = document.createElement("div");
    el.className = className;
    el.textContent = "מידה";
    page.appendChild(el);
  }
  const cs = getComputedStyle(el);
  const height = el.getBoundingClientRect().height;
  const offset = parseFloat(cs[isTop ? "top" : "bottom"]) || 0;
  if (needsCleanup) el.remove();
  return Math.max(0, Math.round(offset + height));
}

function syncReservedSpace() {
  const hasHeader = !!localStorage.getItem(HEADER_KEY);
  const hasFooter = !!localStorage.getItem(FOOTER_KEY);
  const hasPageNum = localStorage.getItem(PAGE_NUM_KEY) === "1";
  const headPx = hasHeader ? measureOverlayReserved("ravtext-page-header", true) : 0;
  const footPx = hasFooter ? measureOverlayReserved("ravtext-page-footer", false) : 0;
  const numPx = hasPageNum ? measureOverlayReserved("ravtext-page-number-overlay", false) : 0;
  document.documentElement.style.setProperty("--ravtext-features-header-reserved", headPx + "px");
  document.documentElement.style.setProperty("--ravtext-features-footer-reserved", footPx + "px");
  document.documentElement.style.setProperty("--ravtext-features-pagenumber-reserved", numPx + "px");
}

function rerender() {
  if (typeof window.__ravtextRerender === "function") window.__ravtextRerender();
}

function applyAll() {
  applyPageNumbers();
  applyHeaderFooter();
  applyWatermark();
}

function installRealizedPageHook() {
  const container = document.getElementById("pages-container");
  if (!container || container.__documentFeaturesHooked) return;
  const previous = container.__processRealizedPage;
  container.__processRealizedPage = (page, idx) => {
    if (typeof previous === "function") previous(page, idx);
    applyAll();
  };
  container.__documentFeaturesHooked = true;
}

export function wireDocumentFeatures() {
  const pageNumCb = document.getElementById("doc-page-numbers-toggle");
  const headerInput = document.getElementById("doc-header-input");
  const footerInput = document.getElementById("doc-footer-input");
  const watermarkInput = document.getElementById("doc-watermark-input");
  const watermarkOpacity = document.getElementById("doc-watermark-opacity");

  if (pageNumCb) {
    pageNumCb.checked = localStorage.getItem(PAGE_NUM_KEY) === "1";
    pageNumCb.addEventListener("change", () => {
      localStorage.setItem(PAGE_NUM_KEY, pageNumCb.checked ? "1" : "0");
      syncReservedSpace();
      rerender();
    });
  }
  let headerTimer, footerTimer;
  if (headerInput) {
    headerInput.value = localStorage.getItem(HEADER_KEY) || "";
    headerInput.addEventListener("input", () => {
      localStorage.setItem(HEADER_KEY, headerInput.value);
      syncReservedSpace();
      clearTimeout(headerTimer);
      headerTimer = setTimeout(rerender, 300);
    });
  }
  if (footerInput) {
    footerInput.value = localStorage.getItem(FOOTER_KEY) || "";
    footerInput.addEventListener("input", () => {
      localStorage.setItem(FOOTER_KEY, footerInput.value);
      syncReservedSpace();
      clearTimeout(footerTimer);
      footerTimer = setTimeout(rerender, 300);
    });
  }
  if (watermarkInput) {
    watermarkInput.value = localStorage.getItem(WATERMARK_KEY) || "";
    watermarkInput.addEventListener("input", () => {
      localStorage.setItem(WATERMARK_KEY, watermarkInput.value);
      applyWatermark();
    });
  }
  if (watermarkOpacity) {
    watermarkOpacity.value = String(parseFloat(localStorage.getItem(WATERMARK_OPACITY_KEY) || "0.12"));
    watermarkOpacity.addEventListener("input", () => {
      localStorage.setItem(WATERMARK_OPACITY_KEY, watermarkOpacity.value);
      applyWatermark();
    });
  }

  window.addEventListener("ravtext:engine-rendered", () => {
    installRealizedPageHook();
    applyAll();
    syncReservedSpace();
  });
  syncReservedSpace();
  setTimeout(() => {
    installRealizedPageHook();
    applyAll();
  }, 500);
}
