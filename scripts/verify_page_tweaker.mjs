// בדיקות למכוון העמודים — ובמיוחד לתאימות מול *שני* קבצי התוכנה הקודמת.
//
// מריצים: node scripts/verify_page_tweaker.mjs
// אין כאן דפדפן: נבדקת הלוגיקה הטהורה בלבד (תרגום סדרה לזרם, זיהוי סוג הקובץ,
// והמודל שמאחורי הכוונון). בדיקת המסך עצמו נעשית בדפדפן בנפרד.

import {
  normalizePageTweaks,
  withPageTweak,
  getPageTweak,
  pageFootnoteShiftLines,
  updatePageTweakMeasurements,
  approvePageTweakWithMeasurements,
  PAGE_TWEAK_STATUS_APPROVED,
  PAGE_TWEAK_STATUS_CHANGED,
} from "../src/page_tweaks.js";

import {
  seriesLetterToStreamCode,
  parseDesktopTweakFile,
} from "../src/page_tweaker_ui.js";

let pass = 0;
let fail = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}\n      צפוי: ${e}\n      קיבלנו: ${a}`); }
}

const CODES = ["01", "02", "03", "04"];

console.log("\n[1] תרגום אות סדרה למספר זרם");
check("A הוא הזרם הראשון", seriesLetterToStreamCode("A", CODES), "01");
check("B הוא השני", seriesLetterToStreamCode("B", CODES), "02");
check("D הוא הרביעי", seriesLetterToStreamCode("D", CODES), "04");
check("אות קטנה עובדת גם", seriesLetterToStreamCode("b", CODES), "02");
check("אות מעבר למספר הזרמים מחזירה כלום", seriesLetterToStreamCode("Z", CODES), null);
check("מה שאינו אות מחזיר כלום", seriesLetterToStreamCode("1", CODES), null);
check("ריק מחזיר כלום", seriesLetterToStreamCode("", CODES), null);
check("בלי זרמים בכלל מחזיר כלום", seriesLetterToStreamCode("A", []), null);

console.log("\n[2] זיהוי page_tweaks.json של התוכנה הקודמת");
const deskTweaks = { 3: { lines_diff: 1 }, 7: { lines_diff: -2 } };
const r1 = parseDesktopTweakFile(deskTweaks, CODES);
check("זוהה כקובץ כוונוני עמודים", r1.kind, "page-tweaks");
check("שני עמודים נטענו", r1.patches.size, 2);
check("עמוד 3 קיבל 1", r1.patches.get(3), { lines_diff: 1 });
check("עמוד 7 קיבל מינוס 2", r1.patches.get(7), { lines_diff: -2 });

console.log("\n[3] זיהוי page_footnote_shifts.json — האות הופכת לזרם");
const deskShifts = { 3: { A: 2 }, 5: { A: 1, B: 4 } };
const r2 = parseDesktopTweakFile(deskShifts, CODES);
check("זוהה כקובץ הזזות זרמים", r2.kind, "footnote-shifts");
check("A בעמוד 3 הפך לזרם 01", r2.patches.get(3), { footnoteShift: { "01": 2 } });
check("A ו-B בעמוד 5 הפכו ל-01 ו-02", r2.patches.get(5), { footnoteShift: { "01": 1, "02": 4 } });
check("לא דולגה אף סדרה", r2.unmapped, []);

console.log("\n[4] סדרה שאין לה זרם במסמך — מדווחת ולא נזרקת בשקט");
const r3 = parseDesktopTweakFile({ 2: { A: 1, C: 3 } }, ["01"]);
check("רק A נכנס", r3.patches.get(2), { footnoteShift: { "01": 1 } });
check("C דווח כלא ממופה", r3.unmapped, ["2:C"]);

console.log("\n[5] קובץ ריק או זבל");
check("אובייקט ריק", parseDesktopTweakFile({}, CODES).kind, "empty");
check("מפתחות שאינם מספרי עמוד", parseDesktopTweakFile({ foo: 1 }, CODES).kind, "empty");
check("null", parseDesktopTweakFile(null, CODES).kind, "empty");

console.log("\n[6] הצורה החדשה {pages:{...}} עובדת גם");
const r4 = parseDesktopTweakFile({ version: 1, pages: { 4: { linesDiff: 2 } } }, CODES);
check("זוהה נכון", r4.kind, "page-tweaks");
check("עמוד 4 נטען", r4.patches.get(4), { linesDiff: 2 });

console.log("\n[7] המודל — שם השדה הישן lines_diff מתקבל");
const model = normalizePageTweaks({ 3: { lines_diff: 5 } });
check("עמוד 3 קיים", Object.keys(model.pages), ["3"]);
check("הערך תורגם ל-linesDiff", model.pages["3"].linesDiff, 5);

console.log("\n[8] המודל — גבולות");
check("מעל הגבול נחתך ל-30", getPageTweak({ 1: { linesDiff: 999 } }, 1).linesDiff, 30);
check("מתחת לגבול נחתך למינוס 30", getPageTweak({ 1: { linesDiff: -999 } }, 1).linesDiff, -30);
check("הזזת זרם שלילית נזרקת", getPageTweak({ 1: { footnoteShift: { "01": -4 } } }, 1).footnoteShift, {});
check("הזזת זרם מעל 30 נחתכת", getPageTweak({ 1: { footnoteShift: { "01": 99 } } }, 1).footnoteShift, { "01": 30 });

console.log("\n[9] עמוד מאושר שנערך — חוזר לסימון „שונה”");
let state = withPageTweak({}, 6, { linesDiff: 1 });
state = withPageTweak(state, 6, { status: PAGE_TWEAK_STATUS_APPROVED });
check("אחרי אישור", getPageTweak(state, 6).status, PAGE_TWEAK_STATUS_APPROVED);
state = withPageTweak(state, 6, { linesDiff: 2 });
check("אחרי עריכה", getPageTweak(state, 6).status, PAGE_TWEAK_STATUS_CHANGED);

console.log("\n[10] שינוי שמחזיר הכול לאפס מוחק את העמוד מהרשימה");
let s2 = withPageTweak({}, 9, { linesDiff: 3 });
check("נרשם", Object.keys(normalizePageTweaks(s2).pages), ["9"]);
s2 = withPageTweak(s2, 9, { linesDiff: 0, status: "pending" });
check("נמחק", Object.keys(normalizePageTweaks(s2).pages), []);

console.log("\n[11] קריאת הזזה לזרם מסוים");
const constraint = getPageTweak({ 2: { footnoteShift: { "01": 3, "02": 1 } } }, 2);
check("זרם 01", pageFootnoteShiftLines(constraint, "01"), 3);
check("זרם 02", pageFootnoteShiftLines(constraint, "02"), 1);
check("זרם שאינו קיים", pageFootnoteShiftLines(constraint, "09"), 0);

console.log("\n[12] „לא נמדד” נשאר לא-נמדד (באג שנמצא ותוקן במנוע)");
const fresh = getPageTweak({ 1: { linesDiff: 2 } }, 1);
check("רווח תחתון לא נמדד", fresh.spaceLines, null);
check("גלישה לא נמדדה", fresh.overflowPx, null);
check("מחרוזת ריקה אינה אפס", getPageTweak({ 1: { spaceLines: "" } }, 1).spaceLines, null);
check("זבל אינו אפס", getPageTweak({ 1: { spaceLines: "אבג" } }, 1).spaceLines, null);
check("אפס אמיתי כן נשמר", getPageTweak({ 1: { spaceLines: 0, linesDiff: 1 } }, 1).spaceLines, 0);

console.log("\n[13] מדידה בלי ערכים אינה דורסת מדידה קיימת");
let s3 = updatePageTweakMeasurements({}, 4, { bottomGapLines: 2.5, overflowPx: 7 });
check("נרשמה מדידה", getPageTweak(s3, 4).spaceLines, 2.5);
s3 = updatePageTweakMeasurements(s3, 4, {});
check("לא נדרסה", getPageTweak(s3, 4).spaceLines, 2.5);
check("וגם הגלישה לא", getPageTweak(s3, 4).overflowPx, 7);

console.log("\n[14] אישור בלי מדידה שומר על המדידה שהייתה");
let s4 = updatePageTweakMeasurements({}, 8, { bottomGapLines: 1.25 });
s4 = approvePageTweakWithMeasurements(s4, 8, {});
check("המדידה נשמרה", getPageTweak(s4, 8).spaceLines, 1.25);
check("והעמוד מאושר", getPageTweak(s4, 8).status, PAGE_TWEAK_STATUS_APPROVED);

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
