import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DAY_SECONDS,
  WEEK_SECONDS,
  checkToolQuota,
  consumeToolQuota,
  ensureToolQuotaSchema,
} from "../../worker/tool_quota_policy.js";

class D1LikeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { meta: { changes: Number(result.changes || 0) } };
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.args) || null;
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.args) };
  }
}

const db = new DatabaseSync(":memory:");
const env = {
  DB: {
    prepare(sql) {
      return new D1LikeStatement(db, sql);
    },
  },
};
await ensureToolQuotaSchema(env);

const free = id => ({ id, paid: false, is_admin: false });
const premium = id => ({ id, paid: true, is_admin: false });

test("weekly success quota is atomic and idempotent", async () => {
  const user = free(101);
  const now = 1_700_000_000;

  assert.equal((await checkToolQuota({ env, user, toolName: "nikud-merger", nowSec: now })).ok, true);

  const first = await consumeToolQuota({
    env, user, toolName: "nikud-merger", nowSec: now, idempotencyKey: "merge-1",
  });
  assert.equal(first.ok, true);
  assert.equal(first.consumed, true);

  const replay = await consumeToolQuota({
    env, user, toolName: "nikud-merger", nowSec: now + 3, idempotencyKey: "merge-1",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);

  const blocked = await consumeToolQuota({
    env, user, toolName: "nikud-merger", nowSec: now + 4, idempotencyKey: "merge-2",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "quota");

  const afterWeek = await checkToolQuota({
    env, user, toolName: "nikud-merger", nowSec: now + WEEK_SECONDS,
  });
  assert.equal(afterWeek.ok, true);
});

test("Torah nikud units cannot overspend and idempotent retry does not double count", async () => {
  const user = free(102);
  const now = 1_700_010_000;
  const tz = 180;

  const a = await consumeToolQuota({
    env, user, toolName: "torah-nikud", amount: 300,
    timezoneOffsetMinutes: tz, nowSec: now, idempotencyKey: "nikud-a",
  });
  assert.equal(a.ok, true);

  const replay = await consumeToolQuota({
    env, user, toolName: "torah-nikud", amount: 300,
    timezoneOffsetMinutes: tz, nowSec: now + 1, idempotencyKey: "nikud-a",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);

  const b = await consumeToolQuota({
    env, user, toolName: "torah-nikud", amount: 200,
    timezoneOffsetMinutes: tz, nowSec: now + 2, idempotencyKey: "nikud-b",
  });
  assert.equal(b.ok, true);

  const blocked = await consumeToolQuota({
    env, user, toolName: "torah-nikud", amount: 1,
    timezoneOffsetMinutes: tz, nowSec: now + 3, idempotencyKey: "nikud-c",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "quota");
});

test("caricature cooldown is enforced at the database update boundary", async () => {
  const user = free(103);
  const now = 1_700_020_000;

  assert.equal((await consumeToolQuota({
    env, user, toolName: "haredi-caricature", nowSec: now, idempotencyKey: "img-a",
  })).ok, true);

  assert.equal((await consumeToolQuota({
    env, user, toolName: "haredi-caricature", nowSec: now + DAY_SECONDS - 1, idempotencyKey: "img-b",
  })).ok, false);

  assert.equal((await consumeToolQuota({
    env, user, toolName: "haredi-caricature", nowSec: now + DAY_SECONDS, idempotencyKey: "img-c",
  })).ok, true);
});

test("comparator consumes on first action and a new window is blocked for the week", async () => {
  const user = free(104);
  const now = 1_700_030_000;

  const before = await checkToolQuota({ env, user, toolName: "comparator-tool", nowSec: now });
  assert.equal(before.ok, true);

  const firstAction = await consumeToolQuota({
    env, user, toolName: "comparator-tool", nowSec: now, idempotencyKey: "cmp-a",
  });
  assert.equal(firstAction.ok, true);

  const reopen = await checkToolQuota({
    env, user, toolName: "comparator-tool", nowSec: now + 60,
  });
  assert.equal(reopen.ok, false);

  const afterWeek = await checkToolQuota({
    env, user, toolName: "comparator-tool", nowSec: now + WEEK_SECONDS,
  });
  assert.equal(afterWeek.ok, true);
});

test("Premium bypass never consumes free quota state", async () => {
  const user = premium(105);
  const now = 1_700_040_000;
  for (let i = 0; i < 3; i++) {
    const r = await consumeToolQuota({
      env, user, toolName: "nikud-merger", nowSec: now + i, idempotencyKey: `p-${i}`,
    });
    assert.equal(r.ok, true);
    assert.equal(r.unlimited, true);
    assert.equal(r.consumed, false);
  }
});
