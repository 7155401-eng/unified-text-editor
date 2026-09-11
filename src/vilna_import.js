// vilna_import.js — ייבוא גמרא ורש"י מהמאגר המקומי, בצורת ש"ס וילנא.
//
// מאיפה הטקסט: public/data/sefaria/vilna_shas/<מסכת>.json — מאגר מקומי שנבנה
// ע"י scripts/build_vilna_shas_mirror.mjs. אין כאן שום פנייה ל-sefaria.org
// (כלל קבוע: כל כלי ספריא עובד מול המאגר המקומי בלבד).
//
// מה יוצא מכאן: טקסט גולמי בפורמט שהעורך כבר יודע לקרוא —
//   ⟦דף ב.⟧
//
//   מאימתי קורין את שמע{@01 מאימתי קורין. משעה שהכהנים...:} בערבין ...
//
// כלומר: שורת סימן-דף לכל עמוד בוילנא, ואחריה פסקה אחת עם כל טקסט העמוד,
// ובתוכה הערות רש"י צמודות למקום שאליו הן מתייחסות.
//
// למה פסקה אחת לעמוד: בוילנא הגמרא היא גוש רץ, לא פסקאות. חלוקת הקטעים של
// ספריא היא עזר טכני (משפט-משפט) ואינה קיימת בדפוס.

export const VILNA_DATA_BASE = "data/sefaria/vilna_shas";

const _cache = new Map();

function dataUrl(path) {
  // ה-base של האתר משתנה בין פיתוח לייצור; import.meta.env.BASE_URL נותן את הנכון.
  const base = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";
  return `${base.replace(/\/$/, "")}/${VILNA_DATA_BASE}/${path}`;
}

export async function loadVilnaManifest() {
  if (_cache.has("__manifest")) return _cache.get("__manifest");
  const res = await fetch(dataUrl("manifest.json"));
  if (!res.ok) throw new Error(`לא נמצא מאגר ש"ס וילנא (${res.status})`);
  const data = await res.json();
  _cache.set("__manifest", data);
  return data;
}

export async function loadVilnaTractate(slug) {
  if (_cache.has(slug)) return _cache.get(slug);
  const res = await fetch(dataUrl(`${slug}.json`));
  if (!res.ok) throw new Error(`לא נמצאה המסכת ${slug} (${res.status})`);
  const data = await res.json();
  _cache.set(slug, data);
  return data;
}

// ===================== שמות דפים =====================
const HE_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const HE_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HE_HUNDREDS = ["", "ק", "ר", "ש", "ת"];

export function hebrewNumber(n) {
  if (!Number.isFinite(n) || n <= 0) return String(n);
  let out = "";
  let rest = n;
  while (rest >= 400) { out += "ת"; rest -= 400; }
  out += HE_HUNDREDS[Math.floor(rest / 100)] || "";
  rest %= 100;
  if (rest === 15) return `${out}טו`;
  if (rest === 16) return `${out}טז`;
  out += HE_TENS[Math.floor(rest / 10)] || "";
  out += HE_ONES[rest % 10] || "";
  return out;
}

// אינדקס 2 = דף ב ע"א. בוילנא מסמנים ע"א בנקודה וע"ב בנקודתיים.
export function amudLabel(idx) {
  const daf = Math.floor(idx / 2) + 1;
  const isAlef = idx % 2 === 0;
  return `${hebrewNumber(daf)}${isAlef ? "." : ":"}`;
}

export function amudLabelLong(idx) {
  const daf = Math.floor(idx / 2) + 1;
  const isAlef = idx % 2 === 0;
  return `${hebrewNumber(daf)} ע"${isAlef ? "א" : "ב"}`;
}

export function parseDafInput(raw) {
  // מקבל "ב", "ב.", "ב:", "2a", "2b", "יד:" ומחזיר אינדקס עמוד.
  const s = String(raw || "").trim();
  if (!s) return -1;
  const en = s.match(/^(\d+)\s*([ab.:]?)$/i);
  if (en) {
    const daf = parseInt(en[1], 10);
    const b = en[2] === "b" || en[2] === ":";
    return (daf - 1) * 2 + (b ? 1 : 0);
  }
  const he = s.match(/^([א-ת"']+)\s*([.:]?)$/);
  if (he) {
    const daf = hebrewToNumber(he[1]);
    if (!daf) return -1;
    return (daf - 1) * 2 + (he[2] === ":" ? 1 : 0);
  }
  return -1;
}

const HE_VALUES = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
export function hebrewToNumber(s) {
  let total = 0;
  for (const ch of String(s || "")) {
    if (HE_VALUES[ch]) total += HE_VALUES[ch];
  }
  return total;
}

// ===================== עיגון רש"י בטקסט הגמרא =====================
// בוילנא כל פירוש רש"י פותח ב"דיבור המתחיל" — המילים מהגמרא שעליהן הוא מדבר.
// לכן המקום הנכון להערה הוא מיד אחרי אותן מילים. מחפשים את הדיבור בטקסט;
// אם לא נמצא במדויק (הבדלי כתיב או קיצורים) — מקצרים מילה-מילה מהסוף ומנסים
// שוב; ואם גם זה לא — ההערה נתלית בסוף הקטע, שזה המקום הקרוב ביותר שיש.
const DH_TAIL_RE = /\s*(?:וכו'?|כו'?|וגו'?)\s*$/;

export function normalizeForMatch(s) {
  return String(s || "")
    .replace(/["'׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findDhEnd(segmentText, dh, fromIndex = 0) {
  const cleanDh = normalizeForMatch(String(dh || "").replace(DH_TAIL_RE, ""));
  if (!cleanDh) return -1;
  const words = cleanDh.split(" ").filter(Boolean);
  // בונים מפה בין הטקסט המנורמל לטקסט המקורי, כדי להחזיר אופסט אמיתי.
  const map = [];
  let norm = "";
  let lastWasSpace = true;
  for (let i = 0; i < segmentText.length; i++) {
    const ch = segmentText[i];
    if (/["'׳״]/.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      map.push(i);
      norm += " ";
      continue;
    }
    lastWasSpace = false;
    map.push(i);
    norm += ch;
  }
  map.push(segmentText.length);
  const normFrom = (() => {
    for (let i = 0; i < map.length; i++) if (map[i] >= fromIndex) return i;
    return norm.length;
  })();

  // קודם מחפשים מהמקום שאחרי ההערה הקודמת (זה הסדר הרגיל של רש"י על הדף),
  // ורק אם לא נמצא — מחפשים מההתחלה. יש פירושים שחוזרים למילה מוקדמת יותר,
  // ועדיף לתלות אותם על המילה הנכונה מאשר לזרוק אותם לסוף הקטע.
  for (const startAt of [normFrom, 0]) {
    for (let take = words.length; take >= 1; take--) {
      const needle = words.slice(0, take).join(" ");
      if (needle.length < 2) break;
      const at = norm.indexOf(needle, startAt);
      if (at >= 0) {
        const endNorm = at + needle.length;
        return map[Math.min(endNorm, map.length - 1)];
      }
    }
    if (normFrom === 0) break;
  }
  return -1;
}

// ===================== בניית הטקסט לייבוא =====================
function rashiToNoteText(comment) {
  // צורת וילנא: דיבור המתחיל, נקודה, גוף הפירוש, ונקודתיים בסוף.
  const dh = String(comment.dh || "").trim();
  let body = String(comment.body || "").trim();
  if (!body) { body = dh; }
  let out = dh && dh !== body ? `${dh.replace(/[.:]$/, "")}. ${body}` : body;
  out = out.replace(/\s+/g, " ").trim();
  if (!/[.:]$/.test(out)) out += ":";
  return out;
}

/**
 * בונה את הטקסט הגולמי לייבוא.
 * @param {Object} book       ה-book מתוך קובץ המסכת
 * @param {Object} opts       { fromAmud, toAmud, withRashi, streamCode, includeTitle }
 * @returns {{ text, stats }}
 */
export function buildVilnaRawText(book, opts = {}) {
  const fromAmud = Number.isFinite(opts.fromAmud) ? opts.fromAmud : book.firstAmud;
  const toAmud = Number.isFinite(opts.toAmud) ? opts.toAmud : book.lastAmud;
  const withRashi = opts.withRashi !== false;
  const code = String(opts.streamCode || "01").padStart(2, "0");

  const blocks = [];
  const stats = { amudim: 0, gemaraChars: 0, rashiNotes: 0, rashiAnchored: 0, rashiAtEnd: 0 };

  if (opts.includeTitle !== false) {
    const he = book.heTitle || book.title;
    blocks.push(`מסכת ${he}`);
  }

  for (let ai = fromAmud; ai <= toAmud; ai++) {
    const segs = (book.gemara || [])[ai] || [];
    if (!segs.length) continue;
    const rashiLines = withRashi ? ((book.rashi || [])[ai] || []) : [];

    // חיתוך חלקי בקצוות: פרק בגמרא מתחיל ונגמר לפעמים באמצע דף. כשמייבאים
    // "רק את הפרק" מדלגים על השורות שלפניו ואחריו. (שורות ספריא מתחילות מ-1.)
    const firstLine = ai === fromAmud && Number.isFinite(opts.fromLine) ? Math.max(0, opts.fromLine - 1) : 0;
    const lastLine = ai === toAmud && Number.isFinite(opts.toLine) ? Math.min(segs.length, opts.toLine) : segs.length;

    const pieces = [];
    for (let li = firstLine; li < lastLine; li++) {
      let text = String(segs[li] || "").trim();
      if (!text) continue;
      stats.gemaraChars += text.length;
      const comments = rashiLines[li] || [];
      if (comments.length) {
        // אוספים לכל הערה את מקום הסיום של הדיבור המתחיל, ואז מזריקים
        // מהסוף להתחלה כדי שהאופסטים לא יזוזו תוך כדי.
        const inserts = [];
        let searchFrom = 0;
        for (const c of comments) {
          stats.rashiNotes++;
          const at = findDhEnd(text, c.dh || c.body, searchFrom);
          if (at >= 0) {
            inserts.push({ at, note: rashiToNoteText(c) });
            searchFrom = at;
            stats.rashiAnchored++;
          } else {
            inserts.push({ at: text.length, note: rashiToNoteText(c) });
            stats.rashiAtEnd++;
          }
        }
        inserts.sort((a, b) => a.at - b.at);
        let out = "";
        let prev = 0;
        for (const ins of inserts) {
          out += text.slice(prev, ins.at);
          out += `{@${code} ${ins.note}}`;
          prev = ins.at;
        }
        out += text.slice(prev);
        text = out;
      }
      pieces.push(text);
    }
    if (!pieces.length) continue;
    stats.amudim++;
    blocks.push(`⟦דף ${amudLabel(ai)}⟧`);
    blocks.push(pieces.join(" "));
  }

  return { text: blocks.join("\n\n"), stats };
}

/**
 * גבולות פרק → טווח לייבוא.
 * פרק בגמרא כמעט תמיד מתחיל ונגמר באמצע דף. לכן שתי אפשרויות:
 *  wholeDafim=true  — לוקחים את הדפים השלמים שבהם הפרק יושב. כל עמוד אצלנו
 *                     ייגמר בדיוק כמו בוילנא, במחיר קצת טקסט משכניו.
 *  wholeDafim=false — רק הפרק עצמו. הדף הראשון והאחרון יהיו חלקיים, ולכן
 *                     סופם לא יהיה סוף הדף בוילנא. זה מדווח למשתמש.
 */
export function perekRange(book, perekNumber, wholeDafim = true) {
  const p = (book.perakim || []).find((x) => x.n === perekNumber);
  if (!p) return null;
  if (wholeDafim) return { fromAmud: p.startAmud, toAmud: p.endAmud, perek: p, partial: false };
  return {
    fromAmud: p.startAmud, toAmud: p.endAmud, perek: p, partial: true,
    fromLine: p.startLine, toLine: p.endLine,
  };
}
