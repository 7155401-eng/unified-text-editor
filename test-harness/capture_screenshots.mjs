// Capture 5 representative pages for visual approval.
import { chromium } from "playwright-chromium";
import fs from "fs/promises";
import path from "path";

const URL = process.argv[2] || "http://127.0.0.1:5187/unified-text-editor/";
const OUT_DIR = "test-harness/screenshots";

await fs.mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on("console", msg => {
  if (msg.type() === "error") process.stdout.write(`[err] ${msg.text()}\n`);
});
await page.goto(URL, { waitUntil: "networkidle" });
// Capture initial state
await page.screenshot({ path: path.join(OUT_DIR, "00-initial.png"), fullPage: false });

await page.evaluate(() => {
  window.__FORCE_SYNC_RENDER__ = true;
  localStorage.setItem("ravtext.talmudLayout", "1");
  // Force light theme so screenshots are readable.
  try {
    localStorage.setItem("ravtext.theme", "light");
    document.documentElement.dataset.theme = "light";
    document.documentElement.classList.remove("theme-dark", "dark");
    document.body.classList.remove("theme-dark", "dark");
  } catch {}
});
await page.$eval("#btn-load-talmud", el => el.click());

// Wait stable
let stable = 0, last = -1;
for (let i = 0; i < 60; i++) {
  const c = await page.evaluate(() => document.querySelectorAll(".pages-container .page:not(.page-placeholder)").length);
  if (c === last) stable++; else { stable = 0; last = c; }
  if (stable >= 3 && c > 0) break;
  await new Promise(r => setTimeout(r, 350));
}
await page.waitForTimeout(3000);

const targets = [
  { name: "01-classic-with-crown", page: 0 },
  { name: "02-asymmetric", page: 12 },
  { name: "03-no-crown-or-single", page: 30 },
  { name: "04-mid-document", page: 45 },
  { name: "05-late-document", page: 70 },
];

// Diagnostic: list every .pages-container and the page count in each.
const containers = await page.evaluate(() => {
  return Array.from(document.querySelectorAll(".pages-container")).map(c => ({
    pageCount: c.querySelectorAll(".page:not(.page-placeholder)").length,
    width: Math.round(c.getBoundingClientRect().width),
    height: Math.round(c.getBoundingClientRect().height),
    parentClass: c.parentElement?.className || "",
  }));
});
console.log("pages-containers:", JSON.stringify(containers));

// Make pages-container the dominant area without moving it (avoids losing
// references). Hide siblings and force pages-container to fill the viewport.
await page.evaluate(() => {
  const pc = document.querySelector(".pages-container");
  if (!pc) return;
  // Walk up: find the root container (body's direct child that contains pc).
  let root = pc;
  while (root.parentElement && root.parentElement !== document.body) {
    root = root.parentElement;
  }
  // Hide siblings of root.
  Array.from(document.body.children).forEach(el => {
    if (el !== root) el.style.display = "none";
  });
  // Make root and ancestors of pc fill the viewport.
  let node = pc;
  while (node && node !== document.body) {
    node.style.width = "auto";
    node.style.maxWidth = "none";
    node.style.height = "auto";
    node.style.maxHeight = "none";
    node.style.flex = "1 1 auto";
    node.style.overflow = "visible";
    node = node.parentElement;
  }
  document.body.style.background = "#f5f5f5";
  document.body.style.color = "#222";
  pc.style.display = "flex";
  pc.style.flexDirection = "column";
  pc.style.gap = "24px";
  pc.style.padding = "20px";
  pc.style.alignItems = "center";
});
await page.waitForTimeout(1500);

for (const { name, page: pageIdx } of targets) {
  const box = await page.evaluate((idx) => {
    const p = document.querySelectorAll(".pages-container .page:not(.page-placeholder)")[idx];
    if (!p) return null;
    p.scrollIntoView({ block: "center", inline: "center" });
    return null;
  }, pageIdx);
  await page.waitForTimeout(500);
  // Capture full viewport to see context.
  if (pageIdx === 0) {
    await page.screenshot({ path: path.join(OUT_DIR, "X-viewport.png") });
  }
  const box2 = await page.evaluate((idx) => {
    const p = document.querySelectorAll(".pages-container .page:not(.page-placeholder)")[idx];
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left)),
      y: Math.max(0, Math.round(r.top)),
      width: Math.min(1700, Math.round(r.width)),
      height: Math.min(1400, Math.round(r.height)),
      bg: getComputedStyle(p).backgroundColor,
      color: getComputedStyle(p).color,
    };
  }, pageIdx);
  if (!box2) { console.log(`  - ${name}: missing`); continue; }
  console.log(`  · ${name}: bg=${box2.bg} color=${box2.color}`);
  const out = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({
    path: out,
    clip: { x: box2.x, y: box2.y, width: box2.width, height: box2.height },
  });
  console.log(`  ✓ ${name}: ${out} (${box2.width}x${box2.height})`);
}

// Also full preview overview (first 6 pages)
const all = await page.locator(".pages-container").screenshot({ path: path.join(OUT_DIR, "00-overview.png"), timeout: 15000 }).catch(() => null);

await browser.close();
console.log("\nDone.");
