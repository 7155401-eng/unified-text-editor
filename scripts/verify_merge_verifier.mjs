// בדיקות לבדיקת השלמות אחרי מיזוג.
// מריצים: node scripts/verify_merge_verifier.mjs
//
// הבדיקה החשובה: שהכלי תופס את „הבריחה” — מיזוג שקפץ ממקומו ואיבד קטע ארוך.

import {
  tokenize, compareMergedToSource, describeMergeReport,
} from "../src/compare/merge_verifier.js";

let pass = 0, fail = 0;
const check = (n, a, e) => {
  const ok = JSON.stringify(a) === JSON.stringify(e);
  if (ok) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}\n      צפוי: ${JSON.stringify(e)}\n      קיבלנו: ${JSON.stringify(a)}`); }
};
const checkThat = (n, c, d = "") => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); }
  else { fail += 1; console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); }
};

console.log("\n[1] פירוק למילים");
check("פיסוק יורד", tokenize("שלום, עולם!"), ["שלום", "עולם"]);
check("ניקוד יורד", tokenize("זָכוֹר"), ["זכור"]);
check("סימני זרם יורדים", tokenize("ויאמר @01 [3] משה"), ["ויאמר", "משה"]);
check("ואפשר לשמור אותם", tokenize("א @01 ב", { keepMarkers: true }).includes("01"), true);
check("ריק", tokenize(""), []);
check("null", tokenize(null), []);

console.log("\n[2] מיזוג מושלם — שום דבר לא אבד");
const src = "ויאמר משה אל העם זכור את היום הזה אשר יצאתם ממצרים";
const perfect = "ויאמר משה @01 אל העם זכור את היום הזה אשר יצאתם ממצרים";
const r1 = compareMergedToSource(src, perfect);
check("תקין", r1.ok, true);
check("אפס מילים אבודות", r1.summary.lostWords, 0);
check("ו-100% נשמר", r1.summary.keptPercent, 100);

console.log("\n[3] מילה אחת אבדה");
const r2 = compareMergedToSource(src, "ויאמר משה אל העם זכור את היום אשר יצאתם ממצרים");
check("לא תקין", r2.ok, false);
check("מילה אחת", r2.summary.lostWords, 1);
check("והיא נקובה בשמה", r2.lost[0].words, ["הזה"]);
checkThat("עם ההקשר שלפניה", r2.lost[0].context.includes("היום"), r2.lost[0].context);

console.log("\n[4] ⭐⭐ „הבריחה” — הכשל שמשה תיאר");
// מיזוג שקפץ ממקומו: 30 מילים רצופות נעלמו מאמצע הטקסט.
const words = Array.from({ length: 80 }, (_, i) => `מילה${i}`);
const long = words.join(" ");
const escaped = words.slice(0, 25).concat(words.slice(55)).join(" ");
const r3 = compareMergedToSource(long, escaped);
check("נתפס", r3.ok, false);
check("שלושים מילים", r3.summary.lostWords, 30);
check("⭐ וסומן כבריחה", r3.summary.runaway, true);
check("הקטע הרצוף הארוך", r3.summary.biggestLostRun, 30);

console.log("\n[5] אובדן מפוזר אינו בריחה");
const scattered = words.filter((_, i) => i % 20 !== 7).join(" ");
const r4 = compareMergedToSource(long, scattered);
checkThat("יש אובדן", r4.summary.lostWords > 0, String(r4.summary.lostWords));
check("אבל אינו בריחה", r4.summary.runaway, false);

console.log("\n[6] תוכן ההערות שנוסף אינו נחשב אובדן");
const withNotes = "ויאמר משה אל העם זכור את היום הזה אשר יצאתם ממצרים ועוד הערה שלמה שנוספה כאן";
const r5 = compareMergedToSource(src, withNotes);
check("תקין", r5.ok, true);
checkThat("והתוספת מדווחת בנפרד", r5.summary.addedWords > 0, String(r5.summary.addedWords));

console.log("\n[7] ⭐ שינוי סדר נתפס כאובדן+תוספת, ולא מוסתר");
const swapped = "זכור את היום הזה ויאמר משה אל העם אשר יצאתם ממצרים";
const r6 = compareMergedToSource(src, swapped);
checkThat("משהו דווח", !r6.ok || r6.summary.addedWords > 0,
  JSON.stringify({ ok: r6.ok, lost: r6.summary.lostWords, added: r6.summary.addedWords }));

console.log("\n[8] טקסט ריק");
check("מקור ריק ⟵ תקין", compareMergedToSource("", "משהו").ok, true);
check("תוצאה ריקה ⟵ הכול אבד", compareMergedToSource(src, "").summary.lostWords, tokenize(src).length);
check("שניהם ריקים", compareMergedToSource("", "").ok, true);

console.log("\n[9] ניקוד שנוסף במיזוג אינו נחשב שינוי");
check("מנוקד מול לא מנוקד",
  compareMergedToSource("זכור את היום", "זָכוֹר אֶת הַיּוֹם").ok, true);

console.log("\n[10] מסמך גדול — הכלי אינו נתקע");
const big = Array.from({ length: 20000 }, (_, i) => `ת${i % 997}ם${i}`).join(" ");
const bigMerged = big.replace("ם5000 ", "");
const t0 = Date.now();
const r7 = compareMergedToSource(big, bigMerged);
const ms = Date.now() - t0;
checkThat(`20,000 מילים ב-${ms} מ"ש`, ms < 5000, `${ms}ms`);
checkThat("והאובדן נתפס", r7.summary.lostWords >= 1, JSON.stringify(r7.summary.lostWords));

console.log("\n[11] הדוח בעברית, ואומר שלא תוקן כלום");
const text = describeMergeReport(r3);
checkThat("מצהיר שלא תוקן", text.includes("לא תוקן"), "");
checkThat("ומזהיר על הבריחה", text.includes("ברח"), "");
checkThat("ובעברית בלבד", !/[a-zA-Z]{3,}/u.test(text), text.slice(0, 80));
const okText = describeMergeReport(r1);
checkThat("ובמקרה תקין אומר זאת", okText.includes("שום דבר לא אבד"), okText.slice(0, 60));

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
