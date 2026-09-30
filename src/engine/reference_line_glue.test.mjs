import test from "node:test";
import assert from "node:assert/strict";
import { WORD_JOINER, referenceLineGlue } from "./reference_line_glue.js";

test("word joiner is the invisible no-break code point", () => {
  assert.equal(WORD_JOINER, "\u2060");
});

test("reference between apostrophe and following word is glued on both sides", () => {
  assert.deepEqual(referenceLineGlue("אב'גד", 3), { before: true, after: true });
});

test("real whitespace remains a legal line-break boundary", () => {
  assert.deepEqual(referenceLineGlue("אב' גד", 3), { before: true, after: false });
  assert.deepEqual(referenceLineGlue("אב 'גד", 3), { before: false, after: true });
  assert.deepEqual(referenceLineGlue("אב  גד", 3), { before: false, after: false });
});

test("string edges only glue the side that actually has adjacent text", () => {
  assert.deepEqual(referenceLineGlue("מילה", 0), { before: false, after: true });
  assert.deepEqual(referenceLineGlue("מילה", 4), { before: true, after: false });
});
