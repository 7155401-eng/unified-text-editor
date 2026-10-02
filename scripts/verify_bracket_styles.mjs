// בדיקות לעיצוב תוכן שבתוך סוגריים.
// מריצים: node scripts/verify_bracket_styles.mjs

import {
  BRACKET_TYPES,
  emptyBracketSettings,
  normalizeBracketSettings,
  findBracketSpans,
  bracketInlineStyle,
  applyBracketStyles,
  summarizeBrackets,
} from "../src/text_fixes/bracket_styles.js";

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
const on = (id, extra = {}) => {
  const s = emptyBracketSettings();
  s[id] = { ...s[id], enabled: true, ...extra };
  return s;
};

console.log("\n[1] ארבעת הסוגים, וברירת מחדל כבויה");
check("ארבעה סוגים", BRACKET_TYPES.map((b) => b.id), ["round", "square", "curly", "angle"]);
checkThat("כולם כבויים", Object.values(emptyBracketSettings()).every((c) => c.enabled === false));
checkThat("וגודל 100 — כלומר בלי שינוי", Object.values(emptyBracketSettings()).every((c) => c.sizePercent === 100));

console.log("\n[2] מציאת קטעים");
check("עגולות", findBracketSpans("א (ב) ג").map((s) => [s.type, s.innerStart, s.innerEnd]), [["round", 3, 4]]);
check("ארבעת הסוגים יחד",
  findBracketSpans("(א)[ב]{ג}<ד>").map((s) => s.type), ["round", "square", "curly", "angle"]);
check("ריק", findBracketSpans(""), []);
check("null", findBracketSpans(null), []);

console.log("\n[3] ⭐ קינון — גם החיצוני וגם הפנימי, עם עומק");
const nested = findBracketSpans("(א [ב] ג)");
check("שני קטעים", nested.length, 2);
check("החיצוני ראשון ובעומק 0", [nested[0].type, nested[0].depth], ["round", 0]);
check("הפנימי בעומק 1", [nested[1].type, nested[1].depth], ["square", 1]);

console.log("\n[4] ⛔ סוגר יחיד אינו בולע את מה שאחריו");
check("סוגר בלי פתיחה", findBracketSpans("א ) ב (ג)").map((s) => s.type), ["round"]);
check("פתיחה בלי סגירה", findBracketSpans("א ( ב"), []);
check("סוגר מסוג אחר באמצע", findBracketSpans("(א ] ב)").map((s) => s.type), ["round"]);
// „(א ] ב)" — התוכן הוא האינדקסים 1..5, ולכן innerEnd (לא כולל) הוא 6.
check("והתוכן הוא בדיוק מה שבין הסוגריים",
  "(א ] ב)".slice(findBracketSpans("(א ] ב)")[0].innerStart, findBracketSpans("(א ] ב)")[0].innerEnd),
  "א ] ב");

console.log("\n[5] בניית העיצוב");
check("כבוי — אין עיצוב", bracketInlineStyle({ enabled: false, sizePercent: 80 }), "");
check("גודל", bracketInlineStyle({ enabled: true, sizePercent: 80 }), "font-size:80%");
check("100% אינו מייצר עיצוב מיותר", bracketInlineStyle({ enabled: true, sizePercent: 100 }), "");
check("פונט", bracketInlineStyle({ enabled: true, sizePercent: 100, font: "FrankRuehl" }), "font-family:FrankRuehl");
check("הכול יחד",
  bracketInlineStyle({ enabled: true, sizePercent: 75, font: "David", parIndentPt: 12, parSkipPt: 6 }),
  "font-size:75%;font-family:David;text-indent:12pt;margin-top:6pt");

console.log("\n[6] גבולות — גודל אינו יוצא משליטה");
check("מתחת ל-10 נחתך", normalizeBracketSettings({ round: { sizePercent: 1 } }).round.sizePercent, 10);
check("מעל 400 נחתך", normalizeBracketSettings({ round: { sizePercent: 9999 } }).round.sizePercent, 400);
check("זבל ⟵ 100", normalizeBracketSettings({ round: { sizePercent: "אבג" } }).round.sizePercent, 100);

console.log("\n[7] ⭐ העיטוף — הסוגריים נשארים, רק התוכן מעוצב");
const r1 = applyBracketStyles("ויאמר (עי' שם) משה", on("round", { sizePercent: 80 }));
checkThat("הסוגריים נשארו בטקסט", r1.html.includes("(") && r1.html.includes(")"), r1.html);
checkThat("והתוכן עוטף", r1.html.includes('<span class="rt-bracket rt-bracket-round" style="font-size:80%">'), r1.html);
checkThat("התוכן עצמו שלם", r1.html.includes("עי' שם"), r1.html);
check("קטע אחד", r1.wrapped, 1);

console.log("\n[8] סוג שלא הופעל אינו נגע");
const r2 = applyBracketStyles("א (ב) [ג]", on("round", { sizePercent: 80 }));
checkThat("העגולות עוטפו", r2.html.includes("rt-bracket-round"), r2.html);
checkThat("והמרובעות לא", !r2.html.includes("rt-bracket-square"), r2.html);

console.log("\n[9] ⭐ קינון אינו מכפיל אחוזים");
const s3 = emptyBracketSettings();
s3.round = { ...s3.round, enabled: true, sizePercent: 80 };
s3.square = { ...s3.square, enabled: true, sizePercent: 80 };
const r3 = applyBracketStyles("(א [ב] ג)", s3);
check("רק השכבה החיצונית עוטפה", r3.wrapped, 1);
check("ויש span אחד בלבד", (r3.html.match(/<span/gu) || []).length, 1);

console.log("\n[10] ⛔ אבטחה — טקסט אינו הופך לקוד");
const r4 = applyBracketStyles("א (<img src=x onerror=alert(1)>) ב", on("round"));
checkThat("אין תגית img אמיתית", !/<img/u.test(r4.html), r4.html);
checkThat("והתווים בורחו", r4.html.includes("&lt;img"), r4.html);
const r5 = applyBracketStyles('<b>לא קוד</b>', emptyBracketSettings());
checkThat("גם בלי הגדרות הטקסט בורח", !/<b>/u.test(r5.html), r5.html);

console.log("\n[11] שם סגנון וורד נשמר כנתון ולא כעיצוב");
const r6 = applyBracketStyles("א (ב)", on("round", { style: "ציון מקור" }));
checkThat("נשמר כתכונה", r6.html.includes('data-word-style="ציון מקור"'), r6.html);

console.log("\n[12] סיכום למשתמש לפני אישור");
const sum = summarizeBrackets("(א) (ב) [ג]", on("round", { sizePercent: 70 }));
check("שתי עגולות", sum.round.found, 2);
check("ומרובעת אחת", sum.square.found, 1);
check("העגולות פעילות", sum.round.enabled, true);
check("המרובעות לא", sum.square.enabled, false);
check("והגודל מוצג", sum.round.sizePercent, 70);

console.log("\n[13] בלי הגדרות פעילות — שום דבר לא עוטף");
const r7 = applyBracketStyles("א (ב) ג", emptyBracketSettings());
check("אפס עטיפות", r7.wrapped, 0);
check("והטקסט כמו שהוא", r7.html, "א (ב) ג");

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
