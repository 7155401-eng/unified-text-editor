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
  const pageTop = pageEl.getBoundingClientRect ? pageEl.getBoundingClientRect().top : 0;
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
  return bottom / usable;
}

function pageOverflows(pageEl) {
  if (!pageEl) return false;
  return pageEl.scrollHeight > pageEl.offsetHeight + 1;
}

// ===================== הבנייה =====================
function scaledConfig(cfg, scale) {
  if (scale === 1) return cfg;
  return {
    ...cfg,
    mainFontSize: (cfg.mainFontSize || 13) * scale,
    sideFontSize: (cfg.sideFontSize || 11) * scale,
  };
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

  for (let si = 0; si < segments.length; si++) {
    if (!isCurrent()) return { pages: allPages, report: { ...report, aborted: true } };
    const seg = segments[si];
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
