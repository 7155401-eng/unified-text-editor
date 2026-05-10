// Local Sefaria mirror — reads from /data/sefaria/{tanakh,mishnah,bavli}.json
// (built by scripts/build_sefaria_mirror.mjs from gs://sefaria-export).
//
// Memory rule (feedback_sefaria_tools_use_local_mirror): all Sefaria features
// must read from this module, never from sefaria.org HTTP APIs.

// Tanakh (~5 MB) and Mishnah (~3 MB) ship as one combined JSON each — single
// HTTP request loads the whole corpus.
//
// Bavli (~29 MB), Rambam (~6 MB across 84 books), and Shulchan Arukh (~3.6 MB
// across 4 chelkim) ship as one manifest plus per-book files. Two reasons:
// (1) some single combined files would exceed Cloudflare Workers Static Assets'
// 25 MiB per-file ceiling and block the deploy; (2) per-book splits let us
// fetch in parallel, which is faster than one giant download.
const CORPORA = ["tanakh", "mishnah", "bavli", "rambam", "shulchan_arukh"];
const SPLIT_CORPORA = new Set(["bavli", "rambam", "shulchan_arukh"]);
const _loaded = new Map(); // name → { books: [...] }
const _loading = new Map(); // name → Promise
const _byEnglishTitle = new Map(); // englishTitle → { book, source }
const _byHebrewTitle = new Map(); // heTitle → { book, source }

async function fetchJsonOrThrow(url) {
  const r = await fetch(url, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`Failed to load ${url} (HTTP ${r.status})`);
  return r.json();
}

async function loadSingleFileCorpus(name) {
  const data = await fetchJsonOrThrow(`/data/sefaria/${name}.json`);
  return data;
}

async function loadSplitCorpus(name) {
  const manifest = await fetchJsonOrThrow(`/data/sefaria/${name}/manifest.json`);
  if (!Array.isArray(manifest.books)) {
    throw new Error(`Manifest for ${name} is missing books[]`);
  }
  const bookFiles = await Promise.all(
    manifest.books.map((entry) =>
      fetchJsonOrThrow(`/data/sefaria/${name}/${entry.slug}.json`)
        .then((d) => d.book)
    )
  );
  return {
    version: manifest.version,
    format: `${name}-v1`,
    source: "Sefaria-Export GCS bucket (Hebrew, merged) — split per tractate",
    books: bookFiles,
  };
}

async function loadCorpus(name) {
  if (_loaded.has(name)) return _loaded.get(name);
  if (_loading.has(name)) return _loading.get(name);
  if (!CORPORA.includes(name)) throw new Error(`Unknown corpus: ${name}`);
  const p = (async () => {
    const data = SPLIT_CORPORA.has(name)
      ? await loadSplitCorpus(name)
      : await loadSingleFileCorpus(name);
    _loaded.set(name, data);
    for (const book of data.books) {
      _byEnglishTitle.set(book.title, { book, source: name });
      if (book.heTitle) _byHebrewTitle.set(book.heTitle, { book, source: name });
    }
    return data;
  })();
  _loading.set(name, p);
  try { return await p; } finally { _loading.delete(name); }
}

// Public: ensure the requested corpus is loaded into memory.
export async function ensureCorpus(name) {
  return loadCorpus(name);
}

// Public: list books in a loaded corpus as [{ englishTitle, heTitle }].
// Caller must await ensureCorpus(name) first.
export function listBooks(name) {
  const data = _loaded.get(name);
  if (!data) return [];
  return data.books.map((b) => ({ englishTitle: b.title, heTitle: b.heTitle }));
}

// Public: which corpus contains an English book title (after corpora are loaded).
export function corpusForBook(englishBook) {
  const entry = _byEnglishTitle.get(englishBook);
  return entry ? entry.source : null;
}

// Public: get every segment of an entire chapter joined with separators.
// Used by "פרק כולו" / "דף כולו" — verse=null skips the per-segment fetch.
// `joiner` defaults to a single space; callers that want one-segment-per-line
// can pass "\n" instead.
export async function getChapterText(book, chapter, { corpus, joiner = " " } = {}) {
  const candidate =
    corpus ||
    (book.startsWith("Mishnah ") || book.startsWith("משנה ") ? "mishnah" :
     book.startsWith("Mishneh Torah") || book.startsWith("רמב\"ם") ? "rambam" :
     book.startsWith("Shulchan Arukh") || book.startsWith("שולחן ערוך") ? "shulchan_arukh" :
     "tanakh");
  await loadCorpus(candidate);
  const entry = _byEnglishTitle.get(book) || _byHebrewTitle.get(book);
  if (!entry) throw new Error(`לא נמצא הספר: ${book}`);
  const ch = entry.book.chapters[chapter - 1];
  if (!Array.isArray(ch) || ch.length === 0) {
    throw new Error(`פרק ${chapter} לא נמצא ב-${book}`);
  }
  return ch.filter((s) => typeof s === "string" && s).join(joiner);
}

// Public: get the canonical Hebrew text (with niqqud + taamim, no HTML) for a
// given book + chapter + verse. Book may be the English title ("Genesis") or
// the Hebrew title ("בראשית"). The optional `corpus` selects which corpus to
// load; when omitted we infer from the title prefix.
//
// Bavli note: Sefaria stores the daf as the chapter index (chapter[1] = ב.,
// chapter[2] = ב:, etc. — 1-indexed daf, segments inside are sub-lines).
export async function getVerseText(book, chapter, verse, { corpus } = {}) {
  const candidate =
    corpus ||
    (book.startsWith("Mishnah ") || book.startsWith("משנה ") ? "mishnah" :
     book.startsWith("Mishneh Torah") || book.startsWith("רמב\"ם") ? "rambam" :
     book.startsWith("Shulchan Arukh") || book.startsWith("שולחן ערוך") ? "shulchan_arukh" :
     "tanakh");
  await loadCorpus(candidate);
  const entry = _byEnglishTitle.get(book) || _byHebrewTitle.get(book);
  if (!entry) throw new Error(`לא נמצא הספר: ${book}`);
  const chapters = entry.book.chapters;
  if (!Array.isArray(chapters)) throw new Error(`מבנה לא תקין: ${book}`);
  const ch = chapters[chapter - 1];
  if (!Array.isArray(ch) || ch.length === 0) {
    throw new Error(`פרק ${chapter} לא נמצא ב-${book}`);
  }
  const v = ch[verse - 1];
  if (typeof v !== "string" || !v) {
    throw new Error(`פסוק ${chapter}:${verse} לא נמצא ב-${book}`);
  }
  return v;
}
