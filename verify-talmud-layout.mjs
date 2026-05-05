import puppeteer from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5173/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1500, height: 1100 },
});

const page = await browser.newPage();
const consoleMsgs = [];
const pageErrors = [];
page.on("console", (msg) => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01 02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
  localStorage.setItem("ravtext.talmudLayout.sideMode", "right-left");
  localStorage.setItem("ravtext.mishnaWrap", "0");
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.waitForSelector("#btn-load-talmud", { timeout: 15000 });
await page.$eval("#btn-load-talmud", (el) => el.click());

const deadline = Date.now() + 180000;
let ready = false;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const pageCount = document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length;
    const talmudBlocks = document.querySelectorAll(".talmud-layout").length;
    const status = document.getElementById("status")?.textContent || "";
    return { pageCount, talmudBlocks, status };
  });
  if (state.pageCount > 0 && state.talmudBlocks > 0) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) throw new Error("Talmud QA timeout: layout did not render.");
await new Promise((r) => setTimeout(r, 750));

const report = await page.evaluate(() => {
  const api = window.__talmudDebugApi;
  const snapshot = api?.snapshot?.(6) || null;
  const problems = api?.problems?.() || [];
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)")).slice(0, 6);
  const visual = pages.map((page, index) => {
    const pageRect = page.getBoundingClientRect();
    const block = page.querySelector(".talmud-layout");
    const main = page.querySelector(".page-main.talmud-main");
    const streams = Array.from(page.querySelectorAll(".stream.talmud-commentary"));
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x - pageRect.x), y: Math.round(r.y - pageRect.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom - pageRect.y), right: Math.round(r.right - pageRect.x) };
    };
    return {
      page: index + 1,
      scrollOverflow: page.scrollHeight - page.offsetHeight,
      block: rectOf(block),
      main: rectOf(main),
      streams: streams.map((s) => ({ stream: s.dataset.stream, role: s.dataset.talmudRole, rect: rectOf(s), text: (s.textContent || "").trim().slice(0, 80) })),
    };
  });
  return { problems, visual, snapshot };
});

await page.screenshot({ path: "verify-talmud-layout.png", fullPage: false });
console.log(JSON.stringify({
  problems: report.problems,
  visual: report.visual,
  consoleMsgs,
  pageErrors,
  screenshot: "verify-talmud-layout.png",
}, null, 2));

await browser.close();
if (pageErrors.length || report.problems.length) process.exit(1);
