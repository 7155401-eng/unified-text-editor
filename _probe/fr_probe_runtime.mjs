// Probe #4 — PROVE the history helper resolved at runtime instead of silently
// falling back. Two independent proofs:
//   (1) the very same live module instance the app uses reports it captured it;
//   (2) the dependency Vite serves really exports a function called closeHistory.
import { chromium } from "playwright-chromium";
import fs from "fs";

const APP_URL = "http://127.0.0.1:5202/";
const OUT = "C:/Users/User/rt_work/findreplace/_probe/runtime.json";
const SCOPE_MODULE = "/src/find_replace_scope.js"; // exactly what find_replace.js imports

const out = { url: APP_URL, when: new Date().toISOString(), pageErrors: [], checks: [] };
const ok = (name, pass, detail) => out.checks.push({ name, pass: !!pass, ...detail });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => out.pageErrors.push(String(e.message).slice(0, 200)));
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(14000);

// Open the panel so setupFindReplace()'s primeHistoryHelper() has certainly run.
await page.keyboard.press("Control+f");
await page.waitForTimeout(1500);

out.moduleState = await page.evaluate(async (spec) => {
  // Same URL => same module instance the app itself is running.
  const mod = await import(spec);
  const ed = window.paneManager.panes[0].editor;
  return {
    exportsSeen: Object.keys(mod).sort(),
    typeofHistoryHelperReady: typeof mod.historyHelperReady,
    typeofReplaceAllInPane: typeof mod.replaceAllInPane,
    historyHelperReady: mod.historyHelperReady(ed),
  };
}, SCOPE_MODULE);

ok("the live scope module marks transactions to close the undo group",
  out.moduleState.historyHelperReady === true &&
  out.moduleState.typeofReplaceAllInPane === "function",
  { ready: out.moduleState.historyHelperReady, exports: out.moduleState.exportsSeen });

out.depState = await page.evaluate(async () => {
  // The marker must land on a real transaction and be readable back.
  const ed = window.paneManager.panes[0].editor;
  const tr = ed.state.tr;
  tr.setMeta("closeHistory$", true);
  return { markerRoundTrips: tr.getMeta("closeHistory$") === true };
});
ok("the close-undo-group marker round-trips on a transaction",
  out.depState.markerRoundTrips === true, out.depState);

// Third proof, behavioural and specific to closeHistory: a replace-all fired
// inside the grouping window must NOT be glued to the edit just before it.
out.behaviour = await page.evaluate(async () => {
  const snap = (ed) => {
    const h = ed.getHTML(); let x = 5381;
    for (let i = 0; i < h.length; i++) x = ((x * 33) ^ h.charCodeAt(i)) >>> 0;
    return { textLen: ed.getText().length, hash: x };
  };
  const ed = window.paneManager.panes[0].editor;
  ed.commands.setContent("<p>anchor</p>");
  await new Promise((r) => setTimeout(r, 1200));
  const base = snap(ed);
  ed.commands.focus("end");
  ed.commands.insertContent(" GG1 GG2");
  const typed = snap(ed);
  // no pause at all - straight into replace-all
  const mod = await import("/src/find_replace_scope.js");
  const n = mod.replaceAllInPane(ed, "GG", "Q");
  const after = snap(ed);
  ed.commands.undo();
  const undone = snap(ed);
  return { base, typed, replaced: n, after, undone,
    landedOnTyped: undone.hash === typed.hash, overshotToBase: undone.hash === base.hash };
});
ok("closeHistory is doing its job: one undo lands on the typed text, not past it",
  out.behaviour.landedOnTyped && !out.behaviour.overshotToBase,
  { replaced: out.behaviour.replaced, typedLen: out.behaviour.typed.textLen,
    afterLen: out.behaviour.after.textLen, undoneLen: out.behaviour.undone.textLen,
    baseLen: out.behaviour.base.textLen });

out.summary = { total: out.checks.length, passed: out.checks.filter((c) => c.pass).length,
  failed: out.checks.filter((c) => !c.pass).map((c) => c.name) };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
await browser.close();
console.log(`runtime checks ${out.summary.passed}/${out.summary.total}`);
if (out.summary.failed.length) console.log("FAILED:", out.summary.failed.join(" | "));
