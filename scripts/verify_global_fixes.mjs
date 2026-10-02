// בדיקות לתיקונים הגלובליים.
// מריצים: node scripts/verify_global_fixes.mjs
//
// הבדיקות נגזרות מהמימוש הסמכותי בתוכנה הישנה (`latex_builder.py`,
// `apply_global_fixes`) — כולל **הסדר**, שהוא חלק מההתנהגות ולא קישוט.

import {
  GLOBAL_FIXES,
  FIX_IDS,
  emptyFixFlags,
  applyGlobalFixes,
  previewGlobalFixes,
} from "../src/text_fixes/global_fixes_engine.js";

let pass = 0, fail = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}\n      צפוי: ${JSON.stringify(expected)}\n      קיבלנו: ${JSON.stringify(actual)}`); }
};
const checkThat = (name, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${detail ? `  (${detail})` : ""}`); }
};
const fix = (text, ...ids) => applyGlobalFixes(text, Object.fromEntries(ids.map((i) => [i, true]))).text;

console.log("\n[1] ברירת המחדל — הכול כבוי, בדיוק כמו בתוכנה הישנה");
check("26 תיקונים", GLOBAL_FIXES.length, 26);
checkThat("כולם כבויים", Object.values(emptyFixFlags()).every((v) => v === false));
check("בלי דגלים — הטקסט לא נגע", applyGlobalFixes("א  ב , ג").text, "א  ב , ג");
check("ומסומן שלא השתנה", applyGlobalFixes("א  ב , ג").changed, false);
checkThat("לכל תיקון יש תווית בעברית",
  GLOBAL_FIXES.every((f) => f.label && !/[a-zA-Z]{3,}/u.test(f.label)),
  JSON.stringify(GLOBAL_FIXES.filter((f) => /[a-zA-Z]{3,}/u.test(f.label)).map((f) => f.label)));

console.log("\n[2] ניקוי בסיסי");
check("טאב לרווח", fix("א\tב", "remove_tabs"), "א ב");
check("רווח קשיח", fix("א ב", "nbsp_to_space"), "א ב");
check("תווי כיוון נסתרים", fix("א‎ב‏ג", "remove_zwj_zwnj"), "אבג");

console.log("\n[3] סוגריים — התוכן נשאר, התווים יורדים");
check("מסולסלות", fix("א {הערה} ב", "strip_curly"), "א הערה ב");
check("מרובעות", fix("א [3] ב", "strip_square"), "א 3 ב");
check("משולשות", fix("א <x> ב", "strip_angle"), "א x ב");
check("ולא נוגעים בעגולות", fix("א (ב) ג", "strip_curly", "strip_square", "strip_angle"), "א (ב) ג");

console.log("\n[4] רווח לפני פיסוק");
check("נקודה", fix("שלום .", "no_space_before_dot"), "שלום.");
check("פסיק", fix("שלום , עולם", "no_space_before_comma"), "שלום, עולם");
check("נקודה-פסיק", fix("א ; ב", "no_space_before_semicolon"), "א; ב");
check("נקודתיים", fix("א : ב", "no_space_before_colon"), "א: ב");
check("סימן שאלה", fix("מה ?", "no_space_before_qmark"), "מה?");
check("סימן קריאה", fix("וואו !", "no_space_before_excl"), "וואו!");
check("אחרי סוגר פותח", fix("( א )", "no_space_after_open_paren"), "(א )");
check("לפני סוגר סוגר", fix("( א )", "no_space_before_close_paren"), "( א)");
check("גם מרובעות", fix("[ א ]", "no_space_after_open_paren", "no_space_before_close_paren"), "[א]");

console.log("\n[5] הוספת רווח אחרי פיסוק");
check("אחרי פסיק", fix("א,ב", "add_space_after_comma"), "א, ב");
check("לא מוסיף אם כבר יש", fix("א, ב", "add_space_after_comma"), "א, ב");
check("לא בסוף שורה", fix("א,", "add_space_after_comma"), "א,");
check("אחרי נקודה", fix("א.ב", "add_space_after_dot"), "א. ב");
checkThat("ולא מפרק שלוש נקודות", fix("א...ב", "add_space_after_dot").includes("..."),
  fix("א...ב", "add_space_after_dot"));

console.log("\n[6] מקפים");
check("רווח משני צדדים", fix("א-ב", "dash_space"), "א - ב");
check("גם כשהיה רווח אחד", fix("א -ב", "dash_space"), "א - ב");

console.log("\n[7] כיווץ רווחים — ו„אחד” גובר על „שניים”");
check("לאחד", fix("א    ב", "double_space"), "א ב");
check("לשניים", fix("א      ב", "multi_space"), "א  ב");
check("כששניהם דלוקים — אחד מנצח", fix("א    ב", "double_space", "multi_space"), "א ב");

console.log("\n[8] ⭐ הסדר — כיווץ אינו מוחק רווח שזה עתה נוסף");
// קודם מוסיפים רווח אחרי הפסיק, ואז מכווצים. אם הסדר היה הפוך — היה נשאר „א,ב".
check("פסיק ואז כיווץ", fix("א,ב    ג", "add_space_after_comma", "double_space"), "א, ב ג");

console.log("\n[9] פיסוק");
check("שלוש נקודות", fix("וכו...", "ellipsis"), "וכו…");
check("שני מקפים", fix("א--ב", "em_dash"), "א—ב");
check("שלושה מקפים", fix("א---ב", "em_dash"), "א—ב");
check("גרשיים חכמים לסירוגין", fix('אמר "שלום" לו', "smart_quotes"), 'אמר “שלום” לו');

console.log("\n[10] ⭐ עברית — הכלל המדויק מהתוכנה הישנה");
check("גרש אחרי אות עברית", fix("ר' משה", "hebrew_geresh"), "ר׳ משה");
check("גרש בסוף טקסט", fix("ר'", "hebrew_geresh"), "ר׳");
check("גרש לפני נקודה", fix("ר'.", "hebrew_geresh"), "ר׳.");
check("⭐ גרש במילה לועזית נשאר", fix("don't", "hebrew_geresh"), "don't");
check("גרשיים בין אותיות עבריות", fix('רש"י', "hebrew_gershayim"), "רש״י");
check("⭐ גרשיים לועזיים נשארים", fix('say "hi" now', "hebrew_gershayim"), 'say "hi" now');
check("⭐ גרשיים בתחילת ציטוט עברי נשארים", fix('אמר "שלום"', "hebrew_gershayim"), 'אמר "שלום"');
check("ראשי תיבות מפעיל את שני הכללים", fix(`ר' רש"י`, "hebrew_acronym"), "ר׳ רש״י");

console.log("\n[11] ניקוי שורות");
check("תחילה וסוף", fix("  א  \n  ב  ", "trim_lines"), "א\nב");
check("ושורה ריקה נשארת שורה", fix("א\n   \nב", "trim_lines"), "א\n\nב");

console.log("\n[12] דיווח מה בוצע בפועל");
const r1 = applyGlobalFixes("שלום , עולם", { no_space_before_comma: true, remove_tabs: true });
check("רק מה ששינה מדווח", r1.applied, ["no_space_before_comma"]);
check("והתוצאה נכונה", r1.text, "שלום, עולם");
check("ומסומן כהשתנה", r1.changed, true);

console.log("\n[13] תצוגה מקדימה — אומרת לכל תיקון אם הוא ישנה משהו");
const pv = previewGlobalFixes("שלום , עולם\tכאן", { no_space_before_comma: true, remove_tabs: true, strip_curly: true });
check("שלוש שורות", pv.rows.length, 3);
check("פסיק ישנה", pv.rows.find((r) => r.id === "no_space_before_comma").changed, true);
check("טאב ישנה", pv.rows.find((r) => r.id === "remove_tabs").changed, true);
check("סוגריים לא ישנה", pv.rows.find((r) => r.id === "strip_curly").changed, false);

console.log("\n[14] קלט קיצוני");
check("ריק", applyGlobalFixes("", { remove_tabs: true }).text, "");
check("null", applyGlobalFixes(null, { remove_tabs: true }).text, "");
check("דגלים null", applyGlobalFixes("א", null).text, "א");
checkThat("מזהה לא מוכר אינו מפיל", applyGlobalFixes("א", { לא_קיים: true }).text === "א");
checkThat("אין כפילות במזהים", new Set(FIX_IDS).size === FIX_IDS.length);

console.log("\n[15] הרצה כפולה אינה משנה פעם שנייה (יציבות)");
const flagsAll = Object.fromEntries(FIX_IDS.map((i) => [i, true]));
const once = applyGlobalFixes("ר' משה , אמר  ...  {כאן}", flagsAll).text;
const twice = applyGlobalFixes(once, flagsAll).text;
check("יציב", twice, once);

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
