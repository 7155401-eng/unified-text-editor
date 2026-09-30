import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  checkToolQuotaAvailability,
  consumeToolQuota,
  localDayBoundsSec,
} from "../../worker/tool_quota.js";

class D1Statement {
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

class D1Db {
  constructor() {
    this.db = new DatabaseSync(":memory:");
  }
  prepare(sql) {
    return new D1Statement(this.db, sql);
  }
}

const env = { DB: new D1Db() };
const free = id => ({ id, paid: false, is_admin: false });
const paid = id => ({ id, paid: true, is_admin: false });
const WEEK = 7 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;

test("Sefaria weekly success use is atomic and idempotent", async () => {
  const user = free(201);
  const t0 = 2_000_000_000;

  assert.equal((await checkToolQuotaAvailability(user, "sefaria-downloader", env, { nowSec: t0 })).ok, true);

  const first = await consumeToolQuota(user, "sefaria-downloader", env, {
    nowSec: t0,
    idempotencyKey: "sef-export-1",
  });
  assert.equal(first.ok, true);

  const replay = await consumeToolQuota(user, "sefaria-downloader", env, {
    nowSec: t0 + 3,
    idempotencyKey: "sef-export-1",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);

  const blocked = await consumeToolQuota(user, "sefaria-downloader", env, {
    nowSec: t0 + 4,
    idempotencyKey: "sef-export-2",
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "quota");

  const reset = await checkToolQuotaAvailability(user, "sefaria-downloader", env, {
    nowSec: t0 + WEEK + 1,
  });
  assert.equal(reset.ok, true);
});

test("Torah nikud enforces 500 characters per local calendar day", async () => {
  const user = free(202);
  const t0 = Math.floor(Date.UTC(2026, 8, 30, 9, 0, 0) / 1000);
  const zone = "Asia/Jerusalem";
  const bounds = localDayBoundsSec(t0, { timeZone: zone });
  assert(bounds.startSec < t0 && bounds.endSec > t0);

  const a = await consumeToolQuota(user, "torah-nikud", env, {
    nowSec: t0,
    units: 300,
    timeZone: zone,
    idempotencyKey: "nikud-units-a",
  });
  assert.equal(a.ok, true);

  const b = await consumeToolQuota(user, "torah-nikud", env, {
    nowSec: t0 + 1,
    units: 200,
    timeZone: zone,
    idempotencyKey: "nikud-units-b",
  });
  assert.equal(b.ok, true);

  const blocked = await checkToolQuotaAvailability(user, "torah-nikud", env, {
    nowSec: t0 + 2,
    units: 1,
    timeZone: zone,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.resetAt, bounds.endSec);

  const nextDay = await checkToolQuotaAvailability(user, "torah-nikud", env, {
    nowSec: bounds.endSec + 1,
    units: 500,
    timeZone: zone,
  });
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.remaining, 500);
});

test("Caricature cooldown is one successful generation per 24 hours", async () => {
  const user = free(203);
  const t0 = 2_000_100_000;

  assert.equal((await consumeToolQuota(user, "haredi-caricature", env, {
    nowSec: t0,
    idempotencyKey: "image-1",
  })).ok, true);

  const blocked = await checkToolQuotaAvailability(user, "haredi-caricature", env, {
    nowSec: t0 + DAY - 1,
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.resetAt, t0 + DAY);

  assert.equal((await consumeToolQuota(user, "haredi-caricature", env, {
    nowSec: t0 + DAY,
    idempotencyKey: "image-2",
  })).ok, true);
});

test("Comparator consumes a weekly session only on the first real action", async () => {
  const user = free(204);
  const t0 = 2_000_200_000;

  const openBefore = await checkToolQuotaAvailability(user, "comparator-tool", env, { nowSec: t0 });
  assert.equal(openBefore.ok, true);
  assert.equal(openBefore.remaining, 1);
  assert.equal(openBefore.sessionIdleSeconds, 15 * 60);

  const firstAction = await consumeToolQuota(user, "comparator-tool", env, {
    nowSec: t0,
    idempotencyKey: "cmp-session-1",
  });
  assert.equal(firstAction.ok, true);

  const reopened = await checkToolQuotaAvailability(user, "comparator-tool", env, {
    nowSec: t0 + 60,
  });
  assert.equal(reopened.ok, false);
  assert.equal(reopened.remaining, 0);

  const afterWeek = await checkToolQuotaAvailability(user, "comparator-tool", env, {
    nowSec: t0 + WEEK + 1,
  });
  assert.equal(afterWeek.ok, true);
});

test("OCR has one successful use per rolling week", async () => {
  const user = free(205);
  const t0 = 2_000_300_000;

  assert.equal((await consumeToolQuota(user, "torah-ocr", env, {
    nowSec: t0,
    idempotencyKey: "ocr-1",
  })).ok, true);

  assert.equal((await checkToolQuotaAvailability(user, "torah-ocr", env, {
    nowSec: t0 + DAY,
  })).ok, false);
});

test("Premium bypass writes no free quota event and never exhausts", async () => {
  const user = paid(206);
  const t0 = 2_000_400_000;

  for (const toolName of [
    "sefaria-downloader",
    "sefaria-live",
    "torah-nikud",
    "haredi-caricature",
    "comparator-tool",
    "torah-ocr",
  ]) {
    const check = await checkToolQuotaAvailability(user, toolName, env, {
      nowSec: t0,
      units: 500,
      timeZone: "Asia/Jerusalem",
    });
    assert.equal(check.ok, true, toolName);
    assert.equal(check.unlimited, true, toolName);

    const use = await consumeToolQuota(user, toolName, env, {
      nowSec: t0,
      units: 500,
      timeZone: "Asia/Jerusalem",
      idempotencyKey: `premium-${toolName}`,
    });
    assert.equal(use.ok, true, toolName);
    assert.equal(use.unlimited, true, toolName);
  }
});
