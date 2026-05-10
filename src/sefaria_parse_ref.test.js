// Unit tests for the smart citation parser.
// Run: node src/sefaria_parse_ref.test.js

import { parseUserRefSync } from "./sefaria_parse_ref.js";

let pass = 0, fail = 0;

function expect(input, predicate, label) {
  const got = parseUserRefSync(input);
  let ok = false;
  try { ok = predicate(got); } catch { ok = false; }
  if (ok) { pass++; console.log(`  ✓ ${label || input}`); }
  else {
    fail++;
    console.error(`  ✗ ${label || input}`);
    console.error(`     input: "${input}"`);
    console.error(`     got: ${JSON.stringify(got, null, 2)}`);
  }
}

function hasRef(corpus, heTitle, chapter, verse) {
  return (got) => got.some((c) =>
    c.corpus === corpus &&
    c.heTitle === heTitle &&
    c.chapter === chapter &&
    (verse === null ? c.verse === null : c.verse === verse)
  );
}

console.log("\n=== Tanakh: simple forms ===");
expect("בראשית א א", hasRef("tanakh", "בראשית", 1, 1));
expect("בראשית א:א", hasRef("tanakh", "בראשית", 1, 1));
expect("בראשית א, א", hasRef("tanakh", "בראשית", 1, 1));
expect("בראשית פרק א פסוק א", hasRef("tanakh", "בראשית", 1, 1));
expect("בראשית 1 1", hasRef("tanakh", "בראשית", 1, 1), "decimal digits");
expect("בראשית 1:1", hasRef("tanakh", "בראשית", 1, 1));

console.log("\n=== Tanakh: gematria + chapters ===");
expect("תהילים קיט", hasRef("tanakh", "תהילים", 119, null), "chapter only");
expect("תהילים קיט א", hasRef("tanakh", "תהילים", 119, 1));
expect("תהלים קיט", hasRef("tanakh", "תהילים", 119, null), "spelling without yod");
expect("תה' קיט", hasRef("tanakh", "תהילים", 119, null), "abbreviated");
expect("תה קיט", hasRef("tanakh", "תהילים", 119, null), "abbrev no apostrophe");

console.log("\n=== Tanakh: numbered books (שמואל, מלכים) ===");
expect("מלכים ב ג ד", hasRef("tanakh", "מלכים ב", 3, 4), "spaces");
expect("מלכים ב' ג' ד'", hasRef("tanakh", "מלכים ב", 3, 4), "all gershayim");
expect('מל"ב ג, ד', hasRef("tanakh", "מלכים ב", 3, 4), "abbreviated");
expect('מ"ב ג ד', hasRef("tanakh", "מלכים ב", 3, 4), "very short abbrev");
expect("שמואל א ג ד", hasRef("tanakh", "שמואל א", 3, 4));
expect('ש"א ג ד', hasRef("tanakh", "שמואל א", 3, 4));

console.log("\n=== Tanakh: trei-asar abbreviations ===");
expect("יש' ג ד", hasRef("tanakh", "ישעיהו", 3, 4));
expect("יר' ג ד", hasRef("tanakh", "ירמיהו", 3, 4));
expect("יחז' ג ד", hasRef("tanakh", "יחזקאל", 3, 4));

console.log("\n=== Mishnah ===");
expect("משנה ברכות א ב", hasRef("mishnah", "משנה ברכות", 1, 2));
expect("ברכות א ב", hasRef("mishnah", "משנה ברכות", 1, 2), "bare → mishnah candidate");
expect("ברכות א ב", hasRef("bavli", "ברכות", 1, 2), "bare → bavli candidate too");
expect("מ' ברכות א ב", hasRef("mishnah", "משנה ברכות", 1, 2));
expect("אבות א, א", hasRef("mishnah", "משנה אבות", 1, 1));
expect("פרקי אבות א", hasRef("mishnah", "משנה אבות", 1, null));

console.log("\n=== Bavli ===");
expect("שבת ב.", hasRef("bavli", "שבת", 2, 1), "amud alef via period");
expect("שבת ב:", hasRef("bavli", "שבת", 2, 1), "amud bet via colon");
expect('שבת ב ע"א', hasRef("bavli", "שבת", 2, 1));
expect("שבת ב עא", hasRef("bavli", "שבת", 2, 1));
expect("תלמוד בבלי שבת ד", hasRef("bavli", "שבת", 4, 1));
expect("מסכת ברכות ב.", hasRef("bavli", "ברכות", 2, 1));
expect('ב"מ ג.', hasRef("bavli", "בבא מציעא", 3, 1));
expect('ב"ק ה.', hasRef("bavli", "בבא קמא", 5, 1));
expect('ב"ב י.', hasRef("bavli", "בבא בתרא", 10, 1));

console.log("\n=== Bavli vs Mishnah ambiguity ===");
const ambig = parseUserRefSync("ברכות א");
const hasMishnahCh = ambig.some((c) => c.corpus === "mishnah" && c.heTitle === "משנה ברכות" && c.chapter === 1);
const hasBavliCh = ambig.some((c) => c.corpus === "bavli" && c.heTitle === "ברכות" && c.chapter === 1);
expect("ברכות א", () => hasMishnahCh && hasBavliCh, "ambiguous returns BOTH candidates");

console.log("\n=== Edge cases / failures ===");
expect("שלום ושלום", (got) => got.length === 0, "non-citation text → empty");
expect("בראשית", (got) => got.length === 0, "book name only → empty");
expect("", (got) => got.length === 0, "empty → empty");

console.log("\n=== Decorations & ambiguity ===");
expect('בראשית-א-א', hasRef("tanakh", "בראשית", 1, 1), "hyphens");
expect('בראשית—א—א', hasRef("tanakh", "בראשית", 1, 1), "em-dash hyphens");

console.log("\n=== Rambam ===");
expect("רמב\"ם הלכות שבת פ\"א ה\"א", hasRef("rambam", "משנה תורה, הלכות שבת", 1, 1));
expect("רמב\"ם הל' שבת פ\"א ה\"א", hasRef("rambam", "משנה תורה, הלכות שבת", 1, 1));
expect("רמבם שבת א, א", hasRef("rambam", "משנה תורה, הלכות שבת", 1, 1));
expect("רמבם הלכות תשובה ג ד", hasRef("rambam", "משנה תורה, הלכות תשובה", 3, 4));
expect("משנה תורה הלכות שבת א, א", hasRef("rambam", "משנה תורה, הלכות שבת", 1, 1));
expect("רמבם הלכות שבת פרק כט", hasRef("rambam", "משנה תורה, הלכות שבת", 29, null), "chapter only");

console.log("\n=== Shulchan Arukh ===");
expect("שו\"ע או\"ח סי' רב סע' א", hasRef("shulchan_arukh", "שולחן ערוך, אורח חיים", 202, 1));
expect("שוע אוח רב, א", hasRef("shulchan_arukh", "שולחן ערוך, אורח חיים", 202, 1));
expect("שולחן ערוך אורח חיים רב, א", hasRef("shulchan_arukh", "שולחן ערוך, אורח חיים", 202, 1));
expect("או\"ח רב א", hasRef("shulchan_arukh", "שולחן ערוך, אורח חיים", 202, 1));
expect("יו\"ד פז ב", hasRef("shulchan_arukh", "שולחן ערוך, יורה דעה", 87, 2));
expect("יוד פז ב", hasRef("shulchan_arukh", "שולחן ערוך, יורה דעה", 87, 2));
expect("חו\"מ רכז ה", hasRef("shulchan_arukh", "שולחן ערוך, חושן משפט", 227, 5));
expect("אה\"ע יז ג", hasRef("shulchan_arukh", "שולחן ערוך, אבן העזר", 17, 3));
expect("שו\"ע או\"ח סימן רב", hasRef("shulchan_arukh", "שולחן ערוך, אורח חיים", 202, null), "siman only");

console.log("\n=== Rambam: bare topic does NOT match (must have prefix) ===");
expect("שבת פ\"א ה\"א", (got) => !got.some(c => c.corpus === "rambam"), "bare 'שבת' is bavli/mishnah, not rambam");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
