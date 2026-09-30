import test from "node:test";
import assert from "node:assert/strict";
import {
  checkToolQuotaAvailability,
  consumeToolUse,
  consumeSuccessfulToolUse,
  quotaResetAt,
  rollingWindowCutoff,
} from "../../worker/tool_quota.js";

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async run() {
    if (/^CREATE (TABLE|INDEX)/i.test(this.sql)) return { meta: { changes: 0 } };

    if (this.sql.startsWith("INSERT OR IGNORE INTO tool_quota_events")) {
      const [
        userId, toolName, eventKind, units, idempotencyKey, createdAt,
        _userId2, _toolName2, _eventKind2, cutoff, _units2, limit,
      ] = this.args;

      if (idempotencyKey && this.db.events.some(e =>
        e.user_id === userId && e.tool_name === toolName && e.idempotency_key === idempotencyKey
      )) {
        return { meta: { changes: 0 } };
      }

      const used = this.db.events
        .filter(e => e.user_id === userId && e.tool_name === toolName && e.event_kind === eventKind && e.created_at >= cutoff)
        .reduce((sum, e) => sum + e.units, 0);

      if (used + units > limit) return { meta: { changes: 0 } };

      this.db.events.push({
        id: this.db.nextId++,
        user_id: userId,
        tool_name: toolName,
        event_kind: eventKind,
        units,
        idempotency_key: idempotencyKey,
        created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }

    throw new Error(`Unsupported fake run SQL: ${this.sql}`);
  }
  async first() {
    if (this.sql.includes("COALESCE(SUM(units), 0) AS used_units")) {
      const [userId, toolName, eventKind, cutoff] = this.args;
      const events = this.db.events.filter(e =>
        e.user_id === userId &&
        e.tool_name === toolName &&
        e.event_kind === eventKind &&
        e.created_at >= cutoff
      );
      return {
        used_units: events.reduce((sum, e) => sum + e.units, 0),
        first_event_at: events.length ? Math.min(...events.map(e => e.created_at)) : null,
      };
    }

    if (this.sql.includes("WHERE user_id = ? AND tool_name = ? AND idempotency_key = ?")) {
      const [userId, toolName, key] = this.args;
      return this.db.events.find(e =>
        e.user_id === userId && e.tool_name === toolName && e.idempotency_key === key
      ) || null;
    }

    throw new Error(`Unsupported fake first SQL: ${this.sql}`);
  }
}

class FakeDb {
  constructor() {
    this.events = [];
    this.nextId = 1;
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
}

const WEEK = 7 * 24 * 60 * 60;
const freeUser = { id: 7, email: "free@example.com", paid: false, is_admin: false };
const paidUser = { id: 8, email: "paid@example.com", paid: true, is_admin: false };

test("rolling helpers use a true seven-day window", () => {
  assert.equal(rollingWindowCutoff(1_000_000, WEEK), 1_000_000 - WEEK);
  assert.equal(quotaResetAt(1_000_000, WEEK), 1_000_000 + WEEK);
});

test("nikud merger consumes only one successful merge per rolling seven days", async () => {
  const env = { DB: new FakeDb() };
  const t0 = 2_000_000;

  const before = await checkToolQuotaAvailability(freeUser, "nikud-merger", env, { nowSec: t0 });
  assert.equal(before.ok, true);
  assert.equal(before.remaining, 1);

  const first = await consumeSuccessfulToolUse(freeUser, "nikud-merger", env, {
    nowSec: t0,
    idempotencyKey: "merge-1",
  });
  assert.equal(first.ok, true);
  assert.equal(first.remaining, 0);
  assert.equal(env.DB.events.length, 1);

  const blocked = await checkToolQuotaAvailability(freeUser, "nikud-merger", env, { nowSec: t0 + 60 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.resetAt, t0 + WEEK);

  const second = await consumeSuccessfulToolUse(freeUser, "nikud-merger", env, {
    nowSec: t0 + 60,
    idempotencyKey: "merge-2",
  });
  assert.equal(second.ok, false);
  assert.equal(env.DB.events.length, 1);

  const afterWindow = await checkToolQuotaAvailability(freeUser, "nikud-merger", env, {
    nowSec: t0 + WEEK + 1,
  });
  assert.equal(afterWindow.ok, true);
  assert.equal(afterWindow.remaining, 1);
});

test("same successful merge retry is idempotent and does not consume twice", async () => {
  const env = { DB: new FakeDb() };
  const t0 = 3_000_000;

  const first = await consumeSuccessfulToolUse(freeUser, "nikud-merger", env, {
    nowSec: t0,
    idempotencyKey: "same-merge",
  });
  assert.equal(first.ok, true);

  const retry = await consumeSuccessfulToolUse(freeUser, "nikud-merger", env, {
    nowSec: t0 + 10,
    idempotencyKey: "same-merge",
  });
  assert.equal(retry.ok, true);
  assert.equal(retry.idempotent, true);
  assert.equal(env.DB.events.length, 1);
});

test("paid nikud merger is unlimited and never writes free quota events", async () => {
  const env = { DB: new FakeDb() };
  const state = await checkToolQuotaAvailability(paidUser, "nikud-merger", env, { nowSec: 4_000_000 });
  assert.equal(state.ok, true);
  assert.equal(state.unlimited, true);

  for (let i = 0; i < 3; i++) {
    const use = await consumeSuccessfulToolUse(paidUser, "nikud-merger", env, {
      nowSec: 4_000_000 + i,
      idempotencyKey: `paid-${i}`,
    });
    assert.equal(use.ok, true);
    assert.equal(use.unlimited, true);
  }
  assert.equal(env.DB.events.length, 0);
});


test("sefaria downloader records the confirmed export action in its own weekly bucket", async () => {
  const env = { DB: new FakeDb() };
  const t0 = 5_000_000;

  const before = await checkToolQuotaAvailability(freeUser, "sefaria-downloader", env, { nowSec: t0 });
  assert.equal(before.ok, true);

  const first = await consumeToolUse(freeUser, "sefaria-downloader", env, {
    nowSec: t0,
    idempotencyKey: "sef-export-1",
  });
  assert.equal(first.ok, true);
  assert.equal(env.DB.events.length, 1);
  assert.equal(env.DB.events[0].event_kind, "confirmed-action");

  const blocked = await checkToolQuotaAvailability(freeUser, "sefaria-downloader", env, { nowSec: t0 + 1 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.resetAt, t0 + WEEK);

  // Different event kinds are tool-policy specific; Nikud's success event does
  // not accidentally satisfy or consume Sefaria's confirmed-action bucket.
  env.DB.events.push({
    id: env.DB.nextId++,
    user_id: freeUser.id,
    tool_name: "sefaria-downloader",
    event_kind: "success",
    units: 1,
    idempotency_key: "legacy-wrong-kind",
    created_at: t0 + WEEK + 10,
  });
  const afterWindow = await checkToolQuotaAvailability(freeUser, "sefaria-downloader", env, {
    nowSec: t0 + WEEK + 11,
  });
  assert.equal(afterWindow.ok, true);
});
