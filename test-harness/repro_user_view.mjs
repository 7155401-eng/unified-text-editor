// Reproduce the user's exact view from the screenshot:
// light theme, narrow preview pane (~700px), toolbar wraps onto 3 rows.
import { chromium } from "playwright-chromium";
const URL = "http://127.0.0.1:5189/?normal=1";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.on("pageerror", e => console.error("[pageerror]", e.message));

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.demoMode", "0");
  window.__RAVTEXT_DEMO_MODE__ = false;
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector(".pdf-toolbar", { timeout: 15000 });

// Match user: light theme + non-resized panes (default split).
await page.evaluate(() => {
  document.body.classList.add("light-theme");
});
await page.waitForTimeout(400);

// What does each button's ACTUAL computed background look like?
const probe = await page.evaluate(() => {
  function snap(el) {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage.slice(0, 60),
      border: cs.border.slice(0, 60),
      shadow: cs.boxShadow.slice(0, 80),
      borderRadius: cs.borderRadius,
      h: Math.round(r.height),
      w: Math.round(r.width),
    };
  }
  return {
    toolbar: snap(document.querySelector(".pdf-toolbar")),
    group_navPill: snap(document.querySelector(".pdf-tb-group")),
    btn_first: snap(document.getElementById("pdf-first")),
    btn_prev: snap(document.getElementById("pdf-prev")),
    btn_zoomOut: snap(document.getElementById("pdf-zoom-out")),
    btn_pdf: snap(document.getElementById("pdf-download")),
    btn_html: snap(document.getElementById("pdf-download-html")),
    btn_print: snap(document.getElementById("pdf-print")),
    btn_debug: snap(document.getElementById("pdf-debug-snapshot")),
  };
});
console.log(JSON.stringify(probe, null, 2));

const tb = await page.$(".pdf-toolbar");
if (tb) await tb.screenshot({ path: "user_repro.png" });
await browser.close();
