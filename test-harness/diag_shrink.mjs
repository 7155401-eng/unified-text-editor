import { chromium } from "playwright-chromium";
import fs from "node:fs";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
page.on("console", m => console.log(`[${m.type()}] ${m.text()}`));
await page.goto("http://127.0.0.1:5193/unified-text-editor/", { waitUntil: "networkidle" });
await page.evaluate(() => { window.__FORCE_SYNC_RENDER__ = true; localStorage.setItem("ravtext.talmudLayout", "1"); });
const text = fs.readFileSync("samples/auto/tiny.txt", "utf-8");
await page.evaluate(async (t) => await window.__loadCustomSample(t), text);
await page.waitForTimeout(5000);

// Manually invoke pull-backward to ensure shrink ran.
const pulled = await page.evaluate(() => {
  if (typeof window.__talmudPullBackward === "function") {
    return window.__talmudPullBackward(document);
  }
  return "no helper";
});
console.log("Manual pull/shrink result:", pulled);
await page.waitForTimeout(500);

// Manually run shrink + check what happened
const result = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
    const block = p.querySelector(":scope > .talmud-layout");
    const pageRect = p.getBoundingClientRect();
    let maxBottom = pageRect.top;
    p.querySelectorAll("*").forEach(el => {
      if (getComputedStyle(el).display === "none") return;
      const r = el.getBoundingClientRect();
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    });
    const actualNeeded = maxBottom - pageRect.top;
    out.push({
      idx: i,
      hasBlock: !!block,
      hasCapped: !!p.querySelector("[data-talmud-capped-at]"),
      scrollH: p.scrollHeight,
      clientH: p.clientHeight,
      pageRectH: Math.round(pageRect.height),
      actualNeeded: Math.round(actualNeeded),
      shouldShrink: actualNeeded > 0 && actualNeeded + 8 < p.clientHeight,
    });
  });
  return out;
});
console.log(JSON.stringify(result, null, 2));

await browser.close();
