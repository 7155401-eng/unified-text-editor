// Full rule verification — 6 pages × all Moshe's rules + screenshot per page
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://localhost:5189/unified-text-editor/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 800, height: 700 },
});

const page = await browser.newPage();
await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector("#btn-load-shulchan", { timeout: 15000 });
await page.$eval("#btn-load-shulchan", el => el.click());
await new Promise(r => setTimeout(r, 12000));

// Per-page rule verdict
const verdict = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)"));
  const results = [];
  pages.forEach((p, idx) => {
    const num = idx + 1;
    const block = p.querySelector(":scope > .talmud-layout");
    const ov = p.scrollHeight - p.clientHeight;
    const r = { page: num, overflow_px: ov, hasGpt: !!block, rules: {} };

    if (!block) { results.push(r); return; }

    // Rule A: 0 overflow
    r.rules.no_overflow = ov <= 5;

    // Rule B: crown height uniform
    const crowns = Array.from(block.querySelectorAll(".talmud-crown-portion"));
    const crownHs = crowns.map(c => Math.round(c.getBoundingClientRect().height * 10) / 10);
    r.rules.crown_uniform = crownHs.length === 0 ||
      (crownHs.every(h => h >= 60 && h <= 80));
    r.crownHs = crownHs;

    // Rule C: bodies dynamic width
    const bodies = Array.from(block.querySelectorAll(".talmud-body-portion"));
    const bodyWs = bodies.map(b => Math.round(b.offsetWidth));
    r.bodyWs = bodyWs;
    const expanded = Array.from(block.querySelectorAll(".talmud-body-expanded"));
    const expandedWs = expanded.map(e => Math.round(e.offsetWidth));
    r.expandedWs = expandedWs;

    // Rule D: main not 100% if a body is alongside
    const mainEl = block.querySelector(":scope > .page-main, :scope > .talmud-main");
    if (mainEl) {
      const mw = mainEl.offsetWidth;
      const pageW = p.offsetWidth;
      r.mainW = mw;
      r.pageW = pageW;
      const ratio = mw / pageW;
      const hasBodyAlongside = bodies.length > 0 || expanded.some(e =>
        e.style.float === "right" || e.style.float === "left"
      );
      r.rules.main_not_100_with_body = !hasBodyAlongside || ratio < 0.95;
    }

    // Rule E: no orphan stream titles (title without content)
    const allStreams = block.querySelectorAll(".stream");
    let orphans = 0;
    allStreams.forEach(s => {
      const title = s.querySelector(":scope > .stream-title");
      if (!title) return;
      const others = Array.from(s.children).filter(c => !c.classList.contains("stream-title"));
      const totalLen = others.reduce((sum, c) => sum + (c.textContent || "").trim().length, 0);
      if (totalLen < 5) orphans++;
    });
    r.rules.no_orphan_titles = orphans === 0;
    r.orphans = orphans;

    // Rule F: page bottom respect
    const pageRect = p.getBoundingClientRect();
    const pageBottomY = pageRect.bottom;
    const allEls = block.querySelectorAll("*");
    let pastEdge = 0;
    allEls.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > pageBottomY + 2 && rect.top < pageBottomY) pastEdge++;
    });
    r.rules.no_past_edge = pastEdge === 0;
    r.pastEdge = pastEdge;

    results.push(r);
  });
  return results;
});

console.log("=== PER-PAGE VERDICT ===");
let totalPass = 0, totalFail = 0;
verdict.forEach(r => {
  const allRulesPass = Object.values(r.rules).every(v => v === true);
  if (allRulesPass) totalPass++;
  else totalFail++;
  console.log(`p${r.page}: gpt=${r.hasGpt} | overflow=${r.overflow_px}px | crowns=${r.crownHs?.join(",") || "—"} | bodies=${r.bodyWs?.join(",") || "—"} | exp=${r.expandedWs?.join(",") || "—"} | rules=${JSON.stringify(r.rules)}`);
});
console.log(`\n=== SUMMARY ===\n  Pass: ${totalPass}/${verdict.length}\n  Fail: ${totalFail}/${verdict.length}`);

// Screenshot each page individually
const pageEls = await page.$$(".pages-container .page:not(.page-placeholder)");
for (let i = 0; i < Math.min(pageEls.length, 6); i++) {
  await pageEls[i].screenshot({ path: `verify-page-${i + 1}.png` });
}
console.log(`\nScreenshots: verify-page-1..${Math.min(pageEls.length, 6)}.png`);

await browser.close();
process.exit(totalFail > 0 ? 1 : 0);
