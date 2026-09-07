// Probe #3 — the hardest undo case: replace-all fired IMMEDIATELY after an
// edit, inside prosemirror's 500ms grouping window. Without closeHistory the
// replacement gets glued onto the previous edit and one undo overshoots,
// throwing away the user's own typing. This is exactly what the old code did.
import { chromium } from "playwright-chromium";
import fs from "fs";

const APP_URL = "http://127.0.0.1:5202/";
const OUT = "C:/Users/User/rt_work/findreplace/_probe/history.json";
const out = { url: APP_URL, when: new Date().toISOString(), pageErrors: [], consoleErrors: [], checks: [] };
const ok = (name, pass, detail) => out.checks.push({ name, pass: !!pass, ...detail });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => out.pageErrors.push(String(e.message).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") out.consoleErrors.push(m.text().slice(0, 200)); });
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(14000);

await page.evaluate(() => {
  window.__frSnap = (ed) => {
    const h = ed.getHTML(); const t = ed.getText();
    let x = 5381; for (let i = 0; i < h.length; i++) x = ((x * 33) ^ h.charCodeAt(i)) >>> 0;
    return { htmlLen: h.length, textLen: t.length, hash: x };
  };
  window.__frDigits = (s) => (s || "").replace(/[^0-9]/g, "");
});

// Did the lazy import of the history helper actually resolve through Vite?
out.historyModuleServed = await page.evaluate(async () => {
  // Ask Vite for the module the way the page would, and see if it is real JS.
  try {
    const r = await fetch("/node_modules/.vite/deps/@tiptap_pm_history.js", { method: "GET" });
    return { probedDepUrl: r.status };
  } catch (e) { return { probedDepUrl: "err" }; }
});

await page.keyboard.press("Control+f");
await page.waitForTimeout(500);
const ids = await page.evaluate(() => window.paneManager.panes.map((p) => p.streamCode || p.id || "main"));

await page.evaluate((id) => {
  const panel = document.getElementById("find-replace-panel");
  const r = panel.querySelector("#fr-mode-one");
  r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true }));
  const s = panel.querySelector("#fr-pane-select");
  s.value = id; s.dispatchEvent(new Event("change", { bubbles: true }));
}, ids[0]);

// --- Case 1: a settled document, then replace-all (already covered, resanity)
out.settled = await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.setContent("<p>s0 QQQ s1 QQQ s2 QQQ</p>");
  return window.__frSnap(ed);
});
await page.waitForTimeout(1200);
const settledBefore = await page.evaluate(() => window.__frSnap(window.paneManager.panes[0].editor));
await page.fill("#fr-find", "QQQ");
await page.fill("#fr-replace", "Z");
await page.click("#fr-replace-all");
await page.waitForTimeout(400);
const settledUndo = await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.undo();
  return window.__frSnap(ed);
});
ok("settled doc: one undo restores exactly", settledUndo.hash === settledBefore.hash,
  { before: settledBefore.textLen, afterUndo: settledUndo.textLen });

// --- Case 2: the hard one. Type, then replace-all with NO pause at all.
out.hot = {};
out.hot.seed = await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.setContent("<p>base line</p>");
  return window.__frSnap(ed);
});
await page.waitForTimeout(1200);          // let the base settle

// The user now types something, creating a fresh history entry...
out.hot.typed = await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.focus("end");
  ed.commands.insertContent(" HOT1 HOT2 HOT3");
  return window.__frSnap(ed);
});
const hotBefore = out.hot.typed;

// ...and fires replace-all straight away, well inside the 500ms grouping window.
await page.fill("#fr-find", "HOT");
await page.fill("#fr-replace", "CO");
await page.click("#fr-replace-all");
out.hot.status = await page.evaluate(() => {
  const st = document.querySelector("#fr-status");
  return { digits: window.__frDigits(st.textContent), isError: st.classList.contains("fr-status-error") };
});
out.hot.after = await page.evaluate(() => window.__frSnap(window.paneManager.panes[0].editor));
out.hot.predicted = hotBefore.textLen + 3 * ("CO".length - "HOT".length);
ok("hot replace: 3 replaced, length exactly as predicted",
  out.hot.status.digits === "3" && out.hot.after.textLen === out.hot.predicted,
  { shown: out.hot.status.digits, actual: out.hot.after.textLen, predicted: out.hot.predicted });

out.hot.afterUndo = await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.undo();
  return window.__frSnap(ed);
});
ok("hot replace: ONE undo lands back on the typed text, does not overshoot",
  out.hot.afterUndo.hash === hotBefore.hash,
  { afterUndoLen: out.hot.afterUndo.textLen, typedLen: hotBefore.textLen, seedLen: out.hot.seed.textLen,
    overshotToSeed: out.hot.afterUndo.textLen === out.hot.seed.textLen });

// --- Case 3: no match => nothing is pushed onto the undo stack at all.
out.noPush = {};
await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.setContent("<p>undo stack guard ABC</p>");
});
await page.waitForTimeout(1200);
const guardBefore = await page.evaluate(() => window.__frSnap(window.paneManager.panes[0].editor));
await page.fill("#fr-find", "ZZZ-NOT-THERE");
await page.fill("#fr-replace", "X");
await page.click("#fr-replace-all");
await page.waitForTimeout(300);
out.noPush.afterClick = await page.evaluate(() => window.__frSnap(window.paneManager.panes[0].editor));
out.noPush.afterUndo = await page.evaluate(() => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.undo();
  return window.__frSnap(ed);
});
ok("no match: document untouched by the click",
  out.noPush.afterClick.hash === guardBefore.hash, { hash: out.noPush.afterClick.hash });
ok("no match: no wasted entry on the undo stack (undo goes past it, not onto it)",
  out.noPush.afterUndo.hash !== guardBefore.hash || out.noPush.afterUndo.textLen !== guardBefore.textLen,
  { beforeLen: guardBefore.textLen, afterUndoLen: out.noPush.afterUndo.textLen });

out.summary = { total: out.checks.length, passed: out.checks.filter((c) => c.pass).length,
  failed: out.checks.filter((c) => !c.pass).map((c) => c.name) };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
await browser.close();
console.log(`history checks ${out.summary.passed}/${out.summary.total}`);
if (out.summary.failed.length) console.log("FAILED:", out.summary.failed.join(" | "));
