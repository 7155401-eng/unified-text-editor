import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("Sefaria toolbar wire stays light while modal implementations are dynamic", async () => {
  const entry = await source("src/sefaria/sefaria.js");

  assert.doesNotMatch(
    entry,
    /^\s*import\s+.*sefaria_(?:downloader|live)_modal\.js/m,
    "modal implementations must not return to the static startup graph"
  );
  assert.doesNotMatch(
    entry,
    /^\s*import\s+.*sefaria_modal\.css/m,
    "modal CSS must not return to the static startup graph"
  );
  assert.doesNotMatch(
    entry,
    /^\s*import\s+.*sefaria_i18n\.js/m,
    "modal-only i18n must not be pulled into startup through the toolbar wire"
  );

  assert.match(entry, /import\("\.\/sefaria_downloader_modal\.js"\)/);
  assert.match(entry, /import\("\.\/sefaria_live_modal\.js"\)/);
  assert.match(entry, /import\("\.\/sefaria_modal\.css"\)/);
  assert.match(entry, /export function wireSefariaTools\(paneManager\)/);
});

test("tool allowance is checked before either heavy Sefaria modal is loaded", async () => {
  const entry = await source("src/sefaria/sefaria.js");

  const downloader = entry.match(
    /export async function openSefariaDownloader\(options = \{\}\) \{([\s\S]*?)\n\}/
  )?.[1] || "";
  assert.ok(downloader, "downloader entry point missing");
  assert.ok(
    downloader.indexOf('await assertToolAllowed("sefaria-downloader")') >= 0,
    "downloader runtime gate missing"
  );
  assert.ok(
    downloader.indexOf("await loadDownloaderModule()") >
      downloader.indexOf('await assertToolAllowed("sefaria-downloader")'),
    "downloader chunk must load only after allowance"
  );

  const live = entry.match(
    /export async function openSefariaLive\(options = \{\}\) \{([\s\S]*?)\n\}/
  )?.[1] || "";
  assert.ok(live, "live entry point missing");
  assert.ok(
    live.indexOf('await assertToolAllowed("sefaria-live")') >= 0,
    "live runtime gate missing"
  );
  assert.ok(
    live.indexOf("await loadLiveModule()") >
      live.indexOf('await assertToolAllowed("sefaria-live")'),
    "live chunk must load only after allowance"
  );
});

test("failed Sefaria chunk loads remain retryable", async () => {
  const entry = await source("src/sefaria/sefaria.js");

  for (const [loader, promiseName] of [
    ["loadModalCss", "_modalCssPromise"],
    ["loadDownloaderModule", "_downloaderModulePromise"],
    ["loadLiveModule", "_liveModulePromise"],
  ]) {
    const start = entry.indexOf("function " + loader + "()");
    assert.ok(start >= 0, loader + " missing");
    const next = entry.indexOf("\nfunction ", start + 1);
    const block = entry.slice(start, next >= 0 ? next : entry.length);
    assert.match(block, /\.catch\(\(error\) => \{/);
    assert.ok(
      block.includes(promiseName + " = null"),
      loader + " must reset its cached promise after a chunk failure"
    );
    assert.match(block, /throw error/);
  }
});
