// Baseline probe: what does find_replace.js actually do TODAY?
// Reports numbers only (no Hebrew content is ever printed).
import { chromium } from "playwright-chromium";
import fs from "fs";

const APP_URL = "http://127.0.0.1:5202/";
const OUT = "C:/Users/User/rt_work/findreplace/_probe/baseline.json";

const out = { url: APP_URL, when: new Date().toISOString(), pageErrors: [], steps: {} };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => out.pageErrors.push(String(e.message).slice(0, 200)));

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(14000);

// ---- helper installed in the page: snapshot of a pane (numbers + hash only) ----
await page.evaluate(() => {
  window.__frSnap = (ed) => {
    const h = ed.getHTML();
    const t = ed.getText();
    let x = 5381;
    for (let i = 0; i < h.length; i++) x = ((x * 33) ^ h.charCodeAt(i)) >>> 0;
    return { htmlLen: h.length, textLen: t.length, hash: x };
  };
  window.__frDigits = (s) => (s || "").replace(/[^0-9]/g, "");
});

// ---- 1. shape of the pane objects ----
out.steps.paneShape = await page.evaluate(() => {
  const pm = window.paneManager;
  if (!pm) return { hasPaneManager: false };
  return {
    hasPaneManager: true,
    paneCount: pm.panes.length,
    hasActivePane: !!pm.activePane,
    panes: pm.panes.map((p) => ({
      id: p.id,
      streamCode: p.streamCode || null,
      hasTitleProp: Object.prototype.hasOwnProperty.call(p, "title"),
      titleIsUndefined: p.title === undefined,
      hasLabelProp: typeof p.label === "string",
      labelLen: (p.label || "").length,
      hasEditor: !!p.editor,
      hasElement: !!p.element,
    })),
  };
});

// ---- 2. make a second pane and RENAME both panes to fresh user names ----
out.steps.setup = await page.evaluate(() => {
  const pm = window.paneManager;
  if (pm.panes.length < 2) pm.addPane({ streamCode: "B", label: "probe-two" });
  // simulate the user renaming panes (this is what first_note_title.js does)
  pm.panes[0].label = "USERNAME-ONE";
  pm.panes[1].label = "USERNAME-TWO";
  return { paneCount: pm.panes.length, labels: pm.panes.map((p) => p.label) };
});

// ---- 3. open the panel, look at what the scope UI shows ----
await page.keyboard.press("Control+f");
await page.waitForTimeout(500);
out.steps.panelUi = await page.evaluate(() => {
  const panel = document.getElementById("find-replace-panel");
  if (!panel) return { panelExists: false };
  const scopeTexts = Array.from(panel.querySelectorAll(".fr-scope-toggle")).map((l) => l.textContent.trim());
  const pm = window.paneManager;
  const liveLabels = pm.panes.map((p) => p.label);
  return {
    panelExists: true,
    hidden: panel.hidden,
    dir: panel.dir,
    hasScopeRadioOrSelect: !!panel.querySelector("select, input[type=radio]"),
    checkboxCount: panel.querySelectorAll(".fr-scope-pane").length,
    scopeLabelsShown: scopeTexts,
    liveUserLabels: liveLabels,
    // the point: do the shown names match the CURRENT user labels?
    showsLiveLabels: liveLabels.every((L) => scopeTexts.some((t) => t.includes(L))),
    buttons: Array.from(panel.querySelectorAll("button")).map((b) => b.id),
  };
});

// ---- 4. load known ASCII content into both panes ----
const N1 = 7, N2 = 5;
out.steps.load = await page.evaluate(({ N1, N2 }) => {
  const pm = window.paneManager;
  const mk = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i} QQQ tail`).join(" | ");
  pm.panes[0].editor.commands.setContent(`<p>${mk(N1, "a")}</p>`);
  pm.panes[1].editor.commands.setContent(`<p>${mk(N2, "b")}</p>`);
  return {
    p0: window.__frSnap(pm.panes[0].editor),
    p1: window.__frSnap(pm.panes[1].editor),
  };
}, { N1, N2 });

// ---- 5. replace-all across ALL panes (the default today) ----
await page.fill("#fr-find", "QQQ");
await page.fill("#fr-replace", "ZZ");
await page.click("#fr-replace-all");
await page.waitForTimeout(600);
out.steps.replaceAllBoth = await page.evaluate(() => {
  const pm = window.paneManager;
  const st = document.querySelector("#fr-status")?.textContent || "";
  return {
    statusDigits: window.__frDigits(st),
    statusLen: st.length,
    p0: window.__frSnap(pm.panes[0].editor),
    p1: window.__frSnap(pm.panes[1].editor),
  };
});

// ---- 6. how many undo steps does that replace-all cost? ----
out.steps.undoCost = await page.evaluate(({ N1 }) => {
  const pm = window.paneManager;
  const ed = pm.panes[0].editor;
  const before = window.__frSnap(ed);
  let steps = 0;
  const targetLen = before.textLen + N1 * 1; // "ZZ"(2) -> "QQQ"(3): +1 per match
  while (steps < 60) {
    ed.commands.undo();
    steps++;
    if (window.__frSnap(ed).textLen === targetLen) break;
  }
  return { undoStepsToRestore: steps, after: window.__frSnap(ed), targetLen };
}, { N1 });

// ---- 7. the "replacement contains the search text" trap ----
out.steps.growingReplacement = await page.evaluate(() => {
  const pm = window.paneManager;
  const ed = pm.panes[1].editor;
  ed.commands.setContent("<p>WWW 1 WWW 2 WWW 3 WWW 4</p>");
  const before = window.__frSnap(ed);
  document.querySelector("#fr-find").value = "WWW";
  document.querySelector("#fr-replace").value = "WWWx";
  document.querySelector("#fr-replace-all").click();
  const st = document.querySelector("#fr-status")?.textContent || "";
  const after = window.__frSnap(ed);
  const txt = ed.getText();
  return {
    occurrencesBefore: 4,
    occurrencesAfterReplacement: (txt.match(/WWWx/g) || []).length,
    stillPlain: (txt.match(/WWW(?!x)/g) || []).length,
    statusDigits: window.__frDigits(st),
    before, after,
  };
});

// ---- 8. overlapping-match counting ----
out.steps.overlapCount = await page.evaluate(() => {
  const pm = window.paneManager;
  const ed = pm.panes[1].editor;
  ed.commands.setContent("<p>AAAA</p>"); // "AA" truly occurs twice, non-overlapping
  document.querySelector("#fr-find").value = "AA";
  document.querySelector("#fr-replace").value = "";
  document.querySelector("#fr-find-next").click();
  const st = document.querySelector("#fr-status")?.textContent || "";
  return { reportedDigits: window.__frDigits(st), trueNonOverlapping: 2 };
});

// ---- 9. match split across two text nodes (bold in the middle) ----
out.steps.splitAcrossMarks = await page.evaluate(() => {
  const pm = window.paneManager;
  const ed = pm.panes[1].editor;
  ed.commands.setContent("<p>SP<strong>LIT</strong> and SPLIT</p>");
  document.querySelector("#fr-find").value = "SPLIT";
  document.querySelector("#fr-replace").value = "";
  document.querySelector("#fr-find-next").click();
  const st = document.querySelector("#fr-status")?.textContent || "";
  return { reportedDigits: window.__frDigits(st), trueOccurrencesInText: 2 };
});

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
await browser.close();
console.log("written:", OUT);
