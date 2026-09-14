// verify_stretch.mjs — "שבירה לא נכונה באמצע הטקסט הראשי ובגלל זה מתיחה
// לא פרופורציונלית של תוכן השורה" (משה 14/09).
//
// ⚠ הלקח: לא סומכים על CSS. הבדיקה הקודמת חיפשה word-spacing גדול ומצאה
// 13 שורות בלבד — אבל המתיחה יכולה להיעשות גם ב-justify של הדפדפן, וגם
// ב-letter-spacing, ואז word-spacing נשאר 0 והבדיקה "נקייה".
// כאן מודדים את **הרווחים בפועל**: לכל שורה, המרחק בין סוף מילה לתחילת
// המילה הבאה, נמדד עם Range על כל מילה בנפרד.

import pp from "puppeteer-core";

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
  // מודדים את הרווח האמיתי בין מילה למילה בכל שורה
  const measureGaps = (el, zoom) => {
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) return null;
    const text = node.textContent;
    const rects = [];
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\s/.test(text[i])) i++;
      const start = i;
      while (i < text.length && !/\s/.test(text[i])) i++;
      if (i > start) {
        const r = document.createRange();
        r.setStart(node, start); r.setEnd(node, i);
        const bb = r.getBoundingClientRect();
        if (bb.width) rects.push({ left: bb.left / zoom, right: bb.right / zoom });
      }
    }
    if (rects.length < 3) return null;
    rects.sort((a, b) => b.right - a.right);   // RTL: מימין לשמאל
    const gaps = [];
    for (let k = 1; k < rects.length; k++) {
      const g = rects[k - 1].left - rects[k].right;
      if (g >= 0) gaps.push(g);
    }
    if (!gaps.length) return null;
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return { max: Math.max(...gaps), median, count: gaps.length };
  };

  const out = [];
  for (const pg of document.querySelectorAll(".pages-container .page")) {
    const pr = pg.getBoundingClientRect();
    const zoom = pr.width && parseFloat(pg.style.width) ? pr.width / parseFloat(pg.style.width) : 1;
    const bad = [];
    let checked = 0;
    for (const l of pg.querySelectorAll(".v9-line")) {
      const g = measureGaps(l, zoom);
      if (!g || g.median <= 0.1) continue;
      checked++;
      // מתיחה לא פרופורציונלית = רווח אחד גדול פי כמה מהחציון בשורה
      if (g.max > g.median * 3 && g.max - g.median > 6) {
        bad.push({ role: l.dataset.v9Role, max: Math.round(g.max), median: Math.round(g.median) });
      }
    }
    out.push({ daf: pg.dataset.dafLabel || "?", checked, bad });
  }
  return out;
});

let total = 0, checkedAll = 0;
for (const r of res) {
  total += r.bad.length; checkedAll += r.checked;
  console.log(`דף ${r.daf} · נבדקו ${r.checked} שורות · ${r.bad.length ? `⚠ ${r.bad.length} מתוחות: ${JSON.stringify(r.bad.slice(0, 3))}` : "✓ נקי"}`);
}
console.log(`\nסהכ ${checkedAll} שורות נמדדו · ${total} מתוחות`);
check("אין שורה עם רווח מוגזם בין מילים", total === 0, `=${total}`);

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
