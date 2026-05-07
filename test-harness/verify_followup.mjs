// Verify the three followup fixes.
import { chromium } from "playwright-chromium";

const URL = "http://127.0.0.1:5189/?normal=1";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("[pageerror]", e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.demoMode", "0");
  window.__RAVTEXT_DEMO_MODE__ = false;
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector(".pdf-toolbar", { timeout: 15000 });

// FIX 1: pages-container max-height should be 'none' so flex governs height.
const maxH = await page.evaluate(() => {
  const c = document.getElementById("pages-container");
  return c ? getComputedStyle(c).maxHeight : "no-container";
});
console.log("max-height of pages-container:", maxH, "(expected: none)");

// Preview pane should be bounded to viewport height.
const previewMetrics = await page.evaluate(() => {
  const p = document.querySelector(".preview-pane");
  if (!p) return null;
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  return {
    cssHeight: cs.height,
    cssMaxHeight: cs.maxHeight,
    actualH: Math.round(r.height),
    overflow: cs.overflow,
    vh: window.innerHeight,
  };
});
console.log("preview-pane:", JSON.stringify(previewMetrics), "(actualH should be ≈ vh-128)");

// FIX 2: inject many pages → scrollbar should appear.
await page.evaluate(() => {
  const c = document.getElementById("pages-container");
  if (!c) return;
  c.innerHTML = "";
  for (let i = 0; i < 12; i++) {
    const p = document.createElement("div");
    p.className = "page";
    p.style.contentVisibility = "visible";
    p.innerHTML = `<div class="page-main" style="padding:20px"><h3>עמוד ${i + 1}</h3></div>`;
    c.appendChild(p);
  }
});
await page.waitForTimeout(400);
const scrollState = await page.evaluate(async () => {
  const c = document.getElementById("pages-container");
  // Use instant scroll-to to avoid the smooth-scroll animation delay.
  c.scrollTo({ top: 200, behavior: "instant" });
  // Read after a microtask + frame.
  await new Promise(r => requestAnimationFrame(r));
  const movedTop = c.scrollTop;
  c.scrollTo({ top: 0, behavior: "instant" });
  // Look for actual scrollbar pseudo-element styling applied (computed track width).
  return {
    scrollH: c.scrollHeight,
    clientH: c.clientHeight,
    canScroll: c.scrollHeight > c.clientHeight,
    scrollTopMoved: movedTop > 0,
    overflowY: getComputedStyle(c).overflowY,
  };
});
console.log("scroll state:", JSON.stringify(scrollState),
  "(canScroll AND scrollTopMoved both expected true)");

// FIX 3: simulate dragging the resize handle right → preview-pane width should grow.
const before = await page.evaluate(() => {
  const p = document.querySelector(".preview-pane");
  return p ? p.getBoundingClientRect().width : -1;
});
const handleBox = await page.locator("#main-resize-handle").boundingBox();
if (!handleBox) {
  console.log("DRAG: handle not found");
} else {
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  // In RTL, handle is on right edge of preview (left side of editor).
  // Drag mouse to the LEFT (towards page left) → preview widens.
  // (Direction-aware formula handles either way; we just check non-zero delta.)
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 100, startY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => {
    const p = document.querySelector(".preview-pane");
    return p ? p.getBoundingClientRect().width : -1;
  });
  const overrideClass = await page.evaluate(() => document.body.classList.contains("has-preview-width-override"));
  console.log(`DRAG: preview width ${before}px → ${after}px; has-override class=${overrideClass} (expected width to change)`);
}

// Check scrollbar pseudo-element styling is applied (Chromium-only test).
const sbWidth = await page.evaluate(() => {
  const c = document.getElementById("pages-container");
  if (!c) return null;
  // clientWidth excludes scrollbar; offsetWidth includes it. Diff = scrollbar.
  return { clientW: c.clientWidth, offsetW: c.offsetWidth, scrollbarPx: c.offsetWidth - c.clientWidth };
});
console.log("scrollbar metrics:", JSON.stringify(sbWidth), "(scrollbarPx should be ~14)");

await page.screenshot({ path: "verify_followup.png", fullPage: false });
console.log("captured verify_followup.png");
await browser.close();
