// verify-stream-links.mjs — the per-stream "which parents may I nest under"
// rule, tested straight against the exported engine helper.
//
// Same harness shape as verify-nested-bridge.mjs: jsdom + `?nested=1` so the
// feature gate is on, then call expandNestedInNote directly.

import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/?nested=1" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
// Pre-existing, NOT caused by this change: src/compact_stream_menu.js (pulled in
// by nested_notes_gate.js) calls bare `addEventListener(...)` at module load, so
// it needs the browser globals to exist on globalThis, not only on `window`.
// verify-nested-bridge.mjs already crashes on HEAD for exactly this reason.
for (const name of [
  "addEventListener", "removeEventListener", "dispatchEvent",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame",
  "matchMedia", "innerWidth", "innerHeight", "location", "navigator",
  "MutationObserver", "Node", "Element", "HTMLElement", "Event", "DOMParser",
  "ResizeObserver", "getSelection",
]) {
  if (globalThis[name] !== undefined) continue;
  const value = dom.window[name];
  globalThis[name] = typeof value === "function" ? value.bind(dom.window) : value;
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
}

const { expandNestedInNote } = await import("./src/engine_bridge.js");
const {
  setStreamLinks, setStreamParents, getStreamParents, canNestInside,
  streamLinksSignature, STREAM_LINKS_STORAGE_KEY, _resetStreamLinksCache,
} = await import("./src/stream_links.js");

const results = [];
const check = (name, cond, detail = "") => results.push({ name, pass: !!cond, detail });

const symbols = ["@01", "@02", "@03"];
const symToCode = { "@01": "01", "@02": "02", "@03": "03" };
const expand = (text, notes, counters, ownCode) =>
  expandNestedInNote(text, notes, counters, ownCode, symbols, symToCode);

// ---------------------------------------------------------------- 1
// DEFAULT configuration: nothing at all nests inside another stream.
{
  setStreamLinks({});
  const counters = {};
  const r = expand("outer @02 here", { "02": ["inner-text"] }, counters, "01");
  check("default: no children pulled", r.children.length === 0, `children=${r.children.length}`);
  check("default: strippedText unchanged", r.strippedText === "outer @02 here", `got '${r.strippedText}'`);
  check("default: counter 02 not advanced", (counters["02"] || 0) === 0, `counter=${counters["02"]}`);
}

// Same, three streams deep, two markers in one note.
{
  setStreamLinks({});
  const counters = {};
  const r = expand("x @02 y @03 z", { "02": ["i02"], "03": ["i03"] }, counters, "01");
  check("default: two markers, still no children", r.children.length === 0);
  check("default: two markers, text unchanged", r.strippedText === "x @02 y @03 z", `got '${r.strippedText}'`);
}

// ---------------------------------------------------------------- 2
// After linking 02 -> 01, a @02 marker inside a stream-01 note is a child.
{
  setStreamLinks({ "02": ["01"] });
  const counters = {};
  const r = expand("outer @02 here", { "02": ["inner-text"] }, counters, "01");
  check("linked 02->01: one child", r.children.length === 1, `children=${r.children.length}`);
  check("linked 02->01: child stream", r.children[0]?.stream === "02");
  check("linked 02->01: child text", r.children[0]?.text === "inner-text", r.children[0]?.text);
  check("linked 02->01: anchor inside parent", r.children[0]?.anchor === "outer ".length, `anchor=${r.children[0]?.anchor}`);
  check("linked 02->01: marker stripped", r.strippedText === "outer  here", `got '${r.strippedText}'`);
  check("linked 02->01: counter advanced", counters["02"] === 1, `counter=${counters["02"]}`);
}

// ---------------------------------------------------------------- 3
// The SAME marker inside a stream-03 note still does not nest.
{
  setStreamLinks({ "02": ["01"] });
  const counters = {};
  const r = expand("outer @02 here", { "02": ["inner-text"] }, counters, "03");
  check("02 not linked to 03: no children", r.children.length === 0, `children=${r.children.length}`);
  check("02 not linked to 03: text unchanged", r.strippedText === "outer @02 here", `got '${r.strippedText}'`);
  check("02 not linked to 03: counter not advanced", (counters["02"] || 0) === 0);
}

// Two parents at once: 02 linked to BOTH 01 and 03.
{
  setStreamLinks({ "02": ["01", "03"] });
  const c1 = {};
  const r1 = expand("a @02 b", { "02": ["n1", "n2"] }, c1, "01");
  const c3 = {};
  const r3 = expand("a @02 b", { "02": ["n1", "n2"] }, c3, "03");
  check("two parents: nests under 01", r1.children.length === 1 && r1.children[0].text === "n1");
  check("two parents: nests under 03", r3.children.length === 1 && r3.children[0].text === "n1");
}

// ---------------------------------------------------------------- 4
// Self-reference stays literal even if someone stored a self link.
{
  setStreamLinks({ "01": ["01"] });
  const counters = {};
  const r = expand("body @01 inside", { "01": ["should not pull"] }, counters, "01");
  check("self-reference: no children", r.children.length === 0);
  check("self-reference: text unchanged", r.strippedText === "body @01 inside", `got '${r.strippedText}'`);
  check("self-reference: counter 01 not advanced", (counters["01"] || 0) === 0);
  check("self link never reaches storage", getStreamParents("01").length === 0, JSON.stringify(getStreamParents("01")));
}

// ---------------------------------------------------------------- 5
// Linked, but the child stream has run out of notes -> marker stays literal.
{
  setStreamLinks({ "02": ["01"] });
  const counters = {};
  const r = expand("outer @02 here", { "02": [] }, counters, "01");
  check("out of notes: no children", r.children.length === 0);
  check("out of notes: marker kept literal", r.strippedText === "outer @02 here", `got '${r.strippedText}'`);
}
{
  setStreamLinks({ "02": ["01"] });
  const counters = { "02": 1 };           // the single note was already used
  const r = expand("outer @02 here", { "02": ["only-one"] }, counters, "01");
  check("pool exhausted: marker kept literal", r.strippedText === "outer @02 here", `got '${r.strippedText}'`);
  check("pool exhausted: no children", r.children.length === 0);
}

// ---------------------------------------------------------------- 6
// Recursion respects the links at every level.
// 03 linked to 02, 02 linked to 01 -> grandchild pulled.
{
  setStreamLinks({ "02": ["01"], "03": ["02"] });
  const counters = {};
  const r = expand("outer @02 mid", { "02": ["inner @03 deep"], "03": ["deepest"] }, counters, "01");
  check("recursion allowed: one child", r.children.length === 1);
  check("recursion allowed: one grandchild", r.children[0]?.children.length === 1, `n=${r.children[0]?.children.length}`);
  check("recursion allowed: grandchild text", r.children[0]?.children[0]?.text === "deepest");
}
// 03 NOT linked to 02 -> the grandchild marker stays literal inside the child.
{
  setStreamLinks({ "02": ["01"] });
  const counters = {};
  const r = expand("outer @02 mid", { "02": ["inner @03 deep"], "03": ["deepest"] }, counters, "01");
  check("recursion blocked: still one child", r.children.length === 1);
  check("recursion blocked: no grandchild", r.children[0]?.children.length === 0, `n=${r.children[0]?.children.length}`);
  check("recursion blocked: child text keeps marker", r.children[0]?.text === "inner @03 deep", r.children[0]?.text);
  check("recursion blocked: 03 counter untouched", (counters["03"] || 0) === 0);
}

// ---------------------------------------------------------------- 7
// strippedText is byte-identical to the input in every no-nest case.
{
  setStreamLinks({});
  const cases = [
    ["plain text, no markers", "01"],
    ["lead @02 tail", "01"],
    ["@02@03 back to back", "01"],
    ["  spaced  @02  out  ", "03"],
    ["", "01"],
  ];
  let allSame = true;
  const bad = [];
  for (const [text, own] of cases) {
    const r = expand(text, { "02": ["a"], "03": ["b"] }, {}, own);
    if (r.strippedText !== text || r.children.length !== 0) { allSame = false; bad.push(text); }
  }
  check("no-nest cases: strippedText byte-identical", allSame, bad.join(" | "));
}

// ---------------------------------------------------------------- 8
// Storage layer: persist, reload from storage, signature, "main only" reset.
{
  setStreamLinks({});
  check("empty map removes the storage key", localStorage.getItem(STREAM_LINKS_STORAGE_KEY) === null);
  check("empty map signature is blank", streamLinksSignature() === "");

  setStreamParents("02", ["01"]);
  check("setStreamParents persisted", localStorage.getItem(STREAM_LINKS_STORAGE_KEY) === '{"02":["01"]}',
    String(localStorage.getItem(STREAM_LINKS_STORAGE_KEY)));
  check("signature changes with the links", streamLinksSignature() === "02>01", streamLinksSignature());

  _resetStreamLinksCache();                    // simulate a page reload
  check("survives a reload", canNestInside("02", "01") === true);
  check("reload: unrelated pair still blocked", canNestInside("02", "03") === false);
  check("reload: parents read back", getStreamParents("02").join(",") === "01", getStreamParents("02").join(","));

  setStreamParents("02", []);                  // back to "main only"
  check("clearing returns to main-only", localStorage.getItem(STREAM_LINKS_STORAGE_KEY) === null);
  check("clearing blocks nesting again", canNestInside("02", "01") === false);

  // Corrupt storage must not throw and must fall back to "main only".
  localStorage.setItem(STREAM_LINKS_STORAGE_KEY, "{not json");
  _resetStreamLinksCache();
  check("corrupt storage falls back to main-only", canNestInside("02", "01") === false);
  localStorage.setItem(STREAM_LINKS_STORAGE_KEY, '{"02":"01","":["x"],"03":[""],"04":["04"]}');
  _resetStreamLinksCache();
  check("junk shapes are dropped", JSON.stringify(getStreamParents("02")) === "[]"
    && JSON.stringify(getStreamParents("03")) === "[]"
    && JSON.stringify(getStreamParents("04")) === "[]");
  // Mutating a returned list must not corrupt the cache.
  setStreamLinks({ "02": ["01"] });
  getStreamParents("02").push("03");
  check("returned parent list is a copy", canNestInside("02", "03") === false);
}

// ---------------------------------------------------------------- 9
// The second copy of the function, in talmud_overflow_repagination.js,
// must follow the very same rule.
{
  const talmud = await import("./src/talmud_overflow_repagination.js");
  setStreamLinks({});
  const a = talmud.expandNestedInNote("outer @02 here", { "02": ["inner"] }, {}, "01", symbols, symToCode);
  check("talmud copy: default nests nothing", a.children.length === 0 && a.strippedText === "outer @02 here", a.strippedText);
  setStreamLinks({ "02": ["01"] });
  const b = talmud.expandNestedInNote("outer @02 here", { "02": ["inner"] }, {}, "01", symbols, symToCode);
  check("talmud copy: linked pair nests", b.children.length === 1 && b.children[0].text === "inner");
  const c = talmud.expandNestedInNote("outer @02 here", { "02": ["inner"] }, {}, "03", symbols, symToCode);
  check("talmud copy: unlinked parent blocked", c.children.length === 0 && c.strippedText === "outer @02 here");
}

setStreamLinks({});   // leave storage clean

const passed = results.filter((r) => r.pass).length;
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "  <- " + r.detail}`);
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
