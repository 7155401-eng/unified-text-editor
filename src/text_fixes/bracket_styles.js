// עיצוב תוכן שבתוך סוגריים — המנוע (העברה מהתוכנה הקודמת, פריט 1 בביקורת).
//
// בספרי קודש נהוג שמה שבתוך סוגריים — ציון מקור, הערת ביניים — מודפס קטן
// יותר מהטקסט שסביבו. בתוכנה הישנה היה לזה חלון „הגדרות סוגריים לזרם", ולכל
// סוג סוגריים בנפרד אפשר היה לקבוע: האם פעיל · סגנון וורד · פונט · גודל
// באחוזים · כניסת פסקה · רווח פסקה.
//
// באתר זה לא קיים — נבדק: אפס התאמות ל-`shrinkBracket`/`bracketSize` בכל המקור.
// השם המקוצר „הקטנת סוגריים אוטומטית" מטעה: לא מקטינים את **הסוגריים**, אלא
// מעצבים את **מה שבתוכן**.
//
// כאן יושבת רק הלוגיקה — מציאת הקטעים ובניית העיצוב. אין פנייה לרשת, אין
// נגיעה במסך, ואין שינוי של טקסט: הפלט הוא **רשימת קטעים**, והמעטפת מחליטה
// מה לעשות איתה.

export const BRACKET_TYPES = [
  { id: "round", label: "עגולות ( )", open: "(", close: ")" },
  { id: "square", label: "מרובעות [ ]", open: "[", close: "]" },
  { id: "curly", label: "מסולסלות { }", open: "{", close: "}" },
  { id: "angle", label: "חיצים < >", open: "<", close: ">" },
];

const BY_OPEN = new Map(BRACKET_TYPES.map((b) => [b.open, b]));
const BY_CLOSE = new Map(BRACKET_TYPES.map((b) => [b.close, b]));

/** ברירת המחדל: הכול כבוי, וגודל 100% — כלומר בלי שינוי. */
export function emptyBracketSettings() {
  const out = {};
  for (const b of BRACKET_TYPES) {
    out[b.id] = { enabled: false, style: "", font: "", sizePercent: 100, parIndentPt: 0, parSkipPt: 0 };
  }
  return out;
}

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeBracketSettings(raw) {
  const out = emptyBracketSettings();
  if (!raw || typeof raw !== "object") return out;
  for (const b of BRACKET_TYPES) {
    const src = raw[b.id];
    if (!src || typeof src !== "object") continue;
    out[b.id] = {
      enabled: !!src.enabled,
      style: String(src.style ?? "").slice(0, 120),
      font: String(src.font ?? "").slice(0, 120),
      // 10%–400%: מתחת לזה הטקסט נעלם, מעליו הוא שובר את השורה.
      sizePercent: Math.min(400, Math.max(10, Math.round(num(src.sizePercent, 100)))),
      parIndentPt: Math.min(200, Math.max(-200, num(src.parIndentPt, 0))),
      parSkipPt: Math.min(200, Math.max(0, num(src.parSkipPt, 0))),
    };
  }
  return out;
}

/**
 * מוצא קטעים שבתוך סוגריים.
 *
 * ⭐ קינון: „(א [ב] ג)" מחזיר גם את החיצוני וגם את הפנימי, והפנימי מסומן
 * בעומק גבוה יותר. זה מכוון — בספרים יש ציון בתוך ציון, ושניהם צריכים עיצוב.
 *
 * ⛔ סוגר שנסגר בלי להיפתח, או נפתח ובלי להיסגר — **אינו מוחזר כלל**. בספר
 * אמיתי זה קורה (סוגר יחיד באמצע ציטוט), ועיצוב שגוי שם היה בולע חצי עמוד.
 *
 * @returns {Array<{type:string, start:number, end:number, innerStart:number, innerEnd:number, depth:number}>}
 */
export function findBracketSpans(text, { types = null } = {}) {
  const src = String(text ?? "");
  const want = types ? new Set(types) : null;
  const stack = [];
  const out = [];

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const open = BY_OPEN.get(ch);
    const close = BY_CLOSE.get(ch);

    if (open) { stack.push({ type: open.id, start: i, depth: stack.length }); continue; }
    if (!close) continue;

    // מחפשים את הפתיחה התואמת. סוגר שלא מתאים לראש המחסנית מתעלמים ממנו,
    // כדי שסוגר יחיד לא יבלע את כל מה שאחריו.
    let idx = -1;
    for (let k = stack.length - 1; k >= 0; k -= 1) {
      if (stack[k].type === close.id) { idx = k; break; }
    }
    if (idx === -1) continue;

    const frame = stack[idx];
    stack.length = idx;
    if (want && !want.has(frame.type)) continue;
    out.push({
      type: frame.type,
      start: frame.start,
      end: i + 1,
      innerStart: frame.start + 1,
      innerEnd: i,
      depth: frame.depth,
    });
  }

  // סוגריים שנפתחו ולא נסגרו נשארים במחסנית ופשוט נזרקים — בכוונה.
  return out.sort((a, b) => a.start - b.start || a.depth - b.depth);
}

/** בונה את העיצוב של סוג סוגריים אחד, או כלום אם אין מה לשנות. */
export function bracketInlineStyle(cfg) {
  if (!cfg?.enabled) return "";
  const parts = [];
  if (cfg.sizePercent && cfg.sizePercent !== 100) parts.push(`font-size:${cfg.sizePercent}%`);
  if (cfg.font) parts.push(`font-family:${cfg.font}`);
  if (cfg.parIndentPt) parts.push(`text-indent:${cfg.parIndentPt}pt`);
  if (cfg.parSkipPt) parts.push(`margin-top:${cfg.parSkipPt}pt`);
  return parts.join(";");
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>]/gu, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

/**
 * עוטף את תוכן הסוגריים בעיצוב, ומחזיר HTML.
 *
 * הסוגריים עצמם **נשארים בטקסט** — רק מה שביניהם מעוצב. מי שרוצה להוריד את
 * התווים עצמם משתמש בתיקון „להוריד סוגריים" שבתיקונים הגלובליים.
 *
 * מטפל רק בשכבה החיצונית: קטע שנמצא בתוך קטע אחר שכבר עוצב לא נעטף פעמיים,
 * כדי שהאחוזים לא יוכפלו (80% בתוך 80% = 64%, וזה לא מה שהתבקש).
 */
export function applyBracketStyles(text, settings) {
  const src = String(text ?? "");
  const cfg = normalizeBracketSettings(settings);
  const active = BRACKET_TYPES.filter((b) => cfg[b.id].enabled).map((b) => b.id);
  if (!active.length) return { html: escapeHtml(src), wrapped: 0 };

  const spans = findBracketSpans(src, { types: active });
  // רק השכבה החיצונית, כדי לא להכפיל אחוזים.
  const top = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start < lastEnd) continue;
    top.push(s);
    lastEnd = s.end;
  }
  if (!top.length) return { html: escapeHtml(src), wrapped: 0 };

  let html = "";
  let pos = 0;
  for (const s of top) {
    html += escapeHtml(src.slice(pos, s.innerStart));
    const style = bracketInlineStyle(cfg[s.type]);
    const cls = `rt-bracket rt-bracket-${s.type}`;
    const styleAttr = style ? ` style="${style}"` : "";
    const dataStyle = cfg[s.type].style ? ` data-word-style="${escapeHtml(cfg[s.type].style)}"` : "";
    html += `<span class="${cls}"${styleAttr}${dataStyle}>${escapeHtml(src.slice(s.innerStart, s.innerEnd))}</span>`;
    html += escapeHtml(src.slice(s.innerEnd, s.end));
    pos = s.end;
  }
  html += escapeHtml(src.slice(pos));
  return { html, wrapped: top.length };
}

/** סיכום למשתמש לפני שהוא מאשר — כמה קטעים מכל סוג יעוצבו. */
export function summarizeBrackets(text, settings) {
  const cfg = normalizeBracketSettings(settings);
  const spans = findBracketSpans(text);
  const counts = {};
  for (const b of BRACKET_TYPES) {
    counts[b.id] = {
      label: b.label,
      found: spans.filter((s) => s.type === b.id).length,
      enabled: cfg[b.id].enabled,
      sizePercent: cfg[b.id].sizePercent,
    };
  }
  return counts;
}
