import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../../" + path, import.meta.url), "utf8");
}

test("optional Torah tool implementations stay outside the startup import graph", async () => {
  const [main, nikudWire, caricatureWire] = await Promise.all([
    source("src/main.js"),
    source("src/torah_nikud_lazy_wire.js"),
    source("src/haredi_caricature_lazy_wire.js"),
  ]);

  assert.match(main, /from "\.\/torah_nikud_lazy_wire\.js"/);
  assert.match(main, /from "\.\/haredi_caricature_lazy_wire\.js"/);
  assert.doesNotMatch(main, /from "\.\/torah_nikud\/torah_nikud\.js"/);
  assert.doesNotMatch(main, /from "\.\/haredi_caricature\/haredi_caricature\.js"/);

  assert.match(nikudWire, /import\("\.\/torah_nikud\/torah_nikud\.js"\)/);
  assert.match(caricatureWire, /import\("\.\/haredi_caricature\/haredi_caricature\.js"\)/);

  // A transient chunk/network failure must not poison all later clicks.
  assert.match(nikudWire, /_modulePromise\s*=\s*null;[\s\S]*throw error/);
  assert.match(caricatureWire, /_modulePromise\s*=\s*null;[\s\S]*throw error/);
});

test("lazy wires preserve the existing toolbar contracts", async () => {
  const [nikudWire, caricatureWire] = await Promise.all([
    source("src/torah_nikud_lazy_wire.js"),
    source("src/haredi_caricature_lazy_wire.js"),
  ]);

  assert.match(nikudWire, /id\s*=\s*"torah-nikud-btn"/);
  assert.match(nikudWire, /querySelector\("\.torah-toolbar"\)/);
  assert.match(nikudWire, /trimTorahOrTextForFreeUser/);
  assert.match(nikudWire, /onResult:\s*\(vocalized\)/);

  assert.match(caricatureWire, /id\s*=\s*"hc-trigger-btn"/);
  assert.match(caricatureWire, /querySelector\("\.torah-toolbar"\)/);
  assert.match(caricatureWire, /initialScene:\s*selectedText\(paneManager\)/);
  assert.match(caricatureWire, /setImage\(\{/);

  for (const wire of [nikudWire, caricatureWire]) {
    assert.match(wire, /aria-busy/);
    assert.match(wire, /btn\.disabled\s*=\s*true/);
    assert.match(wire, /btn\.disabled\s*=\s*false/);
  }
});
