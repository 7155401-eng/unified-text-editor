import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), "utf8");

const policyDoc = read("docs/torahtools-v9-parity.md");
const pageSettings = read("src/page_settings.js");
const v9 = read("src/vilna_v9.js");
const splitPolicy = read("src/engine/v9_split_policy.js");
const report = read("src/layout_analysis_report.js");
const streamSettings = read("src/original_stream_columns.js");

test("torahtools useful capabilities are mapped to first-class V9/web owners", () => {
  for (const name of [
    "TightHMargins",
    "EmergencyStretchAll",
    "TextdirFootnotes",
    "CompactFootnotes",
    "SplitFootnotes",
    "LoosePagebreaks",
    "ParagraphFootnotes",
    "BodyFill",
    "TightTextheight",
    "RealSplitTracker",
  ]) {
    assert(policyDoc.includes(name), `missing parity decision for ${name}`);
  }

  assert(pageSettings.includes("getPageMargins"), "page margins have no first-class owner");
  assert(streamSettings.includes("cols:"), "stream columns have no first-class setting");
  assert(v9.includes("hasUnsafeV9StreamOverflow"), "planner note-continuation/overflow guards missing");
  assert(v9.includes("finalGapFillEnabled"), "planner page-fill policy missing");
  assert(splitPolicy.includes("allowAnchoredNotePrefixSplit"), "anchored split policy missing");
  assert(report.includes("bottomGapLines"), "final-layout diagnostics do not replace split tracker");
});

test("dangerous TeX workaround switches are documented as retired, not web features", () => {
  for (const name of [
    "FlushBottom",
    "Sloppy",
    "HfuzzLedcenter",
    "TinyFuzz",
    "PrintLineWider",
    "WidthX",
    "PgbalCutNewdimen",
  ]) {
    const at = policyDoc.indexOf(name);
    assert(at >= 0, `missing parity decision for ${name}`);
    const nearby = policyDoc.slice(at, at + 500).toLowerCase();
    assert(
      nearby.includes("retired") || nearby.includes("obsolete"),
      `${name} is not explicitly retired/obsolete in the parity contract`
    );
  }
});

test("production source does not import or inject the legacy TeX package", () => {
  const roots = ["src", "worker", "cloudflare", "scripts"];
  const offenders = [];
  const visit = dir => {
    for (const ent of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, ent.name);
      if (ent.isDirectory()) visit(rel);
      else if (/\.(?:js|mjs|cjs|ts|html|css)$/i.test(ent.name)) {
        const content = read(rel);
        if (
          content.includes("torahtools.sty") ||
          content.includes("\\usepackage{torahtools}") ||
          /\\def\\torahtools(?:FlushBottom|Sloppy|HfuzzLedcenter|TinyFuzz|PrintLineWider|WidthX)/.test(content)
        ) {
          offenders.push(rel);
        }
      }
    }
  };
  for (const dir of roots) visit(dir);
  assert.deepEqual(offenders, []);
});
