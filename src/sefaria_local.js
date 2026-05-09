// Local Sefaria mirror — reads from /data/sefaria/{tanakh,mishnah,bavli}.json
// (built by scripts/build_sefaria_mirror.mjs from gs://sefaria-export).
//
// Memory rule (feedback_sefaria_tools_use_local_mirror): all Sefaria features
// must read from this module, never from sefaria.org HTTP APIs.

// Tanakh (~5 MB) and Mishnah (~3 MB) ship as one combined JSON each — single
// HTTP request loads the whole corpus.
//
// Bavli (~29 MB combined) exceeds Cloudflare Workers Static Assets' 25 MiB
// per-file limit. Instead it ships as one manifest plus 37 per-tractate files
// under /data/sefaria/bavli/. The client fetches the manifest once, then all
// tractates in parallel, and merges them into the same in-memory shape Tanakh
// and Mishnah produce — so the rest of the search/render code is corpus-agnostic.
const CORPORA = ["tanakh", "mishnah", "bavli"];
const SPLIT_CORPORA = new Set(["bavli"]);
const _loaded = new Map(); // name → { books: [...] }
const _loading = new Map(); // name → Promise
const _byEnglishTitle = new Map(); // englishTitle → { book, source }

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

// Public: get the canonical Hebrew text (with niqqud + taamim, no HTML) for a
// given English book + chapter + verse. Returns the string or throws.
export async function getVerseText(englishBook, chapter, verse, { corpus } = {}) {
  // If caller didn't say which corpus, try the most likely one based on the title.
  // For the four-button toolbar today we only consult Tanakh; the Mishnah/Bavli
  // entries will be wired up when the UI gains those dropdowns.
  const candidate = corpus || (englishBook.startsWith("Mishnah ") ? "mishnah" : "tanakh");
  await loadCorpus(candidate);
  const entry = _byEnglishTitle.get(englishBook);
  if (!entry) throw new Error(`לא נמצא הספר: ${englishBook}`);
  const chapters = entry.book.chapters;
  if (!Array.isArray(chapters)) throw new Error(`מבנה לא תקין: ${englishBook}`);
  const ch = chapters[chapter - 1];
  if (!Array.isArray(ch)) throw new Error(`פרק ${chapter} לא נמצא ב-${englishBook}`);
  const v = ch[verse - 1];
  if (typeof v !== "string" || !v) throw new Error(`פסוק ${chapter}:${verse} לא נמצא ב-${englishBook}`);
  return v;
}
