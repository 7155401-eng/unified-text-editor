import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = new URL("../../", import.meta.url);

async function jsFiles(dirUrl, out = []) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dirUrl);
    if (entry.isDirectory()) await jsFiles(url, out);
    else if (entry.name.endsWith(".js")) out.push(url);
  }
  return out;
}

test("premium purchase page has one lazy boundary and no static src importers", async () => {
  const files = await jsFiles(new URL("src/", ROOT));
  const offenders = [];

  for (const url of files) {
    const source = await readFile(url, "utf8");
    const rel = relative(new URL(".", ROOT).pathname, url.pathname);
    const staticImport = /(?:^|\n)\s*import\s+(?!\()(?:(?!;)[\s\S])*?["'][^"']*premium_page\.js["']\s*;?/g;
    for (const match of source.matchAll(staticImport)) {
      offenders.push({
        file: rel,
        importText: match[0].trim().replace(/\s+/g, " "),
      });
    }
  }

  assert.deepEqual(offenders, [], "premium_page.js must stay outside the startup/static import graph");
});

test("lazy premium boundary preserves click and URL entry points", async () => {
  const helper = await readFile(new URL("src/premium/premium_page_lazy.js", ROOT), "utf8");
  assert.match(helper, /import\("\.\/premium_page\.js"\)/);
  assert.match(helper, /export async function openPremiumPage/);
  assert.match(helper, /export function maybeAutoOpenFromUrl/);
  for (const token of [
    'premium === "1"',
    'premium === "success"',
    'premium === "failed"',
    'params.get("upgrade") === "1"',
    'params.get("pkg")',
  ]) {
    assert.ok(helper.includes(token), "missing premium URL trigger: " + token);
  }

  const consumers = [
    "src/main.js",
    "src/premium/header_icons.js",
    "src/premium/daily_quota_gate.js",
    "src/premium/header_timer.js",
    "src/premium/premium_status_section.js",
    "src/premium/time_warning.js",
  ];
  for (const file of consumers) {
    const source = await readFile(new URL(file, ROOT), "utf8");
    assert.match(
      source,
      /premium_page_lazy\.js/,
      file + " must route premium UI through the lazy boundary"
    );
  }
});
