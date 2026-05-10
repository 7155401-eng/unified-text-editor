// Hebrew title + alias map for every book in the local Sefaria mirror.
//
// "aliases" is the literal token the user might write (after stripping niqqud,
// gershayim, and decoration). We match against the *exact* token (or sequence
// of tokens for multi-word titles) — no fuzzy distance, just an explicit list.
// Add more aliases freely; the cost is one extra map entry.
//
// Each entry:
//   {
//     corpus: "tanakh" | "mishnah" | "bavli",
//     heTitle: "...",         // canonical heTitle in the mirror
//     englishTitle: "...",    // canonical English title in the mirror
//     aliases: [string[]],    // each inner array = one accepted way to write it
//   }
//
// An alias may be one or more tokens. Multi-token aliases let us match
// "מלכים ב" (two tokens) or "תלמוד בבלי שבת" (three tokens, where the first
// two are an optional prefix the parser strips before matching the book).
//
// IMPORTANT: aliases are normalized like the user input — no gershayim, no
// punctuation, no niqqud — see normalizeForAlias() below.

export function normalizeForAlias(s) {
  return String(s || "")
    .replace(/[֑-ׇ]/g, "")           // niqqud + cantillation
    .replace(/[׳״'"`]/g, "")         // gershayim/geresh/apostrophes
    .replace(/[.,:;\-־()[\]{}]/g, " ")
    // Final-form letters → regular letters. After stripping gershayim, words
    // like "חו"מ" become "חומ" with a non-final "מ"; aliases written with the
    // final form ("חום") wouldn't match unless we also fold the user's input
    // the same way. We fold both sides to non-final forms.
    .replace(/ך/g, "כ").replace(/ם/g, "מ").replace(/ן/g, "נ")
    .replace(/ף/g, "פ").replace(/ץ/g, "צ")
    .replace(/\s+/g, " ")
    .trim();
}

// Convenience builder: turn a "heTitle | a1 | a2" pattern into the entry shape.
function E(corpus, heTitle, englishTitle, aliasGroups) {
  return {
    corpus,
    heTitle,
    englishTitle,
    aliases: aliasGroups.map((g) => normalizeForAlias(g).split(" ").filter(Boolean)),
  };
}

// === Tanakh (39 books) ============================================
// Aliases include: full name, common shortenings (בר', בראש', בראשי'),
// 2-letter abbreviations with gershayim (ב"ר → not used here; reserved for
// midrash), and standard ראשי-תיבות.
//
// Avoid single-letter abbreviations like "ב" alone — too ambiguous; the
// parser would match dozens of contexts. Stick to >=2 chars.

const TANAKH = [
  E("tanakh", "בראשית", "Genesis", ["בראשית", "בראש", "ברא", "בר"]),
  E("tanakh", "שמות", "Exodus", ["שמות", "שמ", "שמו"]),
  E("tanakh", "ויקרא", "Leviticus", ["ויקרא", "ויק"]),
  E("tanakh", "במדבר", "Numbers", ["במדבר", "במ", "במד"]),
  E("tanakh", "דברים", "Deuteronomy", ["דברים", "דב", "דבר"]),

  E("tanakh", "יהושע", "Joshua", ["יהושע", "יהו", "יהוש"]),
  E("tanakh", "שופטים", "Judges", ["שופטים", "שופ", "שופט", "שו"]),
  E("tanakh", "שמואל א", "I Samuel", ["שמואל א", "שא", "שמא", "שמו א", "שמואל ראשון", "שמ א"]),
  E("tanakh", "שמואל ב", "II Samuel", ["שמואל ב", "שב", "שמב", "שמו ב", "שמואל שני", "שמ ב"]),
  E("tanakh", "מלכים א", "I Kings", ["מלכים א", "מא", "מלא", "מל א", "מלכים ראשון"]),
  E("tanakh", "מלכים ב", "II Kings", ["מלכים ב", "מב", "מלב", "מל ב", "מלכים שני"]),

  E("tanakh", "ישעיהו", "Isaiah", ["ישעיהו", "ישעיה", "יש", "ישע", "ישעי"]),
  E("tanakh", "ירמיהו", "Jeremiah", ["ירמיהו", "ירמיה", "יר", "ירמ"]),
  E("tanakh", "יחזקאל", "Ezekiel", ["יחזקאל", "יח", "יחז", "יחזק"]),

  E("tanakh", "הושע", "Hosea", ["הושע", "הוש"]),
  E("tanakh", "יואל", "Joel", ["יואל", "יוא"]),
  E("tanakh", "עמוס", "Amos", ["עמוס", "עמו"]),
  E("tanakh", "עובדיה", "Obadiah", ["עובדיה", "עוב"]),
  E("tanakh", "יונה", "Jonah", ["יונה", "יונ"]),
  E("tanakh", "מיכה", "Micah", ["מיכה", "מי", "מיכ"]),
  E("tanakh", "נחום", "Nahum", ["נחום", "נחו"]),
  E("tanakh", "חבקוק", "Habakkuk", ["חבקוק", "חבק"]),
  E("tanakh", "צפניה", "Zephaniah", ["צפניה", "צפ", "צפנ"]),
  E("tanakh", "חגי", "Haggai", ["חגי"]),
  E("tanakh", "זכריה", "Zechariah", ["זכריה", "זכ", "זכר"]),
  E("tanakh", "מלאכי", "Malachi", ["מלאכי", "מלא"]),

  E("tanakh", "תהילים", "Psalms", ["תהילים", "תהלים", "תה", "תהל", "תהי", "תה ל", "תה י"]),
  E("tanakh", "משלי", "Proverbs", ["משלי", "מש", "משל"]),
  E("tanakh", "איוב", "Job", ["איוב", "איו"]),

  E("tanakh", "שיר השירים", "Song of Songs", ["שיר השירים", "שהש", "שיר", "שה ש"]),
  E("tanakh", "רות", "Ruth", ["רות", "רו"]),
  E("tanakh", "איכה", "Lamentations", ["איכה", "איכ"]),
  E("tanakh", "קהלת", "Ecclesiastes", ["קהלת", "קה", "קהל"]),
  E("tanakh", "אסתר", "Esther", ["אסתר", "אס", "אסת", "מגילת אסתר"]),

  E("tanakh", "דניאל", "Daniel", ["דניאל", "דנ", "דני"]),
  E("tanakh", "עזרא", "Ezra", ["עזרא", "עז"]),
  E("tanakh", "נחמיה", "Nehemiah", ["נחמיה", "נח", "נחמ"]),
  E("tanakh", "דברי הימים א", "I Chronicles", ["דברי הימים א", "דהא", "דה א", "דה י א", "דהי א", "דה הי א"]),
  E("tanakh", "דברי הימים ב", "II Chronicles", ["דברי הימים ב", "דהב", "דה ב", "דה י ב", "דהי ב", "דה הי ב"]),
];

// === Mishnah (63 tractates) ======================================
// User may write "משנה ברכות" or just "ברכות" — both must match. To handle
// the bare form, we add the tractate name with no prefix as an alias too.
// This means a bare "ברכות א ב" parses as Mishnah by default; if the user
// also has Bavli Berakhot, we return BOTH as candidates.
//
// Common abbreviations: ב"מ, ב"ק, ב"ב, ר"ה, מו"ק, ע"ז, ש"ק. All get added.

const MISHNAH_NAMES = [
  ["משנה ערכין", "Mishnah Arakhin", ["ערכין", "ערכ", "ער"]],
  ["משנה עבודה זרה", "Mishnah Avodah Zarah", ["עבודה זרה", "עז", "ע ז"]],
  ["משנה בבא בתרא", "Mishnah Bava Batra", ["בבא בתרא", "בב", "ב ב", "בבא בתראה"]],
  ["משנה בבא קמא", "Mishnah Bava Kamma", ["בבא קמא", "בק", "ב ק", "בבא קמה"]],
  ["משנה בבא מציעא", "Mishnah Bava Metzia", ["בבא מציעא", "במ", "ב מ", "בבא מצועה"]],
  ["משנה ביצה", "Mishnah Beitzah", ["ביצה", "בי"]],
  ["משנה בכורות", "Mishnah Bekhorot", ["בכורות", "בכ", "בכו"]],
  ["משנה ברכות", "Mishnah Berakhot", ["ברכות", "ברכ", "בר"]],
  ["משנה ביכורים", "Mishnah Bikkurim", ["ביכורים", "בכורים", "בי"]],
  ["משנה חגיגה", "Mishnah Chagigah", ["חגיגה", "חג", "חגי"]],
  ["משנה חלה", "Mishnah Challah", ["חלה"]],
  ["משנה חולין", "Mishnah Chullin", ["חולין", "חול", "חו"]],
  ["משנה דמאי", "Mishnah Demai", ["דמאי", "דמ"]],
  ["משנה עדיות", "Mishnah Eduyot", ["עדיות", "עד", "עדי"]],
  ["משנה עירובין", "Mishnah Eruvin", ["עירובין", "ערובין", "עיר"]],
  ["משנה גיטין", "Mishnah Gittin", ["גיטין", "גט", "גיט"]],
  ["משנה הוריות", "Mishnah Horayot", ["הוריות", "הור", "הו"]],
  ["משנה כלים", "Mishnah Kelim", ["כלים", "כלי"]],
  ["משנה כריתות", "Mishnah Keritot", ["כריתות", "כר", "כרי"]],
  ["משנה כתובות", "Mishnah Ketubot", ["כתובות", "כתוב", "כת"]],
  ["משנה קידושין", "Mishnah Kiddushin", ["קידושין", "קיד", "קי"]],
  ["משנה כלאים", "Mishnah Kilayim", ["כלאים", "כלא"]],
  ["משנה קינים", "Mishnah Kinnim", ["קינים", "קינ"]],
  ["משנה מעשר שני", "Mishnah Maaser Sheni", ["מעשר שני", "מ ש", "מש"]],
  ["משנה מעשרות", "Mishnah Maasrot", ["מעשרות", "מעש"]],
  ["משנה מכשירין", "Mishnah Makhshirin", ["מכשירין", "מכש"]],
  ["משנה מכות", "Mishnah Makkot", ["מכות", "מכ"]],
  ["משנה מגילה", "Mishnah Megillah", ["מגילה", "מג"]],
  ["משנה מעילה", "Mishnah Meilah", ["מעילה", "מעי"]],
  ["משנה מנחות", "Mishnah Menachot", ["מנחות", "מנ", "מנח"]],
  ["משנה מדות", "Mishnah Middot", ["מדות", "מידות", "מד"]],
  ["משנה מקואות", "Mishnah Mikvaot", ["מקואות", "מקוואות", "מק"]],
  ["משנה מועד קטן", "Mishnah Moed Katan", ["מועד קטן", "מק", "מו ק"]],
  ["משנה נזיר", "Mishnah Nazir", ["נזיר", "נז"]],
  ["משנה נדרים", "Mishnah Nedarim", ["נדרים", "נד", "נדר"]],
  ["משנה נגעים", "Mishnah Negaim", ["נגעים", "נג"]],
  ["משנה נדה", "Mishnah Niddah", ["נדה"]],
  ["משנה אהלות", "Mishnah Oholot", ["אהלות", "אה"]],
  ["משנה עוקצים", "Mishnah Oktzin", ["עוקצים", "עוק"]],
  ["משנה ערלה", "Mishnah Orlah", ["ערלה", "ערל"]],
  ["משנה פרה", "Mishnah Parah", ["פרה"]],
  ["משנה פאה", "Mishnah Peah", ["פאה"]],
  ["משנה פסחים", "Mishnah Pesachim", ["פסחים", "פס"]],
  ["משנה ראש השנה", "Mishnah Rosh Hashanah", ["ראש השנה", "רה", "רהש", "ר ה"]],
  ["משנה סנהדרין", "Mishnah Sanhedrin", ["סנהדרין", "סנ", "סנהד"]],
  ["משנה שבת", "Mishnah Shabbat", ["שבת"]],
  ["משנה שקלים", "Mishnah Shekalim", ["שקלים", "שק"]],
  ["משנה שביעית", "Mishnah Sheviit", ["שביעית", "שבי"]],
  ["משנה שבועות", "Mishnah Shevuot", ["שבועות", "שבו", "שב"]],
  ["משנה סוטה", "Mishnah Sotah", ["סוטה", "סו"]],
  ["משנה סוכה", "Mishnah Sukkah", ["סוכה", "סוכ"]],
  ["משנה תענית", "Mishnah Ta'anit", ["תענית", "תע"]],
  ["משנה טהרות", "Mishnah Tahorot", ["טהרות", "טה"]],
  ["משנה תמיד", "Mishnah Tamid", ["תמיד", "תמי"]],
  ["משנה תמורה", "Mishnah Temurah", ["תמורה", "תמ", "תמו"]],
  ["משנה תרומות", "Mishnah Terumot", ["תרומות", "תר"]],
  ["משנה טבול יום", "Mishnah Tevul Yom", ["טבול יום", "טב י"]],
  ["משנה ידים", "Mishnah Yadayim", ["ידים", "יד"]],
  ["משנה יבמות", "Mishnah Yevamot", ["יבמות", "יבמ", "יב"]],
  ["משנה יומא", "Mishnah Yoma", ["יומא", "יומ"]],
  ["משנה זבים", "Mishnah Zavim", ["זבים", "זב"]],
  ["משנה זבחים", "Mishnah Zevachim", ["זבחים", "זבח"]],
  ["משנה אבות", "Pirkei Avot", ["אבות", "פרקי אבות", "אב"]],
];

const MISHNAH = MISHNAH_NAMES.map(([heTitle, englishTitle, baseAliases]) => {
  // Build aliases: each base form, plus the same form prefixed with "משנה",
  // plus shorthand "מ' <name>". This way "ברכות" → Mishnah Berakhot AND
  // (separately) "משנה ברכות" → same; either user input matches.
  const all = [];
  for (const a of baseAliases) {
    all.push(a);
    all.push(`משנה ${a}`);
    all.push(`מ ${a}`);
  }
  // The full canonical heTitle ("משנה ברכות") is also a valid alias.
  all.push(heTitle);
  return E("mishnah", heTitle, englishTitle, all);
});

// === Bavli (37 tractates) ========================================
// Bavli aliases follow the same pattern as Mishnah, plus "תלמוד בבלי" prefix
// and the "מסכת" prefix (used in print citations).
//
// Daf notation: a daf is an integer (the chapter index in our mirror); amud
// is "ע"א" / "ע"ב" / "." / ":". Parsed in sefaria_parse_ref's bavli branch.

const BAVLI_NAMES = [
  ["ערכין", "Arakhin", ["ערכין", "ערכ"]],
  ["עבודה זרה", "Avodah Zarah", ["עבודה זרה", "עז", "ע ז"]],
  ["בבא בתרא", "Bava Batra", ["בבא בתרא", "בב", "ב ב"]],
  ["בבא קמא", "Bava Kamma", ["בבא קמא", "בק", "ב ק"]],
  ["בבא מציעא", "Bava Metzia", ["בבא מציעא", "במ", "ב מ"]],
  ["ביצה", "Beitzah", ["ביצה", "בי"]],
  ["בכורות", "Bekhorot", ["בכורות", "בכ"]],
  ["ברכות", "Berakhot", ["ברכות", "ברכ"]],
  ["חגיגה", "Chagigah", ["חגיגה", "חג", "חגי"]],
  ["חולין", "Chullin", ["חולין", "חול", "חו"]],
  ["עירובין", "Eruvin", ["עירובין", "ערובין", "עיר"]],
  ["גיטין", "Gittin", ["גיטין", "גט", "גיט"]],
  ["הוריות", "Horayot", ["הוריות", "הור"]],
  ["כריתות", "Keritot", ["כריתות", "כר"]],
  ["כתובות", "Ketubot", ["כתובות", "כת", "כתוב"]],
  ["קידושין", "Kiddushin", ["קידושין", "קיד", "קי"]],
  ["מכות", "Makkot", ["מכות", "מכ"]],
  ["מגילה", "Megillah", ["מגילה", "מג"]],
  ["מעילה", "Meilah", ["מעילה", "מעי"]],
  ["מנחות", "Menachot", ["מנחות", "מנ", "מנח"]],
  ["מועד קטן", "Moed Katan", ["מועד קטן", "מק", "מו ק"]],
  ["נזיר", "Nazir", ["נזיר", "נז"]],
  ["נדרים", "Nedarim", ["נדרים", "נד", "נדר"]],
  ["נדה", "Niddah", ["נדה"]],
  ["פסחים", "Pesachim", ["פסחים", "פס"]],
  ["ראש השנה", "Rosh Hashanah", ["ראש השנה", "רה", "ר ה"]],
  ["סנהדרין", "Sanhedrin", ["סנהדרין", "סנ", "סנהד"]],
  ["שבת", "Shabbat", ["שבת"]],
  ["שקלים", "Shekalim", ["שקלים", "שק"]],
  ["שבועות", "Shevuot", ["שבועות", "שבו", "שב"]],
  ["סוטה", "Sotah", ["סוטה", "סו"]],
  ["סוכה", "Sukkah", ["סוכה", "סוכ"]],
  ["תענית", "Taanit", ["תענית", "תע"]],
  ["תמיד", "Tamid", ["תמיד", "תמי"]],
  ["תמורה", "Temurah", ["תמורה", "תמו"]],
  ["יבמות", "Yevamot", ["יבמות", "יבמ", "יב"]],
  ["יומא", "Yoma", ["יומא", "יומ"]],
  ["זבחים", "Zevachim", ["זבחים", "זבח"]],
];

const BAVLI = BAVLI_NAMES.map(([heTitle, englishTitle, baseAliases]) => {
  const all = [];
  for (const a of baseAliases) {
    all.push(a);
    all.push(`תלמוד בבלי ${a}`);
    all.push(`בבלי ${a}`);
    all.push(`מסכת ${a}`);
  }
  return E("bavli", heTitle, englishTitle, all);
});

// === Rambam — Mishneh Torah (84 books) ===========================
// Each book in Sefaria is "משנה תורה, הלכות X". Users typically write:
//   "רמב"ם הל' שבת פ"א ה"א" / "רמב"ם שבת פ"א ה"א" / "רמב"ם הלכות שבת"
//   "משנה תורה הלכות שבת א, א"
// We never accept the bare topic name ("שבת") as a Rambam reference — that
// would conflict with Mishnah Shabbat and Bavli Shabbat. The "רמב"ם" /
// "משנה תורה" / "הלכות" prefix is required.
//
// Topic name format taken directly from data.heTitle (verified 2026-05-10):
// "משנה תורה, הלכות X" → topic = "X" (we strip the "משנה תורה, הלכות " prefix).

const RAMBAM_NAMES = [
  ["משנה תורה, הלכות ביאת מקדש", "Mishneh Torah, Admission into the Sanctuary", "ביאת מקדש"],
  ["משנה תורה, הלכות שלוחין ושותפין", "Mishneh Torah, Agents and Partners", "שלוחין ושותפין"],
  ["משנה תורה, הלכות ערכים וחרמין", "Mishneh Torah, Appraisals and Devoted Property", "ערכים וחרמין"],
  ["משנה תורה, הלכות ברכות", "Mishneh Torah, Blessings", "ברכות"],
  ["משנה תורה, הלכות שאלה ופיקדון", "Mishneh Torah, Borrowing and Deposit", "שאלה ופיקדון"],
  ["משנה תורה, הלכות מילה", "Mishneh Torah, Circumcision", "מילה"],
  ["משנה תורה, הלכות מלווה ולווה", "Mishneh Torah, Creditor and Debtor", "מלווה ולווה"],
  ["משנה תורה, הלכות תמידים ומוספין", "Mishneh Torah, Daily Offerings and Additional Offerings", "תמידים ומוספין"],
  ["משנה תורה, הלכות נזקי ממון", "Mishneh Torah, Damages to Property", "נזקי ממון"],
  ["משנה תורה, הלכות טומאת צרעת", "Mishneh Torah, Defilement by Leprosy", "טומאת צרעת"],
  ["משנה תורה, הלכות טומאת מת", "Mishneh Torah, Defilement by a Corpse", "טומאת מת"],
  ["משנה תורה, הלכות טומאת אוכלים", "Mishneh Torah, Defilement of Foods", "טומאת אוכלים"],
  ["משנה תורה, הלכות כלאים", "Mishneh Torah, Diverse Species", "כלאים"],
  ["משנה תורה, הלכות גירושין", "Mishneh Torah, Divorce", "גירושין"],
  ["משנה תורה, הלכות עירובין", "Mishneh Torah, Eruvin", "עירובין"],
  ["משנה תורה, הלכות תעניות", "Mishneh Torah, Fasts", "תעניות"],
  ["משנה תורה, הלכות חגיגה", "Mishneh Torah, Festival Offering", "חגיגה"],
  ["משנה תורה, הלכות ביכורים ושאר מתנות כהונה שבגבולין", "Mishneh Torah, First Fruits and other Gifts to Priests Outside the Sanctuary", "ביכורים"],
  ["משנה תורה, הלכות בכורות", "Mishneh Torah, Firstlings", "בכורות"],
  ["משנה תורה, הלכות מאכלות אסורות", "Mishneh Torah, Forbidden Foods", "מאכלות אסורות"],
  ["משנה תורה, הלכות איסורי ביאה", "Mishneh Torah, Forbidden Intercourse", "איסורי ביאה"],
  ["משנה תורה, הלכות עבודה זרה וחוקות הגויים", "Mishneh Torah, Foreign Worship and Customs of the Nations", "עבודה זרה"],
  ["משנה תורה, הלכות יסודי התורה", "Mishneh Torah, Foundations of the Torah", "יסודי התורה"],
  ["משנה תורה, הלכות ציצית", "Mishneh Torah, Fringes", "ציצית"],
  ["משנה תורה, הלכות מתנות עניים", "Mishneh Torah, Gifts to the Poor", "מתנות עניים"],
  ["משנה תורה, הלכות תרומות", "Mishneh Torah, Heave Offerings", "תרומות"],
  ["משנה תורה, הלכות שכירות", "Mishneh Torah, Hiring", "שכירות"],
  ["משנה תורה, הלכות דעות", "Mishneh Torah, Human Dispositions", "דעות"],
  ["משנה תורה, הלכות מקואות", "Mishneh Torah, Immersion Pools", "מקואות"],
  ["משנה תורה, הלכות נחלות", "Mishneh Torah, Inheritances", "נחלות"],
  ["משנה תורה, הלכות מלכים ומלחמות", "Mishneh Torah, Kings and Wars", "מלכים ומלחמות"],
  ["משנה תורה, הלכות חמץ ומצה", "Mishneh Torah, Leavened and Unleavened Bread", "חמץ ומצה"],
  ["משנה תורה, הלכות יבום וחליצה", "Mishneh Torah, Levirate Marriage and Release", "יבום וחליצה"],
  ["משנה תורה, הלכות אישות", "Mishneh Torah, Marriage", "אישות"],
  ["משנה תורה, הלכות אבל", "Mishneh Torah, Mourning", "אבל"],
  ["משנה תורה, הלכות רוצח ושמירת נפש", "Mishneh Torah, Murderer and the Preservation of Life", "רוצח ושמירת נפש"],
  ["משנה תורה, הלכות נזירות", "Mishneh Torah, Nazariteship", "נזירות"],
  ["משנה תורה, הלכות שכנים", "Mishneh Torah, Neighbors", "שכנים"],
  ["משנה תורה, הלכות שבועות", "Mishneh Torah, Oaths", "שבועות"],
  ["משנה תורה, הלכות מחוסרי כפרה", "Mishneh Torah, Offerings for Those with Incomplete Atonement", "מחוסרי כפרה"],
  ["משנה תורה, הלכות שגגות", "Mishneh Torah, Offerings for Unintentional Transgressions", "שגגות"],
  ["משנה תורה, הלכות חובל ומזיק", "Mishneh Torah, One Who Injures a Person or Property", "חובל ומזיק"],
  ["משנה תורה, הלכות שאר אבות הטומאות", "Mishneh Torah, Other Sources of Defilement", "שאר אבות הטומאות"],
  ["משנה תורה, הלכות זכייה ומתנה", "Mishneh Torah, Ownerless Property and Gifts", "זכייה ומתנה"],
  ["משנה תורה, הלכות קרבן פסח", "Mishneh Torah, Paschal Offering", "קרבן פסח"],
  ["משנה תורה, הלכות טוען ונטען", "Mishneh Torah, Plaintiff and Defendant", "טוען ונטען"],
  ["משנה תורה, הלכות תפילה וברכת כהנים", "Mishneh Torah, Prayer and the Priestly Blessing", "תפילה"],
  ["משנה תורה, הלכות קריאת שמע", "Mishneh Torah, Reading the Shema", "קריאת שמע"],
  ["משנה תורה, הלכות ממרים", "Mishneh Torah, Rebels", "ממרים"],
  ["משנה תורה, הלכות פרה אדומה", "Mishneh Torah, Red Heifer", "פרה אדומה"],
  ["משנה תורה, הלכות תשובה", "Mishneh Torah, Repentance", "תשובה"],
  ["משנה תורה, הלכות שביתת יום טוב", "Mishneh Torah, Rest on a Holiday", "שביתת יום טוב"],
  ["משנה תורה, הלכות שביתת עשור", "Mishneh Torah, Rest on the Tenth of Tishrei", "שביתת עשור"],
  ["משנה תורה, הלכות שחיטה", "Mishneh Torah, Ritual Slaughter", "שחיטה"],
  ["משנה תורה, הלכות גזילה ואבידה", "Mishneh Torah, Robbery and Lost Property", "גזילה ואבידה"],
  ["משנה תורה, הלכות שבת", "Mishneh Torah, Sabbath", "שבת"],
  ["משנה תורה, הלכות שמיטה ויובל", "Mishneh Torah, Sabbatical Year and the Jubilee", "שמיטה ויובל"],
  ["משנה תורה, הלכות פסולי המוקדשין", "Mishneh Torah, Sacrifices Rendered Unfit", "פסולי המוקדשין"],
  ["משנה תורה, הלכות מעשה הקרבנות", "Mishneh Torah, Sacrificial Procedure", "מעשה הקרבנות"],
  ["משנה תורה, הלכות מכירה", "Mishneh Torah, Sales", "מכירה"],
  ["משנה תורה, הלכות קידוש החודש", "Mishneh Torah, Sanctification of the New Month", "קידוש החודש"],
  ["משנה תורה, הלכות מגילה וחנוכה", "Mishneh Torah, Scroll of Esther and Hanukkah", "מגילה וחנוכה"],
  ["משנה תורה, הלכות מעשר שני ונטע רבעי", "Mishneh Torah, Second Tithes and Fourth Year's Fruit", "מעשר שני"],
  ["משנה תורה, הלכות עבודת יום הכפורים", "Mishneh Torah, Service on the Day of Atonement", "עבודת יום הכפורים"],
  ["משנה תורה, הלכות שקלים", "Mishneh Torah, Sheqel Dues", "שקלים"],
  ["משנה תורה, הלכות שופר וסוכה ולולב", "Mishneh Torah, Shofar, Sukkah and Lulav", "שופר וסוכה ולולב"],
  ["משנה תורה, הלכות עבדים", "Mishneh Torah, Slaves", "עבדים"],
  ["משנה תורה, הלכות תמורה", "Mishneh Torah, Substitution", "תמורה"],
  ["משנה תורה, הלכות תפילין ומזוזה וספר תורה", "Mishneh Torah, Tefillin, Mezuzah and the Torah Scroll", "תפילין"],
  ["משנה תורה, הלכות עדות", "Mishneh Torah, Testimony", "עדות"],
  ["משנה תורה, הלכות בית הבחירה", "Mishneh Torah, The Chosen Temple", "בית הבחירה"],
  ["משנה תורה, סדר התפילה", "Mishneh Torah, The Order of Prayer", "סדר התפילה"],
  ["משנה תורה, הלכות סנהדרין והעונשין המסורין להם", "Mishneh Torah, The Sanhedrin and the Penalties within Their Jurisdiction", "סנהדרין"],
  ["משנה תורה, הלכות גניבה", "Mishneh Torah, Theft", "גניבה"],
  ["משנה תורה, הלכות איסורי המזבח", "Mishneh Torah, Things Forbidden on the Altar", "איסורי המזבח"],
  ["משנה תורה, הלכות מטמאי משכב ומושב", "Mishneh Torah, Those Who Defile Bed or Seat", "מטמאי משכב ומושב"],
  ["משנה תורה, הלכות מעשרות", "Mishneh Torah, Tithes", "מעשרות"],
  ["משנה תורה, הלכות תלמוד תורה", "Mishneh Torah, Torah Study", "תלמוד תורה"],
  ["משנה תורה, הלכות מעילה", "Mishneh Torah, Trespass", "מעילה"],
  ["משנה תורה, הלכות כלים", "Mishneh Torah, Vessels", "כלים"],
  ["משנה תורה, הלכות כלי המקדש והעובדין בו", "Mishneh Torah, Vessels of the Sanctuary and Those Who Serve Therein", "כלי המקדש"],
  ["משנה תורה, הלכות נערה בתולה", "Mishneh Torah, Virgin Maiden", "נערה בתולה"],
  ["משנה תורה, הלכות נדרים", "Mishneh Torah, Vows", "נדרים"],
  ["משנה תורה, הלכות סוטה", "Mishneh Torah, Woman Suspected of Infidelity", "סוטה"],
];

const RAMBAM = RAMBAM_NAMES.map(([heTitle, englishTitle, topic]) => {
  // Each topic accepts these prefixes (and ONLY these prefixes — bare topic
  // would conflict with Mishnah/Bavli):
  //   "רמב"ם <topic>" / "רמבם <topic>"
  //   "רמב"ם הלכות <topic>" / "רמב"ם הל <topic>"
  //   "משנה תורה הלכות <topic>" / "משנה תורה <topic>"
  //   The full canonical heTitle.
  const all = [
    `רמבם ${topic}`,
    `רמבם הלכות ${topic}`,
    `רמבם הל ${topic}`,
    `משנה תורה ${topic}`,
    `משנה תורה הלכות ${topic}`,
    heTitle,
  ];
  return E("rambam", heTitle, englishTitle, all);
});

// === Shulchan Arukh (4 chelkim) ==================================
// Standard ראשי-תיבות:
//   או"ח = אורח חיים
//   יו"ד = יורה דעה
//   אה"ע = אבן העזר   (also אבהע"ז)
//   חו"מ = חושן משפט   (also חו"מ, חוש"מ)
// User typically writes "שו"ע או"ח סי' רב סע' א" or "או"ח רב, א".

const SHULCHAN_ARUKH = [
  E("shulchan_arukh", "שולחן ערוך, אורח חיים", "Shulchan Arukh, Orach Chayim", [
    "שולחן ערוך אורח חיים",
    "שוע אורח חיים",
    "שוע אוח",
    "אורח חיים",
    "אוח",
    "שולחן ערוך אוח",
  ]),
  E("shulchan_arukh", "שולחן ערוך, יורה דעה", "Shulchan Arukh, Yoreh De'ah", [
    "שולחן ערוך יורה דעה",
    "שוע יורה דעה",
    "שוע יוד",
    "יורה דעה",
    "יוד",
    "שולחן ערוך יוד",
  ]),
  E("shulchan_arukh", "שולחן ערוך, אבן העזר", "Shulchan Arukh, Even HaEzer", [
    "שולחן ערוך אבן העזר",
    "שוע אבן העזר",
    "שוע אהע",
    "אבן העזר",
    "אהע",
    "אבהעז",
    "שולחן ערוך אהע",
  ]),
  E("shulchan_arukh", "שולחן ערוך, חושן משפט", "Shulchan Arukh, Choshen Mishpat", [
    "שולחן ערוך חושן משפט",
    "שוע חושן משפט",
    "שוע חום",
    "חושן משפט",
    "חום",
    "חושמ",
    "שולחן ערוך חום",
  ]),
];

export const ALL_BOOKS = [...TANAKH, ...MISHNAH, ...BAVLI, ...RAMBAM, ...SHULCHAN_ARUKH];

// Optional helper words the parser can strip *between* book and numbers:
//   "פרק", "פסוק", "משנה" (when used as "פרק א משנה ב"), "דף", "עמוד"
// Kept as a separate set so the parser knows to ignore them, not match them.
// Filler words are normalized through normalizeForAlias before being added to
// the set, so callers can compare against them without re-folding final-form
// letters (סימן→סימנ, סעיף→סעיפ, עמוד→עמוד, etc.).
export const FILLER_WORDS = new Set([
  "פרק", "פר", "פ",
  "פסוק", "פס",
  "משנה", "מש", "מ",
  "דף",
  "עמוד", "עמ", "ע",
  "הלכה", "הלכות", "הל",
  "סימן", "סי",
  "סעיף", "סע",
].map(normalizeForAlias));

// Amud markers in Bavli: ע"א / ע"ב / "." (amud alef) / ":" (amud bet).
// The parser converts the daf+amud combo into the chapter index used by the
// mirror (Sefaria flattens daf:amud into one chapter index per sub-page line).
export const AMUD_ALEF = new Set(["א", "עא", "ע א", "אמוד א"]);
export const AMUD_BET = new Set(["ב", "עב", "ע ב", "אמוד ב"]);
