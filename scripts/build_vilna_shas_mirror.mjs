// build_vilna_shas_mirror.mjs — בונה מאגר מקומי של "ש"ס וילנא" לייבוא גמרא + רש"י.
//
// למה קובץ נפרד מ-build_sefaria_mirror.mjs:
//   המאגר הקיים (public/data/sefaria/bavli) הוא גרסת "merged" של ספריא —
//   מנוקדת ומפוסקת (5,269 נקודות ו-5,182 פסיקים במסכת ברכות לבדה). משה ביקש
//   במפורש גמרא "כמו בווילנא בלי פסיקים ונקודות", ורש"י "כמו בווילנא עם
//   סימוני :. בלבד". לכן נבנה כאן מאגר שני, נפרד, בצורת וילנא.
//
// מקורות (כולם מדלי ה-GCS הציבורי של ספריא, לא מ-sefaria.org — ראה
// feedback_sefaria_tools_use_local_mirror):
//   גמרא  — "William Davidson Edition - Aramaic": הטקסט של וילנא בלי ניקוד
//            ובלי פיסוק (נמדד בברכות: 0 פסיקים, 0 נקודות, 548 נקודתיים).
//   תיקון — "merged" (מנוקד): בגרסת הארמית יש 20 קטעים במסכת ברכות שבהם
//            הטקסט מוחלף באותיות x (קטעים שצונזרו בדפוסים). נמדד: בכל 20
//            הקטעים לגרסת merged יש טקסט עברי מלא. לכן כל קטע-x מתוקן מתוך
//            merged, ואז מוסרים ממנו ניקוד ופיסוק — וכך הטקסט שלם וגם נקי.
//   רש"י   — "Vilna Edition" (ואם חסר: merged / כל גרסה עברית): בלי ניקוד,
//            עם ":" בסוף כל דיבור. הקו המפריד "–" שספריא שמה בין הדיבור
//            המתחיל לגוף הפירוש נשמר כשדה נפרד (dh/body) ולא כתו בטקסט.
//   פרקים  — schemas/<Title>.json, שדה alts.Chapters: לכל פרק wholeRef
//            בצורת "Berakhot 2a:1-13a:15" → ממנו נגזרים גבולות מדויקים.
//
// פלט: public/data/sefaria/vilna_shas/<slug>.json + manifest.json
// שימוש: node scripts/build_vilna_shas_mirror.mjs [--only=berakhot,shabbat] [--limit=2]

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const OUT_DIR = resolve(ROOT, "public", "data", "sefaria", "vilna_shas");
const CACHE_DIR = resolve(tmpdir(), "ravtext-vilna-cache");
const MANIFEST_URL = "https://raw.githubusercontent.com/Sefaria/Sefaria-Export/master/books.json";
// שם קובץ הסכימה בדלי משתמש בקו-תחתון במקום רווח ("Bava_Batra.json"). עם
// רווח מקודד (%20) מתקבל 404 — וזה מה שהשמיט את הפרקים משש מסכתות.
const SCHEMA_URL = (title) => `https://storage.googleapis.com/sefaria-export/schemas/${encodeURIComponent(title.replace(/\s+/g, "_"))}.json`;

// --- עזרי דף/עמוד -----------------------------------------------------------
// ספריא מאנדקסת מסכת כמערך של "עמודים": אינדקס 0 = דף א ע"א, 1 = דף א ע"ב,
// 2 = דף ב ע"א... כלומר amudIndex = (daf-1)*2 + (amud==='b' ? 1 : 0).
// כל מסכת מתחילה בפועל בדף ב ע"א (אינדקס 2); אינדקסים 0-1 ריקים תמיד.
const HE_NUM_ONES = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
const HE_NUM_TENS = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
const HE_NUM_HUNDREDS = ["", "ק", "ר", "ש", "ת"];

export function hebrewNumber(n) {
  if (!Number.isFinite(n) || n <= 0) return String(n);
  let out = "";
  let rest = n;
  while (rest >= 400) { out += "ת"; rest -= 400; }
  out += HE_NUM_HUNDREDS[Math.floor(rest / 100)] || "";
  rest %= 100;
  if (rest === 15) return out + "טו";
  if (rest === 16) return out + "טז";
  out += HE_NUM_TENS[Math.floor(rest / 10)] || "";
  out += HE_NUM_ONES[rest % 10] || "";
  return out;
}

export function amudIndexToRef(idx) {
  const daf = Math.floor(idx / 2) + 1;
  const amud = idx % 2 === 0 ? "a" : "b";
  return { daf, amud, en: `${daf}${amud}`, he: `${hebrewNumber(daf)}${amud === "a" ? "." : ":"}` };
}

export function refToAmudIndex(ref) {
  const m = String(ref || "").trim().match(/(\d+)([ab])$/);
  if (!m) return -1;
  return (parseInt(m[1], 10) - 1) * 2 + (m[2] === "b" ? 1 : 0);
}

// --- ניקוי טקסט -------------------------------------------------------------
const NIKUD_RE = /[֑-ׇ]/g;              // ניקוד + טעמים
const TAG_RE = /<[^>]*>/g;
const ENTITIES = {
  "&nbsp;": " ", "&thinsp;": " ", "&hairsp;": " ", "&ensp;": " ", "&emsp;": " ",
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'",
};

function decodeEntities(s) {
  return s
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m)
    .replace(/&#x?[0-9a-f]+;/gi, (m) => {
      const hex = /^&#x/i.test(m);
      const n = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    });
}

function stripTags(s) {
  return decodeEntities(String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(TAG_RE, ""));
}

// גמרא בצורת וילנא: בלי ניקוד, בלי פסיק/נקודה/סימן-שאלה/קריאה/נקודה-פסיק.
// נשמרים: ":" (סוף סוגיה בוילנא), גרש/גרשיים (ראשי תיבות), סוגריים.
export function cleanGemara(s) {
  let out = stripTags(s).replace(NIKUD_RE, "");
  out = out.replace(/[,.?!;]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// רש"י בצורת וילנא: מותרים ":" ו-"." בלבד; כל שאר סימני הפיסוק יורדים.
export function cleanRashi(s) {
  let out = stripTags(s).replace(NIKUD_RE, "");
  out = out.replace(/[,?!;]/g, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

// ספריא מפרידה בין הדיבור המתחיל לגוף הפירוש בקו "–". שומרים את שני החלקים
// בנפרד: כך הייבוא יכול להבליט את הדיבור המתחיל כמו בוילנא, בלי להשאיר קו
// שאינו קיים בדפוס.
export function splitRashiComment(raw) {
  const text = cleanRashi(raw);
  if (!text) return null;
  const i = text.indexOf("–");
  if (i < 0) return { dh: "", body: text };
  return { dh: text.slice(0, i).trim(), body: text.slice(i + 1).trim() };
}

const CENSOR_RUN_RE = /x{2,}(?:[\s"'׳״]*x{1,})*/g;
export function countCensorRuns(s) {
  return (String(s || "").match(CENSOR_RUN_RE) || []).length;
}
function looksCensored(s) {
  // קטע "מצונזר" = הרבה x ומעט עברית. 3 x ומעלה זה כבר לא מילה עברית.
  return (String(s || "").match(/x/g) || []).length >= 3;
}

// --- הורדה עם מטמון ---------------------------------------------------------
async function fetchJsonCached(url, cacheName) {
  const cachePath = resolve(CACHE_DIR, cacheName);
  if (existsSync(cachePath)) {
    try { return JSON.parse(await readFile(cachePath, "utf8")); } catch { /* נוריד מחדש */ }
  }
  const r = await fetch(url, { headers: { "User-Agent": "ravtext-vilna-mirror/1" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, text);
  return JSON.parse(text);
}

function slugify(title) {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function pickVersion(books, title, preferred) {
  const heb = books.filter((b) => b.title === title && b.language === "Hebrew");
  for (const want of preferred) {
    const hit = heb.find((b) => b.versionTitle === want);
    if (hit) return hit;
  }
  return heb[0] || null;
}

// --- בניית מסכת אחת ---------------------------------------------------------
async function buildTractate(meta, books) {
  const title = meta.title;
  const slug = slugify(title);
  const aramaic = pickVersion(books, title, ["William Davidson Edition - Aramaic", "Wikisource Talmud Bavli", "merged"]);
  const vocalized = pickVersion(books, title, ["merged", "William Davidson Edition - Vocalized Aramaic"]);
  const rashiMeta = pickVersion(books, `Rashi on ${title}`, ["Vilna Edition", "merged"]);
  if (!aramaic) throw new Error(`אין גרסה עברית ל-${title}`);

  const gemRaw = await fetchJsonCached(aramaic.json_url, `${slug}.gem.json`);
  const vocRaw = vocalized && vocalized.json_url !== aramaic.json_url
    ? await fetchJsonCached(vocalized.json_url, `${slug}.voc.json`).catch(() => null)
    : null;
  const rashiRaw = rashiMeta ? await fetchJsonCached(rashiMeta.json_url, `${slug}.rashi.json`).catch(() => null) : null;
  const schema = await fetchJsonCached(SCHEMA_URL(title), `${slug}.schema.json`).catch(() => null);

  const gemChapters = Array.isArray(gemRaw.text) ? gemRaw.text : [];
  const vocChapters = vocRaw && Array.isArray(vocRaw.text) ? vocRaw.text : [];

  // --- גמרא: ניקוי + תיקון קטעים מצונזרים מתוך הגרסה המנוקדת ---
  let repaired = 0;
  let stillCensored = 0;
  const gemara = gemChapters.map((amud, ai) => {
    if (!Array.isArray(amud)) return [];
    return amud.map((seg, si) => {
      let cleaned = cleanGemara(seg);
      if (looksCensored(cleaned)) {
        const alt = vocChapters[ai] && vocChapters[ai][si];
        const altClean = alt ? cleanGemara(alt) : "";
        if (altClean && !looksCensored(altClean)) {
          repaired++;
          return altClean;
        }
        stillCensored++;
      }
      return cleaned;
    });
  });

  // --- רש"י: [דף][שורה][פירוש] → אותו מבנה, כל פירוש {dh, body} ---
  let rashiCount = 0;
  let rashiCensored = 0;
  const rashi = (rashiRaw && Array.isArray(rashiRaw.text) ? rashiRaw.text : []).map((amud) => {
    if (!Array.isArray(amud)) return [];
    return amud.map((line) => {
      const arr = Array.isArray(line) ? line : [line];
      return arr.map((c) => {
        const parsed = splitRashiComment(c);
        if (!parsed) return null;
        rashiCount++;
        if (looksCensored(`${parsed.dh} ${parsed.body}`)) rashiCensored++;
        return parsed;
      }).filter(Boolean);
    });
  });

  // --- פרקים: alts.Chapters[].wholeRef = "Berakhot 2a:1-13a:15" ---
  const perakim = [];
  const nodes = schema?.alts?.Chapters?.nodes || [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const whole = String(node.wholeRef || "");
    const m = whole.match(/(\d+[ab]):(\d+)\s*-\s*(?:.*?\s)?(\d+[ab]):(\d+)$/);
    if (!m) continue;
    perakim.push({
      n: i + 1,
      heTitle: String(node.heTitle || "").trim(),
      title: String(node.title || "").replace(/^Chapter\s+\d+;\s*/, "").trim(),
      startAmud: refToAmudIndex(m[1]),
      startLine: parseInt(m[2], 10),
      endAmud: refToAmudIndex(m[3]),
      endLine: parseInt(m[4], 10),
    });
  }

  const nonEmpty = gemara.map((a, i) => (a.some((s) => s) ? i : -1)).filter((i) => i >= 0);
  const book = {
    title,
    heTitle: gemRaw.heTitle || meta.heTitle || "",
    seder: (meta.categories || [])[2] || "",
    firstAmud: nonEmpty[0] ?? 2,
    lastAmud: nonEmpty[nonEmpty.length - 1] ?? 2,
    gemara,
    rashi,
    perakim,
  };
  const stats = {
    amudim: nonEmpty.length,
    gemaraSegments: gemara.reduce((s, a) => s + a.filter(Boolean).length, 0),
    rashiComments: rashiCount,
    repairedSegments: repaired,
    stillCensoredSegments: stillCensored,
    rashiCensoredComments: rashiCensored,
    perakim: perakim.length,
    gemaraVersion: aramaic.versionTitle,
    rashiVersion: rashiMeta?.versionTitle || null,
  };
  return { slug, book, stats };
}

// --- ראשי ------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const only = (args.find((a) => a.startsWith("--only=")) || "").slice("--only=".length)
    .split(",").map((s) => s.trim()).filter(Boolean);
  const limitArg = (args.find((a) => a.startsWith("--limit=")) || "").slice("--limit=".length);
  const limit = limitArg ? parseInt(limitArg, 10) : 0;

  console.log("מוריד את רשימת הספרים של ספריא...");
  const manifest = await fetchJsonCached(MANIFEST_URL, "books.json");
  const books = manifest.books;
  console.log(`  ${books.length} רשומות`);

  const tractates = books.filter((b) =>
    b.language === "Hebrew" && b.versionTitle === "merged" &&
    Array.isArray(b.categories) && b.categories.length === 3 &&
    b.categories[0] === "Talmud" && b.categories[1] === "Bavli" && /^Seder /.test(b.categories[2]));

  let list = tractates;
  if (only.length) list = list.filter((b) => only.includes(slugify(b.title)));
  if (limit > 0) list = list.slice(0, limit);
  console.log(`בונה ${list.length} מסכתות`);

  await mkdir(OUT_DIR, { recursive: true });
  const entries = [];
  const version = new Date().toISOString().slice(0, 10);
  let i = 0;
  for (const meta of list) {
    i++;
    process.stdout.write(`  [${String(i).padStart(2)}/${list.length}] ${meta.title} ... `);
    try {
      const { slug, book, stats } = await buildTractate(meta, books);
      const json = JSON.stringify({
        version,
        format: "vilna-shas-v1",
        source: "Sefaria-Export GCS — Davidson Aramaic (Vilna text) + Rashi Vilna Edition",
        stats,
        book,
      });
      await writeFile(resolve(OUT_DIR, `${slug}.json`), json);
      entries.push({
        slug,
        title: book.title,
        heTitle: book.heTitle,
        seder: book.seder,
        firstAmud: book.firstAmud,
        lastAmud: book.lastAmud,
        perakim: book.perakim.map((p) => ({
          n: p.n, heTitle: p.heTitle,
          startAmud: p.startAmud, startLine: p.startLine,
          endAmud: p.endAmud, endLine: p.endLine,
        })),
        hasRashi: stats.rashiComments > 0,
        sizeKb: Math.round(json.length / 1024),
        stats,
      });
      console.log(`${stats.amudim} עמודים · ${stats.gemaraSegments} קטעים · ${stats.rashiComments} רש"י · ` +
        `תוקנו ${stats.repairedSegments} · ${Math.round(json.length / 1024)}KB`);
    } catch (e) {
      console.log(`נכשל (${e.message})`);
    }
  }

  const manifestJson = JSON.stringify({ version, format: "vilna-shas-manifest-v1", books: entries });
  await writeFile(resolve(OUT_DIR, "manifest.json"), manifestJson);
  const totalKb = entries.reduce((s, e) => s + e.sizeKb, 0);
  console.log(`\n→ ${OUT_DIR}: ${entries.length} מסכתות + manifest (~${(totalKb / 1024).toFixed(1)}MB)`);
}

if (process.argv[1] && process.argv[1].endsWith("build_vilna_shas_mirror.mjs")) {
  main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
}
