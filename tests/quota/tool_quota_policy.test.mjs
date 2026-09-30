import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY_SECONDS,
  WEEK_SECONDS,
  SESSION_IDLE_SECONDS,
  TOOL_POLICIES,
  evaluateQuotaState,
  localDayBucketStart,
  isUnlimitedUser,
} from "../../worker/tool_quota_policy.js";

test("Premium and admin users are quota-unlimited identities", () => {
  assert.equal(isUnlimitedUser({ paid: true }), true);
  assert.equal(isUnlimitedUser({ is_admin: true }), true);
  assert.equal(isUnlimitedUser({ paid: false, is_admin: false }), false);
});

test("weekly count policy resets seven days after the first successful use", () => {
  const p = TOOL_POLICIES["nikud-merger"];
  const start = 1_700_000_000;
  const blocked = evaluateQuotaState(p, { window_start: start, uses: 1 }, { nowSec: start + DAY_SECONDS });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfterSeconds, WEEK_SECONDS - DAY_SECONDS);

  const reset = evaluateQuotaState(p, { window_start: start, uses: 1 }, { nowSec: start + WEEK_SECONDS });
  assert.equal(reset.allowed, true);
  assert.equal(reset.reset, true);
  assert.equal(reset.remaining, 1);
});

test("Torah nikud counts units against the user's local calendar day", () => {
  const p = TOOL_POLICIES["torah-nikud"];
  const now = 1_700_000_000;
  const offset = 180;
  const bucket = localDayBucketStart(now, offset);

  const ok = evaluateQuotaState(p, { window_start: bucket, units: 420 }, {
    nowSec: now, timezoneOffsetMinutes: offset, amount: 80,
  });
  assert.equal(ok.allowed, true);
  assert.equal(ok.remaining, 80);

  const blocked = evaluateQuotaState(p, { window_start: bucket, units: 421 }, {
    nowSec: now, timezoneOffsetMinutes: offset, amount: 80,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 79);
});

test("caricature cooldown is one successful generation every 24 hours", () => {
  const p = TOOL_POLICIES["haredi-caricature"];
  const t = 1_700_000_000;
  assert.equal(evaluateQuotaState(p, { last_success: t }, { nowSec: t + DAY_SECONDS - 1 }).allowed, false);
  assert.equal(evaluateQuotaState(p, { last_success: t }, { nowSec: t + DAY_SECONDS }).allowed, true);
});

test("comparator session stays free while active and blocks a second weekly session after idle", () => {
  const p = TOOL_POLICIES["comparator-tool"];
  const t = 1_700_000_000;
  const active = evaluateQuotaState(p, {
    window_start: t - 100,
    uses: 1,
    last_activity: t - (SESSION_IDLE_SECONDS - 1),
  }, { nowSec: t });
  assert.equal(active.allowed, true);
  assert.equal(active.activeSession, true);

  const idle = evaluateQuotaState(p, {
    window_start: t - 100,
    uses: 1,
    last_activity: t - SESSION_IDLE_SECONDS,
  }, { nowSec: t });
  assert.equal(idle.allowed, false);
  assert.equal(idle.activeSession, false);
});

test("unmetered desktop-parity tools remain unmetered for free users", () => {
  for (const id of ["word-extractor", "torah-transcription", "text-compare-pro", "torah-tools"]) {
    const r = evaluateQuotaState(TOOL_POLICIES[id], {}, { nowSec: 1_700_000_000 });
    assert.equal(r.allowed, true, id);
    assert.equal(r.unlimited, true, id);
  }
});

test("policy registry encodes the audited desktop charging points", () => {
  assert.equal(TOOL_POLICIES["nikud-merger"].chargeOn, "success");
  assert.equal(TOOL_POLICIES["sefaria-downloader"].chargeOn, "success");
  assert.equal(TOOL_POLICIES["sefaria-live"].chargeOn, "success");
  assert.equal(TOOL_POLICIES["torah-nikud"].chargeOn, "success");
  assert.equal(TOOL_POLICIES["haredi-caricature"].chargeOn, "success");
  assert.equal(TOOL_POLICIES["comparator-tool"].chargeOn, "activity");
  assert.equal(TOOL_POLICIES["torah-transcription"].chargeOn, "none");
});
