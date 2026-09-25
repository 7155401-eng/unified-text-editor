// vilna_daf_lock.js — "נעילת דף": כל עמוד אצלנו נגמר בדיוק היכן שנגמר העמוד
// בש"ס וילנא.
//
// ===================== מה הבעיה שזה פותר =====================
// המנוע (vilna_v9.js) מחליט לבד איפה נגמר עמוד: הוא דוחס כמה שנכנס ועובר
// לעמוד הבא. זה נכון לטקסט רגיל — ולא נכון לגמרא. בגמרא "דף ב עמוד א" הוא
// יחידה מוסכמת: כל העולם מצטט לפיה. אם העמוד שלנו נגמר באמצע, המראה-מקום
// שלנו לא תואם לשום ספר אחר.
//
// ===================== איך זה עובד =====================
// 1. בטקסט יש סימני דף: ⟦דף ב.⟧ — כל סימן כזה פותח עמוד חדש.
// 2. הטקסט נחתך ל"קטעי-דף": כל מה שבין סימן לסימן.
// 3. כל קטע נבנה בקריאה נפרדת ל-buildPages. קריאה נפרדת מתחילה תמיד מעמוד
//    חדש ולא גוררת שאריות מקטע קודם — ובזה לבדו מובטח שעמוד לעולם לא יערבב
//    שני דפים, ושכל עמוד נגמר בדיוק בסוף הדף.
// 4. במצב "דף = עמוד" (ברירת מחדל) מחפשים את גודל האות הגדול ביותר שבו כל
//    הדף עדיין נכנס בעמוד אחד — חיפוש חצייה (binary search) בין גבול תחתון
//    לגבול עליון. זה בדיוק מה שעשה המדפיס בוילנא: הוא התאים את האות כדי
//    שהדף ייגמר במקום הנכון.
//
// המודול הזה לא נוגע בלולאת העימוד של V9 — הוא עוטף אותה. שינוי בלולאה
// עצמה היה מסכן כל מסמך אחר; עטיפה מסכנת רק את מי שהדליק את התכונה.

import { buildPages as v9BuildPages } from "./vilna_v9.js";

// ===================== סימן הדף =====================
// ⟦…⟧ (U+27E6/27E7) נבחרו כי שום חלק אחר בצינור לא משתמש בהם: סימני זרם הם
// @NN, והערות בסוגריים מסולסלים/מרובעים. כך אין התנגשות עם טקסט קיים.
export const DAF_OPEN = "⟦";
export const DAF_CLOSE = "⟧";
const LABEL_CHARS = "[^\\u27E7\\n]{0,40}";
export const DAF_MARK_RE = new RegExp(`${DAF_OPEN}\\s*(?:דף|עמוד)\\s*(${LABEL_CHARS}?)\\s*${DAF_CLOSE}`);
export const DAF_MARK_RE_G = new RegExp(DAF_MARK_RE.source, "g");

export function makeDafMark(label) {
  const clean = String(label || "").replace(new RegExp(`[${DAF_OPEN}${DAF_CLOSE}\\n]`, "g"), "").trim();
  return `${DAF_OPEN}דף ${clean}${DAF_CLOSE}`;
}

export function hasDafMarkers(paragraphs) {
  if (!Array.isArray(paragraphs)) return false;
  return paragraphs.some((p) => p && typeof p.mainText === "string" && DAF_MARK_RE.test(p.mainText));
}

// ===================== חיתוך לקטעי-דף =====================
// הזזת עוגני הערות ו-runs אחרי שנחתך תחילת הטקסט.
function shiftNotes(notes, delta, minAnchor = 0) {
  return (notes || []).map((n) => {
    if (typeof n.anchor !== "number") return { ...n };
    return { ...n, anchor: Math.max(minAnchor, n.anchor - delta) };
  });
}

function sliceRuns(runs, from, to) {
  const out = [];
  for (const r of runs || []) {
    const s = Math.max(r.start, from);
    const e = Math.min(r.end, to);
    if (s < e) out.push({ ...r, start: s - from, end: e - from });
  }
  return out;
}

function normalizeSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

// חותך פסקה אחת בנקודת הסימן: מה שלפני נשאר בקטע הנוכחי, מה שאחרי פותח קטע חדש.
function splitParagraphAt(paragraph, cutStart, cutEnd) {
  const text = paragraph.mainText || "";
  const beforeRaw = text.slice(0, cutStart);
  const afterRaw = text.slice(cutEnd);
  const before = normalizeSpace(beforeRaw);
  const after = normalizeSpace(afterRaw);
  const beforeTrimShift = beforeRaw.length - beforeRaw.replace(/^\s+/, "").length;
  const afterTrimShift = afterRaw.length - afterRaw.replace(/^\s+/, "").length;

  const notes = paragraph.notes || [];
  const notesBefore = [];
  const notesAfter = [];
  for (const n of notes) {
    const a = typeof n.anchor === "number" ? n.anchor : null;
    if (a === null || a <= cutStart) notesBefore.push({ ...n, anchor: a === null ? undefined : Math.max(0, a - beforeTrimShift) });
    else notesAfter.push({ ...n, anchor: Math.max(0, a - cutEnd - afterTrimShift) });
  }

  const runs = paragraph.mainRuns || [];
  const firstHalf = before
    ? { ...paragraph, mainText: before, mainRuns: sliceRuns(runs, beforeTrimShift, cutStart), notes: notesBefore }
    : null;
  const secondHalf = after || notesAfter.length
    ? { ...paragraph, mainText: after, mainRuns: sliceRuns(runs, cutEnd + afterTrimShift, text.length), notes: notesAfter }
    : null;
  return { firstHalf, secondHalf };
}

/**
 * חותך רשימת פסקאות לקטעי-דף לפי סימני ⟦דף …⟧.
 * מחזיר { segments, markerCount }.
 * כל segment = { label, paragraphs }.
 * label ריק = הקטע שלפני הסימן הראשון (למשל כותרת המסכת).
 */
export function splitParagraphsByDaf(paragraphs) {
  const segments = [];
  let current = { label: "", paragraphs: [] };
  let markerCount = 0;

  const pushCurrent = () => {
    const hasContent = current.paragraphs.some(
      (p) => (p.mainText || "").trim() || (p.notes || []).length
    );
    if (hasContent || current.label) segments.push(current);
  };

  for (const p of paragraphs || []) {
    if (!p || typeof p.mainText !== "string" || !DAF_MARK_RE.test(p.mainText)) {
      current.paragraphs.push(p);
      continue;
    }
    // ייתכן יותר מסימן אחד בפסקה אחת — מטפלים בכולם בזה אחר זה.
    let rest = p;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const text = rest.mainText || "";
      const m = text.match(DAF_MARK_RE);
      if (!m) {
        if ((rest.mainText || "").trim() || (rest.notes || []).length) current.paragraphs.push(rest);
        break;
      }
      markerCount++;
      const cutStart = m.index;
      const cutEnd = m.index + m[0].length;
      const { firstHalf, secondHalf } = splitParagraphAt(rest, cutStart, cutEnd);
      if (firstHalf) current.paragraphs.push(firstHalf);
      pushCurrent();
      current = { label: (m[1] || "").trim(), paragraphs: [] };
      if (!secondHalf) break;
      rest = secondHalf;
      if (!DAF_MARK_RE.test(rest.mainText || "")) {
        if ((rest.mainText || "").trim() || (rest.notes || []).length) current.paragraphs.push(rest);
        break;
      }
    }
  }
  pushCurrent();
  return { segments, markerCount };
}

// ===================== הגדרות =====================
export const DAF_LOCK_KEYS = {
  enabled: "ravtext.vilnaDaf.enabled",   // "auto" | "1" | "0"
  mode: "ravtext.vilnaDaf.mode",         // "strict" (דף=עמוד) | "soft" (רק גבול)
  minScale: "ravtext.vilnaDaf.minScale", // אחוזים
  maxScale: "ravtext.vilnaDaf.maxScale",
  showLabel: "ravtext.vilnaDaf.showLabel", // "1" = להראות את שם הדף על העמוד
  // משה 13/09/2026: הכיוון ההפוך — האות נשארת כמו שהיא, והעמוד מתאים
  // את עצמו לדף. "1" = גודל העמוד נגזר מהטקסט.
  fitPageToText: "ravtext.vilnaDaf.fitPageToText",
};

function readLs(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null || v === "" ? fallback : v;
  } catch {
    return fallback;
  }
}

export function readDafLockSettings() {
  const num = (key, fallback, min, max) => {
    const n = parseFloat(readLs(key, String(fallback)));
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };
  return {
    enabled: readLs(DAF_LOCK_KEYS.enabled, "auto"),
    mode: readLs(DAF_LOCK_KEYS.mode, "strict") === "soft" ? "soft" : "strict",
    minScale: num(DAF_LOCK_KEYS.minScale, 70, 40, 100) / 100,
    maxScale: num(DAF_LOCK_KEYS.maxScale, 130, 100, 250) / 100,
    showLabel: readLs(DAF_LOCK_KEYS.showLabel, "1") === "1",
    // משה אמר את זה פעמיים — 13/09 וגם 24/09: „גודל המילים והאותיות
    // והרווחים והכל תמיד יישאר אותו דבר, רק גודל הדף ישתנה בלבד."
    //
    // המתג הזה בוחר בין שתי דרכים להכניס דף וילנא שלם לעמוד אחד:
    //   דלוק  — גודל הדף נגזר מהטקסט. האותיות לא זזות.   ✅ מה שביקש
    //   כבוי  — האותיות מוקטנות כדי להיכנס לדף קבוע.      ⛔ מה שאסר
    //
    // המתג נבנה כבר ב-13/09 אבל **נולד כבוי**, ולכן ברירת המחדל עשתה
    // בדיוק את ההפך מההוראה. מי שהגדיר ידנית — ההגדרה שלו נשמרת.
    fitPageToText: readLs(DAF_LOCK_KEYS.fitPageToText, "1") === "1",
  };
}

export function dafLockActive(paragraphs, settings = readDafLockSettings()) {
  if (settings.enabled === "0") return false;
  if (settings.enabled === "1") return hasDafMarkers(paragraphs);
  return hasDafMarkers(paragraphs); // auto
}

// ===================== מדידת מילוי העמוד =====================
// כמה מגובה העמוד באמת תפוס. נמדד מה-DOM כי זו האמת הסופית שהמשתמש רואה.
export function measurePageFill(pageEl, cfg) {
  if (!pageEl) return 0;
  const usable = Math.max(1, (cfg.pageHeight || 794) - (cfg.padding || 12) - (cfg.reservedBottom || 0));
  let bottom = 0;
  // V9 ממקם כל שורה ב-position:absolute. שורה כזו אינה מוסיפה גובה להורה
  // שלה, ולכן מדידה לפי offsetHeight של הילדים הישירים מחזירה מספר קטן
  // מדי (נמדד: 48% כשהעמוד היה מלא כמעט לגמרי). לכן מודדים את התחתית
  // האמיתית של כל שורה ושורה ביחס לראש העמוד.
  // ⚠ משה 14/09 — שורש "המרווחים הלבנים": כאן נמדד ב-getBoundingClientRect
  // (פיקסלים של **המסך**, אחרי זום-התצוגה) וחולק ב-cfg.pageHeight שהוא
  // בפיקסלים **לוגיים**. כשעמוד מוצג מוקטן, המדידה החזירה מספר שגוי,
  // מעבר-ההגדלה "חשב" שהעמוד מלא ולא הגדיל — והמשתמש ראה חצי עמוד ריק.
  // אותה טעות בדיוק תוקנה כבר ב-trimPageToContent; כאן היא נשארה.
  const pageRect = pageEl.getBoundingClientRect ? pageEl.getBoundingClientRect() : null;
  const pageTop = pageRect ? pageRect.top : 0;
  const logicalW = parseFloat(pageEl.style.width) || (pageRect ? pageRect.width : 0);
  const viewZoom = (pageRect && pageRect.width && logicalW) ? pageRect.width / logicalW : 1;
  const nodes = pageEl.querySelectorAll
    ? pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-opening-word")
    : [];
  if (nodes.length && pageEl.getBoundingClientRect) {
    for (const node of nodes) {
      if (node.classList && node.classList.contains("v9-daf-label")) continue;
      const r = node.getBoundingClientRect();
      const rel = r.bottom - pageTop;
      if (rel > bottom) bottom = rel;
    }
  }
  if (!bottom) {
    for (const child of pageEl.children) {
      const top = child.offsetTop || 0;
      const h = child.offsetHeight || 0;
      if (top + h > bottom) bottom = top + h;
    }
  }
  // המרה חזרה לקואורדינטות לוגיות לפני ההשוואה לגובה הלוגי
  return (bottom / (viewZoom || 1)) / usable;
}

/**
 * ★ משה 14/09/2026: "חייבת להיות מדידה של כמות השטח בעמוד שאין בו תוכן".
 * measurePageFill מודדת גובה בלבד ולכן עיוורת לחורים לרוחב: עמוד שהטקסט
 * בו יורד עד התחתית אבל חצי מהרוחב ריק נמדד כ-100%.
 * כאן מחשבים את **שטח** התוכן: סכום (רוחב×גובה) של כל השורות, חלקי
 * שטח העמוד השימושי. המדידה בקואורדינטות לוגיות, כמו כל השאר.
 */
export function measurePageArea(pageEl, cfg) {
  if (!pageEl || !pageEl.querySelectorAll) return 0;
  const padding = cfg.padding || 12;
  const usableH = Math.max(1, (cfg.pageHeight || 794) - 2 * padding - (cfg.reservedBottom || 0));
  const usableW = Math.max(1, (cfg.pageWidth || 380) - 2 * padding);
  let covered = 0;
  for (const node of pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-opening-word")) {
    if (node.classList && node.classList.contains("v9-daf-label")) continue;
    const w = parseFloat(node.style.width) || 0;
    const h = parseFloat(node.style.height) || parseFloat(node.style.lineHeight) || 0;
    if (w > 0 && h > 0) covered += w * h;
  }
  return covered / (usableW * usableH);
}

function pageOverflows(pageEl) {
  if (!pageEl) return false;
  return pageEl.scrollHeight > pageEl.offsetHeight + 1;
}

// ===================== הבנייה =====================
// במצב "העמוד מתאים את עצמו לטקסט" משנים את **גודל העמוד** ולא את האות.
// ★ משה 14/09/2026: ההגדלה חייבת להיות בגובה וברוחב יחד (אותו מכפיל).
// אחרת העמוד יוצא צר וארוך, ובהדפסה — שבה הזום נגזר מהרוחב — כל דף
// נוחת על נייר באורך אחר. עם מכפיל אחיד, עמוד שהוגדל פי k מקבל זום קטן
// פי k, וכל הדפים יוצאים בדיוק על אותו גודל נייר.
function scaledPageConfig(cfg, factor) {
  const baseW = cfg.pageWidth || 380;
  const baseH = cfg.pageHeight || 537;
  return {
    ...cfg,
    pageWidth: Math.round(baseW * factor),
    pageHeight: Math.round(baseH * factor),
  };
}

/**
 * ★ משה 14/09/2026: "צריך בשלב ראשון לחשב חישוב יחסי של המילים כמה הם,
 * ואז ליצור גודל עמוד מתאים שיכוסה ב-90 אחוז, ורק אחר כך להפעיל עליו V9".
 *
 * עד עכשיו עבדנו הפוך: בנינו דף, מדדנו כמה התמלא, ניחשנו גודל אחר, בנינו
 * שוב. כל ניחוש עולה בנייה שלמה, ולכן הגבלנו את מספר הניחושים — ואז חלק
 * מהדפים נעצרו באמצע החיפוש וקיבלו גודל אחר מהאחרים. זה מה שנראה כמו
 * "כמה מנועים שונים".
 *
 * כאן מחשבים את התשובה **בלי לבנות כלום**: סופרים את האותיות. שטח שאות
 * תופסת הוא (רוחב אות) × (גובה שורה), ושניהם יחסיים לגודל האות. לכן:
 *     שטח הטקסט = מספר אותיות × גודל-אות² × רוחב-יחסי × גובה-שורה
 * מכאן גודל האות שייתן כיסוי של 90% הוא חשבון של שורש אחד, מיידי.
 */
const AVG_GLYPH_W = 0.5;        // רוחב אות עברית ממוצע ביחס לגובהה
const AVG_LINE_H  = 1.55;       // גובה שורה ביחס לגודל האות

export function estimateInkArea(paragraphs, cfg) {
  let mainChars = 0, sideChars = 0;
  for (const para of (paragraphs || [])) {
    if (!para) continue;
    mainChars += String(para.mainText || "").length;
    for (const n of (para.notes || [])) sideChars += String((n && n.text) || "").length;
  }
  const mfs = cfg.mainFontSize || 13;
  const sfs = cfg.sideFontSize || 11;
  const per = AVG_GLYPH_W * AVG_LINE_H;
  return (mainChars * mfs * mfs + sideChars * sfs * sfs) * per;
}

/**
 * גודל האות שבו הטקסט הזה יכסה בדיוק את היעד (ברירת מחדל 90%) בעמוד הנתון.
 * מוחזר כמכפיל ביחס לגודל האות הנוכחי. זהו ניחוש-הפתיחה של החיפוש, ובדרך
 * כלל הוא כבר התשובה עצמה — כך החיפוש מתכנס בבנייה אחת במקום בעשר.
 */
export function predictFontScale(paragraphs, cfg, target = 0.9) {
  const ink = estimateInkArea(paragraphs, cfg);
  if (!(ink > 0)) return 1;
  const p = cfg.padding || 12;
  const usable = Math.max(1, (cfg.pageWidth || 380) - 2 * p)
               * Math.max(1, (cfg.pageHeight || 794) - 2 * p - (cfg.reservedBottom || 0));
  const f = Math.sqrt((target * usable) / ink);
  return Math.min(3.2, Math.max(0.35, f));
}

function scaledConfig(cfg, scale) {
  if (scale === 1) return cfg;
  return {
    ...cfg,
    mainFontSize: (cfg.mainFontSize || 13) * scale,
    sideFontSize: (cfg.sideFontSize || 11) * scale,
  };
}

// ★ משה 14/09/2026: "העמודים צריכים להיות מוצגים ברוחב מלא בכל גודל שהם".
// עמוד שהוגדל רחב מהמיכל, ולמיכל יש overflow-x:hidden — כלומר הצד נחתך.
// נותנים לעמוד זום-תצוגה כך שייכנס במלואו. זו תצוגה בלבד: העימוד כבר
// חושב, וכלל ההדפסה (--ravtext-print-zoom עם !important) גובר בהדפסה.
export function fitPageIntoView(pageEl) {
  if (!pageEl || !pageEl.parentElement) return;
  const container = pageEl.closest(".pages-container") || pageEl.parentElement;
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(container) : null;
  const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 16;
  const avail = Math.max(60, (container.clientWidth || 0) - padX - 4);
  const pageW = parseFloat(pageEl.style.width) || pageEl.offsetWidth || 0;
  if (!pageW || !avail) return;

  // משה, 25/09: "דפים גדולים מרוחב התצוגה, למרות שביקשתי מפורש
  // שלא יהיה כך — אלא שכל דף בכל גודל יתאים את עצמו בתצוגה
  // אוטומטית **לגובה תצוגת המסך**, כברירת מחדל עם אפשרות לשנות."
  //
  // עד כה ההתאמה נעשתה לרוחב בלבד, ולכן דף גבוה נכנס לרוחב אבל
  // חרג מהמסך לגובה. נמדד על הפלט שלו: 23 מתוך 24 עמודים היו
  // גבוהים מהחלון (1297 מול 1000).
  //
  // עכשיו מחשבים שני מכפילים — אחד לרוחב ואחד לגובה — ולוקחים את
  // הקטן, כך שהדף נכנס בשלמותו. מי שמעדיף את ההתנהגות הישנה יכול
  // לכבות בהגדרה אחת.
  const fitHeightToo = (() => {
    try { return localStorage.getItem("ravtext.vilnaDaf.fitToScreenHeight") !== "0"; }
    catch (_) { return true; }
  })();
  const zW = pageW > avail ? Math.max(0.15, avail / pageW) : 1;
  let zH = 1;
  if (fitHeightToo) {
    const padY = cs ? (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) : 16;
    // גובה הצפייה: המיכל אם הוא מוגבל, אחרת חלון הדפדפן
    const winH = (typeof window !== "undefined" && window.innerHeight) || 0;
    const contH = (container.clientHeight || 0) - padY - 4;
    const availH = Math.max(120, contH > 80 ? contH : winH - 120);
    const pageH = parseFloat(pageEl.style.height) || pageEl.offsetHeight || 0;
    if (pageH && availH && pageH > availH) zH = Math.max(0.15, availH / pageH);
  }
  const z = Math.min(zW, zH);
  pageEl.style.zoom = z === 1 ? "" : String(Math.round(z * 10000) / 10000);
  pageEl.dataset.dafViewZoom = String(Math.round(z * 1000) / 1000);
}

// כשמשנים את גודל החלון — מעדכנים את זום-התצוגה של כל העמודים שהוגדלו.
if (typeof window !== "undefined" && !window.__VILNA_DAF_FIT_BOUND__) {
  window.__VILNA_DAF_FIT_BOUND__ = true;
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => {
      for (const pg of document.querySelectorAll(".page[data-daf-page-factor], .page[data-dafPageFactor]")) {
        fitPageIntoView(pg);
      }
      for (const pg of document.querySelectorAll(".pages-container .page")) {
        if (pg.dataset.dafPageFactor) fitPageIntoView(pg);
      }
    }, 150);
  });
}

// ★ משה 14/09/2026: "הפלט אינו ממלא את כל העמוד".
// כשהתוכן נגמר הרבה לפני תחתית העמוד — מקצצים את הרווח המת ומעמידים
// את גובה הנייר על גובה התוכן בפועל. הפריסה כבר חושבה ואינה זזה;
// משתנה רק גובה הקופסה. רצפה של 45% מהגובה שנבחר מונעת הקטנה מוגזמת.
// ★ משה 14/09/2026: "שורות שעולות אחת על השנייה".
// נמדד בקובץ הדיבאג: 58 חפיפות, רובן באותו מקום בדיוק — השורה הראשונה
// של הגמרא רוכבת 6px על השורה האחרונה של הכתר. הפאס הזה עובר על השורות
// לפי סדר אנכי ודוחף מטה כל שורה שרוכבת על קודמתה באותה עמודה.
// מזיז רק בציר האנכי, ורק כמה שצריך — שבירת השורות אינה משתנה.
function resolveLineOverlaps(pageEl) {
  if (!pageEl || !pageEl.querySelectorAll) return 0;
  // ★★ 18/09/2026 — OVERLAP_GEOM_FALLBACK
  //
  // ⛔ הפותר הזה קרא **סגנון ישיר בלבד**: el.style.top/left/width.
  //    שורה שמיקומה מגיע מכלל CSS ולא משורת-סגנון החזירה אפס,
  //    ואז רוחב החפיפה יצא אפס — והפותר **דילג עליה בשקט**.
  //
  // ⭐ הדימוי: פקח חניה שבודק רק מכוניות עם פתק על השמשה.
  //    מי שלא שם פתק — לא קיים מבחינתו.
  //
  // ⇒ מה שחסר נלקח מהגיאומטריה האמיתית על המסך. הסגנון הישיר
  //   נשאר עדיף (הוא זול, ובו הפותר גם כותב), והמדידה היא
  //   רשת-הביטחון בלבד.
  const pageRect = pageEl.getBoundingClientRect
    ? pageEl.getBoundingClientRect()
    : { top: 0, left: 0 };
  const nodes = [...pageEl.querySelectorAll(".v9-line")]
    .map((el) => {
      const top = parseFloat(el.style.top);
      const left = parseFloat(el.style.left);
      const w = parseFloat(el.style.width);
      const h = parseFloat(el.style.height)
        || parseFloat(el.style.lineHeight);
      const need = !Number.isFinite(top) || !Number.isFinite(left)
        || !Number.isFinite(w) || !Number.isFinite(h);
      const r = need && el.getBoundingClientRect
        ? el.getBoundingClientRect() : null;
      return {
        el,
        top: Number.isFinite(top) ? top : (r ? r.top - pageRect.top : 0),
        left: Number.isFinite(left) ? left : (r ? r.left - pageRect.left : 0),
        w: Number.isFinite(w) ? w : (r ? r.width : 0),
        h: Number.isFinite(h) ? h : (r ? r.height : 0),
      };
    })
    .filter((n) => n.h > 0)
    .sort((a, b) => a.top - b.top || a.left - b.left);

  let moved = 0;
  for (let i = 0; i < nodes.length; i++) {
    const cur = nodes[i];
    for (let j = 0; j < i; j++) {
      const prev = nodes[j];
      const xo = Math.min(prev.left + prev.w, cur.left + cur.w) - Math.max(prev.left, cur.left);
      if (xo <= 2) continue;                       // עמודות שונות — אין בעיה
      const prevBottom = prev.top + prev.h;
      if (cur.top >= prevBottom - 0.5) continue;   // אין רכיבה
      const delta = prevBottom - cur.top;
      if (delta <= 0.5 || delta > cur.h * 1.2) continue;  // פער חריג — לא נוגעים
      cur.top += delta;
      cur.el.style.top = `${Math.round(cur.top * 100) / 100}px`;
      moved++;
    }
  }
  // פאס שני — לפי המידות **האמיתיות** על המסך.
  // יש שורות שהטקסט בהן רחב מהתיבה המוצהרת (style.width), ולכן הן
  // רוכבות זו על זו בלי שהמדידה הראשונה רואה זאת. כאן מודדים את המצב
  // בפועל, וממירים חזרה לקואורדינטות לוגיות לפי זום-התצוגה של העמוד.
  if (pageEl.getBoundingClientRect) {
    const pr = pageEl.getBoundingClientRect();
    const logicalW = parseFloat(pageEl.style.width) || pr.width || 1;
    const zoom = pr.width ? pr.width / logicalW : 1;
    const real = nodes.map((n) => {
      const r = n.el.getBoundingClientRect();
      return {
        n,
        top: (r.top - pr.top) / zoom,
        bottom: (r.bottom - pr.top) / zoom,
        left: (r.left - pr.left) / zoom,
        right: (r.right - pr.left) / zoom,
      };
    }).sort((a, b) => a.top - b.top);
    for (let i = 0; i < real.length; i++) {
      for (let j = 0; j < i; j++) {
        const A = real[j], B = real[i];
        const xo = Math.min(A.right, B.right) - Math.max(A.left, B.left);
        const yo = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
        if (xo <= 2 || yo <= 0.5) continue;
        const h = B.bottom - B.top;
        if (yo > h * 1.2) continue;          // חפיפה חריגה — לא נוגעים
        const top = parseFloat(B.n.el.style.top) || 0;
        B.n.el.style.top = `${Math.round((top + yo) * 100) / 100}px`;
        B.top += yo; B.bottom += yo;
        moved++;
      }
    }
  }
  // ⚠ נוסה ונדחה (14/09): פאס שמושך שורות מעלה כדי לסגור את הפער
  // שנוצר מהדחיפה. נמדד שהוא יוצר רכיבה חדשה במקום אחר — 1 חפיפה בכל
  // עמוד — ולא סוגר את הפער. עדיף פער של 12–15px מאשר שורות רוכבות,
  // ולכן הוא הוסר. הפער הזה הוא גובה שורה אחת והוא נשאר פתוח בכוונה.
  if (moved) pageEl.dataset.dafOverlapFixes = String(moved);
  return moved;
}

function trimPageToContent(pageEl, minHeight) {
  if (!pageEl || !pageEl.getBoundingClientRect) return null;
  const pr = pageEl.getBoundingClientRect();
  if (!pr.height) return null;
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(pageEl) : null;
  const padTop = cs ? parseFloat(cs.paddingTop) || 0 : 12;
  const padBottom = cs ? parseFloat(cs.paddingBottom) || 0 : 12;
  // ⚠ חובה למדוד בקואורדינטות **לוגיות** ולא ב-getBoundingClientRect:
  // לעמוד כבר הוחל זום-תצוגה, ולכן ה-rect מוחזר בפיקסלים של המסך בעוד
  // שגובה העמוד נקבע בפיקסלים לוגיים. מדידה מעורבת חתכה יותר מדי
  // (נמדד: מילוי 146% — כלומר התוכן גלש מחוץ לעמוד). ערכי ה-style
  // שהמנוע כתב הם המקור הנכון.
  const logicalH = parseFloat(pageEl.style.height) || pr.height;
  let bottom = 0;
  for (const node of pageEl.querySelectorAll(".v9-line, .v9-stream-title, .v9-opening-word")) {
    if (node.classList && node.classList.contains("v9-daf-label")) continue;
    const top = parseFloat(node.style.top);
    const h = parseFloat(node.style.height) || parseFloat(node.style.lineHeight) || 0;
    if (!Number.isFinite(top)) continue;
    if (top + h > bottom) bottom = top + h;
  }
  if (!bottom) return null;
  const wanted = Math.ceil(bottom + padBottom);
  const floor = Math.max(minHeight || 0, Math.round(logicalH * 0.45), padTop + padBottom + 40);
  const finalH = Math.max(floor, Math.min(Math.round(logicalH), wanted));
  if (finalH >= Math.round(logicalH) - 2) return null;   // כבר מלא — לא נוגעים
  pageEl.style.height = `${finalH}px`;
  pageEl.style.setProperty("--ravtext-page-height", `${finalH}px`);
  pageEl.dataset.dafTrimmed = "1";
  return finalH;
}

function makeTrialContainer(realContainer) {
  const doc = realContainer.ownerDocument;
  const el = doc.createElement("div");
  el.className = realContainer.className;
  // ★ חשוב: גודל העמוד נקבע במשתני CSS שיושבים ישירות על המיכל
  // (page_settings.js כותב אותם גם על ה-root וגם על pages-container).
  // בלי להעתיק אותם, הניסיון נמדד על עמוד בגודל ברירת המחדל בזמן שהעמוד
  // האמיתי בגודל אחר — וכך יצא שדף "נכנס" לפי מדידה של עמוד קטן ואז
  // התיישב על עמוד גדול וחצי ריק. נמדד: מילוי 47% במקום 95%.
  const inlineStyle = realContainer.getAttribute("style");
  if (inlineStyle) el.setAttribute("style", inlineStyle);
  for (const attr of ["dir", "lang", "data-theme"]) {
    const v = realContainer.getAttribute(attr);
    if (v !== null) el.setAttribute(attr, v);
  }
  // ★★ 18/09/2026 — המדידה חייבת לרוץ באותה טיפוגרפיה בדיוק.
  //
  // המיכל הזה מעתיק class, style, dir, lang ו-data-theme — אבל
  // **לא את ה-id**. וכל כלל CSS שמכוון לפי מזהה (#pages-container)
  // פשוט אינו חל עליו. ⇒ הטקסט נמדד בגופן אחד ומוצג באחר.
  //
  // ⭐ הדימוי: לתפור חליפה לפי מידות שנלקחו מאדם אחר.
  //
  // ⚠️ ולמה לא פשוט להעתיק את ה-id: שני אלמנטים באותו מזהה הם
  //    מסמך פגום, ו-getElementById היה מחזיר את הלא-נכון.
  //
  // ⇒ במקום זה מעתיקים את **תכונות הטיפוגרפיה המחושבות** כסגנון
  //   ישיר. זה עוקף את שאלת הסלקטור לגמרי: לא משנה איך הכלל
  //   נכתב, המדידה רואה את אותו גופן, אותו גודל ואותו משקל.
  try {
    const TRIAL_TYPOGRAPHY = [
      "font-family", "font-size", "font-weight", "font-style",
      "line-height", "letter-spacing", "word-spacing",
      "text-align", "direction", "font-variant-ligatures",
    ];
    const cs = (realContainer.ownerDocument.defaultView || window)
      .getComputedStyle(realContainer);
    for (const prop of TRIAL_TYPOGRAPHY) {
      const v = cs.getPropertyValue(prop);
      if (v) el.style.setProperty(prop, v);
    }
  } catch (_) {
    // ⚠️ סביבה בלי getComputedStyle (בדיקות) — ממשיכים כרגיל.
  }
  el.setAttribute("data-daf-trial", "1");
  el.style.position = "absolute";
  el.style.left = "-100000px";
  el.style.top = "0";
  el.style.visibility = "hidden";
  el.style.pointerEvents = "none";
  // חייב להיות בתוך אותו הורה — משם מגיעים משתני ה-CSS של גודל העמוד.
  (realContainer.parentNode || doc.body).appendChild(el);
  return el;
}

/**
 * בונה עמודים כשכל קטע-דף נעול לעמוד משלו.
 *
 * @param {HTMLElement} container   מיכל העמודים האמיתי
 * @param {Array} paragraphs        פסקאות מהעורך
 * @param {Object} cfg              אותו cfg שנשלח ל-buildPages
 * @param {Object} opts             { settings, buildPages (להזרקה בבדיקות), onProgress }
 * @returns {{pages: HTMLElement[], report: Object}}
 */
export async function buildPagesDafLocked(container, paragraphs, cfg, opts = {}) {
  const settings = opts.settings || readDafLockSettings();
  const buildPages = opts.buildPages || v9BuildPages;
  const isCurrent = typeof cfg.isCurrent === "function" ? cfg.isCurrent : () => true;
  const { segments, markerCount } = splitParagraphsByDaf(paragraphs);

  const report = {
    mode: settings.mode,
    markerCount,
    segments: [],
    pagesTotal: 0,
    dafimOverflowed: 0,
    startedAt: Date.now(),
  };
  const allPages = [];

  // מתחילים כל דף מהגודל שהתקבל בדף הקודם — דפים סמוכים דומים בגודלם, כך
  // החיפוש מתכנס אחרי 2–3 ניסיונות במקום 8.
  let lastScale = 1;
  // ★ הניחוש הראשון אינו ניחוש: הוא מחושב מספירת האותיות (ראה
  // predictFontScale). משה: "קודם לחשב חישוב יחסי של המילים כמה הם, ואז
  // ליצור גודל עמוד מתאים שיכוסה ב-90 אחוז, ורק אחר כך להפעיל עליו V9".
  const predicted = segments.map((sg) => predictFontScale(sg.paragraphs, cfg, 0.9));
  report.predictedScales = predicted.map((x) => Math.round(x * 100) / 100);

  for (let si = 0; si < segments.length; si++) {
    if (!isCurrent()) return { pages: allPages, report: { ...report, aborted: true } };
    const seg = segments[si];
    // מתחילים מהחישוב, לא מהדף הקודם — הדף הקודם הוא ניחוש, החישוב הוא תשובה.
    if (predicted[si] > 0) lastScale = predicted[si];
    // ★ משה 14/09/2026: "מילת פתיח נוצרת בכל עמוד חדש, וזה לא אמור להיות
    // ככה — היא שייכת רק לקטע חדש אמיתי".
    // בנעילת דף כל קטע-דף נבנה בקריאה נפרדת, ולכן הפסקה הראשונה בו
    // נראית למנוע כתחילת פסקה — וקיבלה מילת פתיח. אבל מעבר העמוד כאן
    // נובע מגבול הדף בוילנא, לא מפתיחת קטע: הגמרא היא רצף אחד.
    // לכן כל קטע פרט לראשון מסומן כהמשך, בדיוק כמו חצי שני של פסקה
    // שפוצלה בין עמודים.
    if (si > 0 && Array.isArray(seg.paragraphs) && seg.paragraphs.length) {
      seg.paragraphs = seg.paragraphs.map((para, i) => (
        i === 0 && para ? { ...para, _v9OpeningWordAllowed: false, continues: true } : para
      ));
    }
    // tried = יומן הניסיונות (גודל → נכנס/לא נכנס). עוזר להבין למה דף מסוים
    // קיבל דווקא את הגודל הזה, ומאפשר לראות אם החיפוש נתקע.
    const segReport = { label: seg.label, paragraphs: seg.paragraphs.length, scale: 1, pages: 0, fill: 0, overflow: false, tried: [] };

    if (settings.mode === "soft") {
      const res = await buildPages(container, seg.paragraphs, cfg);
      const built = (res && res.pages) || [];
      // מודדים לפני התיוג — תווית הדף היא אלמנט נוסף בעמוד, ואם נמדוד
      // אחריה היא תיספר כתוכן.
      segReport.fill = built.length ? measurePageFill(built[built.length - 1], cfg) : 0;
      built.forEach((pageEl, i) => {
        pageEl.dataset.pageIndex = String(allPages.length + i);
        tagPage(pageEl, seg.label, 1, settings, i, built.length);
      });
      allPages.push(...built);
      segReport.pages = built.length;
      report.segments.push(segReport);
      report.pagesTotal += built.length;
      continue;
    }

    // --- מצב "העמוד מתאים את עצמו לטקסט" ---
    // האות נשארת בדיוק כפי שהמשתמש קבע; מחפשים את **הגובה הקטן ביותר**
    // של עמוד שבו כל הדף עדיין נכנס. כך אין הקטנת אות בכלל, והעמוד יוצא
    // מדויק לתוכן — כמו שדפי וילנא אינם שווים בכמות השורות.
    if (settings.fitPageToText) {
      const baseW = cfg.pageWidth || 380;
      const baseH = cfg.pageHeight || 794;
      // טווח החיפוש הוא **מכפיל** על שני הממדים. דף גמרא שלם עם רש"י
      // בגודל אות מלא צריך עמוד גדול בהרבה מעמוד רגיל; נמדד שפי 3 לא
      // הספיק, ולכן התקרה פי 12.
      let lo = 0.4;
      let hi = 12;
      let bestFit = null;
      const applyPageGeom = (pg, k) => {
        const w = Math.round(baseW * k);
        const h = Math.round(baseH * k);
        // גם אינליין וגם משתני CSS: כללי ההדפסה משתמשים במשתנים עם
        // !important, וסגנון אינליין לבדו היה נדרס בהדפסה.
        pg.style.width = `${w}px`;
        pg.style.height = `${h}px`;
        pg.style.setProperty("--ravtext-page-width", `${w}px`);
        pg.style.setProperty("--ravtext-page-height", `${h}px`);
        // זום ההדפסה של העמוד הזה: רוחב הנייר חלקי הרוחב הלוגי שלו.
        // כך עמוד שהוגדל פי k מקבל זום קטן פי k, וכל הדפים נוחתים על
        // אותו גודל נייר — וזו בדיוק הדרישה של משה.
        const rootZoom = parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--ravtext-print-zoom")
        );
        if (Number.isFinite(rootZoom) && rootZoom > 0) {
          pg.style.setProperty("--ravtext-print-zoom", String(rootZoom / k));
        }
        pg.dataset.dafPageFactor = String(Math.round(k * 1000) / 1000);
        fitPageIntoView(pg);
      };
      const tryHeight = async (k) => {
        const trialEl = makeTrialContainer(container);
        trialEl.style.setProperty("--ravtext-page-width", `${Math.round(baseW * k)}px`);
        trialEl.style.setProperty("--ravtext-page-height", `${Math.round(baseH * k)}px`);
        try {
          const res = await buildPages(trialEl, seg.paragraphs, { ...scaledPageConfig(cfg, k), maxPages: 2 });
          const pages = (res && res.pages) || [];
          for (const pg of pages) applyPageGeom(pg, k);
          const fits = pages.length === 1 && !pageOverflows(pages[0]);
          return { h: k, fits, pages: pages.length, el: trialEl };
        } catch (e) {
          return { h: k, fits: false, pages: 0, el: trialEl, error: String(e && e.message || e) };
        }
      };
      const keepBest = (r) => {
        if (r.fits && (!bestFit || r.h < bestFit.h)) {
          if (bestFit?.el?.parentNode) bestFit.el.parentNode.removeChild(bestFit.el);
          bestFit = r;
        } else if (r.el.parentNode && (!bestFit || bestFit.el !== r.el)) {
          r.el.parentNode.removeChild(r.el);
        }
      };
      keepBest(await tryHeight(hi));
      if (!bestFit) {
        // אפילו בגובה המרבי לא נכנס — לא חורגים; בונים כרגיל ומדווחים.
        const res = await buildPages(container, seg.paragraphs, scaledPageConfig(cfg, hi));
        const built = (res && res.pages) || [];
        built.forEach((pageEl, i) => {
          applyPageGeom(pageEl, hi);
          pageEl.dataset.pageIndex = String(allPages.length + i);
          tagPage(pageEl, seg.label, 1, settings, i, built.length);
        });
        allPages.push(...built);
        Object.assign(segReport, { scale: 1, pages: built.length, overflow: true, pageFactor: hi });
        report.segments.push(segReport);
        report.pagesTotal += built.length;
        report.dafimOverflowed++;
        continue;
      }
      for (let iter = 0; iter < 11 && hi - lo > 0.02; iter++) {
        const mid = (lo + hi) / 2;
        const r = await tryHeight(mid);
        keepBest(r);
        if (r.fits) hi = mid; else lo = mid;
        if (!isCurrent()) return { pages: allPages, report: { ...report, aborted: true } };
      }
      const pageEl = bestFit.el.firstElementChild;
      if (pageEl) {
        container.appendChild(pageEl);
        applyPageGeom(pageEl, bestFit.h);
        const fixes = resolveLineOverlaps(pageEl);
        if (fixes) segReport.overlapFixes = fixes;
        // ⛔ משה 14/09: קיצוץ תחתית העמוד **בוטל**. המטרה היא להדפיס
        // עמודים בגודל אחיד, ולכן כל העמודים חייבים להישאר באותו יחס
        // רוחב-גובה. חיתוך התחתית הרס בדיוק את זה. הפתרון למילוי הוא
        // הקטנה יחסית של כל העמוד (המכפיל), לא חיתוך.
        pageEl.dataset.pageIndex = String(allPages.length);
        tagPage(pageEl, seg.label, 1, settings);
        allPages.push(pageEl);
      }
      if (bestFit.el.parentNode) bestFit.el.parentNode.removeChild(bestFit.el);
      Object.assign(segReport, {
        scale: 1, pages: 1, fill: 1,
        pageFactor: Math.round(bestFit.h * 1000) / 1000,
        pageWidth: Math.round(baseW * bestFit.h),
        pageHeight: Math.round(baseH * bestFit.h),
      });
      report.segments.push(segReport);
      report.pagesTotal += 1;
      if (typeof opts.onProgress === "function") opts.onProgress(si + 1, segments.length, seg.label);
      await new Promise((r) => setTimeout(r, 0));
      continue;
    }

    // --- מצב "דף = עמוד": חיפוש הגודל הגדול ביותר שנכנס בעמוד אחד ---
    let best = null;   // { scale, container, pages, fill }
    const tried = new Map();

    const attempt = async (scale) => {
      const key = Math.round(scale * 1000);
      if (tried.has(key)) return tried.get(key);
      const trialEl = makeTrialContainer(container);
      let result;
      try {
        // maxPages: 2 — לבדיקת "נכנס בעמוד אחד?" די בשניים, וזה חוסך זמן.
        const res = await buildPages(trialEl, seg.paragraphs, { ...scaledConfig(cfg, scale), maxPages: 2 });
        const pages = (res && res.pages) || [];
        const fits = pages.length === 1 && !pageOverflows(pages[0]);
        result = { scale, fits, pages: pages.length, fill: pages.length ? measurePageFill(pages[0], cfg) : 0, el: trialEl };
      } catch (e) {
        result = { scale, fits: false, pages: 0, fill: 0, el: trialEl, error: String(e && e.message || e) };
      }
      tried.set(key, result);
      segReport.tried.push({
        scale: Math.round(scale * 1000) / 1000,
        fits: result.fits,
        pages: result.pages,
        fill: Math.round(result.fill * 100) / 100,
      });
      // שומרים בזיכרון רק את העמוד של הניסיון הטוב ביותר; כל השאר נמחקים
      // מיד מה-DOM כדי שלא יצטברו מאות עמודים מוסתרים.
      if (result.fits && (!best || result.scale > best.scale)) {
        if (best && best.el && best.el.parentNode) best.el.parentNode.removeChild(best.el);
        best = result;
      } else if (result.el.parentNode) {
        result.el.parentNode.removeChild(result.el);
      }
      return result;
    };

    const min = settings.minScale;
    const max = settings.maxScale;
    let lo = min;
    let hi = max;

    const top = await attempt(max);
    if (!top.fits) {
      const bottom = await attempt(min);
      if (!bottom.fits) {
        // גם בגודל הקטן ביותר הדף לא נכנס — לא שוברים את גבול העמוד
        // (כלל 1: אסור לחרוג). נותנים לו לזלוג לעמוד נוסף ומדווחים.
        const res = await buildPages(container, seg.paragraphs, scaledConfig(cfg, min));
        const built = (res && res.pages) || [];
        segReport.fill = built.length ? measurePageFill(built[0], cfg) : 0;
        built.forEach((pageEl, i) => {
          pageEl.dataset.pageIndex = String(allPages.length + i);
          tagPage(pageEl, seg.label, min, settings, i, built.length);
        });
        allPages.push(...built);
        segReport.scale = min;
        segReport.pages = built.length;
        segReport.overflow = true;
        report.segments.push(segReport);
        report.pagesTotal += built.length;
        report.dafimOverflowed++;
        lastScale = min;
        if (!isCurrent()) return { pages: allPages, report: { ...report, aborted: true } };
        continue;
      }
      // חיפוש חצייה: lo תמיד נכנס, hi תמיד לא.
      lo = min;
      hi = max;
      // נקודת פתיחה מהדף הקודם — מקצרת את החיפוש.
      if (lastScale > lo && lastScale < hi) {
        const guess = await attempt(lastScale);
        if (guess.fits) lo = lastScale; else hi = lastScale;
      }
      for (let iter = 0; iter < 6 && hi - lo > 0.015; iter++) {
        const mid = (lo + hi) / 2;
        const r = await attempt(mid);
        if (r.fits) lo = mid; else hi = mid;
        if (!isCurrent()) return { pages: allPages, report: { ...report, aborted: true } };
      }
    }

    if (!best) {
      // לא אמור לקרות (min נבדק ועבר), אבל אם כן — לא מאבדים תוכן.
      const res = await buildPages(container, seg.paragraphs, scaledConfig(cfg, min));
      const built = (res && res.pages) || [];
      built.forEach((pageEl, i) => {
        pageEl.dataset.pageIndex = String(allPages.length + i);
        tagPage(pageEl, seg.label, min, settings, i, built.length);
      });
      allPages.push(...built);
      segReport.scale = min;
      segReport.pages = built.length;
      report.segments.push(segReport);
      report.pagesTotal += built.length;
      continue;
    }

    // מעבירים את העמוד שנבנה בניסיון המוצלח למיכל האמיתי — בלי בנייה נוספת.
    const pageEl = best.el.firstElementChild;
    if (pageEl) {
      container.appendChild(pageEl);
      const fixes = resolveLineOverlaps(pageEl);
      if (fixes) segReport.overlapFixes = fixes;
      pageEl.dataset.pageIndex = String(allPages.length);
      tagPage(pageEl, seg.label, best.scale, settings);
      allPages.push(pageEl);
    }
    if (best.el.parentNode) best.el.parentNode.removeChild(best.el);
    segReport.scale = Math.round(best.scale * 1000) / 1000;
    segReport.pages = 1;
    segReport.fill = Math.round(best.fill * 1000) / 1000;
    report.segments.push(segReport);
    report.pagesTotal += 1;
    lastScale = best.scale;

    if (typeof opts.onProgress === "function") opts.onProgress(si + 1, segments.length, seg.label);
    // שחרור ה-thread בין דף לדף — כמו ב-V9 עצמו.
    await new Promise((r) => setTimeout(r, 0));
  }

  // ★ משה 14/09/2026: "כל העמודים חייבים להיות בגודל אורך ורוחב יחסי"
  // — כי בסוף מדפיסים ספר, וספר שדפיו בגדלים שונים אינו ספר.
  // כל דף קיבל את המכפיל המינימלי שלו; כאן מיישרים את כולם למכפיל
  // הגדול ביותר, כך שכל העמודים יוצאים **בדיוק באותו גודל**.
  // הדף שדרש הכי הרבה מקום קובע — וכך אף דף אינו נחתך.
  if (settings.fitPageToText && allPages.length > 1) {
    let maxFactor = 0;
    for (const pg of allPages) {
      const f = parseFloat(pg.dataset.dafPageFactor || "0");
      if (f > maxFactor) maxFactor = f;
    }
    if (maxFactor > 0) {
      const baseW = cfg.pageWidth || 380;
      const baseH = cfg.pageHeight || 794;
      const W = Math.round(baseW * maxFactor);
      const H = Math.round(baseH * maxFactor);
      const rootZoom = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--ravtext-print-zoom")
      );
      for (const pg of allPages) {
        pg.style.width = `${W}px`;
        pg.style.height = `${H}px`;
        pg.style.setProperty("--ravtext-page-width", `${W}px`);
        pg.style.setProperty("--ravtext-page-height", `${H}px`);
        if (Number.isFinite(rootZoom) && rootZoom > 0) {
          pg.style.setProperty("--ravtext-print-zoom", String(rootZoom / maxFactor));
        }
        pg.dataset.dafPageFactor = String(Math.round(maxFactor * 1000) / 1000);
        pg.dataset.dafUniform = "1";
        fitPageIntoView(pg);
      }
      report.uniformFactor = Math.round(maxFactor * 1000) / 1000;
      report.uniformSize = `${W}x${H}`;

      // ★ מעבר ב': עכשיו כשכל העמודים באותו גודל — כל דף שאינו ממלא
      // את העמוד נבנה מחדש עם **אות גדולה יותר**, עד לגודל שממלא. כך
      // מתקיימות שתי הדרישות יחד: גודל עמוד אחיד, ועמוד מלא.
      // (זו הדרך שמשה ניסח: "למלא את התוכן או להקטין בגודל יחסי" —
      //  ולא לחתוך את הנייר.)
      const uniformCfg = { ...cfg, pageWidth: W, pageHeight: H };
      // ⛔⛔ משה, 24/09: "גודל המילים והאותיות והרווחים והכל תמיד
      // יישאר אותו דבר, רק גודל הדף ישתנה בלבד". ו-25/09: "רק ביחס
      // גודל ורוחב של כל העמודים של המסמך".
      //
      // המעבר שמתחיל כאן מגדיל את **האות** בכל דף שאינו מלא — וזה
      // בדיוק מה שההוראות האחרונות אוסרות. הוא נבנה ב-14/09 לפי
      // בקשה קודמת ("למלא את התוכן או להקטין בגודל יחסי"), וההוראה
      // החדשה גוברת עליה.
      //
      // ⬛ לא נמחק דבר: המעבר נשאר במלואו ורק מדולג, ואפשר להחזיר
      //    אותו בהגדרה אחת. כך גם נשמרות כל המדידות שהושקעו בו.
      //
      // נמדד על הפלט של משה: המעבר חישב 14 ערכי dafScale שונים —
      // כלומר אות בגודל אחר כמעט לכל עמוד.
      const allowLetterResize = (() => {
        try { return localStorage.getItem("ravtext.vilnaDaf.allowLetterResize") === "1"; }
        catch (_) { return false; }
      })();
      for (let si2 = 0; allowLetterResize && si2 < segments.length && si2 < allPages.length; si2++) {
        if (!isCurrent()) break;
        const pageEl = allPages[si2];
        const seg2 = segments[si2];
        if (!pageEl || !seg2) continue;
        // ★ בודקים גם גובה וגם שטח, ולוקחים את הנמוך: חור לרוחב וחור
        // לגובה נחשבים שניהם כחוסר מילוי (בקשת משה 14/09).
        const fillNow = Math.min(
          measurePageFill(pageEl, uniformCfg),
          measurePageArea(pageEl, uniformCfg) * 1.6   // שטח תוכן טיפוסי
        );
        // ★ משה 14/09: "עמוד 23 עומד הרבה זמן על רינדור".
        // מעבר זה רץ אחרי שכל העמודים כבר על המסך, ולכן נראה כתקיעה.
        // סף הדילוג הורד מ-90% ל-80%: ההפרש אינו מצדיק תשע בניות נוספות
        // לכל דף, ועל 23 עמודים זה חוסך מאות בניות.
        // ★ משה 14/09: "יש כמה מנועים שונים שפועלים כאן — חלק בכתב קטן
        // חלק בכתב גדול, חלק ממלא את רוחב הדף וחלק לא, חלק מותח את עצמו
        // למריחה וחלק לא". והוא צדק: הדילוג כאן הוא שיצר את זה — דף
        // שדולג נשאר מהפריסה של **העמוד הישן**, ודף שנבנה מחדש קיבל
        // פריסה של העמוד האחיד. שתי שיטות על אותו מסמך.
        // מעכשיו **כל** דף נבנה מחדש בעמוד האחיד, כפי שמשה הורה: אחרי
        // שנקבע גודל העמוד — נותנים ל-V9 לחשב את הפריסה מחדש. דף שכבר
        // מלא מקבל בנייה אחת בגודל האות המקורי (בלי חיפוש), וכך הוא
        // עובר את אותו מסלול בדיוק בלי לבזבז זמן.
        const alreadyFull = fillNow >= 0.8;
        // סימן התקדמות גלוי, כדי שלא ייראה כמסך תקוע
        if (typeof opts.onProgress === "function") {
          opts.onProgress(si2 + 1, segments.length, `${seg2.label} — מכוון גודל אות`);
        }
        try {
          const st = document.getElementById("status");
          if (st) st.textContent = `מכוון גודל אות ${si2 + 1}/${segments.length}…`;
        } catch { /* אין אלמנט סטטוס — לא נורא */ }
        // חיפוש חצייה על גודל האות: הגדול ביותר שעדיין נכנס בעמוד אחד
        // ★ משה 14/09: "לפעמים הטקסט של הזרם הפנימי ממש מתקטן".
        // נמדד: דפים דלילים (23 שורות רש"י) נשארו במילוי 48%–50% בעוד
        // דפים צפופים הגיעו ל-95%–98%. הסיבה: התקרה להגדלת האות הייתה
        // 3.2, ודף דליל בעמוד שנקבע לפי הדף הצפוף ביותר צריך יותר.
        // התקרה הועלתה ל-6; החיפוש עוצר ממילא ברגע שהדף כבר לא נכנס,
        // ולכן אין סכנה של אות ענקית בדף צפוף.
        // ⚠ נמדד ובוטל (14/09): העלאת התקרה ל-6 שיפרה דפים דלילים אך
        // הרעה מאוד אחרים — מילוי ירד מ-98%/94%/94% ל-44%/52%/78%.
        // חיפוש חצייה על טווח רחב מדי מפספס את האזור הרלוונטי. 3.2 נשאר.
        let lo2 = 1, hi2 = alreadyFull ? 1.0001 : 3.2, bestBig = null;
        // ★ משה 14/09: "יש מרווחים לבנים בלי סיבה הנראית לעין".
        // הקריטריון היה "הגודל הגדול ביותר שנכנס" — ודף דליל ברש"י נכנס
        // בכל גודל, ולכן החיפוש לא חיפש מילוי כלל ונשאר עם חצי עמוד ריק
        // (נמדד: דף ה: עם 32 שורות רש"י — מילוי 50%).
        // עכשיו נשמר לכל גודל שנוסה גם **המילוי** שהתקבל, ונבחר הגודל
        // שממלא הכי טוב מבין אלה שנכנסו. דף צפוף אינו נפגע: אצלו הגודל
        // המרבי הוא ממילא גם הממלא ביותר.
        const tryFont = async (k) => {
          const trialEl = makeTrialContainer(container);
          trialEl.style.setProperty("--ravtext-page-width", `${W}px`);
          trialEl.style.setProperty("--ravtext-page-height", `${H}px`);
          try {
            const res2 = await buildPages(trialEl, seg2.paragraphs, {
              ...uniformCfg,
              mainFontSize: (cfg.mainFontSize || 13) * k,
              sideFontSize: (cfg.sideFontSize || 11) * k,
              maxPages: 2,
            });
            const pgs = (res2 && res2.pages) || [];
            const ok = pgs.length === 1 && !pageOverflows(pgs[0]);
            const fillK = ok ? Math.min(
              measurePageFill(pgs[0], uniformCfg),
              measurePageArea(pgs[0], uniformCfg) * 1.6
            ) : 0;
            if (ok && (!bestBig || fillK > bestBig.fill + 0.005)) {
              if (bestBig?.el?.parentNode) bestBig.el.parentNode.removeChild(bestBig.el);
              bestBig = { k, el: trialEl, fill: fillK };
              return true;
            }
            if (trialEl.parentNode) trialEl.parentNode.removeChild(trialEl);
            return ok;
          } catch {
            if (trialEl.parentNode) trialEl.parentNode.removeChild(trialEl);
            return false;
          }
        };
        // שישה צעדים נותנים דיוק של ~3% בגודל האות — יותר מספיק, וחוסכים
        // שליש מזמן המעבר על מסמך ארוך.
        // דף שכבר מלא — בנייה אחת בגודל 1.0 בלבד, כדי שגם הוא יחושב
        // מחדש בעמוד האחיד ולא יישאר מפריסה ישנה.
        if (alreadyFull) await tryFont(1);
        for (let it = 0; it < 6 && !alreadyFull && hi2 - lo2 > 0.06; it++) {
          const mid = (lo2 + hi2) / 2;
          if (await tryFont(mid)) lo2 = mid; else hi2 = mid;
        }
        if (bestBig && bestBig.el.firstElementChild) {
          const fresh = bestBig.el.firstElementChild;
          fresh.style.width = `${W}px`;
          fresh.style.height = `${H}px`;
          fresh.style.setProperty("--ravtext-page-width", `${W}px`);
          fresh.style.setProperty("--ravtext-page-height", `${H}px`);
          if (Number.isFinite(rootZoom) && rootZoom > 0) {
            fresh.style.setProperty("--ravtext-print-zoom", String(rootZoom / maxFactor));
          }
          fresh.dataset.dafPageFactor = String(Math.round(maxFactor * 1000) / 1000);
          fresh.dataset.dafUniform = "1";
          fresh.dataset.dafFontScale = String(Math.round(bestBig.k * 100) / 100);
          fresh.dataset.pageIndex = pageEl.dataset.pageIndex;
          tagPage(fresh, seg2.label, bestBig.k, settings);
          resolveLineOverlaps(fresh);
          container.replaceChild(fresh, pageEl);
          allPages[si2] = fresh;
          fitPageIntoView(fresh);
          if (report.segments[si2]) report.segments[si2].fontScale = bestBig.k;
        }
        if (bestBig?.el?.parentNode) bestBig.el.parentNode.removeChild(bestBig.el);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  report.durationMs = Date.now() - report.startedAt;
  if (typeof window !== "undefined") window.__VILNA_DAF_REPORT__ = report;
  return { pages: allPages, report };
}

function tagPage(pageEl, label, scale, settings, idx = 0, total = 1) {
  if (!pageEl) return;
  pageEl.dataset.dafLabel = label || "";
  pageEl.dataset.dafScale = String(Math.round(scale * 1000) / 1000);
  if (total > 1) pageEl.dataset.dafPart = `${idx + 1}/${total}`;
  if (label) pageEl.setAttribute("title", `דף ${label}`);
  if (settings.showLabel && label) {
    const doc = pageEl.ownerDocument;
    const old = pageEl.querySelector(":scope > .v9-daf-label");
    if (old) old.remove();
    const el = doc.createElement("div");
    el.className = "v9-daf-label";
    el.textContent = total > 1 ? `${label} (${idx + 1}/${total})` : label;
    pageEl.appendChild(el);
  }
}
