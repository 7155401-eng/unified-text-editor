// Format a Sefaria mirror match into a Hebrew citation string.
// - Tanakh:  "בראשית א, ג"
// - Mishnah: "משנה ברכות פ״א מ״א"
// - Bavli:   "שבת ב ע״א"  (no segment number — Sefaria's segment indexing
//             is editorial and not part of standard rabbinic citation.)

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

// Format a citation for a match returned by searchByText.
// The match shape is { corpus, bookTitle, heTitle, chapter, verse, ... }.
export function formatCitation(match) {
  const heTitle = (match.heTitle || match.bookTitle || "").trim();
  if (match.corpus === "tanakh") {
    return `(${heTitle} ${numberToHebrewLetters(match.chapter)}, ${numberToHebrewLetters(match.verse)})`;
  }
  if (match.corpus === "mishnah") {
    // Sefaria's heTitle for Mishnah works is e.g. "משנה ברכות"; chap=פרק, verse=משנה.
    return `(${heTitle} פ״${numberToHebrewLetters(match.chapter)} מ״${numberToHebrewLetters(match.verse)})`;
  }
  if (match.corpus === "bavli") {
    const { daf, amud } = bavliIndexToDafAmud(match.chapter - 1); // chapter is 1-indexed in match
    return `(${heTitle} ${numberToHebrewLetters(daf)} ע״${amud})`;
  }
  // Fallback for unknown corpora
  return `(${heTitle} ${numberToHebrewLetters(match.chapter)}:${numberToHebrewLetters(match.verse)})`;
}

// Short single-line label used inside the multi-match dialog.
export function formatRefLabel(match) {
  const heTitle = (match.heTitle || match.bookTitle || "").trim();
  if (match.corpus === "tanakh") {
    return `${heTitle} ${numberToHebrewLetters(match.chapter)}, ${numberToHebrewLetters(match.verse)}`;
  }
  if (match.corpus === "mishnah") {
    return `${heTitle} פ״${numberToHebrewLetters(match.chapter)} מ״${numberToHebrewLetters(match.verse)}`;
  }
  if (match.corpus === "bavli") {
    const { daf, amud } = bavliIndexToDafAmud(match.chapter - 1);
    return `${heTitle} ${numberToHebrewLetters(daf)} ע״${amud}`;
  }
  return `${heTitle} ${match.chapter}:${match.verse}`;
}
