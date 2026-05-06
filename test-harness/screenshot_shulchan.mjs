import { chromium } from "playwright-chromium";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5193/unified-text-editor/", { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__FORCE_SYNC_RENDER__ = true;
  localStorage.setItem("ravtext.talmudLayout", "1");
});
await page.$eval("#btn-load-shulchan", el => el.click());
await page.waitForTimeout(8000);

// Inspect page 7 structure deeply.
const inspect = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)"));
  const p7 = pages[7];
  if (!p7) return { error: "no page 7" };
  const block = p7.querySelector(":scope > .talmud-layout");
  if (!block) return { error: "no block on 7", scrollH: p7.scrollHeight, clientH: p7.clientHeight };

  const main = p7.querySelector(".page-main.talmud-main");
  const pageRect = p7.getBoundingClientRect();
  const mainRect = main ? main.getBoundingClientRect() : null;

  const items = Array.from(block.children).map(c => {
    const r = c.getBoundingClientRect();
    return {
      tag: c.tagName,
      cls: c.className.slice(0, 80),
      top: Math.round(r.top - pageRect.top),
      bottom: Math.round(r.bottom - pageRect.top),
      h: Math.round(r.height),
      display: getComputedStyle(c).display,
      float: getComputedStyle(c).float,
      clear: getComputedStyle(c).clear,
      width: getComputedStyle(c).width,
      pos: getComputedStyle(c).position,
      textPreview: (c.textContent || "").slice(0, 50),
    };
  });

  return {
    pageH: Math.round(pageRect.height),
    pageScrollH: p7.scrollHeight,
    pageClientH: p7.clientHeight,
    blockH: Math.round(block.getBoundingClientRect().height),
    mainTop: mainRect ? Math.round(mainRect.top - pageRect.top) : null,
    mainBottom: mainRect ? Math.round(mainRect.bottom - pageRect.top) : null,
    items,
  };
});
console.log(JSON.stringify(inspect, null, 2));

await browser.close();
