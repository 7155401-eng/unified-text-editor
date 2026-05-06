// multi_sample_audit.mjs — runs the full test suite against MULTIPLE samples,
// not just sample-talmud. Loads each via direct text injection.
//
// Output: matrix of sample × check → PASS/FAIL/INFO.

import { chromium } from "playwright-chromium";
import fs from "node:fs";
import path from "node:path";

const URL = process.argv[2] || "http://127.0.0.1:5191/unified-text-editor/";
const SAMPLES_DIR = "samples/auto";

const samples = fs.readdirSync(SAMPLES_DIR)
  .filter(f => f.endsWith(".txt"))
  .map(f => ({ name: f.replace(".txt", ""), path: path.join(SAMPLES_DIR, f) }));

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();

const allResults = []; // { sample, check, status, detail }

async function setEnabled(enabled) {
  await page.evaluate((v) => {
    localStorage.setItem("ravtext.talmudLayout", v ? "1" : "0");
  }, enabled);
}

async function loadSampleText(text) {
  // Use the test helper exposed by main.js — same code path as built-in samples.
  const ok = await page.evaluate(async (t) => {
    if (typeof window.__loadCustomSample === "function") {
      await window.__loadCustomSample(t);
      return true;
    }
    return false;
  }, text);
  return ok;
}

async function waitStable(ms = 8000) {
  let last = -1, stable = 0;
  const start = Date.now();
  while (Date.now() - start < ms) {
    const c = await page.evaluate(() =>
      document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length);
    if (c === last && c > 0) stable++; else { last = c; stable = 0; }
    if (stable >= 3) break;
    await page.waitForTimeout(300);
  }
  // v33: extra wait for post-process (pull-backward + shrink) to apply.
  await page.waitForTimeout(2500);
}

async function runChecksForSample(sampleName) {
  const checks = [];
  const rec = (id, status, detail = "") => checks.push({ id, status, detail });

  // ON-EXISTS
  const layouts = await page.evaluate(() =>
    document.querySelectorAll(".talmud-layout").length);
  rec("ON-EXISTS", layouts > 0 ? "PASS" : "INFO", `count=${layouts}`);

  // CROWN-4
  const crowns = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".talmud-crown-portion:not(.talmud-body-portion):not(.talmud-body-expanded)")
      .forEach((c) => {
        const titleEl = c.querySelector(":scope > .stream-title");
        const range = document.createRange();
        const ys = new Set();
        const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            if (titleEl && titleEl.contains(node)) return NodeFilter.FILTER_REJECT;
            return node.textContent && node.textContent.length > 0
              ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          },
        });
        let n;
        while ((n = walker.nextNode())) {
          for (let i = 0; i < n.length; i++) {
            range.setStart(n, i); range.setEnd(n, i + 1);
            const r = range.getBoundingClientRect();
            if (r.width || r.height) ys.add(Math.round(r.top));
          }
        }
        out.push({ ds: c.getAttribute("data-stream") || "", lines: ys.size });
      });
    return out;
  });
  if (crowns.length === 0) rec("CROWN-4", "INFO", "no crowns");
  else {
    const ok = crowns.every(c => c.lines >= 3 && c.lines <= 5);
    rec("CROWN-4", ok ? "PASS" : "FAIL", JSON.stringify(crowns.slice(0, 3)));
  }

  // NO-OVERFLOW
  const overflows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
      const o = p.scrollHeight - p.clientHeight;
      if (o > 2) out.push({ idx: i, overflow: o });
    });
    return out;
  });
  rec("NO-OVERFLOW", overflows.length === 0 ? "PASS" : "FAIL",
    `${overflows.length} pages, max=${Math.max(0, ...overflows.map(o => o.overflow))}`);

  // BODY-INHERITS
  const badBody = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".talmud-body-portion, .talmud-body-expanded").forEach(b => {
      if (b.classList.contains("talmud-crown-portion")) bad.push(b.dataset.stream || "?");
    });
    return bad;
  });
  rec("BODY-INHERITS", badBody.length === 0 ? "PASS" : "FAIL", JSON.stringify(badBody));

  // BODY-GAP
  const noGap = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".talmud-body-portion").forEach(b => {
      const cs = getComputedStyle(b);
      if (b.classList.contains("talmud-right") && parseFloat(cs.marginLeft) <= 0) bad.push(b.dataset.stream);
      if (b.classList.contains("talmud-left") && parseFloat(cs.marginRight) <= 0) bad.push(b.dataset.stream);
    });
    return bad;
  });
  rec("BODY-GAP", noGap.length === 0 ? "PASS" : "FAIL", JSON.stringify(noGap.slice(0, 3)));

  // NO-MID-WORD
  const midWord = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".talmud-body-portion, .talmud-body-expanded").forEach(b => {
      const txt = (b.textContent || "").trim();
      if (txt.length === 0) return;
      const firstChar = txt[0];
      if (firstChar && !/[\s.,;:!?״׳׃׀־"']/.test(firstChar) && /[א-ת]/.test(firstChar)) {
        // Check if previous element ended with space.
        const prev = b.previousElementSibling;
        if (prev) {
          const prevTxt = (prev.textContent || "").trim();
          const lastChar = prevTxt[prevTxt.length - 1];
          if (lastChar && !/[\s.,;:!?״׳׃׀־"']/.test(lastChar)) bad.push(b.dataset.stream || "?");
        }
      }
    });
    return bad;
  });
  rec("NO-MID-WORD", midWord.length === 0 ? "PASS" : "FAIL", JSON.stringify(midWord.slice(0, 3)));

  // VALIDATE-ALL
  const validateAll = await page.evaluate(() => {
    const r = window.__talmudDebug?.validateAllPages?.();
    if (!r) return null;
    return { ok: r.ok, errors: r.errors?.length || 0,
             firstErrors: (r.errors || []).slice(0, 3).map(e => `${e.invariant}: ${e.message}`) };
  });
  if (validateAll == null) rec("VALIDATE-ALL", "INFO", "no debug API");
  else rec("VALIDATE-ALL", validateAll.ok ? "PASS" : "FAIL", JSON.stringify(validateAll));

  // GAP-IN-MIDDLE — pages with > 100px white at the bottom
  const gaps = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
      const block = p.querySelector(":scope > .talmud-layout");
      if (!block) return;
      const blockBottom = block.getBoundingClientRect().bottom;
      const pageBottom = p.getBoundingClientRect().bottom;
      const gap = pageBottom - blockBottom;
      if (gap > 100) out.push({ idx: i, gap: Math.round(gap) });
    });
    return out;
  });
  rec("NO-LARGE-GAP", gaps.length === 0 ? "PASS" : "FAIL",
    `${gaps.length} pages, max=${Math.max(0, ...gaps.map(g => g.gap))}`);

  return checks;
}

console.log(`Multi-sample audit · ${URL}`);
console.log("─".repeat(80));

await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => { window.__FORCE_SYNC_RENDER__ = true; });

for (const sample of samples) {
  const text = fs.readFileSync(sample.path, "utf-8");
  await setEnabled(true);
  const loaded = await loadSampleText(text);
  if (!loaded) {
    console.log(`  ! could not load ${sample.name} via setContent — skipping`);
    continue;
  }
  await waitStable(10000);

  const checks = await runChecksForSample(sample.name);
  for (const c of checks) {
    allResults.push({ sample: sample.name, ...c });
    const mark = c.status === "PASS" ? "✓" : c.status === "FAIL" ? "✗" : "?";
    console.log(`  ${mark} ${sample.name.padEnd(20)} ${c.id.padEnd(15)} ${c.status}${c.detail ? " " + c.detail.slice(0, 80) : ""}`);
  }
  console.log();
}

console.log("─".repeat(80));
const grouped = {};
for (const r of allResults) {
  if (!grouped[r.id]) grouped[r.id] = { PASS: 0, FAIL: 0, INFO: 0 };
  grouped[r.id][r.status]++;
}
console.log("\nCheck summary across all samples:");
for (const [id, counts] of Object.entries(grouped)) {
  console.log(`  ${id.padEnd(15)} PASS=${counts.PASS} FAIL=${counts.FAIL} INFO=${counts.INFO}`);
}

fs.writeFileSync("test-harness/multi_audit_results.json", JSON.stringify(allResults, null, 2));

await browser.close();
const totalFails = allResults.filter(r => r.status === "FAIL").length;
process.exit(totalFails > 0 ? 1 : 0);
