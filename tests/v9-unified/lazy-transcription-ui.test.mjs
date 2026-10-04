import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

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

test("transcription implementation stays outside the static startup graph", async () => {
  const files = await jsFiles(new URL("src/", ROOT));
  const offenders = [];
  const staticImport = /(?:^|\n)\s*import\s+(?!\()(?:(?!;)[\s\S])*?["'][^"']*torah_transcription(?:\/torah_transcription|\.\/torah_transcription)?\.js["']\s*;?/g;

  for (const url of files) {
    const source = await readFile(url, "utf8");
    const rel = relative(new URL(".", ROOT).pathname, url.pathname);
    for (const match of source.matchAll(staticImport)) {
      offenders.push({
        file: rel,
        importText: match[0].trim().replace(/\s+/g, " "),
      });
    }
  }

  assert.deepEqual(offenders, [], "heavy transcription implementation must be reached only through dynamic import");
});

test("lazy transcription wire preserves immediate toolbar entry points and gates", async () => {
  const wire = await readFile(
    new URL("src/torah_transcription/torah_transcription_lazy_wire.js", ROOT),
    "utf8"
  );
  assert.match(wire, /import\("\.\/torah_transcription\.js"\)/);
  assert.match(wire, /import \{ assertToolAllowed \} from "\.\.\/tool_runtime_gate\.js"/);

  for (const id of ["tt-trigger-btn", "tt-ocr-btn", "tt-linguistic-btn"]) {
    assert.ok(wire.includes(id), "missing startup button id: " + id);
  }

  assert.match(wire, /"torah-transcription"[\s\S]*openTranscriptionWindow\(manager, \{ initialMode: "transcription" \}\)/);
  assert.match(wire, /"torah-ocr"[\s\S]*openTranscriptionWindow\(manager, \{ initialMode: "ocr" \}\)/);
  assert.match(wire, /"torah-transcription"[\s\S]*openLinguisticEditingWindow\(manager\)/);

  const [main, toolbarWire] = await Promise.all([
    readFile(new URL("src/main.js", ROOT), "utf8"),
    readFile(new URL("src/torah_toolbar_lazy_wire.js", ROOT), "utf8"),
  ]);
  assert.match(main, /torah_toolbar_lazy_wire\.js/);
  assert.match(toolbarWire, /import\("\.\/torah_transcription\/torah_transcription_lazy_wire\.js"\)/);
  assert.doesNotMatch(main, /from "\.\/torah_transcription\/torah_transcription\.js"/);
});
