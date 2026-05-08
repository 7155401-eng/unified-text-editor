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

async function buildCategory(label, filter, books, outFile) {
  const filtered = books.filter(filter);
  console.log(`\n[${label}] ${filtered.length} works`);
  const result = {
    version: new Date().toISOString().slice(0, 10),
    format: `${label}-v1`,
    source: "Sefaria-Export GCS bucket (Hebrew, merged)",
    books: [],
  };
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
    const chapters = cleanText(data.text);
    result.books.push({
      title: meta.title,
      heTitle: data.heTitle ?? "",
      cat: meta.categories,
      chapters,
    });
    const segCount = Array.isArray(chapters) ? chapters.flat(Infinity).filter(Boolean).length : 0;
    console.log(`${Array.isArray(chapters) ? chapters.length : 0} chapters · ${segCount} segments`);
  }
  await mkdir(dirname(outFile), { recursive: true });
  const json = JSON.stringify(result);
  await writeFile(outFile, json);
  const kb = (json.length / 1024).toFixed(0);
  console.log(`  → ${outFile} (${kb} KB)`);
  return result;
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : null;

  console.log("Fetching manifest from Sefaria-Export...");
  const manifest = await fetchJson(MANIFEST_URL);
  console.log(`  ${manifest.books.length} total entries · bucket=${manifest.bucket}`);

  if (!only || only === "tanakh") {
    await buildCategory("tanakh", isCanonicalTanakh, manifest.books, resolve(OUT_DIR, "tanakh.json"));
  }
  if (!only || only === "mishnah") {
    await buildCategory("mishnah", isCanonicalMishnah, manifest.books, resolve(OUT_DIR, "mishnah.json"));
  }
  if (!only || only === "bavli") {
    await buildCategory("bavli", isCanonicalBavli, manifest.books, resolve(OUT_DIR, "bavli.json"));
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
