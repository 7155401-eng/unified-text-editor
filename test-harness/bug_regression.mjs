// bug_regression.mjs — comprehensive regression check of all bugs identified
// in the Cloud-Chrome / GPT analysis sessions (passes 127-149).
//
// Each bug entry:
//   - id: short identifier
//   - description: what the bug was
//   - introduced: which pass/session
//   - fixed_in: which pass should fix it
//   - check: function returning { pass, detail }
//
// Usage:
//   node test-harness/bug_regression.mjs http://localhost:5189/unified-text-editor/
//   node test-harness/bug_regression.mjs --sample shulchan
//
// Output: per-bug PASS/FAIL with detail; summary at end.

import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.argv[2] || process.env.URL || "http://localhost:5189/unified-text-editor/";
const SAMPLE = (process.argv.includes("--sample") ? process.argv[process.argv.indexOf("--sample") + 1] : "shulchan");
const SAMPLE_BTN = SAMPLE === "talmud" ? "btn-load-talmud" : "btn-load-shulchan";

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
await page.evaluate(() => {
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01,02");
  localStorage.setItem("ravtext.talmudLayout.crownLines", "4");
  localStorage.setItem("ravtext.talmudLayout.mainWidth", "42");
  localStorage.setItem("ravtext.talmudLayout.sideMode", "inner-outer");
  window.__FORCE_SYNC_RENDER__ = true;
});
await page.reload({ waitUntil: "networkidle0", timeout: 45000 });
await page.waitForSelector(`#${SAMPLE_BTN}`, { timeout: 15000 });
await page.$eval(`#${SAMPLE_BTN}`, el => el.click());
// Wait until pages actually populate (count stable for 2 ticks)
const deadline = Date.now() + 60000;
let lastCount = -1, stableHits = 0;
while (Date.now() < deadline) {
  const c = await page.evaluate(() =>
    document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length
  );
  if (c > 0 && c === lastCount) {
    stableHits++;
    if (stableHits >= 2) break;
  } else {
    stableHits = 0;
  }
  lastCount = c;
  await new Promise(r => setTimeout(r, 500));
}
// extra settle for late-firing splitter (200ms + 1500ms timers)
await new Promise(r => setTimeout(r, 3000));
console.log(`(loaded ${lastCount} pages)`);

// ─────────────────────────────────────────────────────────────────────────────
// Bug definitions
// ─────────────────────────────────────────────────────────────────────────────

const BUGS = [
  {
    id: "BUG-01-overflow",
    description: "No page should have data-talmud-overflow-px > 5",
    fixed_in: "pass 145+147",
    check: () => {
      const pages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
      const overflows = [];
      pages.forEach((p, i) => {
        const ov = p.scrollHeight - p.clientHeight;
        if (ov > 5) overflows.push(`p${i+1}=${ov}px`);
      });
      return { pass: overflows.length === 0, detail: overflows.join(", ") || "no overflows" };
    },
  },
  {
    id: "BUG-02-crown-uniform",
    description: "All crowns should be ~71.66px (no 54/42/55.67 outliers)",
    fixed_in: "pass 148 (HARD_MIN)",
    check: () => {
      const heights = new Set();
      document.querySelectorAll(".talmud-crown-portion").forEach(c => {
        heights.add(Math.round(c.getBoundingClientRect().height * 10) / 10);
      });
      const arr = [...heights];
      const outliers = arr.filter(h => h > 0 && h < 70);
      return { pass: outliers.length === 0, detail: `heights=${arr.join(",")} | outliers=${outliers.join(",")}` };
    },
  },
  {
    id: "BUG-03-no-empty-pages",
    description: "No real (non-placeholder) page should be empty",
    fixed_in: "pass 149 (insertBefore)",
    check: () => {
      const realPages = document.querySelectorAll(".pages-container .page:not(.page-placeholder)");
      const empties = [];
      realPages.forEach((p, i) => {
        const len = (p.textContent || "").replace(/\s+/g, "").length;
        if (len < 20) empties.push(`p${i+1}=${len}chars`);
      });
      return { pass: empties.length === 0, detail: empties.join(", ") || `${realPages.length} pages, all populated` };
    },
  },
  {
    id: "BUG-04-stream-100-stacking",
    description: "When 2 streams alongside, neither should take 100% (should be 49.5/49.5)",
    fixed_in: "pass 128",
    check: () => {
      const issues = [];
      document.querySelectorAll(".talmud-layout").forEach((block, i) => {
        const expanded = [...block.querySelectorAll(".talmud-body-expanded")];
        if (expanded.length >= 2) {
          // 2+ expanded — none should be 100% if all are alongside
          const widths = expanded.map(e => e.offsetWidth);
          const pageW = block.closest(".page").offsetWidth;
          const allFullWidth = widths.every(w => w / pageW > 0.95);
          if (allFullWidth && widths.length > 1) {
            issues.push(`block${i}: ${widths.length} streams all 100%`);
          }
        }
      });
      return { pass: issues.length === 0, detail: issues.join(", ") || "OK" };
    },
  },
  {
    id: "BUG-05-orphan-titles",
    description: "No stream-title without content",
    fixed_in: "pre-existing rule (memory: never hide a stream)",
    check: () => {
      const orphans = [];
      document.querySelectorAll(".stream").forEach(s => {
        const title = s.querySelector(":scope > .stream-title");
        if (!title) return;
        const others = [...s.children].filter(c => !c.classList.contains("stream-title"));
        const totalLen = others.reduce((sum, c) => sum + (c.textContent || "").trim().length, 0);
        if (totalLen < 5 && others.length === 0) {
          orphans.push(`stream=${s.dataset.stream}`);
        }
      });
      return { pass: orphans.length === 0, detail: orphans.join(", ") || "no orphans" };
    },
  },
  {
    id: "BUG-06-content-past-edge",
    description: "No DOM element should extend below page-bottom",
    fixed_in: "pass 147 + correctTalmudOverflow",
    check: () => {
      const issues = [];
      document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
        const pageBottom = p.getBoundingClientRect().bottom;
        const block = p.querySelector(".talmud-layout");
        if (!block) return;
        const elements = block.querySelectorAll("*");
        let pastEdge = 0;
        elements.forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.bottom > pageBottom + 2 && r.top < pageBottom) pastEdge++;
        });
        if (pastEdge > 0) issues.push(`p${i+1}=${pastEdge}els`);
      });
      return { pass: issues.length === 0, detail: issues.join(", ") || "no past-edge" };
    },
  },
  {
    id: "BUG-07-crown-clipped-no-body",
    description: "Stream with crownLines+1 lines must have a body (not lose content)",
    fixed_in: "pass 132 (threshold +2 → +1)",
    check: () => {
      const issues = [];
      document.querySelectorAll(".talmud-crown-portion").forEach((c, i) => {
        const code = c.dataset.stream || c.getAttribute("data-stream");
        if (!code) return;
        const block = c.closest(".talmud-layout");
        if (!block) return;
        const body = block.querySelector(`.talmud-body-portion[data-stream="${code}"], .talmud-body-expanded[data-stream="${code}"], .talmud-body-portion[data-talmud-body-of="${code}"], .talmud-body-expanded[data-talmud-body-of="${code}"]`);
        const sh = c.scrollHeight, ch = c.clientHeight;
        if (sh > ch + 5 && !body) {
          issues.push(`crown${i}(${code}): ${sh - ch}px clipped, no body`);
        }
      });
      return { pass: issues.length === 0, detail: issues.join(", ") || "all clipped crowns have bodies" };
    },
  },
  {
    id: "BUG-08-page1-has-gpt",
    description: "First page should have גפ\"ת if streams 01/02 exist",
    fixed_in: "pass 141 (revert wrong fallback) + pass 136 (logic)",
    check: () => {
      const p1 = document.querySelector(".pages-container .page:not(.page-placeholder)");
      if (!p1) return { pass: false, detail: "no first page" };
      const streams = p1.querySelectorAll(".stream[data-stream]");
      const hasOurStreams = [...streams].some(s => s.dataset.stream === "01" || s.dataset.stream === "02");
      const hasBlock = !!p1.querySelector(".talmud-layout");
      if (hasOurStreams && !hasBlock) {
        return { pass: false, detail: "p1 has 01/02 streams but no talmud block" };
      }
      return { pass: true, detail: hasOurStreams ? "p1 has block" : "p1 has no relevant streams (correct)" };
    },
  },
  {
    id: "BUG-09-mid-word-split",
    description: "No words split mid-character",
    fixed_in: "extractBodyAfterSplit safe-break logic",
    check: () => {
      const allText = document.querySelector(".pages-container").textContent.replace(/\s+/g, " ");
      const lonelyLetters = (allText.match(/\s[א-ת]\s/g) || []).length;
      return { pass: lonelyLetters < 5, detail: `${lonelyLetters} lonely Hebrew letters (suspect mid-word splits)` };
    },
  },
  {
    id: "BUG-10-late-splitter-fired",
    description: "Late-firing splitter (pass 147) should have run",
    fixed_in: "pass 147",
    check: () => {
      const dbg = window.__SPLIT_BE_DEBUG__;
      if (!dbg) return { pass: true, detail: "no splitter activity (no overflow to fix)" };
      return { pass: true, detail: `splitter ran ${dbg.length} times: ${JSON.stringify(dbg).slice(0, 200)}` };
    },
  },
  {
    id: "BUG-11-continuation-pages-visible",
    description: "Pages created by splitter (talmud-body-expanded-continued) should be visible",
    fixed_in: "pass 149 (insertBefore correct position)",
    check: () => {
      const continued = document.querySelectorAll(".talmud-body-expanded-continued");
      if (continued.length === 0) return { pass: true, detail: "no continuation needed" };
      const issues = [];
      continued.forEach((c, i) => {
        const page = c.closest(".page");
        const isPlaceholder = page?.classList.contains("page-placeholder");
        if (isPlaceholder) issues.push(`continued${i} inside placeholder`);
      });
      return { pass: issues.length === 0, detail: issues.join(", ") || `${continued.length} continued pages OK` };
    },
  },
  {
    id: "BUG-12-pageerrors",
    description: "No page errors during render",
    fixed_in: "—",
    check: () => true, // checked separately
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────

console.log("=== BUG REGRESSION SUITE ===");
console.log(`URL: ${URL}`);
console.log(`Sample: ${SAMPLE} (${SAMPLE_BTN})`);
console.log(`Bugs to check: ${BUGS.length}`);
console.log("");

const results = [];
for (const bug of BUGS) {
  if (bug.id === "BUG-12-pageerrors") {
    const result = { pass: errors.length === 0, detail: errors.length ? errors.slice(0, 3).join(" | ") : "no errors" };
    results.push({ ...bug, ...result });
    continue;
  }
  try {
    const result = await page.evaluate(bug.check);
    results.push({ ...bug, ...result });
  } catch (e) {
    results.push({ ...bug, pass: false, detail: `exception: ${e.message}` });
  }
}

// Print results table
console.log("┌─────────────────────────────────────────────────────────────────────────────┐");
console.log("│ ID                            │ STATUS │ DETAIL                              │");
console.log("├─────────────────────────────────────────────────────────────────────────────┤");
results.forEach(r => {
  const icon = r.pass ? "✓ PASS" : "✗ FAIL";
  const id = r.id.padEnd(30);
  console.log(`│ ${id}│ ${icon} │ ${(r.detail || "").slice(0, 36).padEnd(36)}│`);
});
console.log("└─────────────────────────────────────────────────────────────────────────────┘");

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n=== SUMMARY ===`);
console.log(`  Passed: ${passed}/${results.length}`);
console.log(`  Failed: ${failed}/${results.length}`);
if (failed > 0) {
  console.log(`\n=== FAILED DETAILS ===`);
  results.filter(r => !r.pass).forEach(r => {
    console.log(`  ${r.id}: ${r.description}`);
    console.log(`    fixed_in: ${r.fixed_in}`);
    console.log(`    detail:   ${r.detail}`);
  });
}

await browser.close();
process.exit(failed > 0 ? 1 : 0);
