// Investigate main-text-displacement bug — main appears at bottom of page
// instead of flowing through with commentaries.
import { chromium } from "playwright-chromium";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
const page = await ctx.newPage();
page.on("console", m => {
  if (m.type() === "error" || m.type() === "warning") {
    console.log(`[${m.type()}] ${m.text()}`);
  }
});
await page.goto("http://127.0.0.1:5193/unified-text-editor/", { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__FORCE_SYNC_RENDER__ = true;
  localStorage.setItem("ravtext.talmudLayout", "1");
});
await page.$eval("#btn-load-shulchan", el => el.click());
await page.waitForTimeout(8000);

// Find pages where main is positioned BELOW commentaries.
const displaced = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll(".pages-container .page:not(.page-placeholder)").forEach((p, i) => {
    const main = p.querySelector(".page-main.talmud-main");
    if (!main) return;
    const mainTop = main.getBoundingClientRect().top;
    const block = p.querySelector(":scope > .talmud-layout");
    if (!block) return;
    const blockTop = block.getBoundingClientRect().top;
    // Find the topmost commentary float on this page.
    let earliestCommentaryTop = Infinity;
    let earliestCommentaryBottom = -Infinity;
    block.querySelectorAll(":scope > .talmud-commentary, :scope > .talmud-crown-portion, :scope > .talmud-body-portion").forEach(c => {
      const r = c.getBoundingClientRect();
      if (r.top < earliestCommentaryTop) earliestCommentaryTop = r.top;
      if (r.bottom > earliestCommentaryBottom) earliestCommentaryBottom = r.bottom;
    });
    const mainOffsetFromBlock = mainTop - blockTop;
    const mainOffsetFromCommentaryTop = earliestCommentaryTop !== Infinity ? mainTop - earliestCommentaryTop : 0;
    // Displaced: main starts AFTER commentary block ends (at least mostly).
    if (mainOffsetFromCommentaryTop > 50) {
      out.push({
        idx: i,
        mainOffsetFromBlock: Math.round(mainOffsetFromBlock),
        mainOffsetFromCommentaryTop: Math.round(mainOffsetFromCommentaryTop),
        mainHeight: Math.round(main.getBoundingClientRect().height),
        commentaryHeight: Math.round(earliestCommentaryBottom - earliestCommentaryTop),
        blockChildOrder: Array.from(block.children).map((c, j) => `${j}:${c.tagName}.${(c.className || "").split(" ")[0]}`).join("|"),
        mainParagraphCount: main.querySelectorAll(":scope > p, :scope > div").length,
        mainText: (main.textContent || "").slice(0, 100),
      });
    }
  });
  return out;
});

console.log(`Found ${displaced.length} pages with displaced main text.\n`);
for (const d of displaced.slice(0, 5)) {
  console.log(`Page ${d.idx}: main offset from commentary top = ${d.mainOffsetFromCommentaryTop}px`);
  console.log(`  commentary block: ${d.commentaryHeight}px tall`);
  console.log(`  main: ${d.mainHeight}px, ${d.mainParagraphCount} paragraphs`);
  console.log(`  block children: ${d.blockChildOrder}`);
  console.log(`  main text: ${d.mainText}...`);
  console.log();
}

await browser.close();
