import { createLayoutContext, layoutContextReserveValues, publishLayoutContextToCssVars } from "./engine/layout_context.js";

// Document-wide features: page numbers, headers/footers, watermark.
// Each feature is a Layout/View toggle that paints overlays on every
// .page element after each engine render.

const PAGE_NUM_KEY = "ravtext.pageNumbers";
const HEADER_KEY = "ravtext.pageHeader";
const FOOTER_KEY = "ravtext.pageFooter";
const WATERMARK_KEY = "ravtext.watermark";
const WATERMARK_OPACITY_KEY = "ravtext.watermarkOpacity";

let _currentDocumentLayoutContext = null;

function pageElements() {
  return document.querySelectorAll(
    "#pages-container .page:not(.page-placeholder):not(.ravtext-empty-page), " +
    ".pages-container .page:not(.page-placeholder):not(.ravtext-empty-page)"
  );
}

// ★ משה 28/09/2026 — "לפעמים העמודים ממוספרים באותיות ולפעמים במספרים".
//
// השורש: הייתה כאן טבלה קבועה של 20 ערכים בלבד (א..כ), ומעמוד 21 ואילך
// `HEB[num]` יצא undefined והקוד נפל ל-`String(num)`. לכן עמוד ה' הוצג
// כאות ועמוד 26 כספרה — באותו מסמך.
// נמדד בייצוא של משה: עמ' 5 = "ה", עמ' 26 = "26".
//
// כאן המרה מלאה לגימטריה, בלי תקרה. הכללים המקובלים בספרות תורנית:
//   • 15 ו-16 נכתבים טו/טז ולא יה/יו
//   • מאות מעל 400 מורכבות מ-ת חוזרת (500 = תק, 900 = תתק)
function toHebrewNumeral(n) {
  const num = Math.floor(Number(n) || 0);
  if (num <= 0) return String(n);

  const HUNDREDS = ["", "ק", "ר", "ש", "ת"];
  const TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];

  let out = "";
  let rest = num;

  // אלפים — נכתבים כאות ואחריה גרש, למשל 1000 = א'
  const thousands = Math.floor(rest / 1000);
  if (thousands > 0) {
    out += toHebrewNumeral(thousands) + "'";
    rest %= 1000;
  }

  // מאות: מעל 400 בונים מ-ת חוזרת
  while (rest >= 400) { out += "ת"; rest -= 400; }
  out += HUNDREDS[Math.floor(rest / 100)];
  rest %= 100;

  // טו/טז — לא יה/יו
  if (rest === 15) out += "טו";
  else if (rest === 16) out += "טז";
  else {
    out += TENS[Math.floor(rest / 10)];
    out += ONES[rest % 10];
  }
  return out;
}

export function decoratePageNumberBeforeRender(page, pageIndex) {
  if (!page || page.classList?.contains("page-placeholder") || page.classList?.contains("ravtext-empty-page")) return;
  const on = localStorage.getItem(PAGE_NUM_KEY) === "1";
  let label = page.querySelector(".ravtext-page-number-overlay");
  if (!on) {
    label?.remove();
    return;
  }
  const idx = Number.isInteger(pageIndex) && pageIndex >= 0
    ? pageIndex
    : Array.from(pageElements()).indexOf(page);
  if (idx < 0) return;
  if (!label) {
    label = document.createElement("div");
    label.className = "ravtext-page-number-overlay";
    page.appendChild(label);
  }
  label.textContent = toHebrewNumeral(idx + 1);
  page.dataset.ravtextPageNumberPaint = "during-render";
}

function preRenderRegistry() {
  if (typeof window === "undefined") return null;
  return Array.isArray(window.__ravtextPreRenderPageDecorators)
    ? window.__ravtextPreRenderPageDecorators
    : (window.__ravtextPreRenderPageDecorators = []);
}

export function installPageNumberPreRenderDecorator() {
  const registry = preRenderRegistry();
  if (!registry || registry.includes(decoratePageNumberBeforeRender)) return;
  decoratePageNumberBeforeRender.__ravtextPreRenderOrder = 20;
  registry.push(decoratePageNumberBeforeRender);
}

export function decorateHeaderFooterBeforeRender(
  page,
  _pageIndex,
  context = _currentDocumentLayoutContext || createLayoutContext(),
) {
  if (!page || page.classList?.contains("page-placeholder") || page.classList?.contains("ravtext-empty-page")) return;
  const headerText = localStorage.getItem(HEADER_KEY) || "";
  const footerText = localStorage.getItem(FOOTER_KEY) || "";
  const footerBottom = Number(context?.features?.footerBottom);

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
    // layout_context owns the stack geometry. Persist the resolved bottom as
    // an inline pixel value on the rendered footer so HTML/PDF clones keep
    // the exact non-overlapping position without depending on live root vars.
    if (Number.isFinite(footerBottom)) footer.style.bottom = `${footerBottom}px`;
    else footer.style.removeProperty("bottom");
  } else {
    footer?.remove();
  }

  page.dataset.ravtextHeaderFooterPaint = "during-render";
}

export function installHeaderFooterPreRenderDecorator() {
  const registry = preRenderRegistry();
  if (!registry || registry.includes(decorateHeaderFooterBeforeRender)) return;
  decorateHeaderFooterBeforeRender.__ravtextPreRenderOrder = 10;
  registry.push(decorateHeaderFooterBeforeRender);
}

export function installDocumentFeaturePreRenderDecorators() {
  installHeaderFooterPreRenderDecorator();
  installPageNumberPreRenderDecorator();
}

function applyPageNumbers(pages = pageElements()) {
  pages.forEach((page, i) => decoratePageNumberBeforeRender(page, i));
}

// Register as soon as the module loads: the first engine render can start before
// the delayed UI wiring runs, so all page overlays already participate in it.
if (typeof window !== "undefined") installDocumentFeaturePreRenderDecorators();

export function applyHeaderFooter(pages = pageElements(), context = _currentDocumentLayoutContext || createLayoutContext()) {
  pages.forEach((page, i) => decorateHeaderFooterBeforeRender(page, i, context));
}

function applyWatermark(pages = pageElements()) {
  const text = localStorage.getItem(WATERMARK_KEY) || "";
  const opacity = parseFloat(localStorage.getItem(WATERMARK_OPACITY_KEY) || "0.12");
  pages.forEach((page) => {
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

function pxVar(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw || "");
  return Number.isFinite(n) ? Math.round(n) : 0;
}

let _reservedRerenderTimer = null;

function scheduleReservedRerender(reason) {
  clearTimeout(_reservedRerenderTimer);
  _reservedRerenderTimer = setTimeout(() => {
    window.dispatchEvent(new CustomEvent("ravtext:features-reserved-space-changed", {
      detail: { reason },
    }));
    rerender();
  }, 40);
}

export function prepareDocumentFeatureReserves() {
  installDocumentFeaturePreRenderDecorators();
  return syncReservedSpace({ rerenderOnChange: false, reason: "pre-pack" });
}

export function syncReservedSpace(options = {}) {
  // One measurement authority for regular pagination, V9 and post-render UI.
  // layout_context measures the configured header/footer text against the real
  // page CSS before pagination; this module only republishes that same result.
  const context = createLayoutContext();
  _currentDocumentLayoutContext = context;
  const reserves = layoutContextReserveValues(context);
  const changed = (
    pxVar("--ravtext-features-header-reserved") !== reserves.header ||
    pxVar("--ravtext-features-footer-reserved") !== reserves.footer ||
    pxVar("--ravtext-features-pagenumber-reserved") !== reserves.pageNumber
  );

  publishLayoutContextToCssVars(context);

  if (changed && options.rerenderOnChange) {
    scheduleReservedRerender(options.reason || "reserved-space-changed");
  }

  return changed;
}

function rerender() {
  if (typeof window.__ravtextRerender === "function") window.__ravtextRerender();
}

function applyAll() {
  // One DOM snapshot per pass. Each feature used to run its own global
  // querySelectorAll(), tripling full-page traversal on every refresh.
  const pages = pageElements();
  const context = (typeof window !== "undefined" && window.__RAVTEXT_LAYOUT_CONTEXT__)
    || createLayoutContext();
  applyPageNumbers(pages);
  applyHeaderFooter(pages, context);
  applyWatermark(pages);
}

// ★ משה 28/09/2026 — "אין מספרי עמודים כלל", וגם (דחיפות 1): "כשאני
// משנה את הכותרות בטאב פריסה אני לא רואה שלפעמים זה לא משתנה באתר
// החי (ולפעמים כן, לא יודע במה זה תלוי)".
//
// שני הדיווחים הם אותה תקלה, וה"לפעמים" הוא הרמז: זו בעיית תזמון.
// הפונקציה כאן יצאה מיד כשלא נמצא `#pages-container`, ויחד איתה יצא
// גם הרישום של המאזין הגלובלי ל-`ravtext:engine-rendered`. כלומר אם
// היא רצה לפני שהמכל נוצר — המאזין **לעולם לא הותקן** באותה טעינה,
// ומספרי העמודים, הכותרות והסימן המים לא התעדכנו יותר.
// נמדד: באותה בדיקה בלי ייבוא — **אפס** תוויות; עם ייבוא — 27.
//
// המאזין יושב על `window` ואינו תלוי במכל, ולכן הוא נרשם עכשיו תמיד.
// רק ה-hook הנקודתי על המכל ממתין לקיומו.
let _featuresEngineHookInstalled = false;

function installEngineRenderedHook() {
  if (_featuresEngineHookInstalled || typeof window === "undefined") return;
  // The authoritative engine-rendered listener lives in wireDocumentFeatures().
  // This helper only installs the gradual-page MutationObserver fallback.
  // Keeping a second listener here used to repaint all pages twice per render.

  // ★ נמדד: שמונה שניות אחרי הטעינה כבר היו **24 עמודים** על המסך
  // ו-**אפס** תוויות; רק אחרי כ-18 שניות הן הופיעו. כלומר העמודים
  // נוצרים בהדרגה, ו-`ravtext:engine-rendered` לבדו אינו מכסה כל מצב.
  // צופה בתוספות למכל העמודים ומסנכרן ברגע שנוסף עמוד. הצפייה מושהית
  // בכ-120 מ"ש כדי לא לרוץ על כל שורה בנפרד בזמן בנייה.
  if (typeof MutationObserver === "function" && typeof document !== "undefined") {
    let pending = null;
    const observer = new MutationObserver((records) => {
      const addedPage = records.some((r) =>
        Array.from(r.addedNodes || []).some(
          (n) => n.nodeType === 1 && (n.classList?.contains("page") || n.querySelector?.(".page"))
        )
      );
      if (!addedPage) return;
      clearTimeout(pending);
      pending = setTimeout(() => applyAll(), 120);
    });
    const attach = () => {
      const c = document.getElementById("pages-container");
      if (!c) return false;
      observer.observe(c, { childList: true, subtree: true });
      return true;
    };
    if (!attach()) {
      // המכל עדיין לא קיים — מחכים לו על גוף המסמך, פעם אחת
      const bodyWatch = new MutationObserver(() => {
        if (attach()) bodyWatch.disconnect();
      });
      if (document.body) bodyWatch.observe(document.body, { childList: true, subtree: true });
    }
  }

  _featuresEngineHookInstalled = true;
}

function installRealizedPageHook() {
  installEngineRenderedHook();
  const container = document.getElementById("pages-container");
  if (!container || container.__documentFeaturesHooked) return;
  const previous = container.__processRealizedPage;
  container.__processRealizedPage = (page, idx) => {
    if (typeof previous === "function") previous(page, idx);
    applyAll();
  };
  container.__documentFeaturesHooked = true;
  // משה 2026-05-14: אחרי כל סבב רנדור — מסנכרנים את מספרי העמודים/header/footer.
  // בלי זה, כיבוי checkbox השאיר את התוויות כי applyAll רץ רק על page-realize
  // ועמודים קיימים לא נכנסים שוב לאותו hook.
  // המאזין הגלובלי כבר הותקן ב-installEngineRenderedHook, שרץ בראש
  // הפונקציה ואינו תלוי בקיום המכל.
  container.__documentFeaturesEngineHooked = true;
}

export function wireDocumentFeatures() {
  installDocumentFeaturePreRenderDecorators();
  const pageNumCb = document.getElementById("doc-page-numbers-toggle");
  const headerInput = document.getElementById("doc-header-input");
  const footerInput = document.getElementById("doc-footer-input");
  const watermarkInput = document.getElementById("doc-watermark-input");
  const watermarkOpacity = document.getElementById("doc-watermark-opacity");

  if (pageNumCb) {
    pageNumCb.checked = localStorage.getItem(PAGE_NUM_KEY) === "1";
    pageNumCb.addEventListener("change", () => {
      localStorage.setItem(PAGE_NUM_KEY, pageNumCb.checked ? "1" : "0");
      // משה 2026-05-14: ניקוי מיידי של תוויות קיימות לפני ה-rerender, כדי
      // שאם ה-rerender לא ייגרום לרינדור מחדש של עמוד מסוים, התוויות הישנות
      // עדיין יוסרו.
      applyPageNumbers();
      syncReservedSpace({ rerenderOnChange: false, reason: "control-change" });
      rerender();
    });
  }
  let headerTimer, footerTimer;
  if (headerInput) {
    headerInput.value = localStorage.getItem(HEADER_KEY) || "";
    headerInput.addEventListener("input", () => {
      localStorage.setItem(HEADER_KEY, headerInput.value);
      syncReservedSpace({ rerenderOnChange: false, reason: "control-change" });
      clearTimeout(headerTimer);
      headerTimer = setTimeout(rerender, 300);
    });
  }
  if (footerInput) {
    footerInput.value = localStorage.getItem(FOOTER_KEY) || "";
    footerInput.addEventListener("input", () => {
      localStorage.setItem(FOOTER_KEY, footerInput.value);
      syncReservedSpace({ rerenderOnChange: false, reason: "control-change" });
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

    /*
      Single-source rule:
      re-publish the same layout_context measurement used before pagination.
      There is no second live-DOM reserve calculator that can disagree with it.
    */
    syncReservedSpace({ rerenderOnChange: false, reason: "engine-rendered" });
  });

  syncReservedSpace({ rerenderOnChange: false, reason: "initial" });

  setTimeout(() => {
    installRealizedPageHook();
    applyAll();
    syncReservedSpace({ rerenderOnChange: false, reason: "initial-after-paint" });
  }, 500);
}
