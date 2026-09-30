import test from "node:test";
import assert from "node:assert/strict";
import { referenceNoBreakRange } from "../../src/engine/reference_line_glue.js";
import { groupV9FooterStreams } from "../../src/engine/v9_footer_grouping.js";

const streams = (...ids) => ids.map((id) => ({ id, items: [id] }));

test("no-space main reference returns the whole source word as an atomic range", () => {
  assert.deepEqual(referenceNoBreakRange("אב'גד", 3), { start: 0, end: 5 });
  assert.deepEqual(referenceNoBreakRange("אלפא בית", 2), { start: 0, end: 4 });
});

test("real whitespace stays a legal line-break boundary and changes no source text", () => {
  assert.equal(referenceNoBreakRange("אב' גד", 3), null);
  assert.equal(referenceNoBreakRange("אב 'גד", 3), null);
  const text = "אב'גד";
  referenceNoBreakRange(text, 3);
  assert.equal(text, "אב'גד");
});

test("two explicit Mishnah streams form one footer flow pair", () => {
  const result = groupV9FooterStreams(
    streams("03", "04"),
    { "03": { layoutRole: "mishna" }, "04": { layoutRole: "mishna" } },
    [],
    false
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].mishnaFlow, true);
  assert.equal(result[0].source, "layoutRole");
  assert.deepEqual(result[0].streams.map((s) => s.id), ["03", "04"]);
});

test("fixed Talmud ownership is not changed by Mishnah footer grouping", () => {
  const result = groupV9FooterStreams(
    streams("03", "05", "04"),
    {
      "03": { layoutRole: "mishna" },
      "04": { layoutRole: "mishna" },
      "05": { layoutRole: "" },
    },
    [],
    false
  );
  assert.deepEqual(result.map(g => g.streams.map(s => s.id)), [["03", "04"], ["05"]]);
  assert.equal(result[0].mishnaFlow, true);
  assert.equal(result[1].mishnaFlow, false);
});

test("historic secondary Mishnah levels keep precedence", () => {
  const result = groupV9FooterStreams(
    streams("03", "04"),
    {},
    [["01", "02"], ["03", "04"]],
    true
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].mishnaFlow, true);
  assert.equal(result[0].source, "levels");
  assert.equal(result[0].level, 1);
});

test("a lone explicit Mishnah footer is not opportunistically promoted", () => {
  const result = groupV9FooterStreams(
    streams("03", "05"),
    { "03": { layoutRole: "mishna" } },
    [],
    false
  );
  assert.equal(result.length, 2);
  assert.ok(result.every(g => g.mishnaFlow === false));
});
