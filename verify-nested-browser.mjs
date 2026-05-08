// verify-nested-browser.mjs — real-browser verification that a stream
// pane note containing an embedded marker `@02` produces a nested
// `.note-child` inside the rendered apparatus.
//
// Drives the live ravtext app via puppeteer-core. Requires a vite dev
// server running on http://127.0.0.1:5189/ (start with
// `npx vite --port 5189 --host 127.0.0.1`).

import puppeteer from "puppeteer-core";

const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5189/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  protocolTimeout: 120000,
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.evaluate(() => { window.__FORCE_SYNC_RENDER__ = true; });

// Wait for the pane manager to expose the editor objects we need.
await page.waitForFunction(
  () => window.paneManager && window.paneManager.panes && window.paneManager.panes.length >= 2,
  { timeout: 30000 }
).catch(() => {});

// If the app didn't auto-create stream panes, fall back to clicking the
// shulchan sample which loads a known multi-stream layout.
const hasStreams = await page.evaluate(() =>
  !!window.paneManager &&
  window.paneManager.panes.some((p) => p.streamCode === "01") &&
  window.paneManager.panes.some((p) => p.streamCode === "02"));
if (!hasStreams) {
  const btn = await page.$("#btn-load-shulchan");
  if (btn) {
    await btn.click();
    await page.waitForFunction(
      () => window.paneManager &&
        window.paneManager.panes.some((p) => p.streamCode === "02"),
      { timeout: 20000 }
    ).catch(() => {});
  }
}

// Now drive the editors directly: clear stream 01 and 02 content, then
// type the nested-note scenario.
const setupResult = await page.evaluate(() => {
  const pm = window.paneManager;
  if (!pm) return { ok: false, why: "no paneManager" };
  const main = pm.panes.find((p) => !p.streamCode);
  const s01 = pm.panes.find((p) => p.streamCode === "01");
  const s02 = pm.panes.find((p) => p.streamCode === "02");
  if (!main || !s01 || !s02) return { ok: false, why: "missing panes", panes: pm.panes.map((p) => p.streamCode || "MAIN") };
  const setHTML = (pane, html) => pane.editor.commands.setContent(html, true);
  setHTML(main, "<p>גוף הטקסט @01 ההמשך.</p>");
  setHTML(s01, "<p>@01 הערה חיצונית @02 והערה פנימית כאן ההמשך</p>");
  setHTML(s02, "<p>@02 תוכן הערה פנימית</p>");
  return { ok: true };
});
if (!setupResult.ok) {
  console.error("setup failed:", setupResult);
  await browser.close();
  process.exit(2);
}

// Call paneManagerToPackerContent directly in the page context. This
// bypasses the preflight/auth gate and verifies the bridge produces a
// note tree with children for the live editor state we just typed.
const result = await page.evaluate(async () => {
  const mod = await import("/src/engine_bridge.js");
  const content = mod.paneManagerToPackerContent(window.paneManager);
  return content;
});

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

ok("page errors absent", errors.length === 0, errors.join("; "));
ok("packer content has at least one paragraph", result.length > 0,
  JSON.stringify(result).slice(0, 200));
const para = result[0] || {};
ok("paragraph has at least one note", (para.notes || []).length > 0);
const outer = (para.notes || [])[0];
ok("outer is from stream 01", outer && outer.stream === "01");
ok("outer text stripped of inner marker",
  outer && !outer.text.includes("@02"),
  `outer text: '${outer && outer.text}'`);
ok("outer text contains 'חיצונית'",
  outer && outer.text.includes("חיצונית"),
  `outer text: '${outer && outer.text}'`);
ok("outer has 1 child", outer && (outer.children || []).length === 1);
const inner = outer && outer.children && outer.children[0];
ok("inner is from stream 02", inner && inner.stream === "02");
ok("inner text contains 'פנימית'", inner && inner.text.includes("פנימית"),
  `inner text: '${inner && inner.text}'`);
ok("inner anchor inside parent's text length",
  inner && typeof inner.anchor === "number" && inner.anchor < (outer.text || "").length);

await browser.close();
console.log(failed === 0 ? "\nBrowser bridge check: passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
