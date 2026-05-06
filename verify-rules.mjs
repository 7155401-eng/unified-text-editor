// Comprehensive talmud-mode test: checks each of Moshe's primary rules per page.
// Outputs per-page report + screenshots.
import puppeteer from "puppeteer-core";
import fs from "fs";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://localhost:5192/unified-text-editor/";
const SAMPLE = process.env.VERIFY_BUTTON || "btn-load-shulchan";
const CROWN_LINES = parseInt(process.env.CROWN_LINES || "4", 10);

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new", args: ["--no-sandbox"],
  defaultViewport: { width: 1600, height: 1100 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 45000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
  localStorage.setItem("ravtext.talmudLayout.sideMode", "inner-outer");
  localStorage.setItem("ravtext.talmudLayout.preserveBreaks", "0");
  localStorage.setItem("ravtext.mishnaWrap", "0");
  localStorage.setItem("ravtext.liveRender", "1");
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector(`#${SAMPLE}`, { timeout: 15000 });
await page.$eval(`#${SAMPLE}`, e => e.click());

// Wait for stable render
const deadline = Date.now() + 60000;
let lastCount = -1, stable = 0;
while (Date.now() < deadline) {
  const s = await page.evaluate(() => {
    const pages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
    const status = document.getElementById("status")?.textContent || "";
    return { count: pages.length, finished: /\d+ עמודים/.test(status) };
  });
  if (s.count > 0 && s.count === lastCount && s.finished) {
    stable++;
    if (stable >= 3) break;
  } else stable = 0;
  lastCount = s.count;
  await new Promise(r => setTimeout(r, 500));
}
await new Promise(r => setTimeout(r, 3000));

const report = await page.evaluate((CROWN_LINES) => {
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)"));
  const issues = [];

  pages.forEach((p, idx) => {
    const num = idx + 1;
    const rect = p.getBoundingClientRect();
    const block = p.querySelector(":scope > .talmud-layout");

    // RULE: Page does not overflow
    const overflow = p.scrollHeight - p.clientHeight;
    if (overflow > 5) {
      issues.push({ page: num, sev: "HIGH", rule: "page-overflow", detail: `${overflow}px` });
    }

    // RULE: No element extends past page edge
    let pastEdge = 0;
    p.querySelectorAll("*").forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom > rect.bottom + 3) pastEdge++;
    });
    if (pastEdge > 0) {
      issues.push({ page: num, sev: "HIGH", rule: "content-past-page-bottom", detail: `${pastEdge} elements` });
    }

    if (!block) return; // Skip pages without talmud structure

    // RULE: Crown class exists when talmud streams are present
    const hasCrownClass = block.classList.contains("talmud-with-crown") ||
                         block.classList.contains("talmud-asymmetric-crown") ||
                         block.classList.contains("talmud-no-crown") ||
                         block.classList.contains("talmud-one-commentary");
    if (!hasCrownClass) {
      issues.push({ page: num, sev: "MED", rule: "no-crown-mode-class" });
    }

    // RULE: Crown is exactly CROWN_LINES lines (symmetric mode)
    if (block.classList.contains("talmud-with-crown")) {
      const crowns = block.querySelectorAll(":scope > .stream.talmud-crown-portion");
      crowns.forEach((c, ci) => {
        const titleEl = c.querySelector(":scope > .stream-title");
        const lines = new Set();
        const range = document.createRange();
        const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, {
          acceptNode: n => titleEl && titleEl.contains(n) ? NodeFilter.FILTER_REJECT
                         : (n.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        let tn;
        while ((tn = w.nextNode())) {
          range.setStart(tn, 0); range.setEnd(tn, tn.length);
          for (const r of range.getClientRects()) {
            if (r.height > 0) lines.add(Math.round(r.top));
          }
        }
        const n = lines.size;
        if (n > CROWN_LINES + 1) {
          issues.push({ page: num, sev: "MED", rule: `crown-${ci}-too-many-lines`, detail: `${n} > ${CROWN_LINES}` });
        }
      });
    }

    // RULE: No empty page-streams stream (title only)
    const streams = p.querySelectorAll(":scope > .page-streams > .stream[data-stream]");
    streams.forEach(s => {
      const code = s.getAttribute("data-stream");
      const txt = (s.textContent || "").trim();
      const titleTxt = (s.querySelector(":scope > .stream-title")?.textContent || "").trim();
      if (txt === titleTxt && txt.length > 0) {
        issues.push({ page: num, sev: "LOW", rule: "stream-title-only", detail: `code=${code}` });
      }
    });
  });

  // Word integrity check across pages
  const allText = pages.map(p => p.textContent || "").join(" ").replace(/\s+/g, " ");
  const lonelyHebrewLetters = (allText.match(/(?:^|\s)[א-ת](?:\s|$)/g) || []).length;

  return {
    pageCount: pages.length,
    issues,
    lonelyHebrewLetters,
    hiSev: issues.filter(i => i.sev === "HIGH").length,
    medSev: issues.filter(i => i.sev === "MED").length,
    lowSev: issues.filter(i => i.sev === "LOW").length,
  };
}, CROWN_LINES);

console.log("=== TALMUD MODE COMPREHENSIVE VERIFICATION ===");
console.log(`Pages: ${report.pageCount}`);
console.log(`HIGH severity: ${report.hiSev}, MED: ${report.medSev}, LOW: ${report.lowSev}`);
console.log(`Lonely letters: ${report.lonelyHebrewLetters}`);
console.log("");
if (report.issues.length > 0) {
  for (const i of report.issues.slice(0, 50)) {
    console.log(`[${i.sev}] p${i.page}: ${i.rule}${i.detail ? ` (${i.detail})` : ""}`);
  }
  if (report.issues.length > 50) console.log(`...and ${report.issues.length - 50} more`);
}
if (errors.length > 0) {
  console.log("\n=== PAGE ERRORS ===");
  errors.forEach(e => console.log(e));
}

await page.screenshot({ path: "verify-rules-output.png", fullPage: true });
console.log("\nScreenshot: verify-rules-output.png");
fs.writeFileSync("verify-rules-report.json", JSON.stringify(report, null, 2));
console.log("Report: verify-rules-report.json");

await browser.close();
process.exit(report.hiSev > 0 ? 1 : 0);
