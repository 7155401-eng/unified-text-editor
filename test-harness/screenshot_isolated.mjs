import { chromium } from "playwright-chromium";
const URL = "http://127.0.0.1:5189/test-harness/design_isolated.html";
const browser = await chromium.launch({ headless: true });

async function shot(theme, file) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate((t) => {
    if (t === "dark") document.body.classList.remove("light-theme");
    else document.body.classList.add("light-theme");
  }, theme);
  await page.waitForTimeout(400);
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
  console.log("captured", file);
}

await shot("dark", "iso_dark.png");
await shot("light", "iso_light.png");

// Hover capture
const ctx = await browser.newContext({ viewport: { width: 1100, height: 220 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => document.body.classList.remove("light-theme"));
await page.waitForTimeout(300);
await page.hover("#pdf-scroll-down");
await page.waitForTimeout(150);
await page.screenshot({ path: "iso_hover.png", clip: { x: 0, y: 0, width: 1100, height: 220 } });
console.log("captured iso_hover.png");
await ctx.close();

await browser.close();
