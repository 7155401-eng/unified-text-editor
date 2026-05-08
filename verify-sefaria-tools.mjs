// Unit test for Sefaria toolbar logic (pure modules — no browser/DOM).
//
// Tests:
//   - normalizeForSearch                 (sefaria_search.js)
//   - searchByText                        (sefaria_search.js, against real local mirror)
//   - formatCitation / formatRefLabel     (sefaria_ref_format.js)
//   - bavliIndexToDafAmud                 (sefaria_ref_format.js)
//   - numberToHebrewLetters               (sefaria_ref_format.js)
//
// Run:  node verify-sefaria-tools.mjs

import { readFile } from "node:fs/promises";

let pass = 0, fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${detail ? "  — " + detail : ""}`);
  }
}
function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Polyfill global fetch to read from the local public/ folder so the modules
// (which are written for the browser) can import without a server.
// Browser path "/data/sefaria/X.json" → disk path "public/data/sefaria/X.json".
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^\/+/, "");
  const path = `public/${rel}`;
  const buf = await readFile(path);
  return {
    ok: true,
    status: 200,
    async json() { return JSON.parse(buf.toString("utf8")); },
    async text() { return buf.toString("utf8"); },
  };
};

console.log("\n=== sefaria_search.normalizeForSearch ===");
const { normalizeForSearch, searchByText } = await import("./src/sefaria_search.js");
check(
  "strips niqqud",
  normalizeForSearch("בְּרֵאשִׁ֖ית") === "בראשית",
  `got: "${normalizeForSearch("בְּרֵאשִׁ֖ית")}"`
);
check(
  "strips taamim",
  normalizeForSearch("בָּרָ֣א") === "ברא",
  `got: "${normalizeForSearch("בָּרָ֣א")}"`
);
check(
  "maqaf becomes space",
  normalizeForSearch("ויהי־אור") === "ויהי אור",
  `got: "${normalizeForSearch("ויהי־אור")}"`
);
check(
  "punctuation collapsed to space",
  normalizeForSearch("ברא, את השמים.") === "ברא את השמים",
  `got: "${normalizeForSearch("ברא, את השמים.")}"`
);
check(
  "sof-pasuq stripped",
  normalizeForSearch("הָאָֽרֶץ׃") === "הארץ",
  `got: "${normalizeForSearch("הָאָֽרֶץ׃")}"`
);
check("empty input → empty", normalizeForSearch("") === "");
check("whitespace collapse", normalizeForSearch("בראשית   ברא") === "בראשית ברא");

console.log("\n=== sefaria_ref_format ===");
const { formatCitation, formatRefLabel, bavliIndexToDafAmud, numberToHebrewLetters } =
  await import("./src/sefaria_ref_format.js");
check("numberToHebrewLetters(1)", numberToHebrewLetters(1) === "א");
check("numberToHebrewLetters(15)", numberToHebrewLetters(15) === "טו", `got: ${numberToHebrewLetters(15)}`);
check("numberToHebrewLetters(16)", numberToHebrewLetters(16) === "טז");
check("numberToHebrewLetters(100)", numberToHebrewLetters(100) === "ק");
check("numberToHebrewLetters(231)", numberToHebrewLetters(231) === "רלא", `got: ${numberToHebrewLetters(231)}`);
check("numberToHebrewLetters(0)", numberToHebrewLetters(0) === "");

check("bavliIndexToDafAmud(0) = 1a", eq(bavliIndexToDafAmud(0), { daf: 1, amud: "א" }));
check("bavliIndexToDafAmud(2) = 2a", eq(bavliIndexToDafAmud(2), { daf: 2, amud: "א" }));
check("bavliIndexToDafAmud(3) = 2b", eq(bavliIndexToDafAmud(3), { daf: 2, amud: "ב" }));
check("bavliIndexToDafAmud(4) = 3a", eq(bavliIndexToDafAmud(4), { daf: 3, amud: "א" }));

const tanakhMatch = { corpus: "tanakh", heTitle: "בראשית", chapter: 1, verse: 3 };
check("formatCitation Tanakh", formatCitation(tanakhMatch) === "(בראשית א, ג)",
      `got: ${formatCitation(tanakhMatch)}`);
const mishnahMatch = { corpus: "mishnah", heTitle: "משנה ברכות", chapter: 1, verse: 1 };
check("formatCitation Mishnah", formatCitation(mishnahMatch) === "(משנה ברכות פ״א מ״א)",
      `got: ${formatCitation(mishnahMatch)}`);
const bavliMatch = { corpus: "bavli", heTitle: "שבת", chapter: 3, verse: 1 }; // chapter=3 → index 2 → 2a
check("formatCitation Bavli (2a)", formatCitation(bavliMatch) === "(שבת ב ע״א)",
      `got: ${formatCitation(bavliMatch)}`);

console.log("\n=== sefaria_search.searchByText (real corpus) ===");
const cases = [
  // exact verse
  ["Genesis 1:1 verbatim", "בראשית ברא אלהים את השמים ואת הארץ", "Genesis", 1, 1],
  // exact verse with niqqud (should still match — normalize strips it)
  ["Genesis 1:1 with niqqud", "בְּרֵאשִׁית בָּרָא אֱלֹהִים", "Genesis", 1, 1],
  // verse fragment inside a longer selection
  ["Genesis 1:3 inside selection", "אמר משה רבינו ויאמר אלהים יהי אור הוא ידע", "Genesis", 1, 3],
  // famous Mishnah opening — using the exact Mishnah-spelling "בערבית"
  ["Mishnah Berakhot 1:1 fragment", "מאימתי קורין את שמע בערבית", "Mishnah Berakhot", 1, 1],
  // Bavli Berakhot 2a opens with the same Mishnah quote in slightly different spelling
  ["Bavli Berakhot 2a fragment", "משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה", "Berakhot", 3, 1],
];

for (const [label, query, expectBook, expectChap, expectVerse] of cases) {
  const t0 = Date.now();
  const results = await searchByText(query, { limit: 5 });
  const ms = Date.now() - t0;
  const top = results[0];
  const ok = top && top.bookTitle === expectBook && top.chapter === expectChap && top.verse === expectVerse;
  check(
    `[${ms}ms] ${label} → ${expectBook} ${expectChap}:${expectVerse}`,
    ok,
    top ? `top was ${top.bookTitle} ${top.chapter}:${top.verse} (score=${top.score})` : "no results"
  );
}

// Negative case
const nonsense = await searchByText("זהו טקסט שאינו פסוק כלל ועיקר ואין לו שום מקור בספריא", { limit: 5 });
check("nonsense → 0 results", nonsense.length === 0, `got ${nonsense.length}`);

// Short query → 0 results (below minWords threshold)
const tooShort = await searchByText("בראשית", { limit: 5 });
check("query <minWords → 0 results", tooShort.length === 0, `got ${tooShort.length}`);

console.log("\n=== sefaria_locate.findVerseInSelection ===");
const { findVerseInSelection } = await import("./src/sefaria_locate.js");

// Verse fits inside selection — exact match expected
const sel1 = "אמר משה רבינו ויאמר אלהים יהי אור הוא ידע";
const verse1 = "וַיֹּאמֶר אֱלֹהִים יְהִי אוֹר וַיְהִי־אוֹר";
const r1 = findVerseInSelection(verse1, sel1);
check(
  "verse-with-niqqud inside selection — finds the right span",
  r1 && sel1.slice(r1.origStart, r1.origEnd).trim().startsWith("ויאמר אלהים יהי אור"),
  r1 ? `got origStart=${r1.origStart} origEnd=${r1.origEnd} = "${sel1.slice(r1.origStart, r1.origEnd)}"` : "null"
);

// Selection equals verse (after normalization)
const sel2 = "ויאמר אלהים יהי אור ויהי אור";
const r2 = findVerseInSelection(verse1, sel2);
check(
  "selection equals verse — finds full span",
  r2 && r2.origStart === 0 && r2.origEnd === sel2.length,
  r2 ? `got origStart=${r2.origStart} origEnd=${r2.origEnd}` : "null"
);

// Selection contains only a fragment — verse longer than selection
const sel3 = "ויאמר אלהים יהי אור";  // only the start of the verse
const r3 = findVerseInSelection(verse1, sel3);
check(
  "fragment of verse inside selection — finds via window fallback",
  r3 && r3.origStart === 0 && r3.origEnd === sel3.length,
  r3 ? `got origStart=${r3.origStart} origEnd=${r3.origEnd}` : "null"
);

// No match
const sel4 = "טקסט שונה לחלוטין שלא קשור בכלל";
const r4 = findVerseInSelection(verse1, sel4);
check("unrelated text — null", r4 === null, r4 ? JSON.stringify(r4) : "null");

// Punctuation in verse but not in selection — should still match
const sel5 = "כתוב בראשית ברא אלהים את השמים ואת הארץ במקום אחר";
const verse5 = "בְּרֵאשִׁית בָּרָא אֱלֹהִים, אֵת הַשָּׁמַיִם וְאֵת הָאָרֶץ׃";
const r5 = findVerseInSelection(verse5, sel5);
check(
  "verse with punctuation, selection without — matches",
  r5 && sel5.slice(r5.origStart, r5.origEnd).includes("בראשית ברא אלהים"),
  r5 ? `got origStart=${r5.origStart} origEnd=${r5.origEnd} = "${sel5.slice(r5.origStart, r5.origEnd)}"` : "null"
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
