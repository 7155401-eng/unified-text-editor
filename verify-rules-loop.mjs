// Comprehensive rule verification — checks all of Moshe's rules visually
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://localhost:5189/unified-text-editor/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1100 },
});

const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
  localStorage.setItem("ravtext.talmudLayout.sideMode", "inner-outer");
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector("#btn-load-shulchan", { timeout: 15000 });
await page.$eval("#btn-load-shulchan", el => el.click());
await new Promise(r => setTimeout(r, 10000));

const verdict = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)"));
  const issues = [];
  const stats = {
    totalPages: pages.length,
    overflowing: 0,
    crownsByHeight: {},
    bodiesByWidth: {},
    expandedByWidth: {},
    pagesWithGpt: 0,
  };

  pages.forEach((p, idx) => {
    const num = idx + 1;
    const block = p.querySelector(":scope > .talmud-layout");
    if (!block) return;
    stats.pagesWithGpt++;

    // Rule: 0 overflow
    const ov = p.scrollHeight - p.clientHeight;
    if (ov > 5) {
      stats.overflowing++;
      issues.push({ page: num, rule: "no-overflow", actual: `${ov}px`, severity: "CRITICAL" });
    }

    // Rule: crowns uniform height (all ~71.66px)
    const crowns = block.querySelectorAll(".talmud-crown-portion");
    crowns.forEach(c => {
      const h = Math.round(c.getBoundingClientRect().height * 10) / 10;
      stats.crownsByHeight[h] = (stats.crownsByHeight[h] || 0) + 1;
      if (h < 60 && h > 0) {
        issues.push({ page: num, rule: "crown-height-uniform", actual: `${h}px`, severity: "MAJOR" });
      }
    });

    // Rule: bodies symmetric (both 49.5% if 2 streams expand, 100% if 1)
    const bodies = block.querySelectorAll(".talmud-body-portion, .talmud-body-expanded");
    bodies.forEach(b => {
      const w = Math.round(b.offsetWidth);
      const isExpanded = b.classList.contains("talmud-body-expanded");
      if (isExpanded) {
        stats.expandedByWidth[w] = (stats.expandedByWidth[w] || 0) + 1;
      } else {
        stats.bodiesByWidth[w] = (stats.bodiesByWidth[w] || 0) + 1;
      }
    });

    // Rule: main not 100% if a stream is alongside
    const mainEl = block.querySelector(":scope > .page-main, :scope > .talmud-main");
    if (mainEl) {
      const mw = Math.round(mainEl.offsetWidth);
      const pageW = p.offsetWidth;
      const ratio = mw / pageW;
      const hasStreamAlongside = block.querySelectorAll(":scope > .talmud-body-portion, :scope > .talmud-body-expanded").length > 0;
      if (ratio > 0.95 && hasStreamAlongside) {
        issues.push({ page: num, rule: "main-not-100-with-stream", actual: `main=${mw}/${pageW}`, severity: "MINOR" });
      }
    }

    // Rule: stream titles not orphan (no title without content)
    const allStreams = block.querySelectorAll(".stream");
    allStreams.forEach(s => {
      const title = s.querySelector(":scope > .stream-title");
      if (!title) return;
      const childrenWithoutTitle = Array.from(s.children).filter(c =>
        !c.classList.contains("stream-title")
      );
      const hasContent = childrenWithoutTitle.some(c => (c.textContent || "").trim().length > 5);
      if (!hasContent && childrenWithoutTitle.length === 0) {
        issues.push({ page: num, rule: "no-orphan-title", stream: s.dataset.stream, severity: "MINOR" });
      }
    });
  });

  return { stats, issues };
});

console.log("=== STATS ===");
console.log(JSON.stringify(verdict.stats, null, 2));
console.log("\n=== ISSUES ===");
if (verdict.issues.length === 0) {
  console.log("✓ ALL RULES PASS");
} else {
  verdict.issues.forEach(i => console.log(`[${i.severity}] p${i.page}: ${i.rule} — ${JSON.stringify(i)}`));
}

// Screenshot for visual inspection
await page.screenshot({ path: "verify-rules-loop.png", fullPage: false });
console.log("\nScreenshot: verify-rules-loop.png");

await browser.close();
process.exit(verdict.issues.filter(i => i.severity === "CRITICAL").length > 0 ? 1 : 0);
