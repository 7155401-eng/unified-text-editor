// probe: האם מעבר ב' (הגדלת אות למילוי) בכלל רץ, ומה הוא מצא?
import pp from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600000,
  args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
await p.goto("http://127.0.0.1:5211/?demo=0", { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "auto");
  localStorage.setItem("ravtext.vilnaDaf.fitPageToText", "1");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));
await p.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await p.$eval("#btn-vilna-import", (e) => e.click());
await p.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
await p.evaluate(() => {
  const m = document.querySelector(".sef-modal");
  const f = (e, v = "change") => e.dispatchEvent(new Event(v, { bubbles: true }));
  const s = m.querySelector("#vilna-import-tractate");
  s.value = "berakhot"; f(s);
  setTimeout(() => {
    const ss = m.querySelectorAll("select");
    ss[1].value = "dafim"; f(ss[1]);
    const t = [...m.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
    t[0].value = "ד."; f(t[0], "input");
    t[1].value = "ה:"; f(t[1], "input");
  }, 1800);
});
await new Promise((r) => setTimeout(r, 4000));
await p.evaluate(() => [...document.querySelectorAll(".sef-modal button")]
  .find((x) => x.textContent.includes("ייבא לעורך")).click());
const dl = Date.now() + 400000;
while (Date.now() < dl) {
  const ok = await p.evaluate(() => !!window.__VILNA_DAF_REPORT__ && window.__VILNA_DAF_REPORT__.pagesTotal > 0);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 3000));
const rep = await p.evaluate(() => window.__VILNA_DAF_REPORT__);
console.log("uniformFactor:", rep.uniformFactor, "| uniformSize:", rep.uniformSize);
for (const s of rep.segments) {
  console.log(` דף ${s.label} | מכפיל ${s.pageFactor} | fontScale ${s.fontScale ?? "(לא רץ)"} | מילוי ${Math.round((s.fill || 0) * 100)}%`);
}
const px = await p.evaluate(() => [...document.querySelectorAll(".pages-container .page")]
  .map((pg) => ({ daf: pg.dataset.dafLabel, fs: pg.dataset.dafFontScale || "-", f: pg.dataset.dafPageFactor })));
console.log("על העמודים:", JSON.stringify(px));
await b.close();
