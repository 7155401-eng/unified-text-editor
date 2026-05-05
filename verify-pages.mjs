// Manual QA endpoint for bots/agents.
// This script is NOT triggered by normal page load.
// Usage examples:
//   npm run verify:pages
//   VERIFY_URL=http://127.0.0.1:5174/ npm run verify:pages
//   VERIFY_BUTTON=btn-load-talmud npm run verify:pages

import puppeteer from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5185/";
const SAMPLE_BUTTON = process.env.VERIFY_BUTTON || "btn-load-shulchan";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 300000,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1000 },
});

const page = await browser.newPage();
const consoleMsgs = [];
const pageErrors = [];
page.on("console", (msg) => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector(`#${SAMPLE_BUTTON}`, { timeout: 15000 });
await page.evaluate(() => {
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.$eval(`#${SAMPLE_BUTTON}`, (el) => el.click());
const deadline = Date.now() + 180000;
let ready = false;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const pageCount = document.querySelectorAll(".pages-container .page").length;
    const status = document.getElementById("status")?.textContent || "";
    return { pageCount, status };
  });
  if (state.pageCount > 0 || /\d+ עמודים/.test(state.status)) {
    ready = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (!ready) {
  throw new Error("QA timeout: render did not finish within 180 seconds.");
}
await new Promise((r) => setTimeout(r, 250));

const report = await page.evaluate((expectedHeight) => {
  const pages = Array.from(document.querySelectorAll(".pages-container .page"));
  const pageInfo = pages.map((p, i) => {
    const main = p.querySelector(".page-main");
    const streams = p.querySelector(".page-streams");
    const renderedH = p.offsetHeight;
    const scrollH = p.scrollHeight;
    const overflowing = scrollH > renderedH + 1;

    let gap = 0;
    if (main && streams) {
      const mainRect = main.getBoundingClientRect();
      const streamsRect = streams.getBoundingClientRect();
      gap = Math.round(streamsRect.top - mainRect.bottom);
    } else if (main && !streams) {
      const mainRect = main.getBoundingClientRect();
      const pageRect = p.getBoundingClientRect();
      gap = Math.round(pageRect.bottom - mainRect.bottom - 22);
    }

    return {
      page: i + 1,
      width: p.offsetWidth,
      height: renderedH,
      scrollHeight: scrollH,
      overflowing,
      overflowAmount: overflowing ? scrollH - renderedH : 0,
      gapBetweenMainAndStreams: gap,
      mainParagraphs: main ? main.querySelectorAll("p, h1, h2, h3, h4, h5, h6").length : 0,
      streamBlocks: streams ? streams.querySelectorAll(".stream").length : 0,
      notes: p.querySelectorAll(".stream .note").length,
    };
  });

  const totalNotes = pageInfo.reduce((s, p) => s + p.notes, 0);
  const overflowingPages = pageInfo.filter((p) => p.overflowing).length;
  const bigGapPages = pageInfo.filter((p) => p.gapBetweenMainAndStreams > 50).length;
  const status = document.getElementById("status")?.textContent || "";

  return {
    summary: {
      pages: pageInfo.length,
      totalNotes,
      overflowingPages,
      bigGapPages,
      expectedHeight,
      status,
    },
    pages: pageInfo,
  };
}, 537);

console.log("=== SUMMARY ===");
console.log(JSON.stringify(report.summary, null, 2));
console.log("\n=== PER-PAGE ===");
for (const p of report.pages) {
  const mark = p.overflowing ? " OVERFLOW" : "";
  const gapMark = p.gapBetweenMainAndStreams > 50 ? " BIG-GAP" : "";
  console.log(
    `p${p.page}: ${p.width}x${p.height} scroll=${p.scrollHeight}${mark}${gapMark} | main=${p.mainParagraphs} streamBlocks=${p.streamBlocks} notes=${p.notes} gap=${p.gapBetweenMainAndStreams}px`
  );
}

if (consoleMsgs.length > 0) {
  console.log("\n=== CONSOLE ===");
  consoleMsgs.forEach((m) => console.log(m));
}

if (pageErrors.length > 0) {
  console.log("\n=== ERRORS ===");
  pageErrors.forEach((e) => console.log(e));
}

await page.screenshot({ path: "verify-output.png", fullPage: false });
console.log("\nscreenshot: verify-output.png");

const failed = report.summary.overflowingPages > 0;
await browser.close();
if (failed) process.exit(1);
