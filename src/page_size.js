// page_size.js — בחירת גודל הנייר (A4 / A5 / Letter / מותאם אישית).
//
// ===================== איך העמוד בנוי כאן — חשוב להבין =====================
// העמוד על המסך אינו "קטן". הוא **A4 מוקטן**: המנוע עובד במרחב לוגי של
// 380×537 נקודות, ובהדפסה יש `zoom: 2.0887` שמנפח אותו בדיוק ל-210מ"מ
// (380 × 2.0887 = 793.7px = 210mm ב-96dpi). כלומר הנייר תמיד היה A4 —
// פשוט לא הייתה דרך לבחור נייר אחר.
//
// ===================== מה המודול הזה עושה =====================
// שומר את **רוחב המרחב הלוגי על 380** (כדי שכל מסמך קיים ייראה בדיוק אותו
// דבר), משנה רק את **הגובה הלוגי** לפי יחס הנייר, ומחשב מחדש את ה-zoom
// של ההדפסה. כך:
//   • A4 (ברירת מחדל) → 380×537, zoom 2.0887 — זהה לחלוטין למה שהיה.
//   • A5 → אותו רוחב לוגי, אותו יחס, אבל zoom קטן יותר (נייר קטן יותר).
//   • לרוחב (landscape) → הגובה הלוגי קטן מהרוחב.
//
// ⚠️ הכלל הקריטי: משתני ה-CSS חייבים לתאר את **אותו** עמוד שהמנוע מחשב.
// V9 קורא את `--ravtext-page-width/height` מה-container; אם הקופסה ב-CSS
// תהיה בגודל אחר — המנוע יבנה עמוד אחד והמסך יראה עמוד אחר, והתוכן ייחתך
// בשקט. לכן הכול נגזר כאן ממקום אחד.

const KEY = "ravtext.pageSize.v1";
const LOGICAL_WIDTH = 380;          // רוחב המרחב הלוגי — לא משתנה לעולם
const MM_TO_PX = 96 / 25.4;         // 96dpi

// גדלי נייר במילימטרים
export const PAPER_SIZES = {
  a4:        { label: "A4 (21×29.7 ס\"מ)",        w: 210, h: 297 },
  a4l:       { label: "A4 לרוחב",                 w: 297, h: 210 },
  a5:        { label: "A5 (14.8×21 ס\"מ)",        w: 148, h: 210 },
  a5l:       { label: "A5 לרוחב",                 w: 210, h: 148 },
  b5:        { label: "B5 (17.6×25 ס\"מ)",        w: 176, h: 250 },
  letter:    { label: "Letter (21.6×27.9 ס\"מ)",  w: 215.9, h: 279.4 },
  legal:     { label: "Legal (21.6×35.6 ס\"מ)",   w: 215.9, h: 355.6 },
  gemara:    { label: "דף גמרא (19.5×29 ס\"מ)",   w: 195, h: 290 },
  custom:    { label: "מותאם אישית…",             w: 210, h: 297 },
};

export function readPageSize() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { id: "a4", w: 210, h: 297 };
    const s = JSON.parse(raw);
    const preset = PAPER_SIZES[s.id];
    if (s.id === "custom") {
      return { id: "custom", w: clampMm(s.w, 210), h: clampMm(s.h, 297) };
    }
    if (!preset) return { id: "a4", w: 210, h: 297 };
    return { id: s.id, w: preset.w, h: preset.h };
  } catch {
    return { id: "a4", w: 210, h: 297 };
  }
}

function clampMm(v, fallback) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(50, Math.min(600, n));
}

export function writePageSize(next) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* אין אחסון (מצב דמו) — ההגדרה תחזיק רק לסשן הנוכחי */ }
}

/**
 * מחשב את המספרים הנגזרים מגודל הנייר.
 * logicalWidth נשאר 380 תמיד; הגובה והזום נגזרים ממנו.
 */
export function computePageMetrics(size = readPageSize()) {
  const ratio = size.h / size.w;                       // יחס הנייר
  const logicalWidth = LOGICAL_WIDTH;
  const logicalHeight = Math.round(logicalWidth * ratio);
  const paperWidthPx = size.w * MM_TO_PX;
  const printZoom = paperWidthPx / logicalWidth;       // כמה להגדיל בהדפסה
  return {
    id: size.id,
    widthMm: size.w,
    heightMm: size.h,
    logicalWidth,
    logicalHeight,
    printZoom: Math.round(printZoom * 10000) / 10000,
    paperWidthMm: `${size.w}mm`,
    paperHeightMm: `${size.h}mm`,
  };
}

/** כותב את המספרים למשתני ה-CSS. זה המקום היחיד שמגדיר את גודל העמוד. */
export function applyPageSize(size = readPageSize()) {
  if (typeof document === "undefined") return null;
  const m = computePageMetrics(size);
  const root = document.documentElement;
  root.style.setProperty("--ravtext-page-width", `${m.logicalWidth}px`);
  root.style.setProperty("--ravtext-page-height", `${m.logicalHeight}px`);
  root.style.setProperty("--ravtext-print-zoom", String(m.printZoom));
  root.style.setProperty("--ravtext-paper-width", m.paperWidthMm);
  root.style.setProperty("--ravtext-paper-height", m.paperHeightMm);
  // גם על מיכל העמודים עצמו — משם V9 קורא את הגודל דרך getComputedStyle.
  for (const c of document.querySelectorAll(".pages-container")) {
    c.style.setProperty("--ravtext-page-width", `${m.logicalWidth}px`);
    c.style.setProperty("--ravtext-page-height", `${m.logicalHeight}px`);
  }
  return m;
}

/** מחבר את הבורר בסרגל. onChange = לרנדר מחדש. */
export function wirePageSizeControls(onChange) {
  const select = document.getElementById("page-size-select");
  const widthInput = document.getElementById("page-size-width");
  const heightInput = document.getElementById("page-size-height");
  const customWrap = document.getElementById("page-size-custom");
  const info = document.getElementById("page-size-info");
  if (!select) {
    applyPageSize();   // גם בלי ממשק — ההגדרה השמורה חייבת לחול
    return;
  }

  select.innerHTML = "";
  for (const [id, p] of Object.entries(PAPER_SIZES)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.label;
    select.appendChild(opt);
  }

  const current = readPageSize();
  select.value = current.id;
  if (widthInput) widthInput.value = current.w;
  if (heightInput) heightInput.value = current.h;

  const refresh = (rerender) => {
    const size = readPageSize();
    const m = applyPageSize(size);
    if (customWrap) customWrap.style.display = size.id === "custom" ? "" : "none";
    if (info) {
      info.textContent = `${m.widthMm}×${m.heightMm} מ"מ · העמוד במנוע: ${m.logicalWidth}×${m.logicalHeight}`;
    }
    if (rerender) onChange?.();
  };

  select.addEventListener("change", () => {
    const id = select.value;
    if (id === "custom") {
      writePageSize({ id: "custom", w: clampMm(widthInput?.value, 210), h: clampMm(heightInput?.value, 297) });
    } else {
      writePageSize({ id });
      const p = PAPER_SIZES[id];
      if (widthInput) widthInput.value = p.w;
      if (heightInput) heightInput.value = p.h;
    }
    refresh(true);
  });

  const commitCustom = () => {
    const w = clampMm(widthInput?.value, 210);
    const h = clampMm(heightInput?.value, 297);
    if (widthInput) widthInput.value = w;
    if (heightInput) heightInput.value = h;
    select.value = "custom";
    writePageSize({ id: "custom", w, h });
    refresh(true);
  };
  widthInput?.addEventListener("change", commitCustom);
  heightInput?.addEventListener("change", commitCustom);

  refresh(false);
}
