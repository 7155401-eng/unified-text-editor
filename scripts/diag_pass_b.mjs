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
const diag = await p.evaluate(() => {
  const r = window.__VILNA_DAF_REPORT__ || {};
  const pages = [...document.querySelectorAll(".pages-container .page")].map((pg, i) => ({
    i, w: parseFloat(pg.style.width) || 0, h: parseFloat(pg.style.height) || 0,
    factor: pg.dataset.dafPageFactor || "-", uniform: pg.dataset.dafUniform || "-",
    fontScale: pg.dataset.dafFontScale || "-",
    mainLines: pg.querySelectorAll('.v9-line[data-v9-role="main"]').length,
    geo: (() => {
      const g = {};
      for (const l of pg.querySelectorAll('.v9-line')) {
        const role = l.dataset.v9Role || '?';
        const top = parseFloat(l.style.top) || 0;
        const h = parseFloat(l.style.height) || 0;
        const left = parseFloat(l.style.left) || 0;
        const w = parseFloat(l.style.width) || 0;
        const o = g[role] || (g[role] = { n: 0, bot: 0, minL: 1e9, maxR: 0 });
        o.n++; o.bot = Math.max(o.bot, top + h);
        o.minL = Math.min(o.minL, left); o.maxR = Math.max(o.maxR, left + w);
      }
      for (const k in g) { g[k].bot = Math.round(g[k].bot); g[k].minL = Math.round(g[k].minL); g[k].maxR = Math.round(g[k].maxR); }
      return g;
    })(),
    sideLines: pg.querySelectorAll('.v9-line:not([data-v9-role="main"])').length,
  }));
  return { uniformFactor: r.uniformFactor, predicted: r.predictedScales,
    fitPage: r.fitPageToText, segScales: (r.segments||[]).map((s)=>s&&s.fontScale), scen: (()=>{const a=window.__V9_SCENARIOS__||[];const m={};for(const x of a)m[x]=(m[x]||0)+1;return m;})(), main: (()=>{const a=window.__V9_FLOW__||[];const seen=new Set();const out=[];for(const x of a){if(seen.has(x.pb))continue;seen.add(x.pb);out.push([x.pb,x.end,x.ovf?1:0,x.rE,x.lE,(x.st||[]).length]);}return out.sort((p,q)=>p[0]-q[0]);})(), nAll: (window.__V9_SIDE__||[]).length, factors: r.pageFactors, ratio: r.ratioMode, triedH: (r.segments||[]).map((x)=>x&&x.triedH), pages: pages.map(x=>({i:x.i,w:x.w,h:x.h})) };
});
console.log(JSON.stringify(diag, null, 1));
await b.close();
