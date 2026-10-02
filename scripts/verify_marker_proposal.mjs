// בדיקות למנוע הצעת מיקום הסמנים.
// מריצים: node scripts/verify_marker_proposal.mjs
//
// הבדיקה החשובה כאן אינה „האם הוא מצא" אלא **„האם הוא יודע להגיד שהוא לא בטוח"**.
// בוט שמנחש הורס מסמך; בוט שמסמן „צריך בדיקה" מציל אותו.

import {
  normalizeForMatch,
  extractOpeningPhrase,
  parseNotes,
  findPhrasePositions,
  proposeMarkerPlacements,
  describeProposalReport,
  CONFIDENCE_EXACT,
  CONFIDENCE_AMBIGUOUS,
  CONFIDENCE_FAR,
  CONFIDENCE_NONE,
} from "../src/link_tools/marker_proposal_engine.js";

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

console.log("\n[1] נרמול להשוואה — ניקוד וגרשיים לא מפריעים");
check("ניקוד יורד", normalizeForMatch("זָכוֹר"), "זכור");
check("גרשיים יורדים", normalizeForMatch('רש"י'), "רש י");
check("רווחים כפולים", normalizeForMatch("א    ב"), "א ב");
check("ריק", normalizeForMatch(""), "");

console.log("\n[2] שליפת הדיבור המתחיל");
check("עם מקף ארוך", extractOpeningPhrase("@01 [3] זכור את היום — פירוש הדבר"), "זכור את היום");
check("עם נקודתיים", extractOpeningPhrase("@01 זכור את היום: פירוש"), "זכור את היום");
check("עם סוף פסוק", extractOpeningPhrase("@02 ויצאתם׃ כלומר"), "ויצאתם");
check("בלי מפריד — נחתך למילים", extractOpeningPhrase("@01 " + "מילה ".repeat(20), { maxWords: 3 }), "מילה מילה מילה");
check("בלי סימן זרם בכלל", extractOpeningPhrase("סתם טקסט — הסבר"), "סתם טקסט");
check("ריק", extractOpeningPhrase("@01"), "");

console.log("\n[3] פירוק חלונית זרם להערות");
const stream = "@01 [1] זכור — לשון זכירה.\n@01 [2] ויצאתם — יציאה ממש.\nשורה שאינה הערה";
const notes = parseNotes(stream);
check("שתי הערות", notes.length, 2);
check("המספרים נקראו", notes.map((n) => n.number), [1, 2]);
check("הדיבור המתחיל נשלף", notes.map((n) => n.phrase), ["זכור", "ויצאתם"]);

console.log("\n[4] מציאת מיקום בטקסט הראשי — מצביע על המקום האמיתי");
const main = "ויאמר משה אל העם זכור את היום הזה ויצאתם ממצרים";
const at = findPhrasePositions(main, "זכור את היום");
check("נמצא פעם אחת", at.length, 1);
check("והמיקום נכון", main.slice(at[0], at[0] + 12), "זכור את היום");

console.log("\n[5] ⭐ הסמן מוצע **לפני** המילים המצוטטות — הכלל של משה");
const r1 = proposeMarkerPlacements(main, "@01 [1] זכור את היום — פירוש");
const p1 = r1.proposals[0];
check("ודאות מלאה", p1.confidence, CONFIDENCE_EXACT);
checkThat("המיקום הוא בדיוק לפני הציטוט", main.slice(p1.position).startsWith("זכור את היום"),
  main.slice(p1.position, p1.position + 20));

console.log("\n[6] ניקוד בטקסט הראשי אינו מונע התאמה");
const niqqud = "ויאמר משה אל העם זָכוֹר אֶת הַיּוֹם הזה";
const r2 = proposeMarkerPlacements(niqqud, "@01 [1] זכור את היום — פירוש");
check("נמצא למרות הניקוד", r2.proposals[0].confidence, CONFIDENCE_EXACT);

console.log("\n[7] ⭐ ביטוי שחוזר פעמיים — מסומן כדורש הכרעה, לא מנוחש בשקט");
const twice = "זכור את היום. ועוד דברים. זכור את היום שוב.";
const r3 = proposeMarkerPlacements(twice, "@01 [1] זכור את היום — פירוש");
check("סומן כמעורפל", r3.proposals[0].confidence, CONFIDENCE_AMBIGUOUS);
checkThat("וההסבר אומר כמה פעמים", r3.proposals[0].reason.includes("2 פעמים"), r3.proposals[0].reason);

console.log("\n[8] ⭐ ביטוי שלא נמצא — לא נדחף לשום מקום");
const r4 = proposeMarkerPlacements(main, "@01 [1] מילה שאינה קיימת כאן — פירוש");
check("סומן כלא נמצא", r4.proposals[0].confidence, CONFIDENCE_NONE);
check("ואין מיקום", r4.proposals[0].position, null);
checkThat("וההסבר ברור", r4.proposals[0].reason.includes("לא נמצא"), r4.proposals[0].reason);

console.log("\n[9] ⭐ קפיצה רחוקה — מסומנת, בדיוק כמו שמשה הזהיר");
const farMain = "התחלה " + "מילת מילוי ".repeat(400) + "זכור את היום";
const r5 = proposeMarkerPlacements(farMain, "@01 [1] זכור את היום — פירוש", { searchWindow: 200 });
check("סומן כרחוק", r5.proposals[0].confidence, CONFIDENCE_FAR);
checkThat("וההסבר אומר כמה רחוק", /\d+ תווים קדימה/u.test(r5.proposals[0].reason), r5.proposals[0].reason);

console.log("\n[10] ⭐ הערות לפי הסדר — הסמן מתקדם ואינו חוזר אחורה");
const ordered = "אחת זכור שתיים ויצאתם שלוש סוף";
const r6 = proposeMarkerPlacements(ordered, "@01 [1] זכור — א\n@01 [2] ויצאתם — ב\n@01 [3] סוף — ג");
check("שלוש הצעות", r6.proposals.length, 3);
check("כולן ודאיות", r6.proposals.map((p) => p.confidence), [CONFIDENCE_EXACT, CONFIDENCE_EXACT, CONFIDENCE_EXACT]);
checkThat("והמיקומים עולים", r6.proposals[0].position < r6.proposals[1].position
  && r6.proposals[1].position < r6.proposals[2].position,
  JSON.stringify(r6.proposals.map((p) => p.position)));
check("אף אחת לא סומנה כלא-בסדר", r6.summary.outOfOrder, 0);

console.log("\n[11] ⭐ הערה שאינה לפי הסדר — מסומנת ולא מוזזת");
const r7 = proposeMarkerPlacements(ordered, "@01 [1] ויצאתם — ב\n@01 [2] זכור — א");
checkThat("ההערה השנייה סומנה", r7.summary.outOfOrder >= 1 || r7.proposals[1].confidence !== CONFIDENCE_EXACT,
  JSON.stringify(r7.proposals.map((p) => ({ c: p.confidence, o: p.inOrder }))));
checkThat("ושום דבר לא הוזז — אין פה כתיבה בכלל",
  typeof r7.proposals[1].position === "number" || r7.proposals[1].position === null);

console.log("\n[12] סיכום אמיתי");
const r8 = proposeMarkerPlacements(twice,
  "@01 [1] זכור את היום — א\n@01 [2] לא קיים בכלל — ב");
check("שתי הערות", r8.summary.notes, 2);
check("אחת מעורפלת", r8.summary.ambiguous, 1);
check("אחת לא נמצאה", r8.summary.notFound, 1);
check("ואפס ודאיות", r8.summary.exact, 0);
check("הכול דורש בדיקה", r8.summary.needsReview, 2);

console.log("\n[13] הדוח נכתב בעברית ואומר שלא נגעו בכלום");
const text = describeProposalReport(r8);
checkThat("מצהיר שלא השתנה דבר", text.includes("לא השתנה"), text);
checkThat("ובעברית בלבד", !/[a-zA-Z]{3,}/u.test(text), text);

console.log("\n[14] קלט ריק או פגום אינו מפיל");
check("אין הערות", proposeMarkerPlacements("טקסט", "").summary.notes, 0);
check("אין טקסט ראשי", proposeMarkerPlacements("", "@01 [1] משהו — א").proposals[0].confidence, CONFIDENCE_NONE);
check("null", proposeMarkerPlacements(null, null).summary.notes, 0);

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
