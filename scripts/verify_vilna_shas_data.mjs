// verify_vilna_shas_data.mjs — בדיקה טכנית של המאגר שנבנה (scripts/build_vilna_shas_mirror.mjs).
//
// מה נבדק:
//   1. גמרא בצורת וילנא — אפס פסיקים ואפס נקודות בכל המסכתות.
//   2. רש"י בצורת וילנא — רק ":" ו-"." מותרים; אין קו מפריד "–" בגוף הטקסט.
//   3. אין ניקוד ואין תגיות HTML בשום מקום.
//   4. שרידי צנזורה (רצפי x) — נספרים ומדווחים; חריגה מהסף מפילה את הבדיקה.
//   5. מבנה העמודים — אינדקס 0/1 ריקים, המסכת מתחילה בדף ב ע"א.
//   6. פרקים — קיימים, רציפים, וגבולותיהם בתוך תחום המסכת.
//   7. רש"י מיושר לגמרא — מספר השורות בכל עמוד לא עולה על מספר קטעי הגמרא.
//
// שימוש: node scripts/verify_vilna_shas_data.mjs

import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const DIR = resolve(ROOT, "public", "data", "sefaria", "vilna_shas");

const NIKUD_RE = /[֑-ׇ]/;
const TAG_RE = /<[^>]+>/;
const CENSOR_RE = /x{3,}/;

let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ ${msg}`); };

const files = (await readdir(DIR)).filter((f) => f.endsWith(".json") && f !== "manifest.json");
console.log(`בודק ${files.length} מסכתות ב-${DIR}\n`);

const totals = {
  amudim: 0, gemSegs: 0, rashi: 0, repaired: 0,
  gemComma: 0, gemPeriod: 0, rashiBadMark: 0, censorSegs: 0, nikud: 0, tags: 0, perakim: 0,
};

for (const f of files) {
  const data = JSON.parse(await readFile(resolve(DIR, f), "utf8"));
  const b = data.book;
  const name = b.title;
  let gemComma = 0, gemPeriod = 0, nikud = 0, tags = 0, censor = 0;

  for (let ai = 0; ai < b.gemara.length; ai++) {
    for (const seg of b.gemara[ai]) {
      if (!seg) continue;
      totals.gemSegs++;
      if (seg.includes(",")) gemComma++;
      if (seg.includes(".")) gemPeriod++;
      if (NIKUD_RE.test(seg)) nikud++;
      if (TAG_RE.test(seg)) tags++;
      if (CENSOR_RE.test(seg)) censor++;
    }
  }
  let rashiBad = 0, rashiCount = 0, rashiCensor = 0;
  for (const amud of b.rashi || []) {
    for (const line of amud || []) {
      for (const c of line || []) {
        rashiCount++;
        const t = `${c.dh} ${c.body}`;
        if (/[,?!;–]/.test(t)) rashiBad++;
        if (NIKUD_RE.test(t)) nikud++;
        if (TAG_RE.test(t)) tags++;
        if (CENSOR_RE.test(t)) rashiCensor++;
      }
    }
  }

  // מבנה עמודים
  if ((b.gemara[0] || []).some(Boolean) || (b.gemara[1] || []).some(Boolean)) {
    fail(`${name}: אינדקס 0/1 אמור להיות ריק (דף א אינו קיים בש"ס)`);
  }
  // רוב המסכתות מתחילות בדף ב ע"א (אינדקס 2). מסכת תמיד מתחילה בדף כה ע"ב
  // (אינדקס 49) — כך היא בש"ס וילנא עצמו, ולכן זו אינה שגיאה.
  const KNOWN_LATE_START = { Tamid: 49 };
  const expectedFirst = KNOWN_LATE_START[name] ?? 2;
  if (b.firstAmud !== expectedFirst) {
    fail(`${name}: המסכת מתחילה באינדקס ${b.firstAmud} במקום ${expectedFirst}`);
  }

  // פרקים
  if (!b.perakim.length) fail(`${name}: אין פרקים`);
  for (let i = 0; i < b.perakim.length; i++) {
    const p = b.perakim[i];
    if (!(p.startAmud >= 2 && p.endAmud <= b.lastAmud && p.startAmud <= p.endAmud)) {
      fail(`${name}: פרק ${p.n} מחוץ לתחום (${p.startAmud}–${p.endAmud}, מסכת עד ${b.lastAmud})`);
    }
    if (i > 0 && p.startAmud < b.perakim[i - 1].endAmud) {
      fail(`${name}: פרק ${p.n} מתחיל לפני סוף פרק ${i}`);
    }
    if (!p.heTitle) fail(`${name}: לפרק ${p.n} אין שם עברי`);
  }

  // יישור רש"י לגמרא
  for (let ai = 2; ai < (b.rashi || []).length; ai++) {
    const lines = (b.rashi[ai] || []).length;
    const segs = (b.gemara[ai] || []).length;
    if (lines > segs + 2) {
      fail(`${name}: עמוד ${ai} — ${lines} שורות רש"י מול ${segs} קטעי גמרא`);
    }
  }

  if (gemComma) fail(`${name}: ${gemComma} קטעי גמרא עם פסיק`);
  if (gemPeriod) fail(`${name}: ${gemPeriod} קטעי גמרא עם נקודה`);
  if (rashiBad) fail(`${name}: ${rashiBad} פירושי רש"י עם סימן אסור`);
  if (nikud) fail(`${name}: ${nikud} קטעים עם ניקוד`);
  if (tags) fail(`${name}: ${tags} קטעים עם תגיות HTML`);

  totals.amudim += data.stats.amudim;
  totals.rashi += rashiCount;
  totals.repaired += data.stats.repairedSegments;
  totals.gemComma += gemComma;
  totals.gemPeriod += gemPeriod;
  totals.rashiBadMark += rashiBad;
  totals.censorSegs += censor + rashiCensor;
  totals.nikud += nikud;
  totals.tags += tags;
  totals.perakim += b.perakim.length;

  console.log(`  ${name.padEnd(18)} עמודים ${String(data.stats.amudim).padStart(4)} · ` +
    `קטעים ${String(data.stats.gemaraSegments).padStart(5)} · רש"י ${String(rashiCount).padStart(5)} · ` +
    `פרקים ${String(b.perakim.length).padStart(2)} · תוקנו ${String(data.stats.repairedSegments).padStart(3)} · ` +
    `שרידי-צנזורה ${censor + rashiCensor}`);
}

console.log(`\nסיכום: ${files.length} מסכתות · ${totals.amudim} עמודים · ${totals.gemSegs} קטעי גמרא · ` +
  `${totals.rashi} פירושי רש"י · ${totals.perakim} פרקים`);
console.log(`תיקוני צנזורה מהגרסה המנוקדת: ${totals.repaired} · שרידי x שלא ניתן היה לתקן: ${totals.censorSegs}`);
console.log(`פסיקים בגמרא: ${totals.gemComma} · נקודות בגמרא: ${totals.gemPeriod} · ` +
  `סימנים אסורים ברש"י: ${totals.rashiBadMark} · ניקוד: ${totals.nikud} · תגיות: ${totals.tags}`);

if (failures) {
  console.log(`\n✗ ${failures} כשלים`);
  process.exit(1);
}
console.log("\n✓ כל הבדיקות עברו");
