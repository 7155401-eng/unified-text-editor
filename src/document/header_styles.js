// עיצוב כותרת ותחתית העמוד (העברה מהתוכנה הקודמת, פריט 12 בביקורת).
//
// באתר כבר יש כותרת ותחתית — אבל **טקסט פשוט בלבד**: אי-אפשר לקבוע גופן,
// גודל, הדגשה או יישור, ואי-אפשר להבדיל בין עמוד זוגי לאי-זוגי. בספר מודפס
// זה בדיוק מה שצריך: הכותרת בעמוד הימני והשמאלי אינן זהות.
//
// ⚠️ בתוכנה הישנה **אין מימוש לזה** — נבדק: אפס התאמות ל-`header_style`
// בכל 248 קובצי הפייתון. מפת ההעברה רשמה את היכולת, אבל היא הייתה הבטחה
// ולא קוד. ולכן זו בנייה, לא העברה.
//
// ⭐ המודול הזה **אינו נוגע ב-`document_features.js`**, שבוטים אחרים עובדים
// עליו כרגע. הוא רק מזריק כלל עיצוב אחד ל-`.ravtext-page-header` ול-
// `.ravtext-page-footer`, שכבר קיימים. ולכן אין כאן שום סיכון להתנגשות,
// וכיבוי ההגדרה מחזיר את המראה הקודם במדויק.

export const HEADER_STYLE_KEY = "ravtext.pageHeaderStyle";
export const HEADER_STYLE_TAG_ID = "rt-header-style-rules";

export const ALIGN_OPTIONS = [
  { id: "center", label: "באמצע" },
  { id: "right", label: "לימין" },
  { id: "left", label: "לשמאל" },
  { id: "outer", label: "לצד החיצוני (מתחלף בין עמודים)" },
  { id: "inner", label: "לצד הפנימי (מתחלף בין עמודים)" },
];

const ALIGN_IDS = new Set(ALIGN_OPTIONS.map((a) => a.id));

export function emptyHeaderStyle() {
  return {
    enabled: false,
    font: "",
    sizePt: 10,
    bold: false,
    italic: false,
    align: "center",
    color: "",
    rule: false,        // קו מפריד בין הכותרת לטקסט
    applyToFooter: true,
  };
}

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeHeaderStyle(raw) {
  const base = emptyHeaderStyle();
  if (!raw || typeof raw !== "object") return base;
  const align = String(raw.align ?? base.align);
  return {
    enabled: !!raw.enabled,
    font: String(raw.font ?? "").slice(0, 120),
    // 4–72 נקודות. מתחת לזה לא קריא, מעליו הכותרת בולעת את העמוד.
    sizePt: Math.min(72, Math.max(4, num(raw.sizePt, base.sizePt))),
    bold: !!raw.bold,
    italic: !!raw.italic,
    align: ALIGN_IDS.has(align) ? align : base.align,
    // רק צבע בכתיב מקובל — כדי שלא ייכנס לכאן קוד.
    color: /^#[0-9a-fA-F]{3,8}$/u.test(String(raw.color ?? "")) ? String(raw.color) : "",
    rule: !!raw.rule,
    applyToFooter: raw.applyToFooter === undefined ? true : !!raw.applyToFooter,
  };
}

/**
 * „חיצוני" ו„פנימי" אינם ימין או שמאל קבועים — הם מתחלפים בין עמוד זוגי
 * לאי-זוגי, כמו בספר פתוח. בעברית הצד הפנימי של עמוד אי-זוגי הוא **שמאל**.
 */
export function resolveAlign(align, pageNumber) {
  if (align !== "outer" && align !== "inner") return align;
  const odd = Math.abs(Math.trunc(Number(pageNumber) || 1)) % 2 === 1;
  if (align === "outer") return odd ? "right" : "left";
  return odd ? "left" : "right";
}

/** בונה את גוף כלל העיצוב — בלי הסלקטור. */
export function headerStyleDeclarations(cfg) {
  const c = normalizeHeaderStyle(cfg);
  if (!c.enabled) return "";
  const out = [];
  if (c.font) out.push(`font-family:${c.font}`);
  out.push(`font-size:${c.sizePt}pt`);
  out.push(`font-weight:${c.bold ? 700 : 400}`);
  out.push(`font-style:${c.italic ? "italic" : "normal"}`);
  if (c.color) out.push(`color:${c.color}`);
  if (c.align !== "outer" && c.align !== "inner") out.push(`text-align:${c.align}`);
  return out.join(";");
}

/**
 * מייצר את גיליון העיצוב כולו.
 *
 * ליישור מתחלף אין דרך ב-CSS בלבד לדעת מהו מספר העמוד, ולכן נוספים שני
 * כללים שמסתמכים על `data-page-parity` שהמעטפת מסמנת על כל עמוד.
 */
export function buildHeaderStyleSheet(cfg) {
  const c = normalizeHeaderStyle(cfg);
  if (!c.enabled) return "";
  const decls = headerStyleDeclarations(c);
  if (!decls) return "";

  const targets = c.applyToFooter
    ? ".ravtext-page-header,.ravtext-page-footer"
    : ".ravtext-page-header";

  const rules = [`${targets}{${decls}}`];

  if (c.align === "outer" || c.align === "inner") {
    const oddSide = resolveAlign(c.align, 1);
    const evenSide = resolveAlign(c.align, 2);
    rules.push(`.page[data-page-parity="odd"] :is(${targets}){text-align:${oddSide}}`);
    rules.push(`.page[data-page-parity="even"] :is(${targets}){text-align:${evenSide}}`);
  }

  if (c.rule) {
    rules.push(`.ravtext-page-header{border-bottom:1px solid currentColor;padding-bottom:2px}`);
    if (c.applyToFooter) {
      rules.push(`.ravtext-page-footer{border-top:1px solid currentColor;padding-top:2px}`);
    }
  }

  return rules.join("\n");
}

/** מחיל על הדף. החזרה למצב הקודם = קריאה נוספת עם `enabled:false`. */
export function applyHeaderStyle(cfg, doc = (typeof document !== "undefined" ? document : null)) {
  if (!doc) return false;
  const css = buildHeaderStyleSheet(cfg);
  let tag = doc.getElementById(HEADER_STYLE_TAG_ID);
  if (!css) { tag?.remove(); return false; }
  if (!tag) {
    tag = doc.createElement("style");
    tag.id = HEADER_STYLE_TAG_ID;
    doc.head.appendChild(tag);
  }
  if (tag.textContent !== css) tag.textContent = css;
  return true;
}

/**
 * מסמן על כל עמוד אם הוא זוגי או אי-זוגי — רק אם צריך, וכותב רק מה שהשתנה,
 * כדי שלא ייווצר מעגל של שינויים בדף.
 */
export function markPageParity(pagesContainer, selector = ".page:not(.page-placeholder):not(.ravtext-empty-page)") {
  if (!pagesContainer?.querySelectorAll) return 0;
  const pages = [...pagesContainer.querySelectorAll(selector)];
  let touched = 0;
  pages.forEach((page, index) => {
    const want = (index + 1) % 2 === 1 ? "odd" : "even";
    if (page.getAttribute("data-page-parity") !== want) {
      page.setAttribute("data-page-parity", want);
      touched += 1;
    }
  });
  return touched;
}

export function loadHeaderStyle(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  try {
    const raw = storage?.getItem?.(HEADER_STYLE_KEY);
    return raw ? normalizeHeaderStyle(JSON.parse(raw)) : emptyHeaderStyle();
  } catch { return emptyHeaderStyle(); }
}

export function saveHeaderStyle(cfg, storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  try { storage?.setItem?.(HEADER_STYLE_KEY, JSON.stringify(normalizeHeaderStyle(cfg))); return true; }
  catch { return false; }
}
