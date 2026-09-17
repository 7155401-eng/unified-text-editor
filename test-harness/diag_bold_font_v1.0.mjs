// ⭐ מודד בפועל, בדפדפן: משקל-הגופן ושם-הגופן של הטקסט הראשי,
// עמוד אחר עמוד.
//
// שתי התלונות שנבדקות כאן:
//   1. „חלק מהעמודים טקסט ראשי מודגש ללא שביקשתי"
//   2. „הפונט בעמוד הראשון פונט אחר"
//
// ⚠️ מדפיס **מספרים ושמות-גופן בלבד** — לא תוכן מהמסמך.
import { chromium } from "playwright-chromium";

const URL = process.env.RT_URL || "http://127.0.0.1:5211/";
const WAIT = Number(process.env.RT_WAIT || 45000);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
await p.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

// ממתינים שייבנו עמודים
let pages = 0;
const t0 = Date.now();
while (Date.now() - t0 < WAIT) {
  pages = await p.evaluate(() =>
    document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length);
  if (pages > 0) break;
  await p.waitForTimeout(1000);
}

const out = await p.evaluate(() => {
  const res = { pages: [], containerFont: null, trials: 0 };
  const cont = document.querySelector(".pages-container");
  if (cont) {
    const cs = getComputedStyle(cont);
    res.containerFont = {
      family: cs.fontFamily.slice(0, 60),
      weight: cs.fontWeight,
      size: cs.fontSize,
    };
  }
  res.trials = document.querySelectorAll('[data-daf-trial="1"]').length;
  const pgs = document.querySelectorAll(
    ".pages-container .page:not(.page-placeholder)");
  pgs.forEach((pg, i) => {
    const lines = pg.querySelectorAll('.v9-line[data-v9-role="main"]');
    const all = lines.length ? lines : pg.querySelectorAll(".v9-line");
    const fams = {}, wts = {};
    all.forEach((ln) => {
      const cs = getComputedStyle(ln);
      const f = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim();
      fams[f] = (fams[f] || 0) + 1;
      wts[cs.fontWeight] = (wts[cs.fontWeight] || 0) + 1;
    });
    res.pages.push({ i, lines: all.length, fams, wts });
  });
  return res;
});

console.log(JSON.stringify({ built: pages, errors: errors.slice(0, 3), ...out },
                           null, 1));
await b.close();
