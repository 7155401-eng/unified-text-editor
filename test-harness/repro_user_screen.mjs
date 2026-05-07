// Reproduce the user's screen with sidebar open to inspect what they actually see.
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

// Inject many pages so content overflows.
await page.evaluate(() => {
  const c = document.getElementById("pages-container");
  if (!c) return;
  c.innerHTML = "";
  for (let i = 0; i < 8; i++) {
    const p = document.createElement("div");
    p.className = "page";
    p.style.contentVisibility = "visible";
    p.dataset.pageIndex = String(i);
    p.innerHTML = `<div class="page-main" style="padding:20px"><h3>שולחן ערוך אורח חיים, סימן א — עמוד ${i + 1}</h3>
      <p>יתגבר כארי לעמוד בבוקר לעבודת בוראו, שיהא הוא מעורר השחר.</p>
      <p>טור: שיהא הוא מעורר השחר. בית יוסף: הקדים שיתעורר. בית חדש: כך כתוב.</p>
      <p>שורה. שורה. שורה. שורה. שורה. שורה. שורה. שורה. שורה.</p>
      <p>שורה נוספת. שורה נוספת. שורה נוספת. שורה נוספת.</p></div>`;
    c.appendChild(p);
  }
});
await page.waitForTimeout(400);

// Open the sidebar like the user did.
const sidebarBtn = await page.$("#pdf-sidebar-toggle");
if (sidebarBtn) {
  await sidebarBtn.click();
  await page.waitForTimeout(300);
  console.log("sidebar toggled");
}

// Measure everything.
const m = await page.evaluate(() => {
  const previewPane = document.querySelector(".preview-pane");
  const pdfBody = document.querySelector(".pdf-body");
  const pc = document.getElementById("pages-container");
  const sb = document.getElementById("pdf-sidebar");
  return {
    vw: window.innerWidth,
    vh: window.innerHeight,
    preview: previewPane && {
      h: Math.round(previewPane.getBoundingClientRect().height),
      cssH: getComputedStyle(previewPane).height,
      cssMaxH: getComputedStyle(previewPane).maxHeight,
    },
    pdfBody: pdfBody && {
      h: Math.round(pdfBody.getBoundingClientRect().height),
      w: Math.round(pdfBody.getBoundingClientRect().width),
      overflow: getComputedStyle(pdfBody).overflow,
    },
    pages: pc && {
      w: pc.clientWidth,
      h: pc.clientHeight,
      scrollH: pc.scrollHeight,
      scrollbarPx: pc.offsetWidth - pc.clientWidth,
      overflowY: getComputedStyle(pc).overflowY,
      gutter: getComputedStyle(pc).scrollbarGutter,
    },
    sidebar: sb && {
      hidden: sb.hidden,
      w: sb.offsetWidth,
      visible: sb.offsetWidth > 0 && !sb.hidden,
    },
    docHeight: document.documentElement.scrollHeight,
  };
});
console.log(JSON.stringify(m, null, 2));

// Check that the page actually fits inside the container.
const fitCheck = await page.evaluate(() => {
  const c = document.getElementById("pages-container");
  const p = c?.querySelector(".page");
  if (!c || !p) return null;
  return {
    containerW: c.clientWidth,
    pageScreenW: Math.round(p.getBoundingClientRect().width),
    pageStyleZoom: p.style.zoom,
    fits: p.getBoundingClientRect().width <= c.clientWidth + 2,
  };
});
console.log("FIT:", JSON.stringify(fitCheck), "(fits expected true)");

await page.screenshot({ path: "repro_user.png", fullPage: false });
console.log("captured repro_user.png (viewport)");
await page.screenshot({ path: "repro_user_full.png", fullPage: true });
console.log("captured repro_user_full.png (full page)");

await browser.close();
