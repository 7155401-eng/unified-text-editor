// sefaria_book_metadata.js — verbatim port of sefaria_book_metadata.py.
// 119 books across 4 categories (Tanakh 39, Bavli 37, Yerushalmi 39,
// Shulchan Arukh 4) + 30 commentators + LAYOUT_PRESETS + fuzzy match.

// ──────────────────────────────────────────────────────────────────────
// Book type IDs
// ──────────────────────────────────────────────────────────────────────
export const BOOK_TYPE_TANAKH = 1;
export const BOOK_TYPE_BAVLI = 2;
export const BOOK_TYPE_YERUSHALMI = 3;
export const BOOK_TYPE_SHULCHAN_ARUKH = 4;

export const BOOK_TYPE_HEB = {
  [BOOK_TYPE_TANAKH]: "תנ\"ך",
  [BOOK_TYPE_BAVLI]: "תלמוד בבלי",
  [BOOK_TYPE_YERUSHALMI]: "תלמוד ירושלמי",
  [BOOK_TYPE_SHULCHAN_ARUKH]: "שולחן ערוך",
};

// ──────────────────────────────────────────────────────────────────────
// Tanakh — 39 books
// ──────────────────────────────────────────────────────────────────────
export const TANAKH_BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy",
  "Joshua", "Judges", "I Samuel", "II Samuel", "I Kings", "II Kings",
  "Isaiah", "Jeremiah", "Ezekiel",
  "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum",
  "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi",
  "Psalms", "Proverbs", "Job", "Song of Songs", "Ruth",
  "Lamentations", "Ecclesiastes", "Esther", "Daniel",
  "Ezra", "Nehemiah", "I Chronicles", "II Chronicles",
];

export const TANAKH_HEB = {
  "Genesis": "בראשית", "Exodus": "שמות", "Leviticus": "ויקרא",
  "Numbers": "במדבר", "Deuteronomy": "דברים",
  "Joshua": "יהושע", "Judges": "שופטים",
  "I Samuel": "שמואל א", "II Samuel": "שמואל ב",
  "I Kings": "מלכים א", "II Kings": "מלכים ב",
  "Isaiah": "ישעיה", "Jeremiah": "ירמיה", "Ezekiel": "יחזקאל",
  "Hosea": "הושע", "Joel": "יואל", "Amos": "עמוס", "Obadiah": "עובדיה",
  "Jonah": "יונה", "Micah": "מיכה", "Nahum": "נחום",
  "Habakkuk": "חבקוק", "Zephaniah": "צפניה", "Haggai": "חגי",
  "Zechariah": "זכריה", "Malachi": "מלאכי",
  "Psalms": "תהילים", "Proverbs": "משלי", "Job": "איוב",
  "Song of Songs": "שיר השירים", "Ruth": "רות",
  "Lamentations": "איכה", "Ecclesiastes": "קהלת", "Esther": "אסתר",
  "Daniel": "דניאל", "Ezra": "עזרא", "Nehemiah": "נחמיה",
  "I Chronicles": "דברי הימים א", "II Chronicles": "דברי הימים ב",
};

// ──────────────────────────────────────────────────────────────────────
// Talmud Bavli — 37 tractates
// ──────────────────────────────────────────────────────────────────────
export const BAVLI_TRACTATES = [
  "Berakhot", "Shabbat", "Eruvin", "Pesachim", "Rosh Hashanah",
  "Yoma", "Sukkah", "Beitzah", "Taanit", "Megillah", "Moed Katan",
  "Chagigah", "Yevamot", "Ketubot", "Nedarim", "Nazir", "Sotah",
  "Gittin", "Kiddushin", "Bava Kamma", "Bava Metzia", "Bava Batra",
  "Sanhedrin", "Makkot", "Shevuot", "Avodah Zarah", "Horayot",
  "Zevachim", "Menachot", "Chullin", "Bekhorot", "Arakhin", "Temurah",
  "Keritot", "Meilah", "Tamid", "Niddah",
];

export const BAVLI_HEB = {
  "Berakhot": "ברכות", "Shabbat": "שבת", "Eruvin": "עירובין",
  "Pesachim": "פסחים", "Rosh Hashanah": "ראש השנה", "Yoma": "יומא",
  "Sukkah": "סוכה", "Beitzah": "ביצה", "Taanit": "תענית",
  "Megillah": "מגילה", "Moed Katan": "מועד קטן", "Chagigah": "חגיגה",
  "Yevamot": "יבמות", "Ketubot": "כתובות", "Nedarim": "נדרים",
  "Nazir": "נזיר", "Sotah": "סוטה", "Gittin": "גיטין",
  "Kiddushin": "קידושין", "Bava Kamma": "בבא קמא",
  "Bava Metzia": "בבא מציעא", "Bava Batra": "בבא בתרא",
  "Sanhedrin": "סנהדרין", "Makkot": "מכות", "Shevuot": "שבועות",
  "Avodah Zarah": "עבודה זרה", "Horayot": "הוריות",
  "Zevachim": "זבחים", "Menachot": "מנחות", "Chullin": "חולין",
  "Bekhorot": "בכורות", "Arakhin": "ערכין", "Temurah": "תמורה",
  "Keritot": "כריתות", "Meilah": "מעילה", "Tamid": "תמיד",
  "Niddah": "נדה",
};

// ──────────────────────────────────────────────────────────────────────
// Talmud Yerushalmi — 39 tractates
// ──────────────────────────────────────────────────────────────────────
export const YERUSHALMI_TRACTATES = [
  "Jerusalem Talmud Berakhot", "Jerusalem Talmud Peah",
  "Jerusalem Talmud Demai", "Jerusalem Talmud Kilayim",
  "Jerusalem Talmud Sheviit", "Jerusalem Talmud Terumot",
  "Jerusalem Talmud Maasrot", "Jerusalem Talmud Maaser Sheni",
  "Jerusalem Talmud Challah", "Jerusalem Talmud Orlah",
  "Jerusalem Talmud Bikkurim", "Jerusalem Talmud Shabbat",
  "Jerusalem Talmud Eruvin", "Jerusalem Talmud Pesachim",
  "Jerusalem Talmud Yoma", "Jerusalem Talmud Sukkah",
  "Jerusalem Talmud Beitzah", "Jerusalem Talmud Rosh Hashanah",
  "Jerusalem Talmud Taanit", "Jerusalem Talmud Megillah",
  "Jerusalem Talmud Chagigah", "Jerusalem Talmud Moed Katan",
  "Jerusalem Talmud Yevamot", "Jerusalem Talmud Ketubot",
  "Jerusalem Talmud Nedarim", "Jerusalem Talmud Nazir",
  "Jerusalem Talmud Sotah", "Jerusalem Talmud Gittin",
  "Jerusalem Talmud Kiddushin", "Jerusalem Talmud Bava Kamma",
  "Jerusalem Talmud Bava Metzia", "Jerusalem Talmud Bava Batra",
  "Jerusalem Talmud Sanhedrin", "Jerusalem Talmud Makkot",
  "Jerusalem Talmud Shevuot", "Jerusalem Talmud Avodah Zarah",
  "Jerusalem Talmud Horayot", "Jerusalem Talmud Niddah",
  "Jerusalem Talmud Shekalim",
];

export const YERUSHALMI_HEB = (function () {
  const out = {};
  for (const b of BAVLI_TRACTATES) {
    out["Jerusalem Talmud " + b] = "ירושלמי " + (BAVLI_HEB[b] || b);
  }
  out["Jerusalem Talmud Peah"] = "ירושלמי פאה";
  out["Jerusalem Talmud Demai"] = "ירושלמי דמאי";
  out["Jerusalem Talmud Kilayim"] = "ירושלמי כלאים";
  out["Jerusalem Talmud Sheviit"] = "ירושלמי שביעית";
  out["Jerusalem Talmud Terumot"] = "ירושלמי תרומות";
  out["Jerusalem Talmud Maasrot"] = "ירושלמי מעשרות";
  out["Jerusalem Talmud Maaser Sheni"] = "ירושלמי מעשר שני";
  out["Jerusalem Talmud Challah"] = "ירושלמי חלה";
  out["Jerusalem Talmud Orlah"] = "ירושלמי ערלה";
  out["Jerusalem Talmud Bikkurim"] = "ירושלמי ביכורים";
  out["Jerusalem Talmud Shekalim"] = "ירושלמי שקלים";
  return out;
})();

// ──────────────────────────────────────────────────────────────────────
// Shulchan Arukh — 4 sections
// ──────────────────────────────────────────────────────────────────────
export const SHULCHAN_ARUKH_SECTIONS = [
  "Shulchan Arukh, Orach Chayim",
  "Shulchan Arukh, Yoreh De'ah",
  "Shulchan Arukh, Even HaEzer",
  "Shulchan Arukh, Choshen Mishpat",
];

export const SHULCHAN_ARUKH_HEB = {
  "Shulchan Arukh, Orach Chayim": "שולחן ערוך אורח חיים",
  "Shulchan Arukh, Yoreh De'ah": "שולחן ערוך יורה דעה",
  "Shulchan Arukh, Even HaEzer": "שולחן ערוך אבן העזר",
  "Shulchan Arukh, Choshen Mishpat": "שולחן ערוך חושן משפט",
};

// ──────────────────────────────────────────────────────────────────────
// Combined book → type map
// ──────────────────────────────────────────────────────────────────────
export const BOOK_TYPE_MAP = (function () {
  const m = {};
  for (const b of TANAKH_BOOKS) m[b] = BOOK_TYPE_TANAKH;
  for (const b of BAVLI_TRACTATES) m[b] = BOOK_TYPE_BAVLI;
  for (const b of YERUSHALMI_TRACTATES) m[b] = BOOK_TYPE_YERUSHALMI;
  for (const b of SHULCHAN_ARUKH_SECTIONS) m[b] = BOOK_TYPE_SHULCHAN_ARUKH;
  return m;
})();

export function getBookType(bookName) {
  if (!bookName) return BOOK_TYPE_TANAKH;
  if (Object.prototype.hasOwnProperty.call(BOOK_TYPE_MAP, bookName)) {
    return BOOK_TYPE_MAP[bookName];
  }
  if (bookName.indexOf("Shulchan Arukh") !== -1) return BOOK_TYPE_SHULCHAN_ARUKH;
  if (bookName.indexOf("Jerusalem Talmud") === 0) return BOOK_TYPE_YERUSHALMI;
  return BOOK_TYPE_TANAKH;
}

export function getHebrewName(bookName) {
  return (
    TANAKH_HEB[bookName]
    || BAVLI_HEB[bookName]
    || YERUSHALMI_HEB[bookName]
    || SHULCHAN_ARUKH_HEB[bookName]
    || bookName
  );
}

// ──────────────────────────────────────────────────────────────────────
// Layout presets per book type
// ──────────────────────────────────────────────────────────────────────
export const LAYOUT_PRESETS = {
  [BOOK_TYPE_TANAKH]: {
    main_cols: "1",
    footnote_layout: "twocol",
    rtl: true,
    vowels_default: true,
    cantillation_default: true,
    default_font: "David",
    main_parskip_pt: 0,
    lettrine: false,
  },
  [BOOK_TYPE_BAVLI]: {
    main_cols: "1",
    footnote_layout: "twocol",
    rtl: true,
    vowels_default: false,
    cantillation_default: false,
    default_font: "David",
    main_parskip_pt: 4,
    lettrine: false,
  },
  [BOOK_TYPE_YERUSHALMI]: {
    main_cols: "1",
    footnote_layout: "twocol",
    rtl: true,
    vowels_default: false,
    cantillation_default: false,
    default_font: "David",
    main_parskip_pt: 4,
    lettrine: false,
  },
  [BOOK_TYPE_SHULCHAN_ARUKH]: {
    main_cols: "1",
    footnote_layout: "twocol",
    rtl: true,
    vowels_default: false,
    cantillation_default: false,
    default_font: "David",
    main_parskip_pt: 2,
    lettrine: false,
  },
};

// ──────────────────────────────────────────────────────────────────────
// Commentators — 30 entries with color + Hebrew name + font preference
// ──────────────────────────────────────────────────────────────────────
export const COMMENTATOR_INFO = {
  // Tanakh
  "Rashi":           { heb: "רש\"י",         color: "#F4A460", font_pref: "Guttman Rashi" },
  "Ibn Ezra":        { heb: "אבן עזרא",      color: "#90EE90", font_pref: null },
  "Ramban":          { heb: "רמב\"ן",        color: "#87CEEB", font_pref: null },
  "Sforno":          { heb: "ספורנו",        color: "#DDA0DD", font_pref: null },
  "Onkelos":         { heb: "אונקלוס",       color: "#FFD700", font_pref: null },
  "Targum Jonathan": { heb: "תרגום יונתן",   color: "#FFB6C1", font_pref: null },
  "Rashbam":         { heb: "רשב\"ם",        color: "#F0E68C", font_pref: "Guttman Rashi" },
  "Radak":           { heb: "רד\"ק",         color: "#98FB98", font_pref: null },
  "Or HaChaim":      { heb: "אור החיים",     color: "#E6E6FA", font_pref: null },
  "Kli Yakar":       { heb: "כלי יקר",       color: "#FFDAB9", font_pref: null },
  "Chizkuni":        { heb: "חזקוני",        color: "#B0E0E6", font_pref: null },
  "Bekhor Shor":     { heb: "בכור שור",      color: "#F5DEB3", font_pref: null },
  "Daat Zkenim":     { heb: "דעת זקנים",     color: "#D8BFD8", font_pref: null },
  "Metzudat David":  { heb: "מצודת דוד",     color: "#AFEEEE", font_pref: null },
  "Metzudat Zion":   { heb: "מצודת ציון",    color: "#FAFAD2", font_pref: null },
  "Malbim":          { heb: "מלבי\"ם",       color: "#F08080", font_pref: null },
  // Bavli
  "Tosafot":         { heb: "תוספות",        color: "#FFA07A", font_pref: "Guttman Rashi" },
  "Rashba":          { heb: "רשב\"א",        color: "#9370DB", font_pref: null },
  "Ritva":           { heb: "ריטב\"א",       color: "#20B2AA", font_pref: null },
  "Maharsha":        { heb: "מהרש\"א",       color: "#CD853F", font_pref: null },
  "Rosh":            { heb: "רא\"ש",         color: "#DA70D6", font_pref: null },
  "Tosafot Yom Tov": { heb: "תוספות יום טוב", color: "#7FFFD4", font_pref: null },
  // Shulchan Arukh
  "Mishnah Berurah": { heb: "משנה ברורה",    color: "#BA55D3", font_pref: null },
  "Be'er Heitev":    { heb: "באר היטב",      color: "#48D1CC", font_pref: null },
  "Beur Halacha":    { heb: "ביאור הלכה",    color: "#FF7F50", font_pref: null },
  "Magen Avraham":   { heb: "מגן אברהם",     color: "#9ACD32", font_pref: null },
  "Taz":             { heb: "ט\"ז",          color: "#FF6347", font_pref: null },
  "Shach":           { heb: "ש\"ך",          color: "#40E0D0", font_pref: null },
  "Pri Megadim":     { heb: "פרי מגדים",     color: "#EE82EE", font_pref: null },
  "Aruch HaShulchan": { heb: "ערוך השולחן",  color: "#6495ED", font_pref: null },
};

export function getCommentatorInfo(title) {
  if (!title) return { heb: "", color: "#A9A9A9", font_pref: null };
  if (Object.prototype.hasOwnProperty.call(COMMENTATOR_INFO, title)) {
    return COMMENTATOR_INFO[title];
  }
  const low = title.toLowerCase();
  for (const name of Object.keys(COMMENTATOR_INFO)) {
    const info = COMMENTATOR_INFO[name];
    const nlow = name.toLowerCase();
    if (nlow.indexOf(low) !== -1 || low.indexOf(nlow) !== -1) return info;
    if (info.heb && title.indexOf(info.heb) !== -1) return info;
  }
  return { heb: title, color: "#A9A9A9", font_pref: null };
}

export function getDefaultFont(fontPref) {
  // Browser cannot enumerate installed fonts. Return David fallback.
  // The first preferred candidate is recorded for documentation only;
  // Word docx uses the font name verbatim on the user's machine.
  return fontPref || "David";
}

// ──────────────────────────────────────────────────────────────────────
// Persistent paths — adapted to browser localStorage / IndexedDB.
// In the JS port we don't write to the filesystem; the originals returned
// concrete paths used by sefaria_api_client for sqlite cache and log
// files. Here we expose the same names but they map to localStorage keys.
// ──────────────────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  user_presets: "ravtext.sefaria.user_presets",
  favorites: "ravtext.sefaria.favorites",
  recent: "ravtext.sefaria.recent",
  errors_log: "ravtext.sefaria.errors_log",
};

export function favoritesPath() { return STORAGE_KEYS.favorites; }
export function recentPath() { return STORAGE_KEYS.recent; }
export function errorsLogPath() { return STORAGE_KEYS.errors_log; }

// imports_dir is only meaningful in the desktop app; in the browser the
// downloaded .docx is offered via Blob+download.
export function importsDir() {
  return "(browser download)";
}
