// vilna_v9_apply.js — מחיל את V9 עם פגינציה עצמית.
//
// admin-only ב-runtime. כש-V9 דלוק, engine_bridge מדלג על כל הצינור
// הסטנדרטי (domPack, renderPages, talmud_layout, mishna_wrap, וכו')
// וקורא ישירות לפונקציה הזו עם paneManager + container.
//
// הזרימה:
//   1. שולפים פסקאות מובנות מ-paneManagerToPackerContent (ראשי + הערות לכל פסקה)
//   2. מקבלים pageGeom (רוחב/גובה) מ-CSS variables של ה-container
//   3. מקבלים titles + streamSettings מ-window.__STREAM_LABELS__ / __STREAM_SETTINGS__
//   4. קוראים ל-V9.buildPages שמפגן ובונה את כל העמודים בעצמו
//
// V9 מבצע חישוב אנליטי מלא — כל מילה ממוקמת ב-x,y ידועים ב-position:absolute.
// אין float, אין shape-outside.

import { buildPages } from "./vilna_v9.js";
import { getTalmudStreamsText } from "./talmud_controls.js";

// משה 2026-05-08: קריאת קודי הזרמים שהוגדרו לגפ"ת ע"י המשתמש.
// פורמט: "01,02" → ["01","02"]. אלה הזרמים שיהיו בצדדים בעימוד גפ"ת.
function readTalmudStreamCodes() {
  try {
    const raw = getTalmudStreamsText() || "";
    return raw
      .split(/[,\s|;\n]+/)
      .map(s => s.trim())
      .filter(s => /^\d{1,3}$/.test(s))
      .map(s => String(parseInt(s, 10)).padStart(2, "0"));
  } catch {
    return [];
  }
}

const STORAGE_KEY = "ravtext.vilnaV9Beta";

const DEFAULT_TITLES = {
  "01": "מגן אברהם",
  "02": "משנה ברורה",
  "03": "ביאור הלכה",
  "04": "טורי זהב",
  "05": "כף החיים",
};

export function isVilnaV9Enabled() {
  if (typeof window === "undefined") return false;
  const auth = window.__RAVTEXT_AUTH__ || {};
  if (!auth.admin) return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function setVilnaV9Enabled(enabled) {
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

// משה 2026-05-08: קריאת LEVELS מ-localStorage (אותו פורמט כמו ב-mishna_wrap_layout).
// "01,02|02,03" → [["01","02"], ["02","03"]]. זרמים שב-levels הם side; אחרים = footer.
function readLevelsFromLocalStorage() {
  try {
    const raw = localStorage.getItem("ravtext.mishnaWrap.levels") || "";
    if (!raw) return [];
    return raw
      .split(/[|\n;]+/)
      .map(level => (level.match(/\d{1,3}/g) || [])
        .map(n => String(parseInt(n, 10)).padStart(2, "0"))
        .filter(Boolean))
      .map(level => Array.from(new Set(level)))
      .filter(level => level.length >= 1);
  } catch {
    return [];
  }
}

function readPageGeomFromContainer(container) {
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
  // קריאת font-family מהcontainer
  const fontFamily = (cs?.getPropertyValue("--ravtext-page-font-family") || "")
    .replace(/^\s+|\s+$/g, "") || "serif";
  return { pageWidth, pageHeight, mainSize, sideSize, fontFamily };
}

export async function applyVilnaV9FromPaneManager(paragraphs, container) {
  if (!container || !Array.isArray(paragraphs)) return;

  // נקה את ה-container — V9 בונה מאפס
  container.innerHTML = "";

  if (paragraphs.length === 0) return;

  const geom = readPageGeomFromContainer(container);

  const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
  const titles = Object.assign({}, DEFAULT_TITLES, labels);

  const streamSettings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};
  const levels = readLevelsFromLocalStorage();
  const talmudStreams = readTalmudStreamCodes();

  await buildPages(container, paragraphs, {
    pageWidth: geom.pageWidth,
    pageHeight: geom.pageHeight,
    mainFontSize: geom.mainSize,
    sideFontSize: geom.sideSize,
    mainFontFamily: geom.fontFamily,
    sideFontFamily: geom.fontFamily,
    lineHeightRatio: 1.55,
    padding: 12,
    mainWidthRatio: 0.42,
    crownLines: 4,
    titles,
    streamSettings,
    levels,
    talmudStreams,
  });
}
