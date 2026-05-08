// verify-nested-gate.mjs — confirms the URL/localStorage feature gate.
// With `?nested=1`, the gate is on. Without, off. Default is off.

import { JSDOM } from "jsdom";

let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}  ${detail}`); failed++; }
}

// Helper: load a fresh JSDOM with a given URL, clear the module cache, and
// import the gate module so URL parsing happens against the new window.
async function loadGateWithUrl(url) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  // Cache-bust by query so the module re-evaluates URL each call.
  const mod = await import(`./src/nested_notes_gate.js?t=${Math.random()}`);
  mod._resetNestedNotesGateCache();
  return mod;
}

// 1. Default (no URL param, no localStorage) → off.
{
  const m = await loadGateWithUrl("http://localhost/");
  ok("default off", m.isNestedNotesEnabled() === false);
}

// 2. URL `?nested=1` → on.
{
  const m = await loadGateWithUrl("http://localhost/?nested=1");
  ok("?nested=1 → on", m.isNestedNotesEnabled() === true);
  // And it persisted to localStorage.
  ok("?nested=1 persisted", localStorage.getItem("ravtext.nestedNotes") === "1");
}

// 3. localStorage flag set, no URL → on.
{
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  localStorage.setItem("ravtext.nestedNotes", "1");
  const mod = await import(`./src/nested_notes_gate.js?t=${Math.random()}`);
  mod._resetNestedNotesGateCache();
  ok("localStorage on → on", mod.isNestedNotesEnabled() === true);
}

// 4. URL `?nested=0` overrides localStorage.
{
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/?nested=0" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  localStorage.setItem("ravtext.nestedNotes", "1");
  const mod = await import(`./src/nested_notes_gate.js?t=${Math.random()}`);
  mod._resetNestedNotesGateCache();
  ok("?nested=0 overrides storage", mod.isNestedNotesEnabled() === false);
  ok("?nested=0 cleared storage", localStorage.getItem("ravtext.nestedNotes") === null);
}

// 5. With shareable link `?nested=1&k=...`, both flags coexist.
{
  const m = await loadGateWithUrl("http://localhost/?nested=1&k=9q7zX3mP4w");
  ok("shareable link still activates", m.isNestedNotesEnabled() === true);
}

console.log(failed === 0 ? "\nAll gate checks passed." : `\n${failed} failures.`);
process.exit(failed === 0 ? 0 : 1);
