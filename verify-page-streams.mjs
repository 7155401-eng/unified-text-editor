import puppeteer from "puppeteer-core";
const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://localhost:5191/unified-text-editor/";
const SAMPLE = process.env.VERIFY_BUTTON || "btn-load-shulchan";
const PAGE_IDX = parseInt(process.env.VERIFY_PAGE || "0", 10);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", args: ["--no-sandbox"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.sideMode", "inner-outer");
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector(`#${SAMPLE}`, { timeout: 15000 });
await page.$eval(`#${SAMPLE}`, (el) => el.click());
await new Promise(r => setTimeout(r, 6000));

const info = await page.evaluate((idx) => {
  const pages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
  if (idx >= pages.length) return { error: `not found, total=${pages.length}` };
  const p = pages[idx];
  const streams = Array.from(p.querySelectorAll(".stream"));
  return {
    pageClasses: p.className,
    blockExists: !!p.querySelector(":scope > .talmud-layout"),
    blockClasses: p.querySelector(":scope > .talmud-layout")?.className || null,
    streams: streams.map(s => ({
      code: s.getAttribute("data-stream"),
      cls: s.className,
      title: s.querySelector(".stream-title")?.textContent || null,
      h: s.offsetHeight,
    })),
  };
}, PAGE_IDX);
console.log(JSON.stringify(info, null, 2));
await browser.close();
process.exit(0);
