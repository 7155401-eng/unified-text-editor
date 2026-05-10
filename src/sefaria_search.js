// Sefaria-mirror search — finds which canonical reference(s) a Hebrew snippet
// belongs to. Operates over the in-memory Tanakh / Mishnah / Bavli corpora
// loaded by sefaria_local.js. Two match types are reported:
//
//   "selection-in-verse" — the user's selection is a substring of a verse
//                          (the user picked a fragment of a known passage)
//   "verse-in-selection" — a verse is a substring of the user's selection
//                          (the user picked a wider span; the verse is inside it)
//
// Memory rule (feedback_sefaria_tools_use_local_mirror): no network calls;
// everything runs against the local mirror.

import { ensureCorpus } from "./sefaria_local.js";

const CORPORA = ["tanakh", "mishnah", "bavli", "rambam", "shulchan_arukh"];
const _normalizedCache = new Map(); // book.title → { chapters: string[][] } of normalized text

// Reverse index: word → array of [bookKey, chapterIdx, verseIdx] tuples.
// Built lazily per (corpus, book, chapter, verse) the first time it is queried.
// "bookKey" is `${corpusName}::${bookTitleEn}` so the entry is uniquely findable.
// Frequent common words like "את" or "בן" produce huge lists, so the search
// picks the rarest query word as the anchor and uses its list as the candidate
// pool — typically a few hundred verses instead of half a million.
const _wordIndex = new Map(); // word → number[]  (packed: book_id*1e8 + chap*1e4 + verse)
const _bookKeyToIdx = new Map(); // bookKey → small integer id
const _bookIdxToInfo = []; // [{ corpusName, book }]
const _indexedCorpora = new Set();

// Strip cantillation + niqqud (U+0591–U+05BD, U+05BF–U+05C7); replace the
// Hebrew maqaf "־" with a space so "ויהי־אור" does not collapse to "ויהיאור";
// drop punctuation that varies between sources (sof-pasuq ׃, sub-pasuq ׀,
// gershayim/geresh, parens, brackets); collapse whitespace.
const STRIP_RE = /[֑-ֽֿ-ׇ]/g;
const PUNCT_RE = /[׃׀,.;:!?()[\]{}״׳"'׳״]/g;

// User-visible spellings of the Tetragrammaton that Sefaria stores as "יהוה".
// We rewrite them to "יהוה" in the search-normalized form so that a query like
// "שמע ישראל ה' אלהינו" matches Deut 6:4 even though Sefaria's text uses
// "יהוה" verbatim. The locator (sefaria_locate.js) performs the same expansion
// while preserving a position map, so "צמוד לציטוט" anchors onto the original
// "ה'" / "השם" in the user's document.
function canonicalizeSacredNames(s) {
  return s
    .replace(/(^|\s)ה['׳״](?=\s|$)/g, "$1יהוה")     // standalone "ה'" / "ה׳" / "ה״"
    .replace(/(^|\s)השם(?=\s|$)/g, "$1יהוה");        // standalone "השם"
}

export function normalizeForSearch(s) {
  if (typeof s !== "string" || !s) return "";
  // Strip cantillation/niqqud first.
  let out = s.replace(STRIP_RE, "");
  // Canonicalize sacred names BEFORE punctuation stripping — otherwise the
  // apostrophe in "ה'" gets removed before we can recognize the abbreviation.
  out = canonicalizeSacredNames(out);
  return out
    .replace(/־/g, " ")
    .replace(PUNCT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNormalizedBook(corpusName, book) {
  const key = `${corpusName}::${book.title}`;
  let cached = _normalizedCache.get(key);
  if (cached) return cached;
  const chapters = book.chapters.map((ch) =>
    Array.isArray(ch) ? ch.map((seg) => normalizeForSearch(seg)) : []
  );
  cached = { chapters };
  _normalizedCache.set(key, cached);
  return cached;
}

async function ensureAll() {
  await Promise.all(CORPORA.map((c) => ensureCorpus(c)));
}

// Build the inverted word index for one corpus the first time it's queried.
// One full sweep over all normalized verses; thereafter searches are O(rare-word-matches)
// instead of O(all verses).
function buildIndexForCorpus(corpusName, corpus) {
  if (_indexedCorpora.has(corpusName)) return;
  _indexedCorpora.add(corpusName);
  for (const book of corpus.books) {
    const bookKey = `${corpusName}::${book.title}`;
    let bookIdx = _bookKeyToIdx.get(bookKey);
    if (bookIdx === undefined) {
      bookIdx = _bookIdxToInfo.length;
      _bookKeyToIdx.set(bookKey, bookIdx);
      _bookIdxToInfo.push({ corpusName, book });
    }
    const norm = getNormalizedBook(corpusName, book);
    for (let ci = 0; ci < book.chapters.length; ci++) {
      const ch = book.chapters[ci];
      const nCh = norm.chapters[ci];
      if (!Array.isArray(ch) || !Array.isArray(nCh)) continue;
      for (let vi = 0; vi < ch.length; vi++) {
        const nVerse = nCh[vi];
        if (!nVerse) continue;
        const packed = bookIdx * 100000000 + (ci + 1) * 10000 + (vi + 1);
        const seen = new Set();
        const words = nVerse.split(" ");
        for (const w of words) {
          if (!w || seen.has(w)) continue;
          seen.add(w);
          let arr = _wordIndex.get(w);
          if (!arr) { arr = []; _wordIndex.set(w, arr); }
          arr.push(packed);
        }
      }
    }
  }
}

// Pick the query word with the smallest posting list — that's the cheapest
// anchor for finding candidate verses.
function rarestWord(queryWords) {
  let best = null;
  let bestSize = Infinity;
  for (const w of queryWords) {
    const arr = _wordIndex.get(w);
    if (!arr) return { word: w, list: [] }; // a word missing from the index → no matches at all
    if (arr.length < bestSize) {
      bestSize = arr.length;
      best = { word: w, list: arr };
    }
  }
  return best;
}

// For a given verse, find the longest window of consecutive query-words that
// appears as a substring of the verse. Returns the window length (in words)
// or 0 if no window of length >= minWords matches. Tries longest first and
// short-circuits at the first hit, so non-matching verses cost only a few indexOf calls.
function longestQueryWindowIn(verseNorm, queryWords, minWords) {
  for (let win = queryWords.length; win >= minWords; win--) {
    for (let start = 0; start + win <= queryWords.length; start++) {
      const sub = queryWords.slice(start, start + win).join(" ");
      if (verseNorm.indexOf(sub) >= 0) return win;
    }
  }
  return 0;
}

/**
 * Search the loaded corpora for the user's text. Returns an array of matches,
 * sorted best-first, capped at `limit`.
 *
 * Match strategy: for every verse, find the longest window of consecutive
 * query-words that appears as a substring of the verse (after stripping niqqud
 * and normalizing). The window length is the score. This handles three real cases:
 *   - selection IS the verse  (window = full query, full verse match)
 *   - selection is a fragment of a verse  (window = full query, partial verse)
 *   - verse is inside the selection  (window = full verse worth of query)
 * Plus a paraphrase falling between them — we still get the longest contiguous
 * agreement, which is usually a strong-enough signal.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.limit=20]
 * @param {number} [opts.minWords=3]
 * @param {string[]} [opts.corpora]
 * @returns {Promise<Array<{
 *   corpus: string, bookTitle: string, heTitle: string,
 *   chapter: number, verse: number, original: string, normalized: string,
 *   matchType: "selection-in-verse" | "verse-in-selection" | "partial",
 *   score: number
 * }>>}
 */
export async function searchByText(query, opts = {}) {
  const limit = opts.limit ?? 20;
  // 2-word minimum: a single Hebrew word like "אדם" appears in thousands of
  // verses and produces a useless match list. Two consecutive words is the
  // shortest selection that's specific enough to surface a meaningful set.
  const minWords = opts.minWords ?? 2;
  const corpora = opts.corpora ?? CORPORA;

  const nQuery = normalizeForSearch(query);
  const queryWords = nQuery.split(/\s+/).filter(Boolean);
  if (queryWords.length < minWords) return [];

  await ensureAll();
  for (const corpusName of corpora) {
    const corpus = await ensureCorpus(corpusName);
    buildIndexForCorpus(corpusName, corpus);
  }

  // Build candidate set from the rarest query word's posting list.
  // For 2-word queries this is one lookup + a few hundred verse checks.
  const anchor = rarestWord(queryWords);
  if (!anchor || anchor.list.length === 0) return [];

  const corpusFilter = new Set(corpora);
  const results = [];
  const seenPacked = new Set();

  for (const packed of anchor.list) {
    if (seenPacked.has(packed)) continue;
    seenPacked.add(packed);

    const bookIdx = Math.floor(packed / 100000000);
    const rest = packed - bookIdx * 100000000;
    const ci = Math.floor(rest / 10000) - 1;
    const vi = (rest - (ci + 1) * 10000) - 1;
    const info = _bookIdxToInfo[bookIdx];
    if (!info || !corpusFilter.has(info.corpusName)) continue;

    const ch = info.book.chapters[ci];
    if (!Array.isArray(ch)) continue;
    const original = ch[vi];
    if (!original) continue;

    const nCh = getNormalizedBook(info.corpusName, info.book).chapters[ci];
    const nVerse = nCh[vi];
    if (!nVerse) continue;

    const win = longestQueryWindowIn(nVerse, queryWords, minWords);
    if (win === 0) continue;

    let matchType;
    if (win === queryWords.length && nVerse.indexOf(nQuery) >= 0) {
      matchType = "selection-in-verse";
    } else if (nVerse.length <= nQuery.length && nQuery.indexOf(nVerse) >= 0) {
      matchType = "verse-in-selection";
    } else {
      matchType = "partial";
    }

    results.push({
      corpus: info.corpusName, bookTitle: info.book.title, heTitle: info.book.heTitle,
      chapter: ci + 1, verse: vi + 1, original, normalized: nVerse,
      matchType, score: win,
    });
  }

  const corpusOrder = { tanakh: 0, mishnah: 1, bavli: 2, rambam: 3, shulchan_arukh: 4 };
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (corpusOrder[a.corpus] !== corpusOrder[b.corpus]) return corpusOrder[a.corpus] - corpusOrder[b.corpus];
    if (a.bookTitle !== b.bookTitle) return a.bookTitle < b.bookTitle ? -1 : 1;
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    return a.verse - b.verse;
  });

  return results.slice(0, limit);
}
