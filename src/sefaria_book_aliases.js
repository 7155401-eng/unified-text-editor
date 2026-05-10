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

export const ALL_BOOKS = [...TANAKH, ...MISHNAH, ...BAVLI];

// Optional helper words the parser can strip *between* book and numbers:
//   "פרק", "פסוק", "משנה" (when used as "פרק א משנה ב"), "דף", "עמוד"
// Kept as a separate set so the parser knows to ignore them, not match them.
export const FILLER_WORDS = new Set([
  "פרק", "פר", "פ",
  "פסוק", "פס",
  "משנה", "מש", "מ",
  "דף",
  "עמוד", "עמ", "ע",
  "הלכה", "הל",
  "סימן", "סי",
  "סעיף", "סע",
]);

// Amud markers in Bavli: ע"א / ע"ב / "." (amud alef) / ":" (amud bet).
// The parser converts the daf+amud combo into the chapter index used by the
// mirror (Sefaria flattens daf:amud into one chapter index per sub-page line).
export const AMUD_ALEF = new Set(["א", "עא", "ע א", "אמוד א"]);
export const AMUD_BET = new Set(["ב", "עב", "ע ב", "אמוד ב"]);
