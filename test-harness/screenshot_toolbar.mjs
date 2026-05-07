// Screenshot the redesigned PDF toolbar in both themes.
import { chromium } from "playwright-chromium";

const URL = "http://127.0.0.1:5189/?normal=1";
const browser = await chromium.launch({ headless: true });

async function shot(theme, file) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 700 } });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => {
    localStorage.setItem("ravtext.demoMode", "0");
    window.__RAVTEXT_DEMO_MODE__ = false;
  });
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector(".pdf-toolbar", { timeout: 15000 });
  // Hide editor side; expand preview to full width.
  await page.evaluate(() => {
    document.body.classList.remove("preview-minimized");
    document.querySelectorAll(".main > .panel:not(.preview-pane)").forEach(el => el.remove());
    document.querySelectorAll("#ravtext-css-inject-panel").forEach(el => el.remove());
    document.querySelectorAll(".main-resize-handle").forEach(el => el.remove());
    const m = document.querySelector(".main");
    if (m) {
      m.style.gridTemplateColumns = "1fr";
      m.style.gridTemplateAreas = '"preview"';
    }
    const pane = document.querySelector(".preview-pane");
    if (pane) { pane.style.minWidth = "0"; pane.style.width = "100%"; }
  });
  await page.evaluate((t) => {
    if (t === "dark") {
      document.body.classList.remove("light-theme");
    } else {
      document.body.classList.add("light-theme");
    }
  }, theme);
  await page.waitForTimeout(300);
  // Element-only screenshot for crisp toolbar inspection.
  const tb = await page.$(".pdf-toolbar");
  if (tb) {
    await tb.screenshot({ path: file });
    console.log("captured", file);
  }
  await ctx.close();
}

await shot("dark", "tb_dark.png");
await shot("light", "tb_light.png");

// Hover preview
const ctx = await browser.newContext({ viewport: { width: 1500, height: 700 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.demoMode", "0");
  window.__RAVTEXT_DEMO_MODE__ = false;
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector(".pdf-toolbar", { timeout: 15000 });
await page.evaluate(() => {
  document.body.classList.add("light-theme");
  document.querySelectorAll(".main > .panel:not(.preview-pane)").forEach(el => el.remove());
  const m = document.querySelector(".main");
  if (m) { m.style.gridTemplateColumns = "1fr"; m.style.gridTemplateAreas = '"preview"'; }
});
await page.waitForTimeout(300);
await page.hover("#pdf-download");
await page.waitForTimeout(150);
const tb = await page.$(".pdf-toolbar");
if (tb) {
  await tb.screenshot({ path: "tb_hover.png" });
  console.log("captured tb_hover.png");
}
await ctx.close();
await browser.close();
