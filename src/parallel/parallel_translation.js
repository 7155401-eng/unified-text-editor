// תרגום לצד הטקסט — המנוע (העברה מהתוכנה הקודמת, פריט 7 בביקורת).
//
// בתוכנה הישנה לכל זרם היה **סוג**, ובדיוק שלושה: „למטה" · „הערת צד" ·
// „תרגום" (`app_ui.py:6290`). באתר יש רק **מיקום** (פנימי/חיצוני) — ולכן
// „תרגום" לא קיים.
//
// ⭐ ההבדל המהותי מ„הערת צד": הערות **זורמות** לאורך העמוד ומתמלאות לפי
// הצורך; תרגום הוא **עמודה קבועה** שרצה לצד הטקסט לכל אורכו, ופסקה מול
// פסקה. לכן גם בתוכנה הישנה מותר היה **אחד בלבד**: „ניתן לבחור תרגום רק
// לזרם אחד!" — לטקסט יש בן-זוג אחד, לא שלושה.
//
// ⭐⭐ ומשום כך זה **אינו** זרם צד של V9 ואינו עובר דרך מתכנן הגפ״ת. ב-V9
// רוחב זרמי הצד **מחושב מהתוכן**; כאן הוא קבוע מראש. בתוכנה הישנה זה היה
// `SOURCE_PARALLEL` — סוג משלו — וכך גם כאן.
//
// המפרט, מילה במילה מהקוד הישן (`app_ui.py:6689`):
//   parallel_pct = 30     ⟵ העמודה תופסת 30% מרוחב העמוד
//   parallel_gap = 0.8    ⟵ מרחק מהטקסט הראשי, **בסנטימטרים**
//   position     = left/right
//   אחד בלבד.

/** 0.8 ס״מ — הערך של התוכנה הישנה. נשמר בס״מ ומומר רק בציור. */
export const DEFAULT_GAP_CM = 0.8;
export const DEFAULT_WIDTH_PERCENT = 30;
/** 96 פיקסלים לאינץ׳, 2.54 ס״מ לאינץ׳. */
export const PX_PER_CM = 96 / 2.54;

export function cmToPx(cm) {
  const n = Number(cm);
  return Number.isFinite(n) ? Math.round(n * PX_PER_CM * 100) / 100 : 0;
}

export function emptyParallelSettings() {
  return {
    enabled: false,
    streamCode: "",
    widthPercent: DEFAULT_WIDTH_PERCENT,
    gapCm: DEFAULT_GAP_CM,
    position: "left",
    showTitles: true,
  };
}

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeParallelSettings(raw) {
  const base = emptyParallelSettings();
  if (!raw || typeof raw !== "object") return base;
  const position = String(raw.position ?? base.position);
  return {
    enabled: !!raw.enabled,
    streamCode: String(raw.streamCode ?? "").trim().slice(0, 8),
    // 10%–70%: מתחת לזה התרגום אינו קריא, מעליו הוא בולע את המקור.
    widthPercent: Math.min(70, Math.max(10, Math.round(num(raw.widthPercent, base.widthPercent)))),
    gapCm: Math.min(5, Math.max(0, Math.round(num(raw.gapCm, base.gapCm) * 100) / 100)),
    position: position === "right" ? "right" : "left",
    showTitles: raw.showTitles === undefined ? true : !!raw.showTitles,
  };
}

/** מפרק טקסט לפסקאות — שורה ריקה מפרידה, ושורה בודדת היא פסקה. */
export function splitParagraphs(text) {
  return String(text ?? "")
    .split(/\n\s*\n|\n/u)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * מזווג פסקה מול פסקה.
 *
 * ⛔ **הכלל החשוב כאן:** אם מספר הפסקאות אינו שווה — הכלי **אינו מנחש**
 * ואינו מותח. הוא מזווג לפי הסדר עד כמה שאפשר, ומדווח בדיוק כמה נשארו
 * בלי בן-זוג. תרגום שמוצמד לפסקה הלא נכונה גרוע מתרגום חסר, כי הוא
 * נראה נכון.
 *
 * @returns {{pairs: Array<{index:number, source:string, translation:string}>,
 *            summary: Object}}
 */
export function pairParagraphs(sourceText, translationText) {
  const src = splitParagraphs(sourceText);
  const tr = splitParagraphs(translationText);
  const n = Math.max(src.length, tr.length);

  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    pairs.push({
      index: i,
      source: src[i] ?? "",
      translation: tr[i] ?? "",
      orphan: src[i] === undefined || tr[i] === undefined,
    });
  }

  const summary = {
    sourceParagraphs: src.length,
    translationParagraphs: tr.length,
    paired: Math.min(src.length, tr.length),
    sourceWithoutTranslation: Math.max(0, src.length - tr.length),
    translationWithoutSource: Math.max(0, tr.length - src.length),
    aligned: src.length === tr.length,
  };

  return { pairs, summary };
}

/** רוחב שתי העמודות והמרווח ביניהן, באחוזים — כדי שהציור לא יחשב בעצמו. */
export function columnGeometry(settings) {
  const cfg = normalizeParallelSettings(settings);
  const gapPx = cmToPx(cfg.gapCm);
  return {
    translationPercent: cfg.widthPercent,
    sourcePercent: 100 - cfg.widthPercent,
    gapPx,
    gapCm: cfg.gapCm,
    translationFirst: cfg.position === "right",
  };
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/**
 * בונה את ה-HTML של התצוגה המקבילה.
 *
 * כל זוג הוא שורה אחת בטבלת-רשת, ולכן פסקה והתרגום שלה **תמיד מתחילים
 * באותו גובה** — גם אם אחד מהם ארוך מהשני. זה בדיוק מה שתרגום מקביל אמור
 * לעשות, ומה שזרם הערות זורם אינו יכול לעשות.
 */
export function buildParallelHtml(sourceText, translationText, settings, titles = {}) {
  const cfg = normalizeParallelSettings(settings);
  const geo = columnGeometry(cfg);
  const { pairs, summary } = pairParagraphs(sourceText, translationText);

  const cols = geo.translationFirst
    ? `${geo.translationPercent}% ${geo.gapPx}px ${geo.sourcePercent}%`
    : `${geo.sourcePercent}% ${geo.gapPx}px ${geo.translationPercent}%`;

  const head = cfg.showTitles && (titles.source || titles.translation)
    ? (geo.translationFirst
        ? `<div class="rtp-title">${escapeHtml(titles.translation || "תרגום")}</div><div></div><div class="rtp-title">${escapeHtml(titles.source || "מקור")}</div>`
        : `<div class="rtp-title">${escapeHtml(titles.source || "מקור")}</div><div></div><div class="rtp-title">${escapeHtml(titles.translation || "תרגום")}</div>`)
    : "";

  const rows = pairs.map((p) => {
    const srcCell = `<div class="rtp-src${p.source ? "" : " is-empty"}">${escapeHtml(p.source)}</div>`;
    const trCell = `<div class="rtp-tr${p.translation ? "" : " is-empty"}">${escapeHtml(p.translation)}</div>`;
    const gap = `<div class="rtp-gap"></div>`;
    return geo.translationFirst ? trCell + gap + srcCell : srcCell + gap + trCell;
  }).join("");

  const html = `<div class="rtp-grid" style="display:grid;grid-template-columns:${cols};align-items:start">${head}${rows}</div>`;
  return { html, summary, geometry: geo };
}

/** סיכום בעברית למשתמש — ובמיוחד אזהרה כשהפסקאות אינן תואמות. */
export function describeParallelSummary(summary) {
  if (summary.aligned) {
    return `✅ ${summary.paired} פסקאות, וכל אחת מול בת-זוגה.`;
  }
  const parts = [`⚠️ ${summary.sourceParagraphs} פסקאות במקור מול ${summary.translationParagraphs} בתרגום.`];
  if (summary.sourceWithoutTranslation) {
    parts.push(`${summary.sourceWithoutTranslation} פסקאות במקור נשארו בלי תרגום.`);
  }
  if (summary.translationWithoutSource) {
    parts.push(`${summary.translationWithoutSource} פסקאות תרגום נשארו בלי מקור.`);
  }
  parts.push("הזיווג נעשה לפי הסדר עד כמה שאפשר — ולא נוחש. כדאי לבדוק מאיפה ההפרש.");
  return parts.join(" ");
}
