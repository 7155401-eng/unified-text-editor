// Parse a Hebrew "address" the user has selected — e.g. "מלכים ב ג ד",
// "מלכים ב' ג' ד'", "שמות ג, ד", "תהילים קיט", "משנה ברכות א ב",
// "שבת ב.", "שבת ב ע״א" — into one or more concrete Sefaria refs.
//
// The parser is intentionally loose:
//   • accepts gershayim/geresh/period/colon as decoration; ignores them
//   • accepts both gematria letters (ב, ג, ד) and decimal digits (2 3 4)
//   • walks the longest book-title prefix it can match (so "מלכים ב" is
//     matched as the book title before any chapter/verse parsing happens)
//   • when there is exactly ONE numeric token after the book it returns the
//     whole chapter (chapter-only ref); when two it returns chapter+verse
//
// Returns an array (possibly empty) of:
//   { corpus, heTitle, englishTitle, chapter, verse, label, kind }
// where kind is "verse" or "chapter".
//
// The caller (torah_tools) is responsible for fetching text + presenting
// alternatives if there are several plausible parses.

import { ensureCorpus, listBooks } from "./sefaria_local.js";

const HEB_LETTER_VALUES = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
  "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
};

const DECORATIONS_RE = /[׳״',.\-־:]/g;
const NIQQUD_RE = /[֑-ׇ]/g;

function stripNiqqud(s) {
  return String(s || "").replace(NIQQUD_RE, "");
}

// "ב" → 2, "טו" → 15, "קיט" → 119, "5" → 5.
// Returns null if the token is not a valid numeric in either form.
function parseHebrewNumber(tok) {
  if (!tok) return null;
  const clean = stripNiqqud(tok).replace(DECORATIONS_RE, "").trim();
  if (!clean) return null;
  if (/^\d+$/.test(clean)) {
    const n = parseInt(clean, 10);
    return n > 0 ? n : null;
  }
  if (!/^[א-ת]+$/.test(clean)) return null;
  let total = 0;
  for (const ch of clean) {
    const v = HEB_LETTER_VALUES[ch];
    if (!v) return null;
    total += v;
  }
  return total > 0 ? total : null;
}

function tokenize(text) {
  const stripped = stripNiqqud(text);
  return stripped
    .replace(/[()[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Build a flat list of { corpus, heTitle, englishTitle, words } once per
// parse — book titles are tokenized so we can match multi-word titles like
// "מלכים ב" or "משנה בבא בתרא".
let _bookList = null;
async function getAllBooks() {
  if (_bookList) return _bookList;
  await Promise.all([
    ensureCorpus("tanakh"),
    ensureCorpus("mishnah"),
    ensureCorpus("bavli"),
  ]);
  const list = [];
  for (const corpus of ["tanakh", "mishnah", "bavli"]) {
    for (const { englishTitle, heTitle } of listBooks(corpus)) {
      if (!heTitle) continue;
      list.push({
        corpus,
        heTitle,
        englishTitle,
        words: tokenize(heTitle),
      });
    }
  }
  // Longer titles first so "מלכים ב" wins over "מלכים" when both could match.
  list.sort((a, b) => b.words.length - a.words.length);
  _bookList = list;
  return list;
}

// Try to match the longest book-title prefix at the start of tokens[].
// Returns { book, consumed } where consumed = number of tokens matched, or null.
function matchBookPrefix(tokens, books) {
  for (const book of books) {
    const w = book.words;
    if (tokens.length < w.length) continue;
    let ok = true;
    for (let i = 0; i < w.length; i++) {
      if (tokens[i] !== w[i]) { ok = false; break; }
    }
    if (ok) return { book, consumed: w.length };
  }
  return null;
}

/**
 * Parse a free-form Hebrew reference.
 *
 * Examples returning a single ref:
 *   "מלכים ב ג ד"         → 2 Kings 3:4
 *   "שמות ג, ד"           → Exodus 3:4
 *   "תהילים קיט א"        → Psalms 119:1
 *   "משנה ברכות א ב"      → Mishnah Berakhot 1:2
 *
 * Examples returning a chapter-only ref:
 *   "תהילים קיט"          → Psalms 119 (whole chapter)
 *
 * Returns []  when nothing parseable.
 */
export async function parseUserRef(text) {
  const tokens = tokenize(text);
  if (tokens.length < 2) return [];
  const books = await getAllBooks();

  const matched = matchBookPrefix(tokens, books);
  if (!matched) return [];

  const rest = tokens.slice(matched.consumed);
  const numbers = [];
  for (const tok of rest) {
    const n = parseHebrewNumber(tok);
    if (n !== null) numbers.push(n);
    else break; // stop at the first non-numeric token
  }
  if (numbers.length === 0) return [];

  const { book } = matched;
  const results = [];
  if (numbers.length === 1) {
    results.push({
      corpus: book.corpus,
      heTitle: book.heTitle,
      englishTitle: book.englishTitle,
      chapter: numbers[0],
      verse: null,
      kind: "chapter",
      label: `${book.heTitle} ${numbers[0]}`,
    });
  } else {
    // The common case: chap + verse. We still emit the chapter-only ref as
    // an alternative, so the user can pick "all of chapter X" if needed.
    results.push({
      corpus: book.corpus,
      heTitle: book.heTitle,
      englishTitle: book.englishTitle,
      chapter: numbers[0],
      verse: numbers[1],
      kind: "verse",
      label: `${book.heTitle} ${numbers[0]}:${numbers[1]}`,
    });
    results.push({
      corpus: book.corpus,
      heTitle: book.heTitle,
      englishTitle: book.englishTitle,
      chapter: numbers[0],
      verse: null,
      kind: "chapter",
      label: `${book.heTitle} ${numbers[0]}`,
    });
  }
  return results;
}
