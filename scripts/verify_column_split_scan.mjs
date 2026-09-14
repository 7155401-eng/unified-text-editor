// verify_column_split_scan.mjs — ציד החיתוך באמצע שורה.
//
// משה: "לפעמים החיתוך בין שני טורי רש\"י יוצא באמצע שורה".
// במקום לחכות למקרה שהוא יראה — סורקים דפים רבים ומודדים לבד.
//
// איך מזהים חיתוך באמצע שורה: בטור הימני, השורה **האחרונה** לפני המעבר
// לטור השמאלי חייבת להיות שורה מלאה — כלומר רוחבה קרוב לרוחב הרצועה.
// שורה אחרונה קצרה בהרבה = הטקסט נחתך באמצעה והמשכו עבר לטור השני.
//
// שימוש: node scripts/verify_column_split_scan.mjs [מדף] [עד דף]

import pp from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const FROM = process.argv[2] || "ב.";
const TO = process.argv[3] || "ה:";
const FULL_RATIO = 0.82;   // שורה "מלאה" = לפחות 82% מרוחב הטור

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

const scan = await p.evaluate((fullRatio) => {
  const out = [];
  for (const pg of document.querySelectorAll(".pages-container .page")) {
    const right = [...pg.querySelectorAll('.v9-line[data-v9-role="right"]')];
    const left = [...pg.querySelectorAll('.v9-line[data-v9-role="left"]')];
    if (!right.length || !left.length) continue;
    // השורה האחרונה בטור הימני = זו עם ה-top הגדול ביותר
    const byTop = (a, bb) => parseFloat(a.style.top) - parseFloat(bb.style.top);
    right.sort(byTop);
    const last = right[right.length - 1];
    // רוחב הרצועה שבה השורה יושבת = הרוחב המרבי בין שורות באותו x
    const sameCol = right.filter((l) => Math.abs(parseFloat(l.style.left) - parseFloat(last.style.left)) < 2);
    const stripW = Math.max(...sameCol.map((l) => parseFloat(l.style.width) || 0));
    const lastW = parseFloat(last.style.width) || 0;
    // שורה שמסומנת במפורש כסוף-פסקה אינה "חיתוך"
    const isParagraphEnd = last.dataset.v9SourceContinuationEnd === "1";
    out.push({
      daf: pg.dataset.dafLabel || "?",
      lastW: Math.round(lastW),
      stripW: Math.round(stripW),
      ratio: stripW ? Math.round((lastW / stripW) * 100) : 0,
      isParagraphEnd,
      rightLines: right.length,
      leftLines: left.length,
    });
  }
  return out;
}, FULL_RATIO);

console.log(`נסרקו ${scan.length} עמודים עם שני טורי רש"י`);
for (const r of scan) {
  const mark = r.ratio >= FULL_RATIO * 100 ? "✓" : "✗";
  console.log(`  ${mark} דף ${r.daf}: השורה האחרונה בימין ${r.lastW}/${r.stripW}px (${r.ratio}%) · ${r.rightLines}+${r.leftLines} שורות`);
}
const bad = scan.filter((r) => r.ratio < FULL_RATIO * 100);
check(`בכל ${scan.length} העמודים החיתוך נופל בסוף שורה מלאה`,
  bad.length === 0,
  bad.map((r) => `${r.daf}=${r.ratio}%`).join(","));
check("נסרקו עמודים בפועל", scan.length > 0, `=${scan.length}`);

await b.close();
console.log(`\nעברו ${pass} · נכשלו ${fail}`);
process.exit(fail ? 1 : 0);
