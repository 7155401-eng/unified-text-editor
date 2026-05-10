// Smart Hebrew citation parser.
//
// Goal: accept any of the dozen-plus ways a real-world Hebrew citation can be
// written and return one or more concrete Sefaria refs. We rely on an explicit
// alias map (sefaria_book_aliases.js) rather than fuzzy matching — every form
// the parser accepts is enumerated, which makes both behavior and debugging
// predictable.
//
// Supported styles (each can use gershayim, geresh, period, comma, colon,
// hyphen interchangeably; gematria letters or arabic digits for numbers):
//
//   Tanakh:
//     "מלכים ב ג ד"         "מלכים ב' ג' ד'"     "מל"ב ג, ד"      "מ"ב ג:ד"
//     "תהילים קיט"          "תה' קיט א"          "ישעיה ג, ד"
//     "בראשית פרק א פסוק א" "בראשית א:א"
//
//   Mishnah:
//     "משנה ברכות א ב"      "ברכות א:ב"          "מ' ברכות פ"א מ"ב"
//     "אבות א, א"           "פרקי אבות א"
//
//   Bavli:
//     "שבת ב."             "שבת ב:"             "שבת ב ע"א"      "שבת ב ע״ב"
//     "ב"מ ג."             "תלמוד בבלי שבת ד"   "מסכת ברכות ב."
//
// When a citation is ambiguous (e.g. "ברכות א ב" could be Mishnah Berakhot
// 1:2 or Bavli Berakhot daf 1 line 2) we return ALL plausible candidates and
// let the user pick.

import { ensureCorpus } from "./sefaria_local.js";
import { ALL_BOOKS, FILLER_WORDS, AMUD_ALEF, AMUD_BET, normalizeForAlias } from "./sefaria_book_aliases.js";

const HEB_LETTER_VALUES = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50,
  "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
};

// Tokens we treat as a "number-token" only when they appear after a book name
// in a position where a number is expected. Keeping a tight allowlist avoids
// turning every Hebrew word into a gematria value (e.g. "שלום" = 376).
const HEB_NUM_RE = /^[א-ת]{1,5}$/;

function gematria(tok) {
  let total = 0;
  for (const ch of tok) {
    const v = HEB_LETTER_VALUES[ch];
    if (!v) return null;
    total += v;
  }
  return total > 0 ? total : null;
}

function tryParseNumber(tok) {
  if (!tok) return null;
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  if (!HEB_NUM_RE.test(tok)) return null;
  // Cap at 1000 — covers every realistic chapter/verse/siman/daf:
  //   Tanakh max chapter = 150 (Psalms), Bavli max daf = 176 (Bava Batra),
  //   Mishnah max chapter = ~14, Rambam max chapter = ~30, SU max siman = 697.
  // Tokens beyond 1000 are almost certainly not citations.
  const n = gematria(tok);
  if (n === null) return null;
  if (n > 1000) return null;
  return n;
}

function stripDecorations(text) {
  // Strip niqqud, gershayim, apostrophes, parens; turn punctuation into spaces.
  // We DON'T strip period/colon yet — those carry meaning for Bavli amud.
  return String(text || "")
    .replace(/[֑-ׇ]/g, "")        // niqqud + cantillation
    .replace(/[׳״'"`]/g, "")      // gershayim/geresh/apostrophes
    .replace(/[‎‏]/g, "") // LRM/RLM marks
    .replace(/[(){}\[\]]/g, " ")
    .replace(/[\-־–—‐‑‒]/g, " ")  // ASCII hyphen, maqaf, en/em-dash, hyphen variants
    .replace(/,/g, " ")
    .replace(/;/g, " ")
    .trim();
}

// Tokenize while preserving "." and ":" as their own tokens — Bavli amud
// markers depend on them. Outside Bavli context, the parser ignores them.
function tokenize(text) {
  const cleaned = stripDecorations(text);
  // Split on whitespace, then split tokens that have trailing . or :
  const out = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    let cur = raw;
    let trailing = "";
    while (cur.endsWith(".") || cur.endsWith(":")) {
      trailing = cur.slice(-1) + trailing;
      cur = cur.slice(0, -1);
    }
    if (cur) out.push(cur);
    for (const t of trailing) out.push(t);
  }
  return out;
}

// Build flat lookup arrays from the alias table:
//   - by token-length, longest first (so multi-word titles win)
//   - keyed on the joined token sequence
let _aliasIndex = null;
function buildAliasIndex() {
  if (_aliasIndex) return _aliasIndex;
  // Map<int length, Map<string joined, BookEntry[]>>
  const byLen = new Map();
  for (const book of ALL_BOOKS) {
    for (const seq of book.aliases) {
      if (seq.length === 0) continue;
      const key = seq.join(" ");
      let m = byLen.get(seq.length);
      if (!m) { m = new Map(); byLen.set(seq.length, m); }
      let arr = m.get(key);
      if (!arr) { arr = []; m.set(key, arr); }
      arr.push(book);
    }
  }
  // Lengths in descending order — try the longest matches first.
  const lengths = [...byLen.keys()].sort((a, b) => b - a);
  _aliasIndex = { byLen, lengths };
  return _aliasIndex;
}

// Try to match a book at the start of `tokens`. Returns ALL books whose alias
// matches the longest possible prefix (multiple if alias is shared, e.g.
// "ברכות" matches both Mishnah Berakhot and Bavli Berakhot). Returns
// { books: BookEntry[], consumed: number } or null.
function matchBookPrefix(tokens) {
  const { byLen, lengths } = buildAliasIndex();
  for (const L of lengths) {
    if (tokens.length < L) continue;
    const key = tokens.slice(0, L).join(" ");
    const hits = byLen.get(L).get(key);
    if (hits && hits.length > 0) {
      return { books: hits, consumed: L };
    }
  }
  return null;
}

// Compact filler+number forms common in halachic citation:
//   "פ"א" → after gershayim strip → "פא" → meaning "פרק א" → number 1
//   "מ"ב" → "מב" → "משנה ב" → 2
//   "ה"ג" → "הג" → "הלכה ג" → 3
//   "סי'רב" / "סי״רב" → after strip → "סירב" — also handled here.
// Maps the two-letter tokens like פ+digit, מ+digit, ה+digit, ס+digit when the
// suffix is a single Hebrew letter (1-9 in gematria). Two-letter form is the
// classic style; three-letter forms like "פרק" / "משנה" / "הלכה" go through
// FILLER_WORDS instead.
const COMPACT_FILLER_PREFIX = new Set(["פ", "מ", "ה", "ס", "ע"]);

function expandCompactFiller(tok) {
  if (tok.length !== 2) return null;
  const prefix = tok[0];
  const tail = tok[1];
  if (!COMPACT_FILLER_PREFIX.has(prefix)) return null;
  // Tail must be a single Hebrew letter that is also a 1-9 unit gematria value.
  // Specifically: not a tens letter (י/כ/ל/מ/נ/ס/ע/פ/צ) — those would imply
  // a real two-letter number like "מב" = 42, not "פרק 2".
  const tailVal = HEB_LETTER_VALUES[tail];
  if (tailVal === undefined || tailVal < 1 || tailVal > 9) return null;
  return tailVal;
}

// Read up to two number-tokens from `tokens`, skipping FILLER_WORDS and
// "." / ":" tokens (which are amud markers handled separately for Bavli).
// Returns { numbers: number[], amudHint: "א"|"ב"|null, consumed: number }.
// allowCompact is true only for rambam/shulchan_arukh — for Tanakh, "תהילים פב"
// must parse as chapter 82, not "פרק ב" = 2.
function readNumbersAndAmud(tokens, isBavli, allowCompact = false) {
  const numbers = [];
  let amudHint = null;
  let i = 0;
  while (i < tokens.length && numbers.length < 3) {
    const t = tokens[i];
    if (t === ".") {
      if (isBavli) amudHint = amudHint || "א";
      i++;
      continue;
    }
    if (t === ":") {
      if (isBavli) amudHint = amudHint || "ב";
      i++;
      continue;
    }
    if (FILLER_WORDS.has(t)) {
      i++;
      continue;
    }
    // Compact form: "פא" / "מב" / "הג" — equivalent to "פרק א" / "משנה ב" / "הלכה ג".
    if (allowCompact) {
      const compact = expandCompactFiller(t);
      if (compact !== null) {
        numbers.push(compact);
        i++;
        continue;
      }
    }
    // Bavli amud markers as words: "ע"א" (which after stripping gershayim
    // becomes the two tokens "ע" + "א") or just the single token "עא"/"עב".
    if (isBavli && (t === "עא" || t === "אמוד")) {
      amudHint = "א";
      i++;
      // skip the 'א' that may follow "אמוד"
      if (tokens[i] === "א") i++;
      continue;
    }
    if (isBavli && (t === "עב")) {
      amudHint = "ב";
      i++;
      continue;
    }
    if (isBavli && t === "ע" && (tokens[i + 1] === "א" || tokens[i + 1] === "ב")) {
      amudHint = tokens[i + 1];
      i += 2;
      continue;
    }
    const n = tryParseNumber(t);
    if (n !== null) {
      numbers.push(n);
      i++;
      continue;
    }
    // Unknown token after the book → stop reading further numbers.
    break;
  }
  return { numbers, amudHint, consumed: i };
}

/**
 * Parse a free-form Hebrew citation. Returns an array of candidate refs.
 *
 * @param {string} text  the user's selected text (or any free-form citation)
 * @returns {Promise<Array<{
 *   corpus: "tanakh"|"mishnah"|"bavli",
 *   heTitle: string, englishTitle: string,
 *   chapter: number, verse: number|null, kind: "verse"|"chapter",
 *   label: string,
 * }>>}
 */
export async function parseUserRef(text) {
  // Make sure all corpora are loaded so callers can fetch any candidate.
  await Promise.all([
    ensureCorpus("tanakh"),
    ensureCorpus("mishnah"),
    ensureCorpus("bavli"),
  ]);
  return parseUserRefSync(text);
}

// Pure synchronous parsing — no corpus access. Exposed for unit tests and
// for callers that already loaded the corpora elsewhere.
export function parseUserRefSync(text) {
  const norm = normalizeForAlias(text);
  if (!norm) return [];
  const tokens = tokenize(norm);
  if (tokens.length < 2) return [];
  const matched = matchBookPrefix(tokens);
  if (!matched) return [];

  const rest = tokens.slice(matched.consumed);

  // For each candidate book the alias matched, read numbers in the style that
  // book's corpus expects (Bavli understands amud, others don't).
  const out = [];
  for (const book of matched.books) {
    const isBavli = book.corpus === "bavli";
    // Compact filler ("פא" → 1 from "פרק א") is enabled only for Rambam.
    // For Shulchan Arukh "פז" must remain 87 (a real siman), not "פרק 7".
    // For Tanakh "תהילים פב" must remain 82, not 2.
    const allowCompact = book.corpus === "rambam";
    const { numbers, amudHint } = readNumbersAndAmud(rest, isBavli, allowCompact);

    if (numbers.length === 0) {
      // Book name only — no numbers. Skip this candidate; we don't insert
      // entire books.
      continue;
    }

    if (isBavli) {
      // Bavli mirror's chapter index = (daf - 1) * 2 + amudOffset, but ours
      // is actually flat-by-daf (chapter[daf] holds all segments of that daf).
      // We use chapter = daf, verse = numbers[1] || 1.
      // (When the user supplies amud "ב", we still pass the daf as chapter —
      // segment numbering is already amud-agnostic in the mirror.)
      const daf = numbers[0];
      const seg = numbers[1] != null ? numbers[1] : 1;
      // amudHint isn't used for the chapter index in our current mirror, but
      // we keep it in the label so the user sees the citation back.
      const label = `${book.heTitle} ${dafLabel(daf, amudHint)}`;
      out.push({
        corpus: book.corpus,
        heTitle: book.heTitle,
        englishTitle: book.englishTitle,
        chapter: daf,
        verse: seg,
        kind: "verse",
        label,
      });
      continue;
    }

    // Tanakh + Mishnah: numbers[0] = chapter, numbers[1] = verse (if present).
    const chapter = numbers[0];
    if (numbers.length === 1) {
      out.push({
        corpus: book.corpus,
        heTitle: book.heTitle,
        englishTitle: book.englishTitle,
        chapter,
        verse: null,
        kind: "chapter",
        label: `${book.heTitle} ${chapter}`,
      });
    } else {
      const verse = numbers[1];
      out.push({
        corpus: book.corpus,
        heTitle: book.heTitle,
        englishTitle: book.englishTitle,
        chapter,
        verse,
        kind: "verse",
        label: `${book.heTitle} ${chapter}:${verse}`,
      });
      // Also offer the whole-chapter alternative — useful when the user
      // wrote two numbers but actually wanted "chapter X verses Y onward".
      out.push({
        corpus: book.corpus,
        heTitle: book.heTitle,
        englishTitle: book.englishTitle,
        chapter,
        verse: null,
        kind: "chapter",
        label: `${book.heTitle} ${chapter}`,
      });
    }
  }
  // De-duplicate (same book + chapter + verse may appear twice if multiple
  // aliases pointed at the same canonical entry).
  const seen = new Set();
  return out.filter((c) => {
    const k = `${c.corpus}::${c.heTitle}::${c.chapter}::${c.verse}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dafLabel(daf, amudHint) {
  // Display "ב." for amud א, "ב:" for amud ב; bare daf if no hint given.
  if (amudHint === "א") return `${daf}.`;
  if (amudHint === "ב") return `${daf}:`;
  return String(daf);
}
