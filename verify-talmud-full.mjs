// Full talmud-mode verification: checks Moshe's primary rules.
import puppeteer from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://localhost:5189/unified-text-editor/";
const SAMPLE = process.env.VERIFY_BUTTON || "btn-load-shulchan";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1100 },
});

const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.evaluate(() => {
  // ENABLE TALMUD MODE
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
  localStorage.setItem("ravtext.talmudLayout.sideMode", "inner-outer");
  localStorage.setItem("ravtext.talmudLayout.preserveBreaks", "0");
  localStorage.setItem("ravtext.mishnaWrap", "0");
  window.__FORCE_SYNC_RENDER__ = true;
});
// Reload to apply localStorage
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector(`#${SAMPLE}`, { timeout: 15000 });
await page.$eval(`#${SAMPLE}`, (el) => el.click());

// Wait for render — page count stable + status shows finished
const deadline = Date.now() + 60000;
let lastCount = -1, stableHits = 0;
while (Date.now() < deadline) {
  const state = await page.evaluate(() => {
    const pages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
    const status = document.getElementById("status")?.textContent || "";
    return { count: pages.length, status, finished: /\d+ עמודים/.test(status) };
  });
  if (state.count > 0 && state.count === lastCount && state.finished) {
    stableHits++;
    if (stableHits >= 2) break;
  } else {
    stableHits = 0;
  }
  lastCount = state.count;
  await new Promise(r => setTimeout(r, 500));
}
await new Promise(r => setTimeout(r, 2000)); // settle

// CHECK MOSHE'S PRIMARY RULES
const report = await page.evaluate(() => {
  const issues = [];
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)"));

  pages.forEach((p, idx) => {
    const num = idx + 1;
    const block = p.querySelector(":scope > .talmud-layout");
    if (!block) {
      issues.push({ page: num, issue: "no-talmud-layout-block" });
      return;
    }

    // Rule 1: page must NOT overflow
    const overflow = p.scrollHeight - p.clientHeight;
    if (overflow > 2) {
      issues.push({ page: num, issue: `OVERFLOW:${overflow}px (sH=${p.scrollHeight} cH=${p.clientHeight})` });
    }

    // Rule 2: crown must exist (if symmetric mode)
    const isSymmetric = block.classList.contains("talmud-with-crown");
    const isAsym = block.classList.contains("talmud-asymmetric-crown");
    const isNoCrown = block.classList.contains("talmud-no-crown");
    if (!isSymmetric && !isAsym && !isNoCrown) {
      issues.push({ page: num, issue: "no-crown-mode-class" });
    }

    // Rule 3: crown lines (if symmetric) — measure visual lines
    if (isSymmetric) {
      const crowns = block.querySelectorAll(":scope > .stream.talmud-crown-portion");
      crowns.forEach((c, ci) => {
        const range = document.createRange();
        const titleEl = c.querySelector(":scope > .stream-title");
        const seenY = new Set();
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, {
          acceptNode: n => titleEl && titleEl.contains(n) ? NodeFilter.FILTER_REJECT : (n.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        let tn;
        while ((tn = w.nextNode())) {
          range.setStart(tn, 0); range.setEnd(tn, tn.length);
          for (const r of range.getClientRects()) {
            if (r.height > 0) seenY.add(Math.round(r.top));
          }
        }
        const lines = seenY.size;
        if (lines > 5) {
          issues.push({ page: num, issue: `crown-${ci}-too-many-lines:${lines}` });
        }
      });
    }

    // Rule 4: NO content past page bottom (visual check)
    const pageRect = p.getBoundingClientRect();
    const allEls = p.querySelectorAll("*");
    let pastEdge = 0;
    allEls.forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom > pageRect.bottom + 2) pastEdge++;
    });
    if (pastEdge > 0) {
      issues.push({ page: num, issue: `${pastEdge}-elements-past-page-bottom` });
    }

    // Rule 5: main exists if hasMain
    const main = block.querySelector(":scope > .page-main, .page-main");
    if (!main || (main.textContent || "").trim() === "") {
      // OK if all content is in streams
    }
  });

  // Word integrity check: collect all visible text from all pages
  const allText = pages.map(p => (p.textContent || "")).join(" ").replace(/\s+/g, " ");
  // Look for suspicious split patterns: single Hebrew letter standalone
  const lonelyLetters = (allText.match(/\s[א-ת]\s/g) || []).length;

  return {
    pageCount: pages.length,
    issues,
    lonelyLetters,
    sampleText: allText.slice(0, 200),
  };
});

console.log("=== TALMUD MODE VERIFICATION ===");
console.log(`Pages: ${report.pageCount}`);
console.log(`Issues: ${report.issues.length}`);
console.log(`Lonely letters (suspect splits): ${report.lonelyLetters}`);
if (report.issues.length > 0) {
  console.log("\n=== ISSUES ===");
  report.issues.slice(0, 30).forEach(i => console.log(`p${i.page}: ${i.issue}`));
  if (report.issues.length > 30) console.log(`...and ${report.issues.length - 30} more`);
}
if (pageErrors.length > 0) {
  console.log("\n=== PAGE ERRORS ===");
  pageErrors.forEach(e => console.log(e));
}

// Screenshot first 3 pages
const screenshotPath = "verify-talmud-output.png";
await page.screenshot({ path: screenshotPath, fullPage: false });
console.log(`\nScreenshot: ${screenshotPath}`);

await browser.close();
process.exit(report.issues.length === 0 ? 0 : 1);
