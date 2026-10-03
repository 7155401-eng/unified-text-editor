// בדיקות לרווחי ההערות הנפרדים — פריט 5 בביקורת ההעברה.
// מריצים: node scripts/verify_stream_spacing.mjs
//
// ⛔ הבדיקה החשובה: ברירת המחדל **אינה משנה שום דבר** במסמכים קיימים.

import {
  __testOnlyNormalizeSpacing as norm,
  __testOnlyFields as FIELDS,
  __testOnlyDefaults as DEFAULTS,
} from "../src/spacing_settings.js";

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

console.log("\n[1] שלושת השדות שחסרו מההעברה נוספו");
const ids = FIELDS.map((f) => f[0]);
checkThat("לפני הערה", ids.includes("streamNoteGapBefore"), "");
checkThat("אחרי הערה", ids.includes("streamNoteGapAfter"), "");
checkThat("בין פסקאות בתוך הערה", ids.includes("streamParagraphGap"), "");
const labels = Object.fromEntries(FIELDS.map((f) => [f[0], f[1]]));
checkThat("והתוויות בעברית",
  !/[a-zA-Z]{3,}/u.test(labels.streamNoteGapBefore + labels.streamNoteGapAfter + labels.streamParagraphGap),
  labels.streamNoteGapBefore);

console.log("\n[2] ⛔⛔ ברירת המחדל אינה משנה דבר — המלכודת של Number(null)");
check("לפני = null", DEFAULTS.streamNoteGapBefore, null);
check("אחרי = null", DEFAULTS.streamNoteGapAfter, null);
check("בין פסקאות = 0", DEFAULTS.streamParagraphGap, 0);
const d = norm({});
check("⭐ הנרמול שומר null ולא הופך לאפס", [d.streamNoteGapBefore, d.streamNoteGapAfter], [null, null]);
check("ו-streamNoteGap נשאר כמו שהיה", d.streamNoteGap, DEFAULTS.streamNoteGap);

console.log("\n[3] ערכים ריקים נשארים „לא נקבע”");
check("מחרוזת ריקה", norm({ streamNoteGapBefore: "" }).streamNoteGapBefore, null);
check("undefined", norm({ streamNoteGapBefore: undefined }).streamNoteGapBefore, null);
check("זבל", norm({ streamNoteGapBefore: "אבג" }).streamNoteGapBefore, null);

console.log("\n[4] ערך אמיתי כן נשמר, ונחתך לגבולות");
check("ערך רגיל", norm({ streamNoteGapBefore: 11 }).streamNoteGapBefore, 11);
check("⭐ אפס מפורש אינו הופך ל-null", norm({ streamNoteGapBefore: 0 }).streamNoteGapBefore, 0);
check("מעל הגבול נחתך", norm({ streamNoteGapBefore: 999 }).streamNoteGapBefore, 40);
check("שלילי נחתך", norm({ streamNoteGapAfter: -5 }).streamNoteGapAfter, 0);
check("בין פסקאות — ערך", norm({ streamParagraphGap: 7 }).streamParagraphGap, 7);
check("בין פסקאות — זבל חוזר לאפס", norm({ streamParagraphGap: "אבג" }).streamParagraphGap, 0);

console.log("\n[5] ⭐ אי-סימטריה — מה שאבד בהעברה וחזר");
const asym = norm({ streamNoteGapBefore: 11, streamNoteGapAfter: 8 });
check("לפני 11 ואחרי 8", [asym.streamNoteGapBefore, asym.streamNoteGapAfter], [11, 8]);
checkThat("כלומר אפשר סוף-סוף 0.3 ס״מ לפני ו-0.2 אחרי", asym.streamNoteGapBefore !== asym.streamNoteGapAfter);

console.log("\n[6] שאר ההגדרות לא נפגעו");
const all = norm({});
for (const k of ["streamLineHeight", "streamGap", "streamTitleGap", "pageMainLineHeight"]) {
  check(k, all[k], DEFAULTS[k]);
}
check("ובוליאני נשאר בוליאני", typeof all.preventMidLineSplit, "boolean");

console.log(`\n────────────\nעברו ${pass} · נכשלו ${fail}\n`);
process.exit(fail ? 1 : 0);
