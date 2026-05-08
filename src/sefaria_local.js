// Local Sefaria mirror — reads from /data/sefaria/{tanakh,mishnah,bavli}.json
// (built by scripts/build_sefaria_mirror.mjs from gs://sefaria-export).
//
// Memory rule (feedback_sefaria_tools_use_local_mirror): all Sefaria features
// must read from this module, never from sefaria.org HTTP APIs.

const CORPORA = ["tanakh", "mishnah", "bavli"];
const _loaded = new Map(); // name → { books: [...] }
const _loading = new Map(); // name → Promise
const _byEnglishTitle = new Map(); // englishTitle → { book, source }

async function loadCorpus(name) {
  if (_loaded.has(name)) return _loaded.get(name);
  if (_loading.has(name)) return _loading.get(name);
  if (!CORPORA.includes(name)) throw new Error(`Unknown corpus: ${name}`);
  const p = (async () => {
    const r = await fetch(`/data/sefaria/${name}.json`, { credentials: "same-origin" });
    if (!r.ok) throw new Error(`Failed to load ${name}.json (HTTP ${r.status})`);
    const data = await r.json();
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
