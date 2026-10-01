import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("V9 session invariants remain present in canonical source", async () => {
  const [layout, measurement, vilna, mapping, v9Apply] = await Promise.all([
    read("src/engine/v9_main_inline_layout.js"),
    read("src/engine/v9_text_measurement.js"),
    read("src/vilna_v9.js"),
    read("src/engine/main_source_mapping.js"),
    read("src/vilna_v9_apply.js"),
  ]);

  assert.match(layout, /function rebalanceContinuationTail\b/);
  assert.match(layout, /droppedOpeningCrossesRightEdgeTransition/);
  assert.match(layout, /sole\?\.render\.opening\s*&&\s*sole\.isLast/);
  assert.match(layout, /opening-word host row|Opening-word geometry is immutable|opening glyph/i);

  assert.match(measurement, /LRM\/RLM\/WORD JOINER are zero-width source controls/);
  assert.match(measurement, /createTextNode\(ch\)/);

  const unlockedKnees = (vilna.match(/lockYStart:\s*false/g) || []).length;
  assert.ok(unlockedKnees >= 2, `expected both commentary-knee transitions unlocked, got ${unlockedKnees}`);
  assert.match(vilna, /selectV9GapFillCandidates/);
  assert.match(vilna, /final-sparse-rescue/);
  assert.match(vilna, /extension-rescue/);

  // Vertical crown clearance and horizontal main↔side spacing are independent
  // planner axes. The web app must source crown clearance from mainStreamGap.
  assert.match(v9Apply, /crownMainGapPx:\s*Math\.max\(0,\s*Number\(effectiveSpacing\.mainStreamGap\)/);
  assert.doesNotMatch(vilna, /crownMainGap[^\n]*Math\.max\(4,\s*mainGap\)/);

  assert.match(mapping, /NBSP|narrow|thin/i);
  assert.match(mapping, /\u00a0|00a0/i);
});

test("server-authoritative quota wiring survives UI and Worker changes", async () => {
  const [
    runtime,
    policy,
    quota,
    torahNikud,
    transcription,
    caricature,
    sefariaDownloader,
    sefariaLive,
  ] = await Promise.all([
    read("src/tool_runtime_gate.js"),
    read("worker/tool_policy.js"),
    read("worker/tool_quota.js"),
    read("src/torah_nikud/torah_nikud_ui.js"),
    read("src/torah_transcription/torah_transcription_ui.js"),
    read("worker/caricature.js"),
    read("src/sefaria/sefaria_downloader_modal.js"),
    read("src/sefaria/sefaria_live_modal.js"),
  ]);

  assert.match(runtime, /checkToolAllowance/);
  assert.match(runtime, /consumeToolUse/);
  for (const name of [
    "comparator-tool",
    "sefaria-downloader",
    "sefaria-live",
    "torah-nikud",
    "haredi-caricature",
    "torah-ocr",
  ]) assert.ok(policy.includes(`"${name}"`), `missing policy: ${name}`);

  assert.match(quota, /tool_quota_events/);
  assert.match(quota, /checkToolQuotaAvailability/);
  assert.match(quota, /consumeToolQuota/);

  assert.match(torahNikud, /checkToolAllowance\("torah-nikud"/);
  assert.match(torahNikud, /consumeToolUse\("torah-nikud"/);
  assert.match(transcription, /checkToolAllowance\("torah-ocr"/);
  assert.match(transcription, /consumeToolUse\("torah-ocr"/);
  assert.match(caricature, /checkToolQuotaAvailability/);
  assert.match(caricature, /consumeToolQuota/);
  assert.match(sefariaDownloader, /checkToolAllowance\("sefaria-downloader"/);
  assert.match(sefariaDownloader, /consumeToolUse\("sefaria-downloader"/);
  assert.match(sefariaLive, /checkToolAllowance\("sefaria-live"/);
  assert.match(sefariaLive, /consumeToolUse\("sefaria-live"/);
});

test("DOCX migration tools remain wired end-to-end", async () => {
  const [main, worker, comparator] = await Promise.all([
    read("src/main.js"),
    read("cloudflare/docx_worker_entry.js"),
    read("src/comparator_tool/comparator_integrated.js"),
  ]);

  for (const hook of [
    "wireFootnotesToCurlyTool",
    "wireSplitFootnotesByTagTool",
    "wireFootnoteTrackChangesTool",
  ]) assert.ok(main.includes(hook), `missing main wiring: ${hook}`);

  for (const route of [
    "/api/word-footnotes-to-curly",
    "/api/word-split-footnotes-by-tag",
    "/api/word-footnote-track-changes",
  ]) assert.ok(worker.includes(route), `missing Worker route: ${route}`);

  assert.match(comparator, /comparator_docx_export/);
});

test("normal build lifecycle cannot reactivate historical source-mutating patches", async () => {
  const pkg = JSON.parse(await read("package.json"));
  assert.equal(pkg.scripts?.build, "vite build");
  assert.equal(pkg.scripts?.dev, "vite --port 5173 --open");
  assert.equal(pkg.scripts?.prebuild, undefined);
  assert.equal(pkg.scripts?.predev, undefined);
  assert.equal(pkg.scripts?.postinstall, undefined);

  const lifecycle = JSON.stringify({
    build: pkg.scripts?.build,
    dev: pkg.scripts?.dev,
    prebuild: pkg.scripts?.prebuild,
    predev: pkg.scripts?.predev,
    postinstall: pkg.scripts?.postinstall,
  });
  assert.doesNotMatch(lifecycle, /apply_.*\.mjs/);
});
