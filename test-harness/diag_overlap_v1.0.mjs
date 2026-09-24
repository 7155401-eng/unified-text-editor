// מודד את שלוש התלונות של משה (08:32:11) לפי **הגיאומטריה האמיתית
// על המסך** — getBoundingClientRect — ולא לפי סגנון ישיר.
//
//   1. „מילים שחופפות אחת על השניה ושורות שעולות אחת על השניה"
//   2. „שורות שיוצאות החוצה מהמקום"
//   3. „ומכוסות על ידי אזור הערות שולים רש״י שבצד שמאל"
//
// ⚠️ מדפיס מספרים בלבד — לא תוכן.
import { chromium } from "playwright-chromium";

const URL = process.env.RT_URL || "http://127.0.0.1:5212/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(5000);

await p.evaluate(() => {
  const ed = document.querySelector(".ProseMirror, [contenteditable='true']");
  if (!ed) return;
  ed.focus();
  const line = "אבגד הוזח טיכל מנסע פצקר שת ".repeat(40);
  for (let k = 0; k < 8; k++) {
    const d = document.createElement("p");
    d.textContent = line;
    ed.appendChild(d);
  }
  ed.dispatchEvent(new Event("input", { bubbles: true }));
});

let built = 0;
for (let i = 0; i < 40; i++) {
  built = await p.evaluate(() => document.querySelectorAll(
    ".pages-container .page:not(.page-placeholder)").length);
  if (built > 0) break;
  await p.waitForTimeout(1500);
}

const out = await p.evaluate(() => {
  const EPS = 1.0;                       // סבילות של פיקסל
  const res = { pages: built0(), overlaps: 0, outside: 0, hiddenBySide: 0,
                worstOverlapPx: 0, worstOutsidePx: 0, samples: [] };
  function built0() {
    return document.querySelectorAll(
      ".pages-container .page:not(.page-placeholder)").length;
  }
  const pgs = document.querySelectorAll(
    ".pages-container .page:not(.page-placeholder)");
  pgs.forEach((pg, pi) => {
    const pr = pg.getBoundingClientRect();
    const lines = [...pg.querySelectorAll(".v9-line")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((n) => n.r.width > 0 && n.r.height > 0);

    // 1+2 — חפיפה בין שורות, וחריגה מגבולות העמוד
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i].r;
      if (a.left < pr.left - EPS || a.right > pr.right + EPS ||
          a.top < pr.top - EPS || a.bottom > pr.bottom + EPS) {
        res.outside++;
        const d = Math.max(pr.left - a.left, a.right - pr.right,
                           pr.top - a.top, a.bottom - pr.bottom);
        if (d > res.worstOutsidePx) res.worstOutsidePx = d;
      }
      for (let j = i + 1; j < lines.length; j++) {
        const c = lines[j].r;
        const xo = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const yo = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (xo > EPS && yo > EPS) {
          res.overlaps++;
          if (yo > res.worstOverlapPx) res.worstOverlapPx = yo;
          if (res.samples.length < 5) {
            res.samples.push({ page: pi + 1, yOverlapPx: Math.round(yo),
                               xOverlapPx: Math.round(xo) });
          }
        }
      }
    }

    // 3 — שורה ראשית שנחבאת מתחת לאזור הערות-השוליים
    const side = pg.querySelector(
      ".v9-side, .v9-sidenotes, .sidenotes, .rashi, .v9-stream-side");
    if (side) {
      const sr = side.getBoundingClientRect();
      lines.forEach((n) => {
        if (n.el.dataset.v9Role && n.el.dataset.v9Role !== "main") return;
        const xo = Math.min(n.r.right, sr.right) - Math.max(n.r.left, sr.left);
        const yo = Math.min(n.r.bottom, sr.bottom) - Math.max(n.r.top, sr.top);
        if (xo > EPS && yo > EPS) res.hiddenBySide++;
      });
    }
  });
  return res;
});

console.log(JSON.stringify({ built, ...out }, null, 1));
await b.close();
