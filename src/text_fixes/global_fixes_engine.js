// תיקונים גלובליים לטקסט — המנוע (העברה מהתוכנה הקודמת, פריט 13 בביקורת).
//
// בתוכנה שהייתה מותקנת על המחשב היה פאנל עם 26 תיבות סימון: „למחוק רווח לפני
// נקודה", „להמיר גרש לגרש עברי", „להוריד סימני סוגריים" וכן הלאה. **באתר זה
// לא קיים כלל** — נבדק: אפס התאמות ל„תיקון גלובלי" בכל המקור. מה שיש באתר הוא
// „ניקוי צבע / רקע / עיצוב", וזה עיצוב, לא תיקון טקסט.
//
// המקור הסמכותי: `latex_builder.py` ב-`work-files`, הפונקציה `apply_global_fixes`.
// הועתקה ממנה **הסמנטיקה והסדר**, לא הקוד (שם עובדים על אסימונים, כאן על טקסט).
//
// ⭐⭐ הסדר אינו שרירותי, וכתוב בקוד הישן במפורש למה:
//   1. ניקוי בסיסי קודם — כדי שלא יפריע לפעולות הבאות.
//   2. הסרת סוגריים.
//   3. מחיקת רווח לפני פיסוק.
//   4. הוספת רווח אחרי פיסוק.
//   5. מקפים.
//   6. כיווץ רצפי רווחים — **אחרון בקבוצה**, כדי שלא ימחק רווחים שזה עתה נוספו.
//   7. פיסוק חכם.
//   8. סימנים עבריים.
//   9. ניקוי סופי שורות — ממש בסוף.
// שינוי הסדר הזה משנה את התוצאה. אל תסדרו מחדש „כדי שיהיה יפה".
//
// ⛔ כל התיקונים **כבויים כברירת מחדל**, בדיוק כמו בתוכנה הישנה.

/** כל התיקונים, לפי הסדר שבו הם מוצגים למשתמש. */
export const GLOBAL_FIXES = [
  { id: "remove_tabs", label: "להמיר טאבים לרווח", group: "ניקוי בסיסי" },
  { id: "nbsp_to_space", label: "להמיר רווח קשיח לרווח רגיל", group: "ניקוי בסיסי" },
  { id: "remove_zwj_zwnj", label: "להסיר תווי כיוון נסתרים", group: "ניקוי בסיסי" },

  { id: "strip_curly", label: "להוריד סוגריים מסולסלות { } — התוכן נשאר", group: "סוגריים" },
  { id: "strip_square", label: "להוריד סוגריים מרובעות [ ] — התוכן נשאר", group: "סוגריים" },
  { id: "strip_angle", label: "להוריד סוגריים משולשות < > — התוכן נשאר", group: "סוגריים" },

  { id: "no_space_before_dot", label: "למחוק רווח לפני נקודה", group: "רווח לפני פיסוק" },
  { id: "no_space_before_comma", label: "למחוק רווח לפני פסיק", group: "רווח לפני פיסוק" },
  { id: "no_space_before_semicolon", label: "למחוק רווח לפני נקודה-פסיק", group: "רווח לפני פיסוק" },
  { id: "no_space_before_colon", label: "למחוק רווח לפני נקודתיים", group: "רווח לפני פיסוק" },
  { id: "no_space_before_qmark", label: "למחוק רווח לפני סימן שאלה", group: "רווח לפני פיסוק" },
  { id: "no_space_before_excl", label: "למחוק רווח לפני סימן קריאה", group: "רווח לפני פיסוק" },
  { id: "no_space_after_open_paren", label: "למחוק רווח אחרי סוגר פותח", group: "רווח לפני פיסוק" },
  { id: "no_space_before_close_paren", label: "למחוק רווח לפני סוגר סוגר", group: "רווח לפני פיסוק" },

  { id: "add_space_after_comma", label: "להוסיף רווח אחרי פסיק", group: "רווח אחרי פיסוק" },
  { id: "add_space_after_dot", label: "להוסיף רווח אחרי נקודה", group: "רווח אחרי פיסוק" },

  { id: "dash_space", label: "רווח משני צדי מקף", group: "מקפים ורווחים" },
  { id: "double_space", label: "לכווץ רצף רווחים לרווח אחד", group: "מקפים ורווחים" },
  { id: "multi_space", label: "לכווץ רצף רווחים לשני רווחים — פועל רק אם התיקון שמעליו כבוי", group: "מקפים ורווחים" },

  { id: "ellipsis", label: "שלוש נקודות ⟵ שלוש-נקודות אחת", group: "פיסוק" },
  { id: "em_dash", label: "מקפים כפולים ⟵ קו מפריד", group: "פיסוק" },
  { id: "smart_quotes", label: "גרשיים ישרים ⟵ גרשיים פותחים וסוגרים", group: "פיסוק" },

  { id: "hebrew_geresh", label: "גרש ישר ⟵ גרש עברי, אחרי אות עברית", group: "עברית" },
  { id: "hebrew_gershayim", label: "גרשיים ישרים ⟵ גרשיים עבריים, בין אותיות", group: "עברית" },
  { id: "hebrew_acronym", label: "ראשי תיבות — אותו כלל עברי", group: "עברית" },

  { id: "trim_lines", label: "למחוק רווחים בתחילת שורה ובסופה", group: "ניקוי סופי" },
];

export const FIX_IDS = GLOBAL_FIXES.map((f) => f.id);

/** ברירת המחדל: הכול כבוי, כמו בתוכנה הישנה. */
export function emptyFixFlags() {
  const out = {};
  for (const id of FIX_IDS) out[id] = false;
  return out;
}

const HEB = (ch) => !!ch && ch >= "֐" && ch <= "׿";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** מוחק רווחים שלפני תו מסוים. */
function removeSpaceBefore(text, ch) {
  return text.replace(new RegExp(`[ \\t]+(?=${esc(ch)})`, "gu"), "");
}

/** מוחק רווחים שאחרי תו מסוים. */
function removeSpaceAfter(text, ch) {
  return text.replace(new RegExp(`(${esc(ch)})[ \\t]+`, "gu"), "$1");
}

/** מוסיף רווח אחרי תו — רק אם אין שם כבר רווח, סוף שורה, או התו עצמו שוב. */
function addSpaceAfter(text, ch) {
  return text.replace(new RegExp(`(${esc(ch)})(?![\\s${esc(ch)}]|$)`, "gmu"), "$1 ");
}

/**
 * הכלל העברי, מילה במילה מהתוכנה הישנה:
 *   `'` הופך ל-`׳` כשלפניו אות עברית, ואחריו אות עברית / סוף / רווח / . , ) ]
 *   `"` הופך ל-`״` כשלפניו **וגם** אחריו אות עברית.
 * כך גרש אנגלי בתוך מילה לועזית נשאר כמו שהוא.
 */
function hebrewSmartMarks(text, { geresh, gershayim }) {
  const chars = [...text];
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i];
    const prev = chars[i - 1];
    const next = chars[i + 1];
    if (geresh && c === "'") {
      const prevHeb = HEB(prev);
      const ok = prevHeb && (HEB(next) || next === undefined ||
        [" ", "\n", ".", ",", ")", "]"].includes(next));
      if (ok) chars[i] = "׳";
    } else if (gershayim && c === '"') {
      if (HEB(prev) && HEB(next)) chars[i] = "״";
    }
  }
  return chars.join("");
}

/** גרשיים ישרים ⟵ פותחים/סוגרים, לסירוגין — בדיוק כמו בתוכנה הישנה. */
function smartQuotes(text) {
  let open = false;
  let out = "";
  for (const ch of text) {
    if (ch === '"') { out += open ? "”" : "“"; open = !open; }
    else out += ch;
  }
  return out;
}

/**
 * מפעיל את התיקונים שנבחרו, בסדר המחייב.
 *
 * @param {string} text הטקסט המקורי
 * @param {Object} flags מפה של מזהה-תיקון ⟵ בוליאני
 * @returns {{text: string, changed: boolean, applied: string[]}}
 */
export function applyGlobalFixes(text, flags = {}) {
  const src = String(text ?? "");
  const on = (id) => !!flags?.[id];
  const applied = [];
  let out = src;
  const step = (id, fn) => {
    if (!on(id)) return;
    const before = out;
    out = fn(out);
    if (out !== before) applied.push(id);
  };

  // 1 — ניקוי בסיסי
  step("remove_tabs", (t) => t.replace(/\t/gu, " "));
  step("nbsp_to_space", (t) => t.replace(/ /gu, " "));
  step("remove_zwj_zwnj", (t) => t.replace(/[‌‍‎‏﻿]/gu, ""));

  // 2 — סוגריים (התוכן נשאר, רק התווים יורדים)
  step("strip_curly", (t) => t.replace(/[{}]/gu, ""));
  step("strip_square", (t) => t.replace(/[[\]]/gu, ""));
  step("strip_angle", (t) => t.replace(/[<>]/gu, ""));

  // 3 — רווח לפני פיסוק
  step("no_space_before_dot", (t) => removeSpaceBefore(t, "."));
  step("no_space_before_comma", (t) => removeSpaceBefore(t, ","));
  step("no_space_before_semicolon", (t) => removeSpaceBefore(t, ";"));
  step("no_space_before_colon", (t) => removeSpaceBefore(t, ":"));
  step("no_space_before_qmark", (t) => removeSpaceBefore(t, "?"));
  step("no_space_before_excl", (t) => removeSpaceBefore(t, "!"));
  step("no_space_after_open_paren", (t) => removeSpaceAfter(removeSpaceAfter(t, "("), "["));
  step("no_space_before_close_paren", (t) => removeSpaceBefore(removeSpaceBefore(t, ")"), "]"));

  // 4 — הוספת רווח אחרי פיסוק
  step("add_space_after_comma", (t) => addSpaceAfter(t, ","));
  step("add_space_after_dot", (t) => addSpaceAfter(t, "."));

  // 5 — מקפים
  step("dash_space", (t) => t.replace(/\s*-\s*/gu, " - "));

  // 6 — כיווץ רווחים. אחרון בקבוצה, כדי לא למחוק רווחים שזה עתה נוספו.
  //     „אחד" גובר על „שניים", בדיוק כמו ב-elif שבמקור.
  if (on("double_space")) step("double_space", (t) => t.replace(/[ \t]{2,}/gu, " "));
  else step("multi_space", (t) => t.replace(/[ \t]{3,}/gu, "  "));

  // 7 — פיסוק
  step("ellipsis", (t) => t.replace(/\.\.\./gu, "…"));
  step("em_dash", (t) => t.replace(/---/gu, "—").replace(/--/gu, "—"));
  step("smart_quotes", smartQuotes);

  // 8 — עברית
  if (on("hebrew_geresh") || on("hebrew_gershayim") || on("hebrew_acronym")) {
    const before = out;
    out = hebrewSmartMarks(out, {
      geresh: on("hebrew_geresh") || on("hebrew_acronym"),
      gershayim: on("hebrew_gershayim") || on("hebrew_acronym"),
    });
    if (out !== before) {
      for (const id of ["hebrew_geresh", "hebrew_gershayim", "hebrew_acronym"]) {
        if (on(id)) applied.push(id);
      }
    }
  }

  // 9 — ניקוי סופי של שורות
  step("trim_lines", (t) => t.split("\n").map((l) => l.replace(/^[ \t]+|[ \t]+$/gu, "")).join("\n"));

  return { text: out, changed: out !== src, applied };
}

/**
 * מריץ בלי לשנות — ומחזיר כמה שינויים כל תיקון היה עושה.
 * משמש להצגה למשתמש לפני שהוא מאשר.
 */
export function previewGlobalFixes(text, flags = {}) {
  const rows = [];
  for (const fix of GLOBAL_FIXES) {
    if (!flags?.[fix.id]) continue;
    const only = { [fix.id]: true };
    const res = applyGlobalFixes(text, only);
    rows.push({ id: fix.id, label: fix.label, changed: res.changed });
  }
  const full = applyGlobalFixes(text, flags);
  return { rows, result: full };
}
