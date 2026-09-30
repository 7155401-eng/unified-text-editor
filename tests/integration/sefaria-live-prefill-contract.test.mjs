import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { normalizeSefariaLivePrefill } from "../../src/sefaria/sefaria_live_modal.js";

test("Free Sefaria Live prefill is capped at 500 characters", () => {
  const raw = "א".repeat(777);
  const result = normalizeSefariaLivePrefill(raw, false);
  assert.equal(result.truncated, true);
  assert.equal(result.limit, 500);
  assert.equal(result.text.length, 500);
  assert.equal(result.text, raw.slice(0, 500));
});

test("Free prefill at or under the limit is unchanged", () => {
  for (const n of [0, 1, 499, 500]) {
    const raw = "ב".repeat(n);
    const result = normalizeSefariaLivePrefill(raw, false);
    assert.equal(result.truncated, false, String(n));
    assert.equal(result.text, raw, String(n));
  }
});

test("Premium Sefaria Live prefill remains unrestricted", () => {
  const raw = "ג".repeat(5000);
  const result = normalizeSefariaLivePrefill(raw, true);
  assert.equal(result.truncated, false);
  assert.equal(result.text, raw);
});

test("prefill guard coexists with server-authoritative weekly quota", () => {
  const source = fs.readFileSync(
    new URL("../../src/sefaria/sefaria_live_modal.js", import.meta.url),
    "utf8"
  );
  assert(source.includes('checkToolAllowance("sefaria-live"'),
    "server quota precheck was removed");
  assert(source.includes('consumeToolUse("sefaria-live"'),
    "success-only quota consume was removed");
  assert(source.includes("normalizeSefariaLivePrefill(opts.prefillText, isVip, 500)"),
    "programmatic prefill is not using the Free/Premium guard");
});
