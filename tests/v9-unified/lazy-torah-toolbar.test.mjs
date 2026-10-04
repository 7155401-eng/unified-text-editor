import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("heavy Torah toolbar builder stays out of the startup static graph", async () => {
  const [main, lazy] = await Promise.all([
    source("src/main.js"),
    source("src/torah_toolbar_lazy_wire.js"),
  ]);

  assert.match(main, /from "\.\/torah_toolbar_lazy_wire\.js"/);
  assert.doesNotMatch(main, /^\s*import\s+.*from\s+"\.\/torah_tools\.js"/m);
  assert.doesNotMatch(main, /^\s*import\s+.*from\s+"\.\/sefaria\/sefaria\.js"/m);
  assert.doesNotMatch(main, /^\s*import\s+.*wireTorahTranscription/m);
  assert.doesNotMatch(main, /^\s*import\s+.*wireTorahNikud/m);
  assert.doesNotMatch(main, /^\s*import\s+.*wireCaricatureBot/m);

  assert.match(lazy, /import\("\.\/torah_tools\.js"\)/);
  assert.match(lazy, /import\("\.\/sefaria\/sefaria\.js"\)/);
  assert.match(lazy, /import\("\.\/torah_transcription\/torah_transcription_lazy_wire\.js"\)/);
  assert.match(lazy, /import\("\.\/torah_nikud_lazy_wire\.js"\)/);
  assert.match(lazy, /import\("\.\/haredi_caricature_lazy_wire\.js"\)/);
});

test("toolbar orchestration preserves destructive-builder ordering", async () => {
  const lazy = await source("src/torah_toolbar_lazy_wire.js");

  const base = lazy.indexOf("mods.base.wireTorahTools(paneManager)");
  const sefaria = lazy.indexOf("mods.sefaria.wireSefariaTools(paneManager)");
  const transcription = lazy.indexOf("mods.transcription.wireTorahTranscription(paneManager)");
  const nikud = lazy.indexOf("mods.nikud.wireTorahNikud(paneManager)");
  const caricature = lazy.indexOf("mods.caricature.wireCaricatureBot(paneManager)");
  const vilna = lazy.indexOf("wireVilnaImportButton(paneManager, onVilnaImport)");
  const reveal = lazy.indexOf("revealToolButtons()", vilna);

  assert.ok(base >= 0, "base toolbar builder missing");
  assert.ok(sefaria > base, "Sefaria must wire after toolbar replacement");
  assert.ok(transcription > sefaria, "transcription must wire after base/Sefaria");
  assert.ok(nikud > transcription, "nikud ordering changed");
  assert.ok(caricature > nikud, "caricature ordering changed");
  assert.ok(vilna > caricature, "Vilna must wire after toolbar replacement");
  assert.ok(reveal > vilna, "tool visibility must refresh after all buttons exist");

  for (const tool of ["torah-transcription", "torah-nikud", "haredi-caricature"]) {
    assert.ok(
      lazy.includes(`isToolPreviewAllowed("${tool}")`),
      "preview gate missing for " + tool
    );
  }
});

test("toolbar lazy load is interaction-driven, saved-tab aware and retryable", async () => {
  const lazy = await source("src/torah_toolbar_lazy_wire.js");

  assert.match(lazy, /data-ribbon-tab="torah"/);
  assert.match(lazy, /addEventListener\("pointerenter", ensure/);
  assert.match(lazy, /addEventListener\("focus", ensure/);
  assert.match(lazy, /addEventListener\("click", ensure/);
  assert.match(lazy, /localStorage\.getItem\("ravtext\.ribbonTab"\) === "torah"/);
  assert.match(lazy, /queueMicrotask\(ensure\)/);

  assert.match(lazy, /_modulePromise\s*=\s*null;[\s\S]*throw error/);
  assert.match(lazy, /if \(_loadPromise\) return _loadPromise/);
  assert.match(lazy, /aria-busy/);
  assert.match(lazy, /ravtext:torah-toolbar-ready/);
});

test("main no longer performs timer-based toolbar rebuilds or duplicate Sefaria wiring", async () => {
  const main = await source("src/main.js");

  assert.doesNotMatch(main, /setTimeout\(\(\) => \{\s*wireTorahTools/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => wireTorahTranscription/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => wireTorahNikud/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => wireCaricatureBot/);
  assert.doesNotMatch(main, /setTimeout\(\(\) => wireVilnaImportButton/);
  assert.doesNotMatch(main, /wireSefariaTools\(paneManager\)/);

  const tabs = main.indexOf("setupRibbonTabs();");
  const wire = main.indexOf("wireTorahToolbarLazy(paneManager, handleVilnaImport);");
  assert.ok(tabs >= 0 && wire > tabs, "lazy toolbar must wire after ribbon tabs exist");
});
