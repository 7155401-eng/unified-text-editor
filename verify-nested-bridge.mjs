// verify-nested-bridge.mjs — covers the engine_bridge.js helper that
// expands nested-note markers embedded in a stream-pane note's text.

import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };

const { expandNestedInNote } = await import("./src/engine_bridge.js");

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

const symbols = ["@01", "@02", "@03"];
const symToCode = { "@01": "01", "@02": "02", "@03": "03" };

// --- 1. No embedded markers — text unchanged, no children ---
{
  const counters = {};
  const r = expandNestedInNote("simple note", { "02": ["x"] }, counters, "01", symbols, symToCode);
  ok("no markers: text unchanged", r.strippedText === "simple note");
  ok("no markers: no children", r.children.length === 0);
  ok("no markers: counter 02 not advanced", (counters["02"] || 0) === 0);
}

// --- 2. One embedded marker pulls a child note ---
{
  const counters = {};
  const r = expandNestedInNote("outer @02 here", { "02": ["inner-text"] }, counters, "01", symbols, symToCode);
  ok("1 marker: text stripped", r.strippedText === "outer  here", `got '${r.strippedText}'`);
  ok("1 marker: 1 child", r.children.length === 1);
  ok("1 marker: child stream", r.children[0].stream === "02");
  ok("1 marker: child text", r.children[0].text === "inner-text");
  ok("1 marker: child anchor inside parent", r.children[0].anchor === "outer ".length);
  ok("1 marker: counter advanced", counters["02"] === 1);
}

// --- 3. Out-of-stream marker leaves literal text ---
{
  const counters = {};
  const r = expandNestedInNote("outer @02 here", { "02": [] }, counters, "01", symbols, symToCode);
  ok("no notes: marker kept literal", r.strippedText === "outer @02 here");
  ok("no notes: no children", r.children.length === 0);
}

// --- 4. Self-marker is ignored (no recursion into own stream) ---
{
  const counters = {};
  const r = expandNestedInNote("body @01 inside", { "01": ["should not pull"] }, counters, "01", symbols, symToCode);
  ok("self-marker: text unchanged", r.strippedText === "body @01 inside");
  ok("self-marker: no children", r.children.length === 0);
  ok("self-marker: counter 01 NOT advanced", (counters["01"] || 0) === 0);
}

// --- 5. Two embedded markers pull two children ---
{
  const counters = {};
  const r = expandNestedInNote(
    "x @02 y @03 z",
    { "02": ["i02"], "03": ["i03"] },
    counters,
    "01",
    symbols, symToCode
  );
  ok("2 markers: 2 children", r.children.length === 2);
  ok("2 markers: child0 stream", r.children[0].stream === "02");
  ok("2 markers: child1 stream", r.children[1].stream === "03");
  ok("2 markers: text stripped",
    r.strippedText === "x  y  z", `got '${r.strippedText}'`);
}

// --- 6. Recursive nesting: child's text contains another marker ---
{
  const counters = {};
  const r = expandNestedInNote(
    "outer @02 mid",
    { "02": ["inner @03 deep"], "03": ["deepest"] },
    counters,
    "01",
    symbols, symToCode
  );
  ok("recursive: 1 child", r.children.length === 1);
  const inner = r.children[0];
  ok("recursive: inner has 1 grandchild", inner.children.length === 1);
  ok("recursive: grandchild stream", inner.children[0].stream === "03");
  ok("recursive: grandchild text", inner.children[0].text === "deepest");
  ok("recursive: 02 counter at 1", counters["02"] === 1);
  ok("recursive: 03 counter at 1", counters["03"] === 1);
}

// --- 7. Counter is shared with main-body extraction ---
// If main body had already consumed @02[0], a nested @02 in note body
// pulls @02[1].
{
  const counters = { "02": 1 };
  const r = expandNestedInNote("@02", { "02": ["first", "second"] }, counters, "01", symbols, symToCode);
  ok("shared counter: pulled second", r.children[0].text === "second");
  ok("shared counter: advanced to 2", counters["02"] === 2);
}

console.log(failed === 0 ? "\nAll bridge checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
