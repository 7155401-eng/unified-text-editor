// verify-nested-cross-ref.mjs — verifies the consumption model that
// matches Moshe's spec:
//   "הערה הבאה של זרם 02 תקושר לטקסט הראשי היכן שההערה הנוכחית בזרם
//    01 מקושרת, ואילו ההערה שלאחריה בזרם 02 תקושר לקישור הקרוב 02
//    בזרם הראשי שיופיע לאחר מכן"
//
// Each main-body @YY marker AND each nested @YY (inside another stream's
// note text) is a CONSUMER of stream Y's pane pool. Pane is consumed
// sequentially in sorted (paraIdx, anchor, primary) order. Stream Y's
// apparatus shows ALL consumed notes anchored at their consumer's
// effective position (parent's anchor for nested).

import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/?nested=1",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

const { paneManagerToPackerContent } = await import("./src/engine_bridge.js");

function makePane(streamCode, text) {
  const sym = streamCode ? `@${streamCode}` : null;
  return {
    id: streamCode || "main",
    streamCode,
    symbol: sym,
    label: streamCode ? `זרם ${streamCode}` : "ראשי",
    editor: {
      state: { doc: { textContent: text, descendants(visit) {
        visit({
          type: { name: "paragraph" },
          attrs: {},
          descendants(visitChild) { visitChild({ isText: true, text, marks: [] }, 0); },
        }, 0);
      } } },
    },
  };
}

function makePM(panes) {
  return { panes, getMainPane() { return panes.find((p) => !p.streamCode); } };
}

// --- 1. Moshe's headline scenario: nested @02 in stream-01 consumes from
//        pane 02. Subsequent main @02 consumes the next pane note. ---
{
  // Main: "@01 outerAnchor @02 mainAnchor"
  // Stream 01 pane: "@01 outer with @02 nested"
  // Stream 02 pane: "@02 first @02 second @02 third"
  const pm = makePM([
    makePane(null, "@01 outerAnchor @02 mainAnchor"),
    makePane("01", "@01 outer with @02 nested"),
    makePane("02", "@02 first @02 second @02 third"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream02Notes = r[0].notes.filter((n) => n.stream === "02");
  ok("stream 02 has 2 apparatus notes", stream02Notes.length === 2,
    JSON.stringify(stream02Notes));
  // First (by anchor): nested ref at outer's anchor → pane[0]="first"
  ok("nested note appears first (anchored at outer)", stream02Notes[0].text === "first",
    JSON.stringify(stream02Notes[0]));
  // Second: main @02 → pane[1]="second"
  ok("main @02 gets the next pane note (second)", stream02Notes[1].text === "second",
    JSON.stringify(stream02Notes[1]));
  // Numbering: assigned by sorted consumption order
  ok("nested note num=1", stream02Notes[0].num === 1);
  ok("main @02 num=2", stream02Notes[1].num === 2);
  // Anchors
  ok("nested note anchored at outer's main-body position",
    stream02Notes[0].anchor < stream02Notes[1].anchor,
    `anchors: ${stream02Notes[0].anchor}, ${stream02Notes[1].anchor}`);
}

// --- 2. Outer text in stream-01 apparatus has @02 STRIPPED ---
{
  const pm = makePM([
    makePane(null, "@01 here @02 there"),
    makePane("01", "@01 outer with @02 cross-ref between"),
    makePane("02", "@02 alpha @02 beta"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream01Note = r[0].notes.find((n) => n.stream === "01");
  ok("outer text has cross-stream @02 stripped",
    stream01Note && !stream01Note.text.includes("@02"),
    `text: '${stream01Note?.text}'`);
  ok("outer text retains surrounding words",
    stream01Note?.text?.includes("outer with") &&
    stream01Note?.text?.includes("cross-ref between"),
    `text: '${stream01Note?.text}'`);
}

// --- 3. Three nested @02 inside the SAME outer note → consume 3 sequential
//        pane 02 notes, all anchored at outer's position ---
{
  const pm = makePM([
    makePane(null, "@01 outer-anchor"),
    makePane("01", "@01 outer with @02 a @02 b @02 c"),
    makePane("02", "@02 alpha @02 beta @02 gamma @02 delta"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream02 = r[0].notes.filter((n) => n.stream === "02");
  ok("three nested → three stream-02 notes", stream02.length === 3,
    JSON.stringify(stream02));
  ok("they consume pane[0..2] in order",
    stream02[0].text === "alpha" && stream02[1].text === "beta" && stream02[2].text === "gamma",
    JSON.stringify(stream02));
  ok("all anchored at outer's position",
    stream02[0].anchor === stream02[1].anchor && stream02[1].anchor === stream02[2].anchor,
    JSON.stringify(stream02.map((n) => n.anchor)));
}

// --- 4. Mix: main @02 + nested @02 + main @02 → 3 stream-02 notes anchored
//        in document order ---
{
  // Main: @02 (pos A) ... @01 (pos B) ... @02 (pos C)
  // Stream 01: "@01 outer with @02 nested"
  // Stream 02: 4 notes
  const pm = makePM([
    makePane(null, "@02 first-pos @01 mid-pos @02 last-pos"),
    makePane("01", "@01 outer @02 nested"),
    makePane("02", "@02 alpha @02 beta @02 gamma @02 delta"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream02 = r[0].notes.filter((n) => n.stream === "02");
  ok("3 stream-02 notes (2 main + 1 nested)", stream02.length === 3,
    JSON.stringify(stream02));
  // Anchors in document order: main @02 at first-pos, nested at mid-pos, main @02 at last-pos
  // Pane consumption in that sorted order: pane[0]=alpha → first main, pane[1]=beta → nested, pane[2]=gamma → last main
  ok("first main @02 → alpha", stream02[0].text === "alpha");
  ok("nested @02 → beta", stream02[1].text === "beta");
  ok("last main @02 → gamma", stream02[2].text === "gamma");
}

// --- 5. Nested @02 in a stream-01 note that's the SECOND main @01 (pane idx 1) ---
{
  // Main: @01 outerA, @01 outerB
  // Stream 01: 2 notes — only the SECOND has nested
  // Stream 02: 1 note
  const pm = makePM([
    makePane(null, "@01 outerA @01 outerB"),
    makePane("01", "@01 first @01 second with @02 nested"),
    makePane("02", "@02 alpha"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream02 = r[0].notes.filter((n) => n.stream === "02");
  ok("1 stream-02 note from the nested @02", stream02.length === 1);
  ok("anchor matches the SECOND outer's main-body position",
    stream02[0].anchor > 0,
    JSON.stringify(stream02));
  // The first main @01 anchored at "@01 outerA" (anchor 0 after stripping)
  // The second main @01 anchored at " @01 outerB" → after first marker stripped, anchor = "outerA ".length = 7
  ok("anchored after first outer (not at 0)", stream02[0].anchor > 0);
}

// --- 6. Pane 02 runs out → extras drop silently ---
{
  const pm = makePM([
    makePane(null, "@01 anchor @02 main"),
    makePane("01", "@01 outer @02 nested-overflows"),
    makePane("02", "@02 only-one"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream02 = r[0].notes.filter((n) => n.stream === "02");
  ok("stream-02 has 1 note (nested took the only one)", stream02.length === 1,
    JSON.stringify(stream02));
  ok("nested consumed first (sorted before main @02 by anchor)",
    stream02[0].text === "only-one");
}

console.log(failed === 0 ? "\nAll consumption-model checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
