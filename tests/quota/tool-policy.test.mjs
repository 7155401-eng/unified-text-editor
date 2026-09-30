import test from "node:test";
import assert from "node:assert/strict";
import {
  TOOL_POLICIES,
  getToolPolicy,
  isFreePreflightUnmetered,
  isToolPublic,
  publicToolNames,
} from "../../worker/tool_policy.js";

test("policy registry contains every public tool previously exposed by preflight", () => {
  const expected = [
    "nikud-merger",
    "word-extractor",
    "text-compare-pro",
    "comparator-tool",
    "sefaria-downloader",
    "sefaria-live",
    "torah-transcription",
    "torah-nikud",
    "torah-ocr",
    "haredi-caricature",
    "css-ai",
    "torah-tools",
  ].sort();
  assert.deepEqual(publicToolNames().sort(), expected);
  for (const name of expected) assert.equal(isToolPublic(name), true, name);
  assert.equal(isToolPublic("not-a-tool"), false);
});

test("source-free tools are unmetered at preflight", () => {
  for (const name of ["word-extractor", "torah-transcription", "text-compare-pro"]) {
    const policy = getToolPolicy(name);
    assert.equal(policy.freeMode, "unmetered", name);
    assert.equal(policy.chargeOn, "none", name);
    assert.equal(policy.migrationState, "server-ready", name);
    assert.equal(isFreePreflightUnmetered(name), true, name);
  }
});

test("audited metered parity targets use server-authoritative enforcement", () => {
  const targets = {
    "comparator-tool": ["session", "first-session-action", "session-metered-ready"],
    "sefaria-downloader": ["count", "success", "success-metered-ready"],
    "sefaria-live": ["count", "success", "success-metered-ready"],
    "torah-nikud": ["units", "success", "units-metered-ready"],
    "haredi-caricature": ["cooldown", "success", "cooldown-metered-ready"],
    "torah-ocr": ["count", "success", "success-metered-ready"],
  };
  for (const [name, [mode, chargeOn, state]] of Object.entries(targets)) {
    const p = TOOL_POLICIES[name];
    assert.equal(p.freeMode, mode, name);
    assert.equal(p.chargeOn, chargeOn, name);
    assert.equal(p.premiumMode, "unlimited", name);
    assert.equal(p.migrationState, state, name);
    assert.equal(isFreePreflightUnmetered(name), false, name);
  }
});

test("nikud merger is migrated to server success metering", () => {
  const p = TOOL_POLICIES["nikud-merger"];
  assert.equal(p.freeMode, "count");
  assert.equal(p.limit, 1);
  assert.equal(p.windowSeconds, 7 * 24 * 60 * 60);
  assert.equal(p.chargeOn, "success");
  assert.equal(p.premiumMode, "unlimited");
  assert.equal(p.migrationState, "success-metered-ready");
});

test("desktop parity constants are pinned", () => {
  assert.equal(TOOL_POLICIES["comparator-tool"].windowSeconds, 7 * 24 * 60 * 60);
  assert.equal(TOOL_POLICIES["comparator-tool"].sessionIdleSeconds, 15 * 60);
  assert.equal(TOOL_POLICIES["nikud-merger"].windowSeconds, 7 * 24 * 60 * 60);
  assert.equal(TOOL_POLICIES["sefaria-downloader"].windowSeconds, 7 * 24 * 60 * 60);
  assert.equal(TOOL_POLICIES["sefaria-live"].windowSeconds, 7 * 24 * 60 * 60);
  assert.equal(TOOL_POLICIES["torah-nikud"].limit, 500);
  assert.equal(TOOL_POLICIES["torah-nikud"].unit, "characters");
  assert.equal(TOOL_POLICIES["haredi-caricature"].windowSeconds, 24 * 60 * 60);
  assert.equal(TOOL_POLICIES["torah-ocr"].windowSeconds, 7 * 24 * 60 * 60);
});
