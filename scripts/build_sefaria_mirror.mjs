// Build a local mirror of the canonical Hebrew text corpus from Sefaria-Export.
//
// Sefaria's GitHub repo at github.com/Sefaria/Sefaria-Export holds only metadata.
// The actual texts live in a public GCS bucket (gs://sefaria-export → https://storage.googleapis.com/sefaria-export/...).
// This script:
//   1. Downloads the master manifest (books.json)
//   2. Filters to canonical Tanakh / Mishnah / Bavli (139 works total) — Hebrew, "merged" version
//   3. Downloads each merged.json
//   4. Strips HTML, normalizes whitespace, but keeps niqqud + ta'amim intact
//   5. Writes one compact JSON per category to public/data/sefaria/
//
// Usage: node scripts/build_sefaria_mirror.mjs [--only=tanakh|mishnah|bavli]
// Requires Node 18+ (uses global fetch).
//
// Memory rule (feedback_sefaria_tools_use_local_mirror): all client Sefaria features
// must read from these files at runtime, never from sefaria.org.

import { writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const OUT_DIR = resolve(ROOT, "public", "data", "sefaria");
const MANIFEST_URL = "https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json";

// --- Filters ----------------------------------------------------------------

function isHebMerged(book) {
  return book.language === "Hebrew" && book.versionTitle === "merged";
}

function isCanonicalTanakh(book) {
  return isHebMerged(book) &&
    Array.isArray(book.categories) && book.categories.length === 2 &&
    book.categories[0] === "Tanakh" &&
    ["Torah", "Prophets", "Writings"].includes(book.categories[1]);
}

function isCanonicalMishnah(book) {
  return isHebMerged(book) &&
    Array.isArray(book.categories) && book.categories.length === 2 &&
    book.categories[0] === "Mishnah" &&
    /^Seder /.test(book.categories[1]);
}

function isCanonicalBavli(book) {
  return isHebMerged(book) &&
    Array.isArray(book.categories) && book.categories.length === 3 &&
    book.categories[0] === "Talmud" && book.categories[1] === "Bavli" &&
    /^Seder /.test(book.categories[2]);
}

// Pure Mishneh Torah (Rambam) — 84 books, each "Sefer X" houses ~6 books.
// We exclude commentary subtrees by requiring the third category to start
// with "Sefer " (commentary trees use names like "Annotations of...").
function isCanonicalRambam(book) {
  return isHebMerged(book) &&
    Array.isArray(book.categories) && book.categories.length === 3 &&
    book.categories[0] === "Halakhah" && book.categories[1] === "Mishneh Torah" &&
    /^Sefer /.test(book.categories[2]);
}

// Shulchan Arukh proper — the four chelkim only (Orach Chayim, Yoreh De'ah,
// Even HaEzer, Choshen Mishpat). The "Introduction" entry is metadata, not
// halakhic content; the title prefix "Shulchan Arukh, " filters it cleanly.
function isCanonicalShulchanArukh(book) {
  return isHebMerged(book) &&
    Array.isArray(book.categories) && book.categories.length === 2 &&
    book.categories[0] === "Halakhah" && book.categories[1] === "Shulchan Arukh" &&
    /^Shulchan Arukh, (Orach Chayim|Yoreh De'ah|Even HaEzer|Choshen Mishpat)$/.test(book.title);
}

// --- Cleaning ---------------------------------------------------------------

// Strip HTML and editorial markers, decode common entities, normalize spaces,
// but PRESERVE Hebrew niqqud and ta'amim (we may render them or strip them
// at search-time). This is the form that ships to the client.
const ENTITY_MAP = {
  "&nbsp;": " ", // keep — used by Sefaria for tight spacing inside verse-end ornaments
  "&thinsp;": " ",
  "&hairsp;": " ",
  "&ensp;": " ",
  "&emsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function cleanString(s) {
  if (typeof s !== "string") return s == null ? "" : String(s);
  let out = s
    .replace(/<sup[^>]*>.*?<\/sup>/gis, "")
    .replace(/<i\s+class="footnote">.*?<\/i>/gis, "")
    .replace(/<[^>]+>/g, "");
  // Decode named entities
  out = out.replace(/&[a-z]+;/gi, (m) => ENTITY_MAP[m] ?? m);
  // Decode numeric entities
  out = out.replace(/&#x?[0-9a-f]+;/gi, (m) => {
    const hex = m.startsWith("&#x") || m.startsWith("&#X");
    const n = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });
  // Drop Sefaria's parsha/sub-parsha markers — editorial layout, not text.
  out = out.replace(/\{[פס][פסת]?\}/g, "");
  // Drop trailing curly-brace metadata sequences like {ש} that Sefaria adds.
  out = out.replace(/\{[֐-׿ּ\w]+\}/g, "");
  // Collapse repeated whitespace (including the hair-spaces we just decoded).
  out = out.replace(/[\s     ]+/g, " ").trim();
  return out;
}

function cleanText(node) {
  if (typeof node === "string") return cleanString(node);
  if (Array.isArray(node)) return node.map(cleanText);
  return null;
}

// --- Fetching ---------------------------------------------------------------

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "User-Agent": "ravtext-mirror-builder/1" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

// --- Build one category -----------------------------------------------------

function slugifyTitle(title) {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// When split=true, each book is written to its own file and a manifest is also
// emitted that the client uses to enumerate which files to fetch. This is the
// path used for Bavli, where the combined file (~29 MB) exceeds Cloudflare
// Workers Static Assets' 25 MiB per-file ceiling and blocks the entire deploy.
async function buildCategory(label, filter, books, outDir, { split = false } = {}) {
  const filtered = books.filter(filter);
  console.log(`\n[${label}] ${filtered.length} works  (split=${split})`);
  const version = new Date().toISOString().slice(0, 10);
  const collected = [];
  let i = 0;
  for (const meta of filtered) {
    i++;
    process.stdout.write(`  [${String(i).padStart(3)}/${filtered.length}] ${meta.title} ... `);
    let data;
    try {
      data = await fetchJson(meta.json_url);
    } catch (e) {
      console.log(`SKIP (${e.message})`);
      continue;
    }
    // Complex-schema books (e.g. Shulchan Arukh, Even HaEzer) put the main
    // chelek text under data.text[''] and aux schema-nodes under named keys.
    // Use the default node for those; otherwise data.text is the array directly.
    const rawText = Array.isArray(data.text)
      ? data.text
      : (data.text && Array.isArray(data.text[""]) ? data.text[""] : data.text);
    const chapters = cleanText(rawText);
    const segCount = Array.isArray(chapters) ? chapters.flat(Infinity).filter(Boolean).length : 0;
    const book = {
      title: meta.title,
      heTitle: data.heTitle ?? "",
      cat: meta.categories,
      chapters,
    };
    collected.push({ meta, book, segCount });
    console.log(`${Array.isArray(chapters) ? chapters.length : 0} chapters · ${segCount} segments`);
  }

  // For split: outDir is the directory itself.
  // For combined: outDir is the path without ".json" — the parent must exist.
  await mkdir(split ? outDir : dirname(`${outDir}.json`), { recursive: true });
  if (split) {
    const manifestEntries = [];
    for (const { meta, book, segCount } of collected) {
      const slug = slugifyTitle(meta.title);
      const fileJson = JSON.stringify({
        version, format: `${label}-book-v1`,
        source: "Sefaria-Export GCS bucket (Hebrew, merged)",
        book,
      });
      const filePath = `${outDir}/${slug}.json`;
      await writeFile(filePath, fileJson);
      manifestEntries.push({
        slug,
        title: meta.title,
        heTitle: book.heTitle,
        cat: meta.categories,
        sizeKb: Math.round(fileJson.length / 1024),
        segCount,
      });
    }
    const manifestJson = JSON.stringify({
      version, format: `${label}-manifest-v1`, books: manifestEntries,
    });
    await writeFile(`${outDir}/manifest.json`, manifestJson);
    const totalKb = manifestEntries.reduce((s, e) => s + e.sizeKb, 0);
    console.log(`  → ${outDir}/{${manifestEntries.length} per-book files + manifest.json} (~${totalKb} KB total)`);
  } else {
    const result = {
      version, format: `${label}-v1`,
      source: "Sefaria-Export GCS bucket (Hebrew, merged)",
      books: collected.map((c) => c.book),
    };
    const outFile = `${outDir}.json`;
    const json = JSON.stringify(result);
    await writeFile(outFile, json);
    console.log(`  → ${outFile} (${(json.length / 1024).toFixed(0)} KB)`);
  }
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;

  console.log("Fetching manifest from Sefaria-Export...");
  const manifest = await fetchJson(MANIFEST_URL);
  console.log(`  ${manifest.books.length} total entries · bucket=${manifest.bucket}`);

  // Tanakh (~5 MB) and Mishnah (~3 MB) ship as a single combined file each.
  // Bavli, Rambam, and Shulchan Arukh are split per book/tractate because the
  // combined files exceed Cloudflare Workers Static Assets' 25 MiB per-file
  // ceiling, which would block the entire deploy.
  if (!only || only === "tanakh") {
    await buildCategory("tanakh", isCanonicalTanakh, manifest.books, resolve(OUT_DIR, "tanakh"));
  }
  if (!only || only === "mishnah") {
    await buildCategory("mishnah", isCanonicalMishnah, manifest.books, resolve(OUT_DIR, "mishnah"));
  }
  if (!only || only === "bavli") {
    await buildCategory("bavli", isCanonicalBavli, manifest.books, resolve(OUT_DIR, "bavli"), { split: true });
  }
  if (!only || only === "rambam") {
    await buildCategory("rambam", isCanonicalRambam, manifest.books, resolve(OUT_DIR, "rambam"), { split: true });
  }
  if (!only || only === "shulchan_arukh") {
    await buildCategory("shulchan_arukh", isCanonicalShulchanArukh, manifest.books, resolve(OUT_DIR, "shulchan_arukh"), { split: true });
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
