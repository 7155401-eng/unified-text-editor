// verify-nested-toggle-and-bubble.mjs — real-browser checks for:
//   • the toggle row + first-time explanation dialog
//   • the hover bubble for @XX markers in stream panes (the new UX)
//
// Requires a vite dev server on the port below.

import puppeteer from "puppeteer-core";

const URL = process.env.VERIFY_URL || "http://127.0.0.1:5201/";
const CHROME = process.env.VERIFY_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
// Clear any prior preferences so we hit the fresh-user path.
await page.evaluate(() => {
  try {
    localStorage.removeItem("ravtext.nestedNotes");
    localStorage.removeItem("ravtext.nestedNotesHint.dismissed");
  } catch (_) {}
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => window.paneManager?.panes?.filter((p) => p.streamCode)?.length >= 2,
  { timeout: 20000 }
).catch(() => {});

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

// 1. Toggle row visible, unchecked by default.
{
  const r = await page.evaluate(() => {
    const cb = document.getElementById("nested-notes-toggle");
    return {
      rowExists: !!document.getElementById("nested-notes-row"),
      cbExists: !!cb,
      cbChecked: cb?.checked,
    };
  });
  ok("toggle row exists", r.rowExists);
  ok("checkbox exists", r.cbExists);
  ok("checkbox unchecked by default", r.cbChecked === false);
}

// 2. Click the toggle → dialog opens, gate flips on.
{
  await page.click("#nested-notes-toggle");
  await new Promise((r) => setTimeout(r, 400));
  const r = await page.evaluate(() => {
    const dlg = document.getElementById("nested-notes-explain-dialog");
    return {
      dlgOpen: dlg?.open === true,
      cbChecked: document.getElementById("nested-notes-toggle")?.checked,
      gateOn: localStorage.getItem("ravtext.nestedNotes") === "1",
      seenFlag: localStorage.getItem("ravtext.nestedNotesHint.dismissed") === "1",
    };
  });
  ok("dialog opens on first check", r.dlgOpen);
  ok("checkbox now checked", r.cbChecked === true);
  ok("gate flag persisted", r.gateOn);
  ok("seen flag persisted", r.seenFlag);
}

// 3. Close dialog, ensure it stays closed on subsequent checks.
{
  await page.evaluate(() => document.getElementById("nested-notes-explain-dialog")?.close());
  await new Promise((r) => setTimeout(r, 200));
  await page.click("#nested-notes-toggle"); // off
  await page.click("#nested-notes-toggle"); // on again
  await new Promise((r) => setTimeout(r, 300));
  const r = await page.evaluate(() => ({
    dlgOpen: document.getElementById("nested-notes-explain-dialog")?.open === true,
  }));
  ok("dialog NOT shown on second on-check", r.dlgOpen === false);
}

// 4. Bubble appears on hover of an @XX marker inside a stream pane.
{
  // Setup: turn gate on; type @01 ... @02 ... in stream-01 pane and
  // matching content in stream-02 pane.
  await page.evaluate(() => {
    localStorage.setItem("ravtext.nestedNotes", "1");
    const pm = window.paneManager;
    const s01 = pm.panes.find((p) => p.streamCode === "01");
    const s02 = pm.panes.find((p) => p.streamCode === "02");
    if (s01) s01.editor.commands.setContent("<p>@01 outer note has @02 here continues</p>", true);
    if (s02) s02.editor.commands.setContent("<p>@02 inner content alpha</p>", true);
  });
  // Auto-mark plugin needs a tick to wrap @XX as stream-markers.
  await new Promise((r) => setTimeout(r, 800));

  const setup = await page.evaluate(() => {
    const markers = Array.from(document.querySelectorAll(".stream-marker[data-stream='02']"));
    return {
      streamPanes: window.paneManager?.panes?.filter((p) => p.streamCode)?.length,
      streamMarkerCount: markers.length,
      stream02Markers: markers.length,
      firstMarker: markers[0]?.outerHTML?.slice(0, 200),
    };
  });
  ok("at least one @02 stream-marker rendered", setup.stream02Markers > 0,
    JSON.stringify(setup));

  if (setup.stream02Markers > 0) {
    // Hover the FIRST @02 marker (the one inside stream-01's note text).
    await page.evaluate(() => {
      const m = document.querySelector(".stream-marker[data-stream='02']");
      if (!m) return;
      const r = m.getBoundingClientRect();
      const ev = new MouseEvent("mouseover", {
        bubbles: true, cancelable: true,
        clientX: r.left + 2, clientY: r.top + 2,
      });
      m.dispatchEvent(ev);
    });
    await new Promise((r) => setTimeout(r, 200));
    const bubble = await page.evaluate(() => {
      const b = document.querySelector(".nested-notes-bubble");
      return {
        exists: !!b,
        visible: b && getComputedStyle(b).display !== "none",
        text: b?.textContent?.replace(/\s+/g, " ").trim().slice(0, 200),
      };
    });
    ok("bubble appears on hover", bubble.visible === true, JSON.stringify(bubble));
    ok("bubble shows stream label", (bubble.text || "").includes("הערה 1") || (bubble.text || "").length > 0,
      JSON.stringify(bubble));
    ok("bubble shows resolved note content", (bubble.text || "").includes("alpha") || (bubble.text || "").includes("inner"),
      JSON.stringify(bubble));
  }
}

ok("no page errors", errors.length === 0, errors.join("; "));

await browser.close();
console.log(failed === 0 ? "\nAll toggle+bubble checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
