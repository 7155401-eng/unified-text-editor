// Format a Sefaria mirror match into a Hebrew citation string.
// - Tanakh:         "בראשית א, ג"        |  whole chapter:  "בראשית א"
// - Mishnah:        "משנה ברכות פ״א מ״א" |  whole chapter:  "משנה ברכות פ״א"
// - Bavli:          "שבת ב ע״א"           |  whole daf:      "שבת ב"
// - Rambam:         "רמב״ם הלכות שבת פ״א ה״א"  |  whole pereq: "רמב״ם הלכות שבת פ״א"
// - Shulchan Arukh: "שו״ע אורח חיים סי׳ רב סע׳ א" | whole siman: "שו״ע אורח חיים סי׳ רב"

const HEB_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const HEB_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];

export function numberToHebrewLetters(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1) return "";
  let out = "";
  let rest = n;
  while (rest >= 400) { out += "ת"; rest -= 400; }
  if (rest >= 100) {
    const h = Math.floor(rest / 100);
    out += "קרש"[h - 1] || "";
    rest = rest % 100;
  }
  if (rest === 15) return out + "טו";
  if (rest === 16) return out + "טז";
  if (rest >= 10) { out += HEB_TENS[Math.floor(rest / 10)]; rest = rest % 10; }
  if (rest > 0) out += HEB_ONES[rest];
  return out;
}

// Convert a 0-indexed Bavli chapters[] index into {daf, amud}.
// In the Sefaria-Export shape, indices 0 and 1 are 1a/1b (empty — Bavli starts at 2a),
// index 2 = 2a, index 3 = 2b, index 4 = 3a, etc.
export function bavliIndexToDafAmud(index0) {
  const daf = Math.floor(index0 / 2) + 1;
  const amud = index0 % 2 === 0 ? "א" : "ב";
  return { daf, amud };
}

function rambamShortTitle(heTitle) {
  // "משנה תורה, הלכות שבת" → "רמב״ם הלכות שבת"
  // "משנה תורה, סדר התפילה" → "רמב״ם סדר התפילה"
  return heTitle.replace(/^משנה תורה, /, "רמב״ם ");
}

function shulchanShortTitle(heTitle) {
  // "שולחן ערוך, אורח חיים" → "שו״ע אורח חיים"
  return heTitle.replace(/^שולחן ערוך, /, "שו״ע ");
}

// Format a citation for a match returned by searchByText.
// The match shape is { corpus, bookTitle, heTitle, chapter, verse, ... }.
// When verse is null/undefined, we render the whole-chapter form.
export function formatCitation(match) {
  const heTitle = (match.heTitle || match.bookTitle || "").trim();
  const wholeChapter = match.verse == null;
  if (match.corpus === "tanakh") {
    return wholeChapter
      ? `(${heTitle} ${numberToHebrewLetters(match.chapter)})`
      : `(${heTitle} ${numberToHebrewLetters(match.chapter)}, ${numberToHebrewLetters(match.verse)})`;
  }
  if (match.corpus === "mishnah") {
    return wholeChapter
      ? `(${heTitle} פ״${numberToHebrewLetters(match.chapter)})`
      : `(${heTitle} פ״${numberToHebrewLetters(match.chapter)} מ״${numberToHebrewLetters(match.verse)})`;
  }
  if (match.corpus === "bavli") {
    const { daf, amud } = bavliIndexToDafAmud(match.chapter - 1);
    return `(${heTitle} ${numberToHebrewLetters(daf)} ע״${amud})`;
  }
  if (match.corpus === "rambam") {
    const short = rambamShortTitle(heTitle);
    return wholeChapter
      ? `(${short} פ״${numberToHebrewLetters(match.chapter)})`
      : `(${short} פ״${numberToHebrewLetters(match.chapter)} ה״${numberToHebrewLetters(match.verse)})`;
  }
  if (match.corpus === "shulchan_arukh") {
    const short = shulchanShortTitle(heTitle);
    return wholeChapter
      ? `(${short} סי׳ ${numberToHebrewLetters(match.chapter)})`
      : `(${short} סי׳ ${numberToHebrewLetters(match.chapter)} סע׳ ${numberToHebrewLetters(match.verse)})`;
  }
  return `(${heTitle} ${numberToHebrewLetters(match.chapter)}:${numberToHebrewLetters(match.verse)})`;
}

// Short single-line label used inside the multi-match dialog.
export function formatRefLabel(match) {
  const heTitle = (match.heTitle || match.bookTitle || "").trim();
  const wholeChapter = match.verse == null;
  if (match.corpus === "tanakh") {
    return wholeChapter
      ? `${heTitle} ${numberToHebrewLetters(match.chapter)}`
      : `${heTitle} ${numberToHebrewLetters(match.chapter)}, ${numberToHebrewLetters(match.verse)}`;
  }
  if (match.corpus === "mishnah") {
    return wholeChapter
      ? `${heTitle} פ״${numberToHebrewLetters(match.chapter)}`
      : `${heTitle} פ״${numberToHebrewLetters(match.chapter)} מ״${numberToHebrewLetters(match.verse)}`;
  }
  if (match.corpus === "bavli") {
    const { daf, amud } = bavliIndexToDafAmud(match.chapter - 1);
    return `${heTitle} ${numberToHebrewLetters(daf)} ע״${amud}`;
  }
  if (match.corpus === "rambam") {
    const short = rambamShortTitle(heTitle);
    return wholeChapter
      ? `${short} פ״${numberToHebrewLetters(match.chapter)}`
      : `${short} פ״${numberToHebrewLetters(match.chapter)} ה״${numberToHebrewLetters(match.verse)}`;
  }
  if (match.corpus === "shulchan_arukh") {
    const short = shulchanShortTitle(heTitle);
    return wholeChapter
      ? `${short} סי׳ ${numberToHebrewLetters(match.chapter)}`
      : `${short} סי׳ ${numberToHebrewLetters(match.chapter)} סע׳ ${numberToHebrewLetters(match.verse)}`;
  }
  return `${heTitle} ${match.chapter}:${match.verse}`;
}
