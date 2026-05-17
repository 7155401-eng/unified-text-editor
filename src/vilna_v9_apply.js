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
import { getMainTextStyle, loadDocumentStyleSettings } from "./document_style_settings.js";
import { getEffectiveStreamSettings } from "./original_stream_columns.js";
import { injectMainRefs } from "./engine/note_content_builder.js";
import {
  startVilnaRenderProgress,
  hideVilnaRenderProgressImmediately,
} from "./render_progress_ui.js";

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

// 2026-05-17: V9 מצייר שורות ב-position:absolute. לכן גובה השורה אינו רק
// עיצוב — הוא גם ה-step האנכי בין top של שורה אחת לשורה הבאה. אם סגנון אישי
// או פונט עברי מנוקד מגדיל את ה-line-height בפועל רק בזמן הציור, השורה הבאה
// עלולה לעלות על הניקוד/טעמים של השורה הקודמת. כאן מחילים את המינימום לפני
// הפגינציה, כדי שכל החישוב האנליטי ישתמש באותו גובה בטוח.
const V9_SAFE_LINE_HEIGHT_RATIO_MIN = 1.55;

function safeV9LineHeightRatio(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? Math.max(n, V9_SAFE_LINE_HEIGHT_RATIO_MIN)
    : V9_SAFE_LINE_HEIGHT_RATIO_MIN;
}

function withSafeV9LineHeight(style) {
  if (!style || typeof style !== "object") return style;
  return {
    ...style,
    lineHeight: safeV9LineHeightRatio(style.lineHeight),
  };
}

function withSafeV9StreamSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  return {
    ...settings,
    inlineStyle: withSafeV9LineHeight(settings.inlineStyle),
    manualStyle: withSafeV9LineHeight(settings.manualStyle),
  };
}

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
  const mainStyle = withSafeV9LineHeight(getMainTextStyle());
  const mainSize   = Number(mainStyle?.fontSize) > 0
    ? Number(mainStyle.fontSize)
    : pickPx(cs?.getPropertyValue("--ravtext-page-main-size"), 13);
  const sideSize   = pickPx(cs?.getPropertyValue("--ravtext-page-stream-size"), 11);
  const lineHeightRatio = safeV9LineHeightRatio((() => {
    const n = parseFloat(cs?.getPropertyValue("--ravtext-v9-line-height") || "");
    return Number(mainStyle?.lineHeight) > 0 ? Number(mainStyle.lineHeight) : (Number.isFinite(n) && n > 0 ? n : 1.55);
  })());
  const mainGap = pickPx(cs?.getPropertyValue("--ravtext-v9-main-gap"), 8);
  const streamHorizontalGap = pickPx(cs?.getPropertyValue("--ravtext-stream-horizontal-gap"), 8);
  // קריאת font-family מהcontainer
  const fontFamily = (mainStyle?.fontFamily || cs?.getPropertyValue("--ravtext-page-font-family") || "")
    .replace(/^\s+|\s+$/g, "") || "serif";
  // reserved space for overlays (set by document_features.js syncReservedSpace)
  const docCs = (typeof window !== "undefined" && window.getComputedStyle)
    ? window.getComputedStyle(document.documentElement)
    : null;
  const reservedTop = pickPx(docCs?.getPropertyValue("--ravtext-features-header-reserved"), 0);
  const reservedBottom = Math.max(
    pickPx(docCs?.getPropertyValue("--ravtext-features-footer-reserved"), 0),
    pickPx(docCs?.getPropertyValue("--ravtext-features-pagenumber-reserved"), 0),
  );
  return { pageWidth, pageHeight, mainSize, sideSize, fontFamily, lineHeightRatio, mainGap, streamHorizontalGap, reservedTop, reservedBottom };
}

function readPercentSetting(key, fallback, min, max) {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n)) / 100;
}

function readIntSetting(key, fallback, min, max) {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (raw === null || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function readSpacingBool(key, fallback = false) {
  try {
    const raw = localStorage.getItem("ravtext.spacing.v1");
    const settings = raw ? JSON.parse(raw) : null;
    return typeof settings?.[key] === "boolean" ? settings[key] : fallback;
  } catch {
    return fallback;
  }
}

function estimateV9PageCount(paragraphs) {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return 1;
  let chars = 0;
  let notes = 0;
  for (const p of paragraphs) {
    chars += String(p?.mainText || "").length;
    notes += Array.isArray(p?.notes) ? p.notes.length : 0;
  }
  // הערכה רכה בלבד עבור פס התקדמות. ה-MutationObserver יעדכן לפי עמודים אמיתיים.
  return Math.max(1, Math.ceil(chars / 1800 + notes / 18));
}

export async function applyVilnaV9FromPaneManager(paragraphs, container, opts = {}) {
  if (!container || !Array.isArray(paragraphs)) return;
  const isCurrent = typeof opts.isCurrent === "function" ? opts.isCurrent : () => true;

  // משה 2026-05-15: V9 מודד רוחב מילים דרך Canvas.measureText (vilna_v9.js).
  // אם הפונט עוד לא טעון, המדידה משתמשת בפונט ברירת־מחדל צר יותר → V9 חושב
  // שנכנסות יותר מילים בשורה ממה שבאמת נכנסות. כשהפונט האמיתי נטען, המילים
  // רחבות יותר → חפיפה ויזואלית. ממתינים ל-fonts.ready עם תקרה של 2 שניות
  // כדי לא לתקוע את הרינדור לעד אם הפונט נכשל.
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
    try {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
    } catch {
      /* ממשיכים גם אם נכשל */
    }
  }

  // משה 2026-05-15: אם בזמן המתנה לפונטים התחיל רינדור חדש, נצא בלי
  // למחוק את העמודים הנוכחיים — אחרת המסך יישאר ריק עד הרינדור הבא.
  if (!isCurrent()) return { aborted: true };

  hideVilnaRenderProgressImmediately();
  const progress = startVilnaRenderProgress({
    container,
    estimatedTotalPages: estimateV9PageCount(paragraphs),
    title: "מרנדר עמודים",
    subtitle: "מודד שורות, מפרשים וריווח דף",
  });

  try {
    // נקה את ה-container — V9 בונה מאפס
    container.innerHTML = "";

    if (paragraphs.length === 0) {
      progress.finish({ totalPages: 0 });
      return;
    }

    const geom = readPageGeomFromContainer(container);

    const labels = (typeof window !== "undefined" && window.__STREAM_LABELS__) || {};
    const titles = Object.assign({}, DEFAULT_TITLES, labels);

    const rawStreamSettings = (typeof window !== "undefined" && window.__STREAM_SETTINGS__) || {};
    const streamSettings = {};
    for (const code of Object.keys(rawStreamSettings)) {
      streamSettings[code] = withSafeV9StreamSettings(getEffectiveStreamSettings(code));
    }
    const levels = readLevelsFromLocalStorage();
    const talmudStreams = readTalmudStreamCodes();

    // משה 2026-05-13: סגנון של "טקסט ראשי" — הזרמת ה-id והאובייקט הגולמי למנוע
    // כדי שהבולד/האיטליק וכל שאר התכונות יחולו על שורות הראשי ב-V9.
    const mainStyleId = loadDocumentStyleSettings().mainStyleId || "";
    const mainInlineStyle = withSafeV9LineHeight(getMainTextStyle() || null);

    // משה 2026-05-15: סימני־ייחוס בראשי ("[N]") — אותה החלטה כמו המנוע הרגיל.
    // injectMainRefs ב-note_content_builder.js בודק mainRefEnabled לכל זרם
    // ומזריק לטקסט הראשי + מזיז mainRuns ועוגני הערות. אם אף זרם לא הפעיל
    // את האפשרות, הפונקציה מחזירה את הקלט ללא שינוי.
    const transformedParagraphs = paragraphs.map((p) => {
      if (!p) return p;
      const injected = injectMainRefs(p.mainText, p.mainRuns, p.notes);
      return { ...p, mainText: injected.mainText, mainRuns: injected.mainRuns, notes: injected.notes };
    });

    const result = await buildPages(container, transformedParagraphs, {
      isCurrent,
      pageWidth: geom.pageWidth,
      pageHeight: geom.pageHeight,
      reservedTop: geom.reservedTop,
      reservedBottom: geom.reservedBottom,
      mainFontSize: geom.mainSize,
      sideFontSize: geom.sideSize,
      mainFontFamily: geom.fontFamily,
      sideFontFamily: geom.fontFamily,
      lineHeightRatio: geom.lineHeightRatio,
      padding: 12,
      mainGap: geom.mainGap,
      streamHorizontalGap: geom.streamHorizontalGap,
      mainStyleId,
      mainInlineStyle,
      mainWidthRatio: readIntSetting("ravtext.talmudLayout.mainWidth", 42, 20, 80) / 100,
      crownLines: readIntSetting("ravtext.talmudLayout.crownLines", 4, 0, 12),
      gapFillMinRatio: readPercentSetting("ravtext.talmudLayout.gapFillMin", 82, 50, 98),
      gapFillMaxMainLines: readIntSetting("ravtext.talmudLayout.gapFillMaxMainLines", null, 1, 30),
      carryOnlyMinRatio: readPercentSetting("ravtext.talmudLayout.carryOnlyMin", 78, 50, 98),
      titles,
      streamSettings,
      levels,
      talmudStreams,
      noMidParagraphSoft: readSpacingBool("noMidParagraphSoft", false),
      noMidLineSplits: readSpacingBool("noMidLineSplits", false),
      preventMidLineSplit: readSpacingBool("preventMidLineSplit", false),
    });

    if (result?.aborted || !isCurrent()) {
      progress.abort();
      return result;
    }

    progress.finish({
      totalPages: container.querySelectorAll(".page").length || result?.pages?.length || 0,
    });
    return result;
  } catch (e) {
    progress.fail(e);
    throw e;
  }
}
