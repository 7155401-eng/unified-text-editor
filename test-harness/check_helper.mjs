import { chromium } from "playwright-chromium";
const browser = await chromium.launch({ headless: true });
const page = await browser.newContext({ viewport: { width: 1700, height: 1400 } }).then(c => c.newPage());
const errors = [];
page.on("pageerror", e => errors.push("PAGE ERROR: " + e.message));
page.on("requestfailed", req => errors.push("REQ FAIL: " + req.url() + " - " + req.failure()?.errorText));
page.on("console", m => {
  if (m.type() === "error") errors.push("CONSOLE ERROR: " + m.text());
});
await page.goto("http://127.0.0.1:5193/unified-text-editor/", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const has = await page.evaluate(() => typeof window.__loadCustomSample);
console.log("typeof __loadCustomSample:", has);
console.log("\n--- Errors ---");
for (const e of errors.slice(0, 10)) console.log(e);
await browser.close();
