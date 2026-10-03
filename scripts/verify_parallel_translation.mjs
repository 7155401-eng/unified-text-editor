// בדיקות לתרגום לצד הטקסט.
// מריצים: node scripts/verify_parallel_translation.mjs
//
// הבדיקה החשובה: שכשמספר הפסקאות אינו תואם — הכלי **מדווח ואינו מנחש**.
// תרגום שהוצמד לפסקה הלא נכונה גרוע מתרגום חסר, כי הוא נראה נכון.

import {
  cmToPx, emptyParallelSettings, normalizeParallelSettings,
  splitParagraphs, pairParagraphs, columnGeometry,
  buildParallelHtml, describeParallelSummary,
  DEFAULT_GAP_CM, DEFAULT_WIDTH_PERCENT,
} from "../src/parallel/parallel_translation.js";

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

console.log("\n[1] ברירות המחדל — בדיוק כמו בתוכנה הישנה");
check("רוחב 30%", DEFAULT_WIDTH_PERCENT, 30);
check("מרווח 0.8 ס״מ", DEFAULT_GAP_CM, 0.8);
check("כבוי כברירת מחדל", emptyParallelSettings().enabled, false);

console.log("\n[2] ⛔ המרת היחידות — המלכודת שתפסתי בפריט 5");
check("0.8 ס״מ ≈ 30.24 פיקסל", cmToPx(0.8), 30.24);
check("1 ס״מ", cmToPx(1), 37.8);
check("אפס", cmToPx(0), 0);
check("זבל", cmToPx("אבג"), 0);

console.log("\n[3] גבולות");
check("רוחב מתחת ל-10 נחתך", normalizeParallelSettings({ widthPercent: 1 }).widthPercent, 10);
check("רוחב מעל 70 נחתך", normalizeParallelSettings({ widthPercent: 95 }).widthPercent, 70);
check("מרווח שלילי ⟵ 0", normalizeParallelSettings({ gapCm: -3 }).gapCm, 0);
check("מרווח מעל 5 ס״מ נחתך", normalizeParallelSettings({ gapCm: 99 }).gapCm, 5);
check("מיקום לא מוכר ⟵ שמאל", normalizeParallelSettings({ position: "למעלה" }).position, "left");
check("ימין מתקבל", normalizeParallelSettings({ position: "right" }).position, "right");

console.log("\n[4] פירוק לפסקאות");
check("שורה ריקה מפרידה", splitParagraphs("א\n\nב"), ["א", "ב"]);
check("גם שורה בודדת", splitParagraphs("א\nב"), ["א", "ב"]);
check("רווחים נחתכים", splitParagraphs("  א  \n\n  ב  "), ["א", "ב"]);
check("ריק", splitParagraphs(""), []);
check("null", splitParagraphs(null), []);

console.log("\n[5] זיווג תקין — פסקה מול פסקה");
const r1 = pairParagraphs("אחת\n\nשתיים\n\nשלוש", "one\n\ntwo\n\nthree");
check("שלושה זוגות", r1.pairs.length, 3);
check("מזווג נכון", r1.pairs.map((p) => [p.source, p.translation]),
  [["אחת", "one"], ["שתיים", "two"], ["שלוש", "three"]]);
check("מסומן כתואם", r1.summary.aligned, true);
check("אפס יתומים", [r1.summary.sourceWithoutTranslation, r1.summary.translationWithoutSource], [0, 0]);

console.log("\n[6] ⭐⭐ חוסר התאמה — מדווח ואינו מנחש");
const r2 = pairParagraphs("אחת\n\nשתיים\n\nשלוש", "one\n\ntwo");
check("לא תואם", r2.summary.aligned, false);
check("שניים זווגו", r2.summary.paired, 2);
check("ואחד נשאר בלי תרגום", r2.summary.sourceWithoutTranslation, 1);
check("⭐ והשלישי מופיע עם תרגום ריק — לא עם תרגום של אחר",
  [r2.pairs[2].source, r2.pairs[2].translation], ["שלוש", ""]);
check("ומסומן כיתום", r2.pairs[2].orphan, true);
checkThat("שני הראשונים אינם יתומים", !r2.pairs[0].orphan && !r2.pairs[1].orphan);

console.log("\n[7] תרגום ארוך מהמקור");
const r3 = pairParagraphs("אחת", "one\n\ntwo\n\nthree");
check("שתי פסקאות תרגום בלי מקור", r3.summary.translationWithoutSource, 2);
check("והמקור שלהן ריק", r3.pairs[1].source, "");

console.log("\n[8] גיאומטריית העמודות");
const g = columnGeometry({ widthPercent: 30, gapCm: 0.8, position: "left" });
check("30% לתרגום", g.translationPercent, 30);
check("70% למקור", g.sourcePercent, 70);
check("והמרווח בפיקסלים", g.gapPx, 30.24);
check("שמאל ⟵ המקור ראשון", g.translationFirst, false);
check("ימין ⟵ התרגום ראשון", columnGeometry({ position: "right" }).translationFirst, true);

console.log("\n[9] הציור — פסקה והתרגום שלה באותה שורה");
const b1 = buildParallelHtml("אחת\n\nשתיים", "one\n\ntwo", { enabled: true }, {});
checkThat("זו רשת", b1.html.includes("display:grid"), b1.html.slice(0, 80));
checkThat("שלוש עמודות עם מרווח באמצע", b1.html.includes("70% 30.24px 30%"), b1.html.slice(0, 160));
checkThat("המקור מופיע", b1.html.includes("אחת"), "");
checkThat("והתרגום מופיע", b1.html.includes("one"), "");

console.log("\n[10] מיקום ימין הופך את הסדר");
const b2 = buildParallelHtml("אחת", "one", { enabled: true, position: "right" }, {});
checkThat("התרגום ראשון ברשת", b2.html.indexOf("rtp-tr") < b2.html.indexOf("rtp-src"), "");
checkThat("והעמודות התהפכו", b2.html.includes("30% 30.24px 70%"), b2.html.slice(0, 160));

console.log("\n[11] כותרות");
const b3 = buildParallelHtml("א", "a", { enabled: true }, { source: "המקור", translation: "התרגום" });
checkThat("שתי הכותרות מופיעות", b3.html.includes("המקור") && b3.html.includes("התרגום"), "");
const b4 = buildParallelHtml("א", "a", { enabled: true, showTitles: false }, { source: "המקור" });
checkThat("ואפשר לכבות אותן", !b4.html.includes("rtp-title"), "");

console.log("\n[12] ⛔ אבטחה — טקסט אינו הופך לקוד");
const b5 = buildParallelHtml("<img src=x onerror=alert(1)>", "<b>לא</b>", { enabled: true }, {});
checkThat("אין img אמיתי", !/<img/u.test(b5.html), b5.html.slice(0, 120));
checkThat("ואין b אמיתי", !/<b>/u.test(b5.html), b5.html.slice(0, 120));
checkThat("התווים בורחו", b5.html.includes("&lt;img"), "");
const b6 = buildParallelHtml("א", "a", { enabled: true }, { source: "<script>" });
checkThat("גם בכותרת", !b6.html.includes("<script>"), b6.html.slice(0, 120));

console.log("\n[13] הסיכום בעברית");
checkThat("תואם — נאמר בפשטות", describeParallelSummary(r1.summary).includes("כל אחת מול בת-זוגה"), "");
const warn = describeParallelSummary(r2.summary);
checkThat("לא תואם — מזהיר", warn.includes("⚠️"), warn);
checkThat("ואומר כמה נשארו בלי", warn.includes("בלי תרגום"), warn);
checkThat("ומצהיר שלא נוחש", warn.includes("ולא נוחש"), warn);
checkThat("ובעברית בלבד", !/[a-zA-Z]{3,}/u.test(warn), warn);

console.log("\n[14] קלט ריק");
const b7 = buildParallelHtml("", "", { enabled: true }, {});
check("אפס זוגות", b7.summary.sourceParagraphs, 0);
checkThat("ועדיין רשת תקינה", b7.html.includes("rtp-grid"), "");

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
