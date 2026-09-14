// verify_lost_words.mjs — "מילים חופפות מצד ימין, לא נכנסות בעמוד,
// ולא שהן נסתרות אלא לא נראות כלל" (משה 14/09).
//
// ⚠ הלקח מהבאג הקודם: לא מודדים את התיבה — מודדים את **הטקסט**.
// כאן בודקים שלושה דברים על כל שורה, בקואורדינטות אמיתיות:
//   1. האם הטקסט חורג מגבול העמוד (ימינה או שמאלה).
//   2. האם הטקסט רחב מהתיבה שהוקצתה לו (ואז הוא נחתך/מוסתר).
//   3. האם יש טקסט שקוף/מוסתר (visibility, opacity, clip).
// ובנוסף — השוואת ספירת מילים: כמה מילים במקור מול כמה על העמודים.

import pp from "puppeteer-core";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const FROM = process.argv[2] || "ב.";
const TO = process.argv[3] || "ד:";

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 900000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
await p.goto(URL_, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "auto");
  localStorage.setItem("ravtext.vilnaDaf.mode", "strict");
  localStorage.setItem("ravtext.vilnaDaf.fitPageToText", "1");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

await p.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await p.$eval("#btn-vilna-import", (el) => el.click());
await p.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await p.evaluate((f, t) => {
  const modal = document.querySelector(".sef-modal");
  const fire = (el, ev = "change") => el.dispatchEvent(new Event(ev, { bubbles: true }));
  const sel = modal.querySelector("#vilna-import-tractate");
  sel.value = "berakhot"; fire(sel);
  setTimeout(() => {
    const selects = modal.querySelectorAll("select");
    selects[1].value = "dafim"; fire(selects[1]);
    const texts = [...modal.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
    texts[0].value = f; fire(texts[0], "input");
    texts[1].value = t; fire(texts[1], "input");
  }, 1800);
}, FROM, TO);
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => [...document.querySelectorAll(".sef-modal button")]
  .find((x) => x.textContent.includes("ייבא לעורך")).click());

const dl = Date.now() + 600000;
while (Date.now() < dl) {
  const st = await p.evaluate(() => ({
    total: window.__VILNA_DAF_REPORT__?.pagesTotal || 0,
    pages: document.querySelectorAll(".pages-container .page").length,
  }));
  if (st.total > 0 && st.pages >= st.total) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 3000));

const res = await p.evaluate(() => {
  const out = [];
  for (const pg of document.querySelectorAll(".pages-container .page")) {
    const pr = pg.getBoundingClientRect();
    const logicalW = parseFloat(pg.style.width) || pr.width;
    const zoom = pr.width && logicalW ? pr.width / logicalW : 1;
    const bad = [];
    for (const l of pg.querySelectorAll(".v9-line")) {
      const rng = document.createRange();
      rng.selectNodeContents(l);
      const tr = rng.getBoundingClientRect();
      if (!tr.width) continue;
      const boxW = parseFloat(l.style.width) || 0;
      const textW = tr.width / zoom;
      const relRight = (tr.right - pr.left) / zoom;
      const relLeft = (tr.left - pr.left) / zoom;
      const cs = getComputedStyle(l);
      const hidden = cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.1;
      // חריגה מגבול העמוד, או טקסט רחב מהתיבה שהוקצתה לו
      if (relRight > logicalW + 1 || relLeft < -1) {
        bad.push({ kind: "מחוץ לעמוד", role: l.dataset.v9Role, right: Math.round(relRight), pageW: Math.round(logicalW) });
      } else if (boxW && textW > boxW + 2) {
        bad.push({ kind: "טקסט רחב מהתיבה", role: l.dataset.v9Role, textW: Math.round(textW), boxW: Math.round(boxW) });
      } else if (hidden) {
        bad.push({ kind: "מוסתר", role: l.dataset.v9Role });
      }
    }
    out.push({ daf: pg.dataset.dafLabel || "?", pageW: Math.round(logicalW), bad });
  }
  return out;
});

let total = 0;
for (const r of res) {
  total += r.bad.length;
  const kinds = r.bad.length ? [...new Set(r.bad.map((x) => x.kind))].join(", ") : "";
  console.log(`דף ${r.daf} (רוחב ${r.pageW}) · ${r.bad.length ? `⚠ ${r.bad.length} — ${kinds}` : "✓ נקי"}`);
  for (const x of r.bad.slice(0, 3)) console.log(`     ${JSON.stringify(x)}`);
}
check("אין שורה שהטקסט בה חורג מהעמוד או רחב מהתיבה", total === 0, `=${total}`);

// ★ "לא נראים כלל" = המילים **חסרות**, לא מוסתרות. לכן משווים מילה-מילה
// את כל הטקסט שאמור להיות על הדף מול מה שבאמת מופיע — גמרא ורש"י גם יחד.
const data = JSON.parse(await readFile(resolve(ROOT, "public", "data", "sefaria", "vilna_shas", "berakhot.json"), "utf8"));
const book = data.book;
const letters = (x) => String(x || "").replace(/[^א-ת]/g, "");
const heNum = (n) => {
  const O = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"], T = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  if (n === 15) return "טו"; if (n === 16) return "טז";
  let o = ""; if (n >= 100) { o += "ק".repeat(Math.floor(n / 100)); n %= 100; }
  return o + (T[Math.floor(n / 10)] || "") + (O[n % 10] || "");
};
const onPage = await p.evaluate(() => {
  const m = {};
  for (const pg of document.querySelectorAll(".pages-container .page")) {
    const k = pg.dataset.dafLabel || "?";
    m[k] = [...pg.querySelectorAll(".v9-line")].map((l) => l.textContent).join(" ");
  }
  return m;
});
let missGem = 0, missRashi = 0, totGem = 0, totRashi = 0;
const examples = [];
for (const [label, text] of Object.entries(onPage)) {
  const pageLetters = letters(text);
  // איזה אינדקס עמוד זה
  const mm = label.match(/^(.+?)([.:])$/);
  if (!mm) continue;
  const O = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
  let daf = 0; for (const ch of mm[1]) daf += O[ch] || 0;
  const ai = (daf - 1) * 2 + (mm[2] === ":" ? 1 : 0);
  for (const seg of (book.gemara[ai] || [])) {
    for (const w of String(seg).split(/\s+/)) {
      const lw = letters(w);
      if (lw.length < 3) continue;
      totGem++;
      if (!pageLetters.includes(lw)) { missGem++; if (examples.length < 5) examples.push(`גמרא ${label}: ${lw.length} אותיות`); }
    }
  }
  for (const line of (book.rashi[ai] || [])) {
    for (const c of (line || [])) {
      for (const w of `${c.dh} ${c.body}`.split(/\s+/)) {
        const lw = letters(w);
        if (lw.length < 3) continue;
        totRashi++;
        if (!pageLetters.includes(lw)) { missRashi++; if (examples.length < 5) examples.push(`רש"י ${label}: ${lw.length} אותיות`); }
      }
    }
  }
}
console.log(`
מילים על העמודים — גמרא: ${totGem - missGem}/${totGem} · רש"י: ${totRashi - missRashi}/${totRashi}`);
if (examples.length) console.log("דוגמאות לחסרות:", examples.join(" | "));
check("אף מילה מהגמרא לא נעלמה", missGem === 0, `${missGem} חסרות מתוך ${totGem}`);
check('אף מילה מרש"י לא נעלמה', missRashi === 0, `${missRashi} חסרות מתוך ${totRashi}`);

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
