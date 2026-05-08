// verify-nested-cross-ref.mjs — covers the cross-reference linking
// behavior that Moshe specified:
//   "להערה בזרם 2 הכי קרובה למסמך אחרי הקישור של הערה 1 זרם 1"
//
// The nested @XX inside a stream pane's note text resolves to the next
// note in stream X whose main-body anchor is AFTER the parent's anchor.
// Stream 2's apparatus stays entirely driven by main-body @02 markers
// (no consumption from nested expansion).

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

// Build a fake paneManager with TipTap-compatible editor stubs.
function makePane(streamCode, htmlText) {
  const sym = streamCode ? `@${streamCode}` : null;
  return {
    id: streamCode || "main",
    streamCode,
    symbol: sym,
    label: streamCode ? `זרם ${streamCode}` : "ראשי",
    editor: {
      state: {
        doc: makeFakeDoc(htmlText, streamCode),
      },
    },
  };
}

function makeFakeDoc(text, streamCode) {
  // Minimal stub with the methods engine_bridge calls: descendants + textContent.
  return {
    textContent: text,
    descendants(visit) {
      // One paragraph node for the whole text.
      const para = {
        type: { name: "paragraph" },
        attrs: {},
        descendants(visitChild) {
          const child = {
            isText: true,
            text,
            marks: [],
          };
          visitChild(child, 0);
        },
      };
      visit(para, 0);
    },
  };
}

function makePaneManager(panes) {
  return {
    panes,
    getMainPane() { return panes.find((p) => !p.streamCode); },
  };
}

// --- 1. Nested @02 finds the FIRST stream-2 ref AFTER parent's anchor ---
{
  // Main: "alpha @01 beta @02 gamma"
  //   Position:  6   ->@01,  next position 16->@02
  // Stream 1 pane: "@01 outer-with-@02-inside"
  // Stream 2 pane: "@02 stream2-content"
  const pm = makePaneManager([
    makePane(null, "alpha @01 beta @02 gamma"),
    makePane("01", "@01 outer @02 mid"),
    makePane("02", "@02 stream2-content"),
  ]);
  const r = paneManagerToPackerContent(pm);
  ok("1 paragraph", r.length === 1);
  ok("2 notes (one per main marker)", r[0].notes.length === 2);
  const stream1Note = r[0].notes.find((n) => n.stream === "01");
  const stream2Note = r[0].notes.find((n) => n.stream === "02");
  ok("stream-1 note from main-body @01", !!stream1Note);
  ok("stream-2 note from main-body @02", !!stream2Note);
  ok("stream-2 note text comes from stream-2 pane",
    stream2Note.text === "stream2-content", `got '${stream2Note.text}'`);
  ok("stream-1 note has 1 link to stream-2",
    stream1Note.links && stream1Note.links.length === 1, JSON.stringify(stream1Note.links));
  ok("link points to stream-2 note num=1",
    stream1Note.links?.[0]?.stream === "02" && stream1Note.links?.[0]?.num === 1,
    JSON.stringify(stream1Note.links));
}

// --- 2. Two main @02 refs → nested @02 in stream 1 links to the one
//        whose anchor is AFTER the parent (skipping the earlier one) ---
{
  // Main: "@02 first @01 outer-place @02 second"
  //   Anchors: @02→0, @01→9, @02→24
  // Stream 1 pane: "@01 here is @02"  (one nested @02)
  // Stream 2 pane: "@02 first-2 @02 second-2"
  const pm = makePaneManager([
    makePane(null, "@02 first @01 outer @02 second"),
    makePane("01", "@01 here is @02"),
    makePane("02", "@02 first-2 @02 second-2"),
  ]);
  const r = paneManagerToPackerContent(pm);
  // 3 notes: @02 (first-2), @01 (outer-text), @02 (second-2)
  ok("3 notes", r[0].notes.length === 3, JSON.stringify(r[0].notes));
  // The stream-1 note should link to stream-2 num=2 (the one AFTER its anchor)
  const stream1Note = r[0].notes.find((n) => n.stream === "01");
  ok("stream-1 has 1 link", stream1Note?.links?.length === 1,
    JSON.stringify(stream1Note?.links));
  ok("link is to stream-2 num=2 (closest after parent)",
    stream1Note?.links?.[0]?.num === 2,
    JSON.stringify(stream1Note?.links));
}

// --- 3. Three nested @02 in stream 1 → each grabs the next stream-2 ref ---
{
  // Main: "@01 outer @02 a @02 b @02 c"
  // Stream 1 pane: "@01 outer with @02 first @02 second @02 third"
  // Stream 2 pane: "@02 a-text @02 b-text @02 c-text"
  const pm = makePaneManager([
    makePane(null, "@01 outer @02 a @02 b @02 c"),
    makePane("01", "@01 outer with @02 first @02 second @02 third"),
    makePane("02", "@02 a-text @02 b-text @02 c-text"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const stream1Note = r[0].notes.find((n) => n.stream === "01");
  ok("stream-1 has 3 links", stream1Note?.links?.length === 3,
    JSON.stringify(stream1Note?.links));
  ok("links are to nums [1,2,3] in order",
    stream1Note?.links?.[0]?.num === 1 &&
    stream1Note?.links?.[1]?.num === 2 &&
    stream1Note?.links?.[2]?.num === 3,
    JSON.stringify(stream1Note?.links));
}

// --- 4. Stream-2 apparatus is NOT consumed by nested expansion ---
{
  // Main: "@01 just-this" (no main-body @02)
  // Stream 1 pane: "@01 outer @02 nested-ref"
  // Stream 2 pane: "@02 unique-text"
  // Expectation: stream-2 apparatus has NO note (no main-body @02 anchored
  // it). The nested @02 in stream-1 has nowhere to link to.
  const pm = makePaneManager([
    makePane(null, "@01 just-this"),
    makePane("01", "@01 outer @02 nested-ref"),
    makePane("02", "@02 unique-text"),
  ]);
  const r = paneManagerToPackerContent(pm);
  ok("stream-2 apparatus is empty (no main @02)",
    !r[0].notes.find((n) => n.stream === "02"),
    JSON.stringify(r[0].notes));
  const stream1Note = r[0].notes.find((n) => n.stream === "01");
  ok("stream-1 has no links (no target available)",
    !stream1Note?.links || stream1Note.links.length === 0,
    JSON.stringify(stream1Note?.links));
}

// --- 5. Self-stream marker inside a note is left alone ---
{
  // Stream 1 pane: "@01 outer talks about @01 someone-else"
  // The second @01 inside the note text is self-stream and shouldn't be
  // turned into a link.
  const pm = makePaneManager([
    makePane(null, "@01 outer @01 second"),
    makePane("01", "@01 has @01 inside @01 second outer"),
    makePane("02", "@02 alpha"),
  ]);
  const r = paneManagerToPackerContent(pm);
  const note1 = r[0].notes.find((n) => n.stream === "01");
  ok("self-stream @01 is not turned into a link",
    !note1?.links || note1.links.every((l) => l.stream !== "01"),
    JSON.stringify(note1?.links));
}

console.log(failed === 0 ? "\nAll cross-ref checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
