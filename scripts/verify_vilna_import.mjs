// verify_vilna_import.mjs — בדיקות לייבוא (src/vilna_import.js) מול הנתונים האמיתיים.
//
// נבדק כאן:
//   1. שמות דפים בעברית (ב. / ב: / טו. ...) והמרה הפוכה מקלט המשתמש.
//   2. עיגון רש"י: כמה פירושים נתלו בדיוק על הדיבור המתחיל וכמה נפלו לסוף.
//   3. אפס אובדן טקסט — הטקסט שיוצא לייבוא מכיל בדיוק את כל טקסט הגמרא.
//   4. סימן דף אחד לכל עמוד, בסדר הנכון, ופסקה אחת לעמוד.
//   5. פרק שלם — טווח הדפים תואם את מה שמוגדר בספריא.
//
// שימוש: node scripts/verify_vilna_import.mjs [slug]

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const slug = process.argv[2] || "berakhot";

const {
  buildVilnaRawText, amudLabel, amudLabelLong, parseDafInput, hebrewNumber,
  findDhEnd, normalizeForMatch, perekRange,
} = await import("../src/vilna_import.js");

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

console.log("[1] שמות דפים");
check("אינדקס 2 = ב.", amudLabel(2) === "ב.", amudLabel(2));
check("אינדקס 3 = ב:", amudLabel(3) === "ב:", amudLabel(3));
check("אינדקס 28 = טו.", amudLabel(28) === "טו.", amudLabel(28));
check("אינדקס 30 = טז.", amudLabel(30) === "טז.", amudLabel(30));
check('אינדקס 3 ארוך = ב ע"ב', amudLabelLong(3) === 'ב ע"ב', amudLabelLong(3));
check("קלט '2a'", parseDafInput("2a") === 2, String(parseDafInput("2a")));
check("קלט 'ב:'", parseDafInput("ב:") === 3, String(parseDafInput("ב:")));
check("קלט 'טו.'", parseDafInput("טו.") === 28, String(parseDafInput("טו.")));
check("קלט ריק", parseDafInput("") === -1);
check("מספר עברי 115", hebrewNumber(115) === "קטו", hebrewNumber(115));

console.log("\n[2] חיפוש דיבור המתחיל");
{
  const seg = "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסין לאכול בתרומתן";
  const at = findDhEnd(seg, "מאימתי קורין את שמע בערבין");
  check("דיבור מלא נמצא", at === 26, `at=${at}`);
  const at2 = findDhEnd(seg, "מאימתי קורין וכו'");
  check("דיבור עם וכו' נמצא", at2 > 0 && at2 <= 14, `at=${at2}`);
  const at3 = findDhEnd(seg, "משעה שהכהנים", 30);
  check("חיפוש מנקודה מאוחרת", at3 > 30, `at=${at3}`);
  check("דיבור שאינו קיים", findDhEnd(seg, "אין כזה דבר בכלל") === -1);
  check("נרמול מסיר גרשיים", normalizeForMatch('ר"ה') === "רה", normalizeForMatch('ר"ה'));
}

console.log("\n[3] בנייה מהנתונים האמיתיים");
const data = JSON.parse(await readFile(resolve(ROOT, "public", "data", "sefaria", "vilna_shas", `${slug}.json`), "utf8"));
const book = data.book;
console.log(`  מסכת ${book.heTitle} · ${book.perakim.length} פרקים`);

{
  const { text, stats } = buildVilnaRawText(book, { fromAmud: 2, toAmud: 9, withRashi: true });
  const markers = text.match(/⟦דף [^⟧]+⟧/g) || [];
  check("8 סימני דף ל-8 עמודים", markers.length === 8, `=${markers.length}`);
  check("הסימנים בסדר הנכון",
    markers.join(",") === ["ב.", "ב:", "ג.", "ג:", "ד.", "ד:", "ה.", "ה:"].map((l) => `⟦דף ${l}⟧`).join(","),
    markers.join(","));

  const blocks = text.split(/\n\n/);
  check("מבנה: כותרת + זוג (סימן, פסקה) לכל עמוד", blocks.length === 1 + 8 * 2, `=${blocks.length}`);
  check("כל פסקה שנייה היא סימן דף",
    blocks.slice(1).every((b, i) => (i % 2 === 0) === /^⟦דף/.test(b)));

  // --- אפס אובדן: מסירים סימני דף והערות, ומשווים לטקסט המקורי ---
  const stripped = text
    .replace(/⟦דף [^⟧]+⟧/g, " ")
    .replace(/\{@\d{2,3}[^}]*\}/g, "")
    .replace(/^מסכת .*$/m, " ")
    .replace(/\s+/g, " ").trim();
  const original = [];
  for (let ai = 2; ai <= 9; ai++) {
    for (const s of book.gemara[ai] || []) if (s) original.push(s);
  }
  const originalJoined = original.join(" ").replace(/\s+/g, " ").trim();
  check("אפס אובדן טקסט גמרא", stripped === originalJoined,
    `יצא ${stripped.length} תווים מול ${originalJoined.length}`);

  // --- רש"י ---
  let expectedRashi = 0;
  for (let ai = 2; ai <= 9; ai++) {
    for (const line of book.rashi[ai] || []) expectedRashi += (line || []).length;
  }
  check('כל פירושי רש"י נכנסו', stats.rashiNotes === expectedRashi, `${stats.rashiNotes} מול ${expectedRashi}`);
  const notes = text.match(/\{@01 [^}]*\}/g) || [];
  check("מספר ההערות בטקסט תואם", notes.length === expectedRashi, `${notes.length} מול ${expectedRashi}`);
  const anchoredPct = Math.round((stats.rashiAnchored / Math.max(1, stats.rashiNotes)) * 100);
  console.log(`    עוגן מדויק לדיבור המתחיל: ${stats.rashiAnchored}/${stats.rashiNotes} (${anchoredPct}%)`);
  check("לפחות 80% מפירושי רש\"י עוגנו על הדיבור המתחיל", anchoredPct >= 80, `=${anchoredPct}%`);
  check("כל הערה נגמרת ב-: או .", notes.every((n) => /[.:]\}$/.test(n)));
  check("אין פסיקים בגמרא שיצאה", !stripped.includes(","));
  check("אין נקודות בגמרא שיצאה", !stripped.includes("."));
}

console.log("\n[4] בלי רש\"י");
{
  const { text, stats } = buildVilnaRawText(book, { fromAmud: 2, toAmud: 3, withRashi: false });
  check("אין סימני זרם", !/\{@\d/.test(text));
  check("אין הערות בסטטיסטיקה", stats.rashiNotes === 0);
  check("שני עמודים", stats.amudim === 2);
}

console.log("\n[5] פרק שלם");
{
  const r1 = perekRange(book, 1, true);
  check("פרק א מתחיל בדף ב.", r1.fromAmud === 2, `=${r1.fromAmud}`);
  check("לפרק א יש שם", !!r1.perek.heTitle, r1.perek.heTitle);
  const { stats } = buildVilnaRawText(book, { fromAmud: r1.fromAmud, toAmud: r1.toAmud, withRashi: true });
  check("פרק א מכסה יותר מ-10 עמודים", stats.amudim > 10, `=${stats.amudim}`);

  const r2 = perekRange(book, 2, false);
  const partial = buildVilnaRawText(book, {
    fromAmud: r2.fromAmud, toAmud: r2.toAmud, fromLine: r2.fromLine, toLine: r2.toLine, withRashi: false,
  });
  const full = buildVilnaRawText(book, { fromAmud: r2.fromAmud, toAmud: r2.toAmud, withRashi: false });
  check("חיתוך חלקי אכן מקצר את הפרק", partial.stats.gemaraChars < full.stats.gemaraChars,
    `${partial.stats.gemaraChars} < ${full.stats.gemaraChars}`);
}

console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
