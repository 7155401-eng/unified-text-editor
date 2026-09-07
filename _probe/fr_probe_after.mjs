// Verification probe for the new find & replace scope feature.
// Drives the real page at 127.0.0.1:5202. Reports numbers only.
import { chromium } from "playwright-chromium";
import fs from "fs";

const APP_URL = "http://127.0.0.1:5202/";
const OUT = "C:/Users/User/rt_work/findreplace/_probe/after.json";

// Mixed Hebrew + English strings, written as escapes so there is no doubt
// about what is in them.
const HEB_FIND = "\u05d1\u05d3\u05d9\u05e7\u05d4" + "TEST";   // 5 + 4 = 9 chars
const HEB_REPL = "\u05e0\u05d1\u05d3\u05e7" + "OK";           // 4 + 2 = 6 chars

const out = { url: APP_URL, when: new Date().toISOString(), pageErrors: [], checks: [], steps: {} };
const ok = (name, pass, detail) => out.checks.push({ name, pass: !!pass, ...detail });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => out.pageErrors.push(String(e.message).slice(0, 200)));
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(14000);

await page.evaluate(() => {
  window.__frSnap = (ed) => {
    const h = ed.getHTML(); const t = ed.getText();
    let x = 5381; for (let i = 0; i < h.length; i++) x = ((x * 33) ^ h.charCodeAt(i)) >>> 0;
    return { htmlLen: h.length, textLen: t.length, hash: x };
  };
  window.__frDigits = (s) => (s || "").replace(/[^0-9]/g, "");
  window.__snapAll = () => window.paneManager.panes.map((p) => window.__frSnap(p.editor));
});

// ---------- helpers -------------------------------------------------------
async function setScope(mode, paneId) {
  await page.evaluate(({ mode, paneId }) => {
    const panel = document.getElementById("find-replace-panel");
    const r = panel.querySelector("#fr-mode-" + mode);
    r.checked = true;
    r.dispatchEvent(new Event("change", { bubbles: true }));
    if (paneId != null) {
      const s = panel.querySelector("#fr-pane-select");
      s.value = paneId;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { mode, paneId });
  await page.waitForTimeout(150);
}
async function typeQuery(find, repl) {
  await page.fill("#fr-find", find);
  await page.fill("#fr-replace", repl);
  await page.waitForTimeout(350); // let the debounced live count run
}
async function statusNow() {
  return page.evaluate(() => {
    const st = document.querySelector("#fr-status");
    return { digits: window.__frDigits(st.textContent), len: st.textContent.length, isError: st.classList.contains("fr-status-error") };
  });
}
async function clickReplaceAll() {
  await page.click("#fr-replace-all");
  await page.waitForTimeout(400);
  return statusNow();
}
async function seed(paneIdx, html) {
  return page.evaluate(({ paneIdx, html }) => {
    const ed = window.paneManager.panes[paneIdx].editor;
    ed.commands.setContent(html);
    return window.__frSnap(ed);
  }, { paneIdx, html });
}
async function snap(paneIdx) {
  return page.evaluate((i) => window.__frSnap(window.paneManager.panes[i].editor), paneIdx);
}
async function undoOnce(paneIdx) {
  return page.evaluate((i) => {
    const ed = window.paneManager.panes[i].editor;
    ed.commands.undo();
    return window.__frSnap(ed);
  }, paneIdx);
}

// ---------- 1. panes + live names in the dropdown --------------------------
out.steps.setup = await page.evaluate(() => {
  const pm = window.paneManager;
  if (pm.panes.length < 2) pm.addPane({ streamCode: "B", label: "probe-two" });
  // The user renames both panes AFTER they were created.
  pm.panes[0].label = "LIVE-NAME-ALEF";
  pm.panes[1].label = "LIVE-NAME-BET";
  return {
    paneCount: pm.panes.length,
    ids: pm.panes.map((p) => p.streamCode || p.id || "main"),
    labels: pm.panes.map((p) => p.label),
  };
});
const IDS = out.steps.setup.ids;

await page.keyboard.press("Control+f");
await page.waitForTimeout(500);

out.steps.dropdown = await page.evaluate(() => {
  const panel = document.getElementById("find-replace-panel");
  const sel = panel.querySelector("#fr-pane-select");
  const pm = window.paneManager;
  const opts = Array.from(sel?.options || []).map((o) => ({ value: o.value, text: o.textContent }));
  const live = pm.panes.map((p) => p.label);
  return {
    panelDir: panel.dir,
    hasModeRadios: panel.querySelectorAll("input[name='fr-scope-mode']").length,
    hasSelect: !!sel,
    optionCount: opts.length,
    optionTextsMatchLiveLabels: opts.length === live.length && opts.every((o, i) => o.text === live[i]),
    firstTwoOptionTexts: opts.slice(0, 2).map((o) => o.text),
    defaultMode: panel.querySelector("input[name='fr-scope-mode']:checked")?.value,
    defaultSelectedIsActivePane: sel?.value === (pm.activePane ? (pm.activePane.streamCode || pm.activePane.id || "main") : null),
    paneRowHidden: panel.querySelector("#fr-pane-row").hidden,
    customCheckboxRowHidden: panel.querySelector("#fr-scope").hidden,
    // nothing was removed:
    stillHasCheckboxes: panel.querySelectorAll(".fr-scope-pane").length,
    stillHasButtons: Array.from(panel.querySelectorAll("button")).map((b) => b.id),
  };
});
ok("dropdown lists the CURRENT user names", out.steps.dropdown.optionTextsMatchLiveLabels, {
  optionCount: out.steps.dropdown.optionCount,
});
ok("scope radios exist (one / all / custom)", out.steps.dropdown.hasModeRadios === 3, { radios: out.steps.dropdown.hasModeRadios });
ok("nothing removed: checkboxes + 4 buttons still there",
  out.steps.dropdown.stillHasCheckboxes >= 2 && out.steps.dropdown.stillHasButtons.length === 4,
  { checkboxes: out.steps.dropdown.stillHasCheckboxes, buttons: out.steps.dropdown.stillHasButtons });

// ---------- 2. scope "this pane only" --------------------------------------
const NA = 7, NB = 4;
out.steps.scopeOne = {};
out.steps.scopeOne.seedA = await seed(0, `<p>${Array.from({ length: NA }, (_, i) => `a${i} QQQ z`).join(" ")}</p>`);
out.steps.scopeOne.seedB = await seed(1, `<p>${Array.from({ length: NB }, (_, i) => `b${i} QQQ z`).join(" ")}</p>`);
await page.waitForTimeout(1200); // close the history group

const beforeA = await snap(0), beforeB = await snap(1);
await setScope("one", IDS[0]);
await typeQuery("QQQ", "ZZ");
out.steps.scopeOne.liveCount = await statusNow();
ok("live count before replacing = matches in the chosen pane only",
  out.steps.scopeOne.liveCount.digits === String(NA), { shown: out.steps.scopeOne.liveCount.digits, expected: NA });

out.steps.scopeOne.status = await clickReplaceAll();
const afterA = await snap(0), afterB = await snap(1);
out.steps.scopeOne.before = { A: beforeA, B: beforeB };
out.steps.scopeOne.after = { A: afterA, B: afterB };
out.steps.scopeOne.predictedALen = beforeA.textLen + NA * ("ZZ".length - "QQQ".length);
ok("replaced count reported = 7", out.steps.scopeOne.status.digits === String(NA),
  { shown: out.steps.scopeOne.status.digits, expected: NA });
ok("chosen pane length changed exactly as predicted",
  afterA.textLen === out.steps.scopeOne.predictedALen,
  { actual: afterA.textLen, predicted: out.steps.scopeOne.predictedALen });
ok("OTHER pane is byte-identical (hash + lengths)",
  afterB.hash === beforeB.hash && afterB.htmlLen === beforeB.htmlLen && afterB.textLen === beforeB.textLen,
  { beforeB, afterB });

// ---------- 3. ONE undo restores the pane exactly --------------------------
const undo1 = await undoOnce(0);
out.steps.scopeOne.afterOneUndo = undo1;
ok("one single undo restores the pane exactly (hash match)",
  undo1.hash === beforeA.hash && undo1.textLen === beforeA.textLen,
  { restoredTextLen: undo1.textLen, originalTextLen: beforeA.textLen, hashMatch: undo1.hash === beforeA.hash });

// ---------- 4. scope "all panes" -------------------------------------------
out.steps.scopeAll = {};
await seed(0, `<p>${Array.from({ length: NA }, (_, i) => `a${i} QQQ z`).join(" ")}</p>`);
await seed(1, `<p>${Array.from({ length: NB }, (_, i) => `b${i} QQQ z`).join(" ")}</p>`);
await page.waitForTimeout(1200);
const allBeforeA = await snap(0), allBeforeB = await snap(1);
await setScope("all");
await typeQuery("QQQ", "LONGER-REPL");
out.steps.scopeAll.liveCount = await statusNow();
ok("live count across all panes = 7 + 4 = 11",
  out.steps.scopeAll.liveCount.digits.startsWith(String(NA + NB)),
  { shown: out.steps.scopeAll.liveCount.digits, expected: NA + NB });

out.steps.scopeAll.status = await clickReplaceAll();
const allAfterA = await snap(0), allAfterB = await snap(1);
const d = "LONGER-REPL".length - "QQQ".length; // +8 per match
out.steps.scopeAll.before = { A: allBeforeA, B: allBeforeB };
out.steps.scopeAll.after = { A: allAfterA, B: allAfterB };
out.steps.scopeAll.predicted = { A: allBeforeA.textLen + NA * d, B: allBeforeB.textLen + NB * d, delta: d };
ok("all-panes replaced count = 11", out.steps.scopeAll.status.digits.startsWith(String(NA + NB)),
  { shown: out.steps.scopeAll.status.digits });
ok("pane A grew exactly as predicted (longer replacement)",
  allAfterA.textLen === out.steps.scopeAll.predicted.A, { actual: allAfterA.textLen, predicted: out.steps.scopeAll.predicted.A });
ok("pane B grew exactly as predicted (longer replacement)",
  allAfterB.textLen === out.steps.scopeAll.predicted.B, { actual: allAfterB.textLen, predicted: out.steps.scopeAll.predicted.B });

const uA = await undoOnce(0), uB = await undoOnce(1);
out.steps.scopeAll.afterOneUndoEach = { A: uA, B: uB };
ok("one undo per pane restores both panes exactly",
  uA.hash === allBeforeA.hash && uB.hash === allBeforeB.hash,
  { A: { restored: uA.textLen, orig: allBeforeA.textLen }, B: { restored: uB.textLen, orig: allBeforeB.textLen } });

// ---------- 5. edge cases ---------------------------------------------------
out.steps.edge = {};

// (a) empty search string
await seed(0, "<p>EDGE empty search EDGE</p>");
await page.waitForTimeout(600);
const eBefore = await snap(0);
await setScope("one", IDS[0]);
await typeQuery("", "XX");
out.steps.edge.emptySearch = await clickReplaceAll();
out.steps.edge.emptySearchSnap = await snap(0);
ok("empty search: error message shown, document untouched",
  out.steps.edge.emptySearch.isError && out.steps.edge.emptySearch.len > 10 &&
  out.steps.edge.emptySearchSnap.hash === eBefore.hash,
  { statusLen: out.steps.edge.emptySearch.len, isError: out.steps.edge.emptySearch.isError });

// (b) search text that appears zero times
await typeQuery("NOSUCHSTRING12345", "XX");
out.steps.edge.noMatchLive = await statusNow();
out.steps.edge.noMatch = await clickReplaceAll();
out.steps.edge.noMatchSnap = await snap(0);
ok("no matches: error message shown, document untouched",
  out.steps.edge.noMatch.isError && out.steps.edge.noMatchSnap.hash === eBefore.hash,
  { liveIsError: out.steps.edge.noMatchLive.isError, statusLen: out.steps.edge.noMatch.len });

// (c) mixed Hebrew + English search, replacement SHORTER than the original
const NM = 3;
await seed(0, `<p>${Array.from({ length: NM }, (_, i) => `m${i} ${HEB_FIND} z`).join(" ")}</p>`);
await page.waitForTimeout(1200);
const mBefore = await snap(0);
await typeQuery(HEB_FIND, HEB_REPL);
out.steps.edge.mixedLive = await statusNow();
out.steps.edge.mixedStatus = await clickReplaceAll();
const mAfter = await snap(0);
const dm = HEB_REPL.length - HEB_FIND.length; // 6 - 9 = -3
out.steps.edge.mixed = {
  findLen: HEB_FIND.length, replLen: HEB_REPL.length, perMatchDelta: dm,
  before: mBefore, after: mAfter, predicted: mBefore.textLen + NM * dm,
};
ok("mixed Hebrew+English: 3 matches found and replaced",
  out.steps.edge.mixedStatus.digits === String(NM), { shown: out.steps.edge.mixedStatus.digits });
ok("shorter replacement: length shrank exactly as predicted",
  mAfter.textLen === out.steps.edge.mixed.predicted,
  { actual: mAfter.textLen, predicted: out.steps.edge.mixed.predicted });
const mUndo = await undoOnce(0);
out.steps.edge.mixedUndo = mUndo;
ok("mixed Hebrew+English: one undo restores exactly", mUndo.hash === mBefore.hash,
  { restored: mUndo.textLen, orig: mBefore.textLen });

// (d) replacement that CONTAINS the search text (the old killer bug)
await seed(0, "<p>WWW 1 WWW 2 WWW 3 WWW 4</p>");
await page.waitForTimeout(600);
await typeQuery("WWW", "WWWx");
out.steps.edge.growingStatus = await clickReplaceAll();
out.steps.edge.growing = await page.evaluate(() => {
  const t = window.paneManager.panes[0].editor.getText();
  return { replaced: (t.match(/WWWx/g) || []).length, leftPlain: (t.match(/WWW(?!x)/g) || []).length, snap: window.__frSnap(window.paneManager.panes[0].editor) };
});
ok("replacement containing the search text: all 4 replaced, none left",
  out.steps.edge.growing.replaced === 4 && out.steps.edge.growing.leftPlain === 0,
  { replaced: out.steps.edge.growing.replaced, leftPlain: out.steps.edge.growing.leftPlain, statusDigits: out.steps.edge.growingStatus.digits });

// (e) overlapping-looking query
await seed(0, "<p>AAAA</p>");
await page.waitForTimeout(400);
await typeQuery("AA", "");
out.steps.edge.overlap = await statusNow();
ok("overlap counting: AA in AAAA counts 2, not 3",
  out.steps.edge.overlap.digits === "2", { shown: out.steps.edge.overlap.digits });

// (f) match broken in two by formatting
await seed(0, "<p>SP<strong>LIT</strong> and SPLIT</p>");
await page.waitForTimeout(400);
await typeQuery("SPLIT", "");
out.steps.edge.splitMarks = await statusNow();
ok("match split by bold is still found: counts 2, not 1",
  out.steps.edge.splitMarks.digits === "2", { shown: out.steps.edge.splitMarks.digits });

// (g) deleting (empty replacement) must not lose surrounding content
await seed(0, "<p>keep1 DEL keep2 DEL keep3</p>");
await page.waitForTimeout(600);
const delBefore = await snap(0);
await typeQuery("DEL", "");
out.steps.edge.deleteStatus = await clickReplaceAll();
out.steps.edge.deleteAfter = await page.evaluate(() => {
  const t = window.paneManager.panes[0].editor.getText();
  return { hasKeep1: t.includes("keep1"), hasKeep2: t.includes("keep2"), hasKeep3: t.includes("keep3"), delLeft: (t.match(/DEL/g) || []).length, snap: window.__frSnap(window.paneManager.panes[0].editor) };
});
ok("empty replacement deletes only the matches, keeps the rest",
  out.steps.edge.deleteAfter.hasKeep1 && out.steps.edge.deleteAfter.hasKeep2 &&
  out.steps.edge.deleteAfter.hasKeep3 && out.steps.edge.deleteAfter.delLeft === 0 &&
  out.steps.edge.deleteAfter.snap.textLen === delBefore.textLen - 2 * 3,
  { before: delBefore.textLen, after: out.steps.edge.deleteAfter.snap.textLen, predicted: delBefore.textLen - 6 });

// (h) formatting survives a replacement
await seed(0, "<p>plain <strong>BOLDWORD</strong> plain</p>");
await page.waitForTimeout(400);
await typeQuery("BOLDWORD", "NEWBOLD");
await clickReplaceAll();
out.steps.edge.marksKept = await page.evaluate(() => {
  const h = window.paneManager.panes[0].editor.getHTML();
  return { boldKept: /<strong>NEWBOLD<\/strong>/.test(h), htmlLen: h.length };
});
ok("replaced text keeps the bold it had", out.steps.edge.marksKept.boldKept, out.steps.edge.marksKept);

// (i) custom mode still works (nothing removed)
await seed(0, "<p>CUS 1 CUS 2</p>");
await seed(1, "<p>CUS 3 CUS 4</p>");
await page.waitForTimeout(600);
const cB = await snap(1);
await setScope("custom");
await page.evaluate(() => {
  const panel = document.getElementById("find-replace-panel");
  const boxes = Array.from(panel.querySelectorAll(".fr-scope-pane"));
  boxes.forEach((cb, i) => { cb.checked = (i === 0); });
  panel.querySelector("#fr-scope").dispatchEvent(new Event("change", { bubbles: true }));
});
await typeQuery("CUS", "K");
out.steps.edge.customStatus = await clickReplaceAll();
const cAfterB = await snap(1);
ok("custom checkbox mode still scopes correctly (pane B untouched)",
  out.steps.edge.customStatus.digits === "2" && cAfterB.hash === cB.hash,
  { shown: out.steps.edge.customStatus.digits });

out.summary = {
  total: out.checks.length,
  passed: out.checks.filter((c) => c.pass).length,
  failed: out.checks.filter((c) => !c.pass).map((c) => c.name),
};

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
await browser.close();
console.log(`checks ${out.summary.passed}/${out.summary.total} passed`);
if (out.summary.failed.length) console.log("FAILED:", out.summary.failed.join(" | "));
