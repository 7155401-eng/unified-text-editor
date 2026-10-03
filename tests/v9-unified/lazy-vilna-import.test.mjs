import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("heavy Vilna import modal stays out of the startup static graph", async () => {
  const main = await source("src/main.js");
  assert.match(main, /from "\.\/vilna_import_lazy\.js"/);
  assert.doesNotMatch(
    main,
    /^\s*import\s+.*from\s+"\.\/vilna_import_modal\.js"/m,
    "heavy modal must not return to the startup static graph"
  );

  const lazy = await source("src/vilna_import_lazy.js");
  assert.doesNotMatch(lazy, /^\s*import\s+.*vilna_import_modal\.js/m);
  assert.match(lazy, /import\("\.\/vilna_import_modal\.js"\)/);
});

test("lazy import button loads only on activation and retries failed chunks", async () => {
  const lazy = await source("src/vilna_import_lazy.js");
  const click = lazy.indexOf('btn.addEventListener("click"');
  const load = lazy.indexOf("await loadVilnaImportModule()");
  assert.ok(click >= 0, "click handler missing");
  assert.ok(load > click, "heavy module must load only from the click path");

  const loaderStart = lazy.indexOf("export function loadVilnaImportModule()");
  const wireStart = lazy.indexOf("export function wireVilnaImportButton", loaderStart);
  const loader = lazy.slice(loaderStart, wireStart);
  assert.match(loader, /\.catch\(\(error\) => \{/);
  assert.match(loader, /_vilnaImportModulePromise\s*=\s*null/);
  assert.match(loader, /throw error/);

  assert.match(lazy, /if \(btn\.disabled\) return/);
  assert.match(lazy, /btn\.disabled\s*=\s*true/);
  assert.match(lazy, /setAttribute\("aria-busy", "true"\)/);
  assert.match(lazy, /finally\s*\{/);
  assert.match(lazy, /btn\.disabled\s*=\s*false/);
  assert.match(lazy, /removeAttribute\("aria-busy"\)/);
});

test("post-import layout helper reuses the same lazy module", async () => {
  const main = await source("src/main.js");
  const start = main.indexOf("async function handleVilnaImport");
  assert.ok(start >= 0, "import completion handler missing");
  const end = main.indexOf("\n}\n", start);
  const block = main.slice(start, end + 3);
  assert.match(block, /const \{ enableVilnaLayoutFor \} = await loadVilnaImportModule\(\)/);
  assert.match(block, /enableVilnaLayoutFor\(code\)/);
});
