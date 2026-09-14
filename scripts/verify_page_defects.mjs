// verify_page_defects.mjs — סורק חמשת הפגמים שמשה דיווח עליהם 14/09.
//
// במקום לנחש איפה הבעיה — מודדים כל עמוד ומחפשים:
//   1. עמוד שאינו מלא (רווח גדול בתחתית).
//   2. "שבר" באמצע הגמרא — קפיצה אנכית בין שורה לשורה.
//   3. רווח מוגזם בין מילים בשורה (שבירה במקום הלא נכון + מתיחה).
//   4. חפיפה — מילים/שורות שרוכבות זו על זו, או שורה שנכנסת לאזור רש"י.
//   5. פונט שאינו הפונט שהוגדר — בעמוד הראשון לעומת השאר.
//
// שימוש: node scripts/verify_page_defects.mjs [מדף] [עד דף]

import pp from "puppeteer-core";
import { writeFile } from "node:fs/promises";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_ = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const FROM = process.argv[2] || "ב.";
const TO = process.argv[3] || "ה:";

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

const report = await p.evaluate(() => {
  const num = (v) => parseFloat(v) || 0;
  const pages = [...document.querySelectorAll(".pages-container .page")];
  return pages.map((pg, pageIdx) => {
    const pr = pg.getBoundingClientRect();
    const H = pr.height, W = pr.width;
    const lines = [...pg.querySelectorAll(".v9-line")].map((l) => ({
      el: l,
      role: l.dataset.v9Role || "?",
      top: num(l.style.top),
      left: num(l.style.left),
      width: num(l.style.width),
      height: num(l.style.height) || num(l.style.lineHeight),
      font: getComputedStyle(l).fontFamily,
      fontSize: Math.round(parseFloat(getComputedStyle(l).fontSize)),
      text: l.textContent || "",
      ws: getComputedStyle(l).wordSpacing,
      ls: getComputedStyle(l).letterSpacing,
      rect: l.getBoundingClientRect(),
    }));
    const main = lines.filter((l) => l.role === "main").sort((a, b) => a.top - b.top);
    const sides = lines.filter((l) => l.role !== "main");

    // 1. מילוי העמוד
    const bottom = lines.length ? Math.max(...lines.map((l) => l.rect.bottom - pr.top)) : 0;
    const fill = Math.round((bottom / H) * 100);
    // ★ משה 14/09: למדוד גם את **השטח** שאין בו תוכן, לא רק את הגובה.
    // עמוד שהטקסט בו יורד עד התחתית אבל חצי מהרוחב ריק — "מילוי 100%"
    // לפי גובה, ובעין חצי עמוד לבן.
    const logicalW = parseFloat(pg.style.width) || W;
    const logicalH = parseFloat(pg.style.height) || H;
    let covered = 0;
    for (const l of lines) covered += (l.width || 0) * (l.height || 0);
    const area = Math.round((covered / Math.max(1, logicalW * logicalH)) * 100);

    // 2. שבר אנכי בגמרא: פער גדול מגובה שורה בין שורות עוקבות
    const lineH = main.length ? Math.max(...main.map((l) => l.height)) : 0;
    const gaps = [];
    for (let i = 1; i < main.length; i++) {
      const gap = main[i].top - (main[i - 1].top + main[i - 1].height);
      if (lineH && gap > lineH * 0.6) {
        gaps.push({ after: i, gap: Math.round(gap), lineH: Math.round(lineH) });
      }
    }

    // 3. רווח מוגזם בין מילים
    const stretched = lines.filter((l) => {
      const ws = parseFloat(l.ws);
      return Number.isFinite(ws) && ws > 6;
    }).map((l) => ({ role: l.role, ws: l.ws, text: l.text.length }));

    // 4. חפיפות בין שורות + שורה שנכנסת לאזור צד
    const overlaps = [];
    for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i].rect, c = lines[j].rect;
        const xo = Math.min(a.right, c.right) - Math.max(a.left, c.left);
        const yo = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
        if (xo > 2 && yo > 2) {
          overlaps.push({ a: lines[i].role, b: lines[j].role, xo: Math.round(xo), yo: Math.round(yo) });
          if (overlaps.length > 8) break;
        }
      }
      if (overlaps.length > 8) break;
    }

    // 5. פונטים
    const fonts = {};
    for (const l of lines) fonts[l.role] = fonts[l.role] || l.font;

    // חריגה מגבולות
    const outside = lines.filter((l) => l.rect.right > pr.right + 1 || l.rect.left < pr.left - 1
      || l.rect.bottom > pr.bottom + 1).length;

    return {
      pageIdx, daf: pg.dataset.dafLabel || "?",
      size: `${Math.round(W)}x${Math.round(H)}`,
      fill, area, mainLines: main.length, sideLines: sides.length,
      verticalBreaks: gaps, stretchedLines: stretched.length,
      overlaps: overlaps.length, overlapSample: overlaps.slice(0, 3),
      outside, fonts,
    };
  });
});

console.log(`נסרקו ${report.length} עמודים\n`);
for (const r of report) {
  const flags = [];
  if (r.fill < 90) flags.push(`גובה ${r.fill}%`);
  if (r.area < 35) flags.push(`שטח ${r.area}%`);
  if (r.verticalBreaks.length) flags.push(`${r.verticalBreaks.length} שברים (${r.verticalBreaks.map((g) => g.gap + "px").join(",")})`);
  if (r.stretchedLines) flags.push(`${r.stretchedLines} שורות מתוחות`);
  if (r.overlaps) flags.push(`${r.overlaps} חפיפות`);
  if (r.outside) flags.push(`${r.outside} שורות מחוץ לעמוד`);
  console.log(`דף ${r.daf} (${r.size}) · גובה ${r.fill}% · שטח ${r.area}% · ${flags.length ? "⚠ " + flags.join(" · ") : "✓ נקי"}`);
  console.log(`   פונטים: ${JSON.stringify(r.fonts)}`);
}
// ★ משה: "הפונט של הזרם הראשי בעמוד הראשון בלבד אינו הפונט המבוקש".
{
  const mains = report.map((r) => r.fonts.main || "(אין)");
  const first = mains[0], rest = [...new Set(mains.slice(1))];
  console.log(`
פונט הראשי — עמוד 1: ${first}`);
  console.log(`פונט הראשי — שאר העמודים: ${JSON.stringify(rest)}`);
  console.log(rest.includes(first) ? "  ✓ העמוד הראשון זהה לשאר" : "  ✗ העמוד הראשון שונה מהשאר!");
}
await writeFile("C:/Users/User/ravtext_work/page_defects.json", JSON.stringify(report, null, 1), "utf8");
console.log("\nדוח מלא: C:/Users/User/ravtext_work/page_defects.json");
await b.close();
