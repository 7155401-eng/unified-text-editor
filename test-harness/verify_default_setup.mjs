// Verify the default Shulchan setup: labels, mishna mode, levels.
import { chromium } from "playwright-chromium";
const URL = "http://127.0.0.1:5189/?normal=1";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("[pageerror]", e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
// Reset localStorage so defaults apply.
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("ravtext.demoMode", "0");
  window.__RAVTEXT_DEMO_MODE__ = false;
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector(".pdf-toolbar", { timeout: 15000 });
await page.waitForTimeout(2000); // give time for sample to load and labels to populate

const result = await page.evaluate(() => {
  return {
    mishnaWrap: localStorage.getItem("ravtext.mishnaWrap"),
    levels: localStorage.getItem("ravtext.mishnaWrap.levels"),
    streamLabels: window.__STREAM_LABELS__,
    paneLabels: window.paneManager?.panes?.map(p => ({ code: p.streamCode, label: p.label })) || "no paneManager",
    streamTitlesInDom: Array.from(document.querySelectorAll(".pages-container .stream-title"))
      .slice(0, 8)
      .map(el => el.textContent.trim()),
  };
});
console.log(JSON.stringify(result, null, 2));

// Also check that no placeholder text remains in the rendered pages
const placeholderHits = await page.evaluate(() => {
  const text = document.body.innerText;
  return {
    hasPlaceholder: text.includes("ניסיון הערת"),
    sampleSnippet: text.substring(text.indexOf("יתגבר כארי"), text.indexOf("יתגבר כארי") + 200),
  };
});
console.log("placeholder check:", JSON.stringify(placeholderHits));

await browser.close();
