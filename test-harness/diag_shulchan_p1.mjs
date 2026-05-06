import { chromium } from "playwright-chromium";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5193/unified-text-editor/", { waitUntil: "networkidle" });
await page.evaluate(() => { window.__FORCE_SYNC_RENDER__ = true; localStorage.setItem("ravtext.talmudLayout", "1"); });
await page.$eval("#btn-load-shulchan", el => el.click());
await page.waitForTimeout(8000);
// Make sure render fired
await page.$eval("#btn-render", el => el.click()).catch(()=>{});
await page.waitForTimeout(5000);

// Inspect page 0 (which user calls page 1)
const inspect = await page.evaluate(() => {
  const allPages = Array.from(document.querySelectorAll(".page"));
  const realPages = allPages.filter(p => !p.classList.contains("page-placeholder"));
  if (realPages.length === 0) return { error: "no real pages", allPagesCount: allPages.length, allClasses: allPages.slice(0,3).map(p => p.className) };
  const p0 = realPages[0];
  const main = p0.querySelector(".page-main.talmud-main");
  if (!main) return { error: "no main on p0" };
  const children = Array.from(main.children).map(c => {
    const r = c.getBoundingClientRect();
    return {
      tag: c.tagName,
      cls: c.className.slice(0, 80),
      display: getComputedStyle(c).display,
      float: getComputedStyle(c).float,
      clear: getComputedStyle(c).clear,
      h: Math.round(r.height),
      top: Math.round(r.top),
      textPreview: (c.textContent || "").slice(0, 80),
      childTags: Array.from(c.children).map(cc => cc.tagName + "." + (cc.className || "").split(" ").slice(0, 2).join(".")),
    };
  });
  return {
    mainHTMLPreview: main.innerHTML.slice(0, 1500),
    childCount: main.children.length,
    children,
  };
});
console.log(JSON.stringify(inspect, null, 2));
await browser.close();
