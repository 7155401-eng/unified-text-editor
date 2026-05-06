// Quick: dump the HTML structure of a specific page after render.
import puppeteer from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5187/";
const SAMPLE = process.env.VERIFY_BUTTON || "btn-load-shulchan";
const PAGE_IDX = parseInt(process.env.VERIFY_PAGE || "10", 10); // 0-based

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1000 },
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
await new Promise(r => setTimeout(r, 8000));

const info = await page.evaluate((idx) => {
  const pages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
  if (idx >= pages.length) return { error: `page ${idx} not found, total=${pages.length}` };
  const p = pages[idx];
  return {
    pageIdx: idx,
    classes: p.className,
    height: p.offsetHeight,
    scrollHeight: p.scrollHeight,
    childrenSummary: Array.from(p.children).map(c => ({
      tag: c.tagName,
      cls: c.className,
      h: c.offsetHeight,
      top: c.getBoundingClientRect().top - p.getBoundingClientRect().top,
      bottom: c.getBoundingClientRect().bottom - p.getBoundingClientRect().top,
      textLen: (c.textContent || "").trim().length,
    })),
  };
}, PAGE_IDX);

console.log(JSON.stringify(info, null, 2));
await browser.close();
process.exit(0);
