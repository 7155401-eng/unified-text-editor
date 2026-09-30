import test from "node:test";
import assert from "node:assert/strict";
import { groupV9FooterStreams } from "./v9_footer_grouping.js";

const streams = (...ids) => ids.map((id) => ({ id, items: [id] }));

test("two explicit Mishnah streams stay below fixed Talmud sides as one flow group", () => {
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

test("normal footer is not swallowed by an explicit Mishnah pair", () => {
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
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].streams.map((s) => s.id), ["03", "04"]);
  assert.equal(result[0].mishnaFlow, true);
  assert.deepEqual(result[1].streams.map((s) => s.id), ["05"]);
  assert.equal(result[1].mishnaFlow, false);
});

test("historic secondary Mishnah levels retain precedence", () => {
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
  assert.equal(result[0].mishnaFlow, false);
  assert.equal(result[1].mishnaFlow, false);
});
