// Smoke test for the unified note-content builder.
// Confirms that:
//   1. Default settings produce "[1] " / "[2] " prefixes (matching the old renderer).
//   2. V9-side nodesToTextRuns produces matching text + runs.
//   3. Lemma bold becomes a run with marks.bold for V9 consumers.
//   4. Child notes are flattened correctly.
//
// Run via:  node verify-note-content.mjs

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;

const { buildNoteContentNodes, nodesToTextRuns, injectMainRefs } = await import("./src/engine/note_content_builder.js");
const streamColumns = await import("./src/original_stream_columns.js");

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log("PASS ", label); }
  else      { fail++; console.log("FAIL ", label); }
}

// 1) Simple note, default settings.
{
  const nodes = buildNoteContentNodes("06", 1, "פרשה כל מקום שאתה מוצא", [], {});
  const { text, runs } = nodesToTextRuns(nodes);
  assert(text.startsWith("[1] "), "1) number prefix [1] appears");
  assert(text.includes("פרשה"), "1) lemma present in text");
  assert(runs.some((r) => r.marks && r.marks.bold), "1) lemma bolded via run");
}

// 2) Continuation half — no prefix, no lemma split.
{
  const nodes = buildNoteContentNodes("06", 1, "המשך של הערה קודמת", [], { isCont: true });
  const { text } = nodesToTextRuns(nodes);
  assert(!text.startsWith("[1]"), "2) continuation has no prefix");
  assert(text.trim().startsWith("המשך"), "2) continuation body unchanged");
}

// 3) Second note, num=2.
{
  const nodes = buildNoteContentNodes("06", 2, "אמר רבי", [], {});
  const { text } = nodesToTextRuns(nodes);
  assert(text.startsWith("[2] "), "3) second note [2] appears");
}

// 4) Child notes flattened (no extra wrapping in text).
{
  const nodes = buildNoteContentNodes(
    "06",
    1,
    "הערת אם",
    [],
    {
      children: [
        { stream: "07", num: 1, text: "ילד אחד", runs: [], children: [] },
        { stream: "07", num: 2, text: "ילד שני", runs: [], children: [] },
      ],
    }
  );
  const { text } = nodesToTextRuns(nodes);
  assert(text.includes("ילד אחד"), "4) first child text appears");
  assert(text.includes("ילד שני"), "4) second child text appears");
}

// 5) injectMainRefs — מצב כבוי (ברירת מחדל) — שום שינוי לא קורה.
{
  const out = injectMainRefs("שלום עולם", [], [{ stream: "06", num: 1, anchor: 5 }]);
  assert(out.mainText === "שלום עולם", "5) main ref off → text unchanged");
  assert(out.notes[0].anchor === 5, "5) main ref off → anchor unchanged");
}

// 6) injectMainRefs — מצב דלוק לזרם 07 → [1] מוזרק במיקום העוגן.
{
  // הפעלת mainRefEnabled לזרם 07 דרך __STREAM_SETTINGS__ (merged עם defaults
  // בתוך getEffectiveStreamSettings).
  if (!globalThis.window.__STREAM_SETTINGS__) globalThis.window.__STREAM_SETTINGS__ = {};
  globalThis.window.__STREAM_SETTINGS__["07"] = { mainRefEnabled: true };
  const out = injectMainRefs("שלום עולם", [], [{ stream: "07", num: 1, anchor: 5 }]);
  assert(out.mainText.includes("[1]"), "6) main ref on → [1] appears in text");
  // השם "שלום " (5 תווים) קודם, אחריו "[1]", אחריו "עולם"
  assert(out.mainText === "שלום [1]עולם", "6) ref inserted exactly at anchor 5");
  // העוגן של ההערה זז קדימה כדי להיצמד למספר ולא לפצל אותו
  assert(out.notes[0].anchor === 5 + 3, "6) note anchor shifted past its ref");
  delete globalThis.window.__STREAM_SETTINGS__["07"];
}

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
