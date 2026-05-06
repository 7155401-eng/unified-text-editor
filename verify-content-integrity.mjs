// verify-content-integrity.mjs — set-diff Hebrew words before vs after talmud toggle.
//
// Detects ANY content loss caused by talmud layout transformations.
// Compares the multiset of Hebrew word tokens between:
//   STATE A: talmudLayout=0 (raw streams)
//   STATE B: talmudLayout=1 (after all transformations)
//
// Exit 0 if no words lost. Exit 1 if any word missing.

import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : (process.env.URL || "http://localhost:5189/unified-text-editor/");
const sampleArgIdx = process.argv.indexOf("--sample");
const SAMPLE = sampleArgIdx >= 0 ? process.argv[sampleArgIdx + 1] : "shulchan";
const SAMPLE_BTN = SAMPLE === "talmud" ? "btn-load-talmud" : "btn-load-shulchan";

function tokenize(text) {
  // Hebrew words with optional nikud and hyphens; ignore punctuation and Latin.
  return (text.match(/[א-ת][א-ת֑-ֽֿ-ׇ־]*/g) || []);
}

function multisetDiff(a, b) {
  const counts = new Map();
  for (const w of a) counts.set(w, (counts.get(w) || 0) + 1);
  for (const w of b) counts.set(w, (counts.get(w) || 0) - 1);
  const lost = [];
  const extra = [];
  counts.forEach((c, w) => {
    if (c > 0) for (let i = 0; i < c; i++) lost.push(w);
    if (c < 0) for (let i = 0; i < -c; i++) extra.push(w);
  });
  return { lost, extra };
}

async function captureWords(page, talmudOn) {
  await page.evaluate((on) => {
    localStorage.setItem("ravtext.talmudLayout", on ? "1" : "0");
    localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
    localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
    localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
    window.__FORCE_SYNC_RENDER__ = true;
  }, talmudOn);
  await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
  await page.waitForSelector(`#${SAMPLE_BTN}`, { timeout: 15000 });
  await page.$eval(`#${SAMPLE_BTN}`, el => el.click());
  // wait for stable count
  const deadline = Date.now() + 60000;
  let lastCount = -1, stableHits = 0;
  while (Date.now() < deadline) {
    const c = await page.evaluate(() =>
      document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length
    );
    if (c > 0 && c === lastCount) {
      stableHits++;
      if (stableHits >= 2) break;
    } else stableHits = 0;
    lastCount = c;
    await new Promise(r => setTimeout(r, 500));
  }
  await new Promise(r => setTimeout(r, 3000));
  return await page.evaluate(() => {
    const text = (document.querySelector(".pages-container")?.textContent || "");
    return text;
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1200, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });

console.log(`\n=== CONTENT INTEGRITY — ${SAMPLE.toUpperCase()} ===`);
console.log("Capturing STATE A (talmud OFF)...");
const textA = await captureWords(page, false);
const wordsA = tokenize(textA);
console.log(`  ${wordsA.length} Hebrew word tokens`);

console.log("Capturing STATE B (talmud ON)...");
const textB = await captureWords(page, true);
const wordsB = tokenize(textB);
console.log(`  ${wordsB.length} Hebrew word tokens`);

const { lost, extra } = multisetDiff(wordsA, wordsB);

console.log(`\n=== DIFF ===`);
console.log(`  Words lost (in A, missing from B): ${lost.length}`);
console.log(`  Words extra (in B, not in A):     ${extra.length}`);

if (lost.length > 0) {
  console.log(`\n  Sample of lost words (first 20):`);
  lost.slice(0, 20).forEach(w => console.log(`    - ${w}`));
}
if (extra.length > 0) {
  console.log(`\n  Sample of extra words (first 20):`);
  extra.slice(0, 20).forEach(w => console.log(`    + ${w}`));
}

console.log(`\n  Page errors during render: ${errors.length}`);

await browser.close();
process.exit(lost.length > 0 ? 1 : 0);
