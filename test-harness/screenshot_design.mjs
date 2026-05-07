// Screenshot the viewer to verify design polish.
import { chromium } from "playwright-chromium";

const URL = "http://127.0.0.1:5189/?normal=1";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
page.on("pageerror", e => console.error("[pageerror]", e.message));
page.on("console", m => { if (m.type() === "error") console.error("[console.error]", m.text()); });

await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  localStorage.setItem("ravtext.demoMode", "0");
  window.__RAVTEXT_DEMO_MODE__ = false;
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });

// Make sure preview is not minimized.
await page.evaluate(() => {
  document.body.classList.remove("preview-minimized");
});
// Hide editor and CSS-inject panels so preview pane gets full window width.
await page.evaluate(() => {
  document.querySelectorAll(".main > .panel:not(.preview-pane)").forEach(el => el.remove());
  document.querySelectorAll("#ravtext-css-inject-panel").forEach(el => el.remove());
  document.querySelectorAll(".main-resize-handle").forEach(el => el.remove());
  const m = document.querySelector(".main");
  if (m) {
    m.style.gridTemplateColumns = "1fr";
    m.style.gridTemplateAreas = '"preview"';
  }
  const pane = document.querySelector(".preview-pane");
  if (pane) {
    pane.style.minWidth = "0";
    pane.style.width = "100%";
  }
});
await new Promise(r => setTimeout(r, 300));
// Diagnose page state.
const diag = await page.evaluate(() => {
  const list = [...document.body.children].map(el => ({
    tag: el.tagName,
    cls: el.className,
    id: el.id,
    z: getComputedStyle(el).zIndex,
    pos: getComputedStyle(el).position,
    display: getComputedStyle(el).display,
  }));
  // Find anything covering with high z-index.
  const covers = [...document.querySelectorAll("*")].filter(el => {
    const cs = getComputedStyle(el);
    return cs.position === "fixed" && parseInt(cs.zIndex || "0") >= 100;
  }).slice(0, 6).map(el => `${el.tagName}#${el.id}.${el.className} z=${getComputedStyle(el).zIndex}`);
  return { children: list, covers, body: document.body.className };
});
console.log("DIAG:", JSON.stringify(diag, null, 2));
// Wait for the toolbar to be visible.
await page.waitForSelector(".pdf-toolbar", { timeout: 15000 });
// Inject fake pages so the scrollbar has something to scroll.
await page.evaluate(() => {
  const c = document.getElementById("pages-container");
  if (!c) return;
  c.innerHTML = "";
  for (let i = 0; i < 10; i++) {
    const p = document.createElement("div");
    p.className = "page";
    p.dataset.pageIndex = String(i);
    p.style.contentVisibility = "visible";
    p.innerHTML = `<div class="page-main" style="padding:20px;font-size:14px;line-height:1.6;direction:rtl">
      <h3 style="color:#444">עמוד ${i + 1}</h3>
      <p>זוהי תצוגת דוגמה של עמוד ${i + 1}. הטקסט הזה נועד למלא את העמוד כדי שניתן יהיה לראות את פס הגלילה ואת כפתורי הגלילה החדשים בפעולה. אם אתה רואה את זה — הרינדור מצליח.</p>
      <p>שורה נוספת לדוגמה. שורה נוספת לדוגמה. שורה נוספת לדוגמה. שורה נוספת לדוגמה.</p>
    </div>`;
    c.appendChild(p);
  }
});
await new Promise(r => setTimeout(r, 500));

await page.screenshot({ path: "design_default.png" });
console.log("captured design_default.png");

// Light theme variant
await page.evaluate(() => {
  document.body.classList.add("light-theme");
});
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: "design_light.png" });
console.log("captured design_light.png");

// Hover the scroll-down button to capture the hover styling
await page.evaluate(() => {
  document.body.classList.remove("light-theme");
});
await page.hover("#pdf-scroll-down").catch(() => {});
await new Promise(r => setTimeout(r, 200));
await page.screenshot({ path: "design_hover.png" });
console.log("captured design_hover.png");

// Element screenshots — most reliable.
const tb = await page.$(".pdf-toolbar");
if (tb) {
  await tb.screenshot({ path: "design_toolbar.png" });
  console.log("captured design_toolbar.png (element)");
}
const grp = await page.$(".pdf-tb-scroll-group");
if (grp) {
  await grp.screenshot({ path: "design_scroll_group.png" });
  console.log("captured design_scroll_group.png");
}

const pc = await page.$("#pages-container");
if (pc) {
  await pc.screenshot({ path: "design_scrollbar.png" });
  console.log("captured design_scrollbar.png (element)");
}
const previewPane = await page.$(".preview-pane");
if (previewPane) {
  await previewPane.screenshot({ path: "design_preview_full.png" });
  console.log("captured design_preview_full.png");
}

// Final full body screenshot for debug.
const detail = await page.evaluate(() => {
  const tb = document.querySelector(".pdf-toolbar");
  const cs = tb && getComputedStyle(tb);
  const r = tb && tb.getBoundingClientRect();
  const grp = document.querySelector(".pdf-tb-scroll-group");
  return {
    tbStyle: cs ? { bg: cs.backgroundColor, display: cs.display, h: cs.height } : null,
    tbRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top } : null,
    grpExists: !!grp,
    grpHTML: grp ? grp.outerHTML.slice(0, 200) : null,
    btnCount: tb ? tb.querySelectorAll("button").length : 0,
  };
});
console.log("DETAIL:", JSON.stringify(detail, null, 2));
await page.screenshot({ path: "design_full_debug.png", fullPage: true });

await browser.close();
console.log("done");
