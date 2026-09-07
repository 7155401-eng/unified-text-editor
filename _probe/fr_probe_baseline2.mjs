// Baseline probe #2 — a FAIR undo measurement plus case sensitivity.
// The first probe let setContent and the replacements fall into one history
// group. Here we wait past TipTap's 500ms newGroupDelay so the pre-replace
// state is its own history entry, then count how many undos are needed.
import { chromium } from "playwright-chromium";
import fs from "fs";

const APP_URL = "http://127.0.0.1:5202/";
const OUT = "C:/Users/User/rt_work/findreplace/_probe/baseline2.json";
const out = { url: APP_URL, when: new Date().toISOString(), pageErrors: [], steps: {} };

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
});

await page.keyboard.press("Control+f");
await page.waitForTimeout(400);

// Restrict the scope to pane 0 only, using today's checkboxes.
await page.evaluate(() => {
  const panel = document.getElementById("find-replace-panel");
  const boxes = Array.from(panel.querySelectorAll(".fr-scope-pane"));
  boxes.forEach((cb, i) => { cb.checked = (i === 0); });
});

// Seed 7 matches, then let the history group close.
const N = 7;
out.steps.seed = await page.evaluate(({ N }) => {
  const ed = window.paneManager.panes[0].editor;
  ed.commands.setContent(`<p>${Array.from({ length: N }, (_, i) => `w${i} QQQ end`).join(" ")}</p>`);
  return window.__frSnap(ed);
}, { N });
await page.waitForTimeout(1200); // > history newGroupDelay (500ms)

const beforeSnap = await page.evaluate(() => window.__frSnap(window.paneManager.panes[0].editor));

await page.fill("#fr-find", "QQQ");
await page.fill("#fr-replace", "ZZ");
await page.click("#fr-replace-all");
await page.waitForTimeout(600);

out.steps.afterReplace = await page.evaluate(() => {
  const st = document.querySelector("#fr-status")?.textContent || "";
  return { statusDigits: window.__frDigits(st), snap: window.__frSnap(window.paneManager.panes[0].editor) };
});

out.steps.fairUndo = await page.evaluate(({ beforeSnap }) => {
  const ed = window.paneManager.panes[0].editor;
  const trail = [];
  let restoredAt = -1;
  for (let i = 1; i <= 15; i++) {
    ed.commands.undo();
    const s = window.__frSnap(ed);
    trail.push(s.textLen);
    if (restoredAt < 0 && s.hash === beforeSnap.hash) restoredAt = i;
  }
  return { beforeHash: beforeSnap.hash, beforeTextLen: beforeSnap.textLen, restoredAfterNUndos: restoredAt, textLenTrail: trail };
}, { beforeSnap });

// Case sensitivity: is there any toggle, and does an uppercase query find lowercase text?
out.steps.caseSensitivity = await page.evaluate(() => {
  const panel = document.getElementById("find-replace-panel");
  const ed = window.paneManager.panes[0].editor;
  ed.commands.setContent("<p>alpha ALPHA Alpha</p>");
  document.querySelector("#fr-find").value = "alpha";
  document.querySelector("#fr-replace").value = "";
  document.querySelector("#fr-find-next").click();
  const st = document.querySelector("#fr-status")?.textContent || "";
  return {
    hasCaseToggle: !!panel.querySelector("#fr-case, [data-fr-case]"),
    hasWholeWordToggle: !!panel.querySelector("#fr-word, [data-fr-word]"),
    reportedForLowercaseQuery: window.__frDigits(st),
    trueCaseInsensitiveCount: 3,
    trueCaseSensitiveCount: 1,
  };
});

fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf8");
await browser.close();
console.log("written:", OUT);
