import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");

test("legacy layout capabilities have current first-class owners", () => {
  const page = read("src/page_settings.js");
  const streams = read("src/original_stream_columns.js");
  const v9 = read("src/vilna_v9.js");
  const split = read("src/engine/v9_split_policy.js");
  const report = read("src/layout_analysis_report.js");

  assert(page.includes("getPageMargins"), "page margin owner missing");
  assert(streams.includes("cols:"), "stream column setting missing");
  assert(v9.includes("hasUnsafeV9StreamOverflow"), "V9 overflow safety owner missing");
  assert(v9.includes("finalGapFillEnabled"), "V9 page-fill owner missing");
  assert(split.includes("allowAnchoredNotePrefixSplit"), "anchored split owner missing");
  assert(report.includes("bottomGapLines"), "final-layout diagnostics owner missing");
});

test("retired legacy layout switches are documented as non-ports", () => {
  const policy = read("docs/torahtools-v9-parity.md");
  for (const name of [
    "FlushBottom",
    "Sloppy",
    "HfuzzLedcenter",
    "TinyFuzz",
    "PrintLineWider",
    "WidthX",
    "PgbalCutNewdimen",
  ]) assert(policy.includes(name), `missing explicit decision for ${name}`);
  assert.match(policy, /remain retired/i);
});

test("production source does not import or inject the legacy package", () => {
  const roots = ["src", "worker", "cloudflare", "scripts"];
  const offenders = [];
  const visit = relDir => {
    const absDir = path.join(root, relDir);
    if (!fs.existsSync(absDir)) return;
    for (const ent of fs.readdirSync(absDir, { withFileTypes: true })) {
      const rel = path.join(relDir, ent.name);
      if (ent.isDirectory()) { visit(rel); continue; }
      if (!/\.(?:js|mjs|cjs|ts|html|css)$/i.test(ent.name)) continue;
      const source = read(rel);
      if (
        source.includes("torahtools.sty") ||
        source.includes("\\usepackage{torahtools}") ||
        /\\def\\torahtools(?:FlushBottom|Sloppy|HfuzzLedcenter|TinyFuzz|PrintLineWider|WidthX)/.test(source)
      ) offenders.push(rel);
    }
  };
  roots.forEach(visit);
  assert.deepEqual(offenders, []);
});
