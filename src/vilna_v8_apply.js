// vilna_v8_apply.js — מחיל את V8 עם פגינציה עצמית.
//
// admin-only ב-runtime. כש-V8 דלוק, engine_bridge מדלג על כל הצינור
// הסטנדרטי (domPack, renderPages, talmud_layout, mishna_wrap, וכו')
// וקורא ישירות לפונקציה הזו עם paneManager + container.
//
// הזרימה:
//   1. שולפים פסקאות מובנות מ-paneManagerToPackerContent (ראשי + הערות לכל פסקה)
//   2. מקבלים pageGeom (רוחב/גובה) מ-CSS variables של ה-container
//   3. מקבלים titles + streamSettings מ-window.__STREAM_LABELS__ / __STREAM_SETTINGS__
//   4. קוראים ל-V8.buildPages שמפגן ובונה את כל העמודים בעצמו
//
// זה מחליף את כל הצינור הקיים — אין כאן per-page הזרקה לעמודים שכבר נבנו.

import { buildPages } from "./vilna_v8.js";

const STORAGE_KEY = "ravtext.vilnaV8Beta";

const DEFAULT_TITLES = {
  "01": "מגן אברהם",
  "02": "משנה ברורה",
  "03": "ביאור הלכה",
  "04": "טורי זהב",
  "05": "כף החיים",
};

export function isVilnaV8Enabled() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__ || {};
  if (!auth.admin) return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setVilnaV8Enabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

function readPageGeomFromContainer(container) {
  // קורא את משתני ה-CSS שמוגדרים ע"י page_settings — ravtext-page-width/height
  const cs = (typeof window !== "undefined" && window.getComputedStyle)
    ? window.getComputedStyle(container)
    : null;
  const pickPx = (val, fallback) => {
    const n = parseFloat(val || "");
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const pageWidth  = pickPx(cs?.getPropertyValue("--ravtext-page-width"), 559);
  const pageHeight = pickPx(cs?.getPropertyValue("--ravtext-page-height"), 794);
  const mainSize   = pickPx(cs?.getPropertyValue("--ravtext-page-main-size"), 13);
  const sideSize   = pickPx(cs?.getPropertyValue("--ravtext-page-stream-size"), 11);
  return { pageWidth, pageHeight, mainSize, sideSize };
}

export async function applyVilnaV8FromPaneManager(paragraphs, container) {
  if (!container || !Array.isArray(paragraphs)) return;

  // נקה את ה-container — V8 בונה מאפס
  container.innerHTML = "";

  if (paragraphs.length === 0) return;

  const geom = readPageGeomFromContainer(container);

  const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
  const titles = Object.assign({}, DEFAULT_TITLES, labels);

  const streamSettings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};

  await buildPages(container, paragraphs, {
    pageWidth: geom.pageWidth,
    pageHeight: geom.pageHeight,
    mainFontSize: geom.mainSize,
    sideFontSize: geom.sideSize,
    lineHeightRatio: 1.55,
    padding: 12,
    mainWidthRatio: 0.33,
    crownLines: 4,
    titles,
    streamSettings,
  });
}
