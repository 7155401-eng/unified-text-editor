// מודד בפועל: משקל וגופן של הטקסט הראשי, אחרי טעינת תוכן.
// ⚠️ מדפיס מספרים ושמות-גופן בלבד.
import { chromium } from "playwright-chromium";

const URL = process.env.RT_URL || "http://127.0.0.1:5211/";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 100)));
await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(5000);

// מזינים טקסט ישירות לעורך — לא תלוי בשרת נתונים חיצוני
const typed = await p.evaluate(() => {
  const ed = document.querySelector(".ProseMirror, [contenteditable='true']");
  if (!ed) return false;
  ed.focus();
  const mk = (t) => {
    const d = document.createElement("p");
    d.textContent = t;
    return d;
  };
  const words = [];
  for (let i = 0; i < 40; i++) {
    words.push("אבגד הוזח טיכל מנסע פצקר שת ");
  }
  for (let k = 0; k < 8; k++) ed.appendChild(mk(words.join("")));
  ed.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
});

let built = 0;
for (let i = 0; i < 40; i++) {
  built = await p.evaluate(() => document.querySelectorAll(
    ".pages-container .page:not(.page-placeholder)").length);
  if (built > 0) break;
  await p.waitForTimeout(1500);
}

const out = await p.evaluate(() => {
  const res = { pages: [], trialsLeft: 0 };
  res.trialsLeft = document.querySelectorAll('[data-daf-trial="1"]').length;
  const pgs = document.querySelectorAll(
    ".pages-container .page:not(.page-placeholder)");
  pgs.forEach((pg, i) => {
    const all = pg.querySelectorAll(".v9-line, p, .page-line");
    const fams = {}, wts = {};
    all.forEach((ln) => {
      if (!ln.textContent || !ln.textContent.trim()) return;
      const cs = getComputedStyle(ln);
      const f = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      fams[f] = (fams[f] || 0) + 1;
      wts[cs.fontWeight] = (wts[cs.fontWeight] || 0) + 1;
    });
    res.pages.push({ page: i + 1, lines: all.length, fonts: fams, weights: wts });
  });
  return res;
});

console.log(JSON.stringify(
  { typed, built, errors: errs.slice(0, 2), ...out }, null, 1));
await b.close();
