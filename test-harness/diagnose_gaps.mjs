// diagnose_gaps.mjs — analyze why pages have large gaps at bottom.
import { chromium } from "playwright-chromium";
import fs from "node:fs";

const URL = "http://127.0.0.1:5192/unified-text-editor/";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__FORCE_SYNC_RENDER__ = true;
  localStorage.setItem("ravtext.talmudLayout", "1");
});

const text = fs.readFileSync("samples/auto/single-1.txt", "utf-8");
await page.evaluate(async (t) => await window.__loadCustomSample(t), text);
await page.waitForTimeout(5000);

const gaps = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
    const block = p.querySelector(":scope > .talmud-layout");
    if (!block) return;
    const blockRect = block.getBoundingClientRect();
    const pageRect = p.getBoundingClientRect();
    const gap = pageRect.bottom - blockRect.bottom;
    if (gap > 50) {
      const blockChildren = Array.from(block.children).map(c => ({
        tag: c.tagName, cls: c.className.slice(0, 60),
        h: Math.round(c.getBoundingClientRect().height),
        textLen: (c.textContent || "").length,
      }));
      out.push({
        idx: i, gap: Math.round(gap),
        blockH: Math.round(blockRect.height),
        pageH: Math.round(pageRect.height),
        blockChildren,
      });
    }
  });
  return out;
});

console.log(`single-1 has ${gaps.length} pages with >50px gap\n`);
for (const g of gaps) {
  console.log(`Page ${g.idx}: gap=${g.gap}px (block=${g.blockH}/page=${g.pageH})`);
  for (const c of g.blockChildren) {
    console.log(`  ${c.tag} h=${c.h} text=${c.textLen} cls=${c.cls}`);
  }
  console.log();
}

await browser.close();
