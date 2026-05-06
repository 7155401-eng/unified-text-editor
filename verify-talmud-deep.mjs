// Per-page deep diagnostic of talmud mode.
import puppeteer from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://localhost:5189/unified-text-editor/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1100 },
});

const page = await browser.newPage();
const errors = [];
const logs = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", msg => {
  const t = msg.text();
  if (/strict_overflow|talmud_layout|overflow_cap|push|expand|hasRealMain/.test(t)) {
    logs.push(t);
  }
});

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

await new Promise(r => setTimeout(r, 8000));

const detail = await page.evaluate(() => {
  const pages = Array.from(document.querySelectorAll(".pages-container .page:not(.page-placeholder)"));
  return pages.map((p, idx) => {
    const block = p.querySelector(":scope > .talmud-layout");
    const main = p.querySelector(":scope > .page-main, :scope .talmud-layout > .page-main");
    const streams = p.querySelectorAll(":scope > .page-streams .stream, :scope .talmud-layout .stream, :scope .talmud-layout > .talmud-body-portion, :scope .talmud-layout > .talmud-body-expanded");
    const crowns = p.querySelectorAll(".talmud-crown-portion");
    const bodies = p.querySelectorAll(".talmud-body-portion");
    const expanded = p.querySelectorAll(".talmud-body-expanded");
    const overflow = p.scrollHeight - p.clientHeight;
    const mainText = main ? (main.textContent || "").trim() : "";
    const mainTextLen = mainText.length;
    const blockClasses = block ? Array.from(block.classList).join(",") : "(none)";
    const expandedDetail = Array.from(expanded).map(e => {
      const innerHTML = e.innerHTML;
      const inner = e.children[0];
      return {
        cls: Array.from(e.classList).join(","),
        width: e.offsetWidth,
        height: e.offsetHeight,
        stream: e.getAttribute("data-stream") || e.dataset.talmudBodyOf || "?",
        textLen: (e.textContent||"").trim().length,
        childCount: e.children.length,
        childTags: Array.from(e.children).slice(0, 5).map(c => c.tagName).join(","),
        innerStruct: innerHTML.slice(0, 300),
        firstChildChildCount: inner ? inner.children.length : 0,
        firstChildChildTags: inner ? Array.from(inner.children).slice(0, 5).map(c => c.tagName).join(",") : "",
      };
    });
    const bodyDetail = Array.from(bodies).map(b => ({
      width: b.offsetWidth,
      stream: b.dataset.talmudBodyOf || b.getAttribute("data-stream") || "?",
      textLen: (b.textContent||"").trim().length,
    }));
    return {
      pageNum: idx + 1,
      blockClasses,
      mainTextLen,
      mainTextStart: mainText.slice(0, 60),
      crowns: crowns.length,
      bodies: bodies.length,
      bodyDetail,
      expanded: expanded.length,
      expandedDetail,
      overflow,
    };
  });
});

console.log(JSON.stringify(detail, null, 2));
console.log("\n=== LOGS ===");
logs.forEach(l => console.log(l));
console.log("\n=== ERRORS ===");
errors.forEach(e => console.log(e));

await browser.close();
