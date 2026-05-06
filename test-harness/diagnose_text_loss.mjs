// diagnose_text_loss.mjs — pinpoint which page/stream loses text on talmud-on.
import { chromium } from "playwright-chromium";

const URL = process.argv[2] || "http://127.0.0.1:5187/unified-text-editor/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__FORCE_SYNC_RENDER__ = true;
  localStorage.setItem("ravtext.talmudLayout", "1");
});
await page.$eval("#btn-load-talmud", el => el.click());
// Wait for stable page count
let lastCount = -1, stable = 0;
const start = Date.now();
while (Date.now() - start < 60000) {
  const c = await page.evaluate(() =>
    document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length);
  if (c > 0 && c === lastCount) stable++;
  else { stable = 0; lastCount = c; }
  if (stable >= 3) break;
  await new Promise(r => setTimeout(r, 350));
}
await page.waitForTimeout(800);

async function getPerPage() {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
      const text = (p.textContent || "").replace(/\s+/g, " ").trim();
      out.push({ idx: i, len: text.length, sample: text.slice(0, 40) });
    });
    return out;
  });
}

async function setEnabled(v) {
  await page.evaluate((vv) => {
    localStorage.setItem("ravtext.talmudLayout", vv ? "1" : "0");
    const t = document.getElementById("talmud-layout-toggle");
    if (t && t.checked !== vv) {
      t.checked = vv;
      t.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, v);
  await page.waitForTimeout(800);
}

await setEnabled(false);
const off = await getPerPage();
await setEnabled(true);
const on = await getPerPage();

const diffs = [];
for (let i = 0; i < Math.min(off.length, on.length); i++) {
  if (off[i].len !== on[i].len) {
    diffs.push({ idx: i, offLen: off[i].len, onLen: on[i].len, delta: on[i].len - off[i].len, sample: off[i].sample });
  }
}
const offTotal = off.reduce((s, p) => s + p.len, 0);
const onTotal = on.reduce((s, p) => s + p.len, 0);
console.log(`Total off=${offTotal} on=${onTotal} delta=${onTotal - offTotal}`);
console.log(`Pages off=${off.length} on=${on.length}`);
console.log(`Differing pages: ${diffs.length}`);
for (const d of diffs.slice(0, 20)) console.log(JSON.stringify(d));

await browser.close();
