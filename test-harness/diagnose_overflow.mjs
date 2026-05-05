// diagnose_overflow.mjs — show what pages with extreme overflow contain.
import { chromium } from "playwright-chromium";

const URL = process.argv[2] || "http://127.0.0.1:5187/unified-text-editor/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
// Toggle for "on" or "off" via env
const ENABLED = process.env.DIAG_ENABLE !== "0";
await page.evaluate((v) => {
  window.__FORCE_SYNC_RENDER__ = true;
  localStorage.setItem("ravtext.talmudLayout", v ? "1" : "0");
}, ENABLED);
await page.$eval("#btn-load-talmud", el => el.click());
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

// Look at specific pages even if overflow doesn't show now.
const targets = [56, 86];
const overflows = await page.evaluate((idxs) => {
  const out = [];
  document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
    const o = p.scrollHeight - p.clientHeight;
    if (o > 100 || idxs.includes(i)) {
      const block = p.querySelector(":scope > .talmud-layout");
      out.push({
        idx: i,
        overflow: o,
        scrollH: p.scrollHeight,
        clientH: p.clientHeight,
        hasTalmudLayout: !!block,
        mode: block?.dataset?.talmudMode || (block ? Array.from(block.classList).filter(c=>c.startsWith("talmud-")).join(",") : ""),
        crowns: p.querySelectorAll(".talmud-crown-portion").length,
        bodies: p.querySelectorAll(".talmud-body-portion").length,
        expanded: p.querySelectorAll(".talmud-body-expanded").length,
        leftoverStreams: p.querySelectorAll(".page-streams > .stream").length,
        textLen: (p.textContent || "").length,
        mainText: p.querySelector(".page-main")?.textContent?.slice(0, 100),
      });
    }
  });
  return out;
}, targets);

console.log(`Pages with overflow > 100px or in targets: ${overflows.length}`);
for (const o of overflows.slice(0, 10)) console.log(JSON.stringify(o, null, 2));

await browser.close();
