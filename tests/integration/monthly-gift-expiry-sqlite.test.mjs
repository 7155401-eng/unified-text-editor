import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import {
  ensureGiftMinuteUsageSchema,
  expireAllGiftBalances,
  expireUserGiftBalance,
  giftMonthKey,
  recordCurrentGiftUsage,
} from "../../worker/gift_expiry.js";

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
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function makeEnv({ legacyUsage = false } = {}) {
  const DB = new D1Db();
  DB.db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      balance_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT,
      plan_type TEXT
    );
    CREATE TABLE gift_claims (
      user_id INTEGER NOT NULL,
      year_month TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, year_month)
    );
  `);
  if (legacyUsage) {
    DB.db.exec(`
      CREATE TABLE gift_minute_usage (
        user_id INTEGER NOT NULL,
        year_month TEXT NOT NULL,
        seconds_granted INTEGER NOT NULL DEFAULT 0,
        seconds_used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        claimed_at INTEGER,
        PRIMARY KEY (user_id, year_month)
      );
    `);
  }
  return { DB };
}

const row = (env, sql, ...args) => env.DB.db.prepare(sql).get(...args);
const exec = (env, sql, ...args) => env.DB.db.prepare(sql).run(...args);

test("gift month uses Israel calendar on both DST sides", () => {
  assert.equal(giftMonthKey(new Date("2026-04-30T20:30:00Z")), "2026-04");
  assert.equal(giftMonthKey(new Date("2026-04-30T21:30:00Z")), "2026-05");
  assert.equal(giftMonthKey(new Date("2026-10-31T21:30:00Z")), "2026-10");
  assert.equal(giftMonthKey(new Date("2026-10-31T22:30:00Z")), "2026-11");
});

test("runtime schema upgrades migration-0009 table and backfills legacy claims", async () => {
  const env = makeEnv({ legacyUsage: true });
  exec(env, "INSERT INTO gift_claims(user_id,year_month,claimed_at) VALUES(?,?,?)", 1, "2026-08", 1234);

  await ensureGiftMinuteUsageSchema(env);

  const columns = env.DB.db.prepare("PRAGMA table_info(gift_minute_usage)").all().map(x => x.name);
  assert(columns.includes("seconds_expired"));
  const gift = row(env,
    "SELECT user_id,year_month,seconds_granted,seconds_used,seconds_expired,claimed_at FROM gift_minute_usage WHERE user_id=1");
  assert.deepEqual({ ...gift }, {
    user_id: 1,
    year_month: "2026-08",
    seconds_granted: 1200,
    seconds_used: 0,
    seconds_expired: 0,
    claimed_at: 1234,
  });
});

test("0011 migration really alters an existing migration-0009 table", () => {
  const env = makeEnv({ legacyUsage: true });
  const migration = fs.readFileSync(
    new URL("../../migrations/0011_monthly_gift_expiry.sql", import.meta.url),
    "utf8"
  );
  env.DB.db.exec(migration);
  const columns = env.DB.db.prepare("PRAGMA table_info(gift_minute_usage)").all().map(x => x.name);
  assert(columns.includes("seconds_expired"));
});

test("expiring old gift removes only unused gift seconds and preserves paid balance", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  exec(env,
    "INSERT INTO users(id,balance_seconds,status,plan_type) VALUES(?,?,?,?)",
    2, 4500, "active", "hours");
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    2, "2026-09", 1200, 300, 0, 1, 1);

  const first = await expireUserGiftBalance(env, 2, { cutoff: "2026-10" });
  assert.equal(first.expiredSeconds, 900);
  assert.equal(first.balanceRemovedSeconds, 900);
  assert.equal(first.balanceSeconds, 3600);

  const user = row(env, "SELECT balance_seconds,status,plan_type FROM users WHERE id=2");
  assert.deepEqual({ ...user }, { balance_seconds: 3600, status: "active", plan_type: "hours" });
  const gift = row(env,
    "SELECT seconds_granted,seconds_used,seconds_expired FROM gift_minute_usage WHERE user_id=2 AND year_month='2026-09'");
  assert.deepEqual({ ...gift }, { seconds_granted: 1200, seconds_used: 1200, seconds_expired: 900 });

  const second = await expireUserGiftBalance(env, 2, { cutoff: "2026-10" });
  assert.equal(second.expiredSeconds, 0);
  assert.equal(second.balanceRemovedSeconds, 0);
  assert.equal(row(env, "SELECT balance_seconds FROM users WHERE id=2").balance_seconds, 3600);
});

test("gift usage is attributed only to the current Israel month", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    3, "2026-09", 1200, 100, 0, 1, 1);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    3, "2026-10", 1200, 100, 0, 2, 2);

  const used = await recordCurrentGiftUsage(env, 3, 250, { monthKey: "2026-10" });
  assert.equal(used, 250);
  assert.equal(row(env,
    "SELECT seconds_used FROM gift_minute_usage WHERE user_id=3 AND year_month='2026-09'").seconds_used, 100);
  assert.equal(row(env,
    "SELECT seconds_used FROM gift_minute_usage WHERE user_id=3 AND year_month='2026-10'").seconds_used, 350);
});

test("user-scoped expiry does not scan or modify another user; global maintenance later does", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  for (const [id,balance] of [[4,1200],[5,1200]]) {
    exec(env, "INSERT INTO users(id,balance_seconds,status,plan_type) VALUES(?,?,?,?)",
      id,balance,"active","hours");
    exec(env,
      "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
      id,"2026-09",1200,0,0,id,id);
  }

  const one = await expireUserGiftBalance(env, 4, { cutoff:"2026-10" });
  assert.equal(one.expiredSeconds,1200);
  assert.equal(row(env,"SELECT balance_seconds FROM users WHERE id=4").balance_seconds,0);
  assert.equal(row(env,"SELECT balance_seconds FROM users WHERE id=5").balance_seconds,1200);
  assert.equal(row(env,
    "SELECT seconds_expired FROM gift_minute_usage WHERE user_id=5 AND year_month='2026-09'").seconds_expired,0);

  const all = await expireAllGiftBalances(env,{cutoff:"2026-10"});
  assert.equal(all.expiredSeconds,1200);
  assert.equal(all.usersAffected,1);
  assert.equal(row(env,"SELECT balance_seconds FROM users WHERE id=5").balance_seconds,0);
});

test("expired hours access deactivates, but subscription status is preserved", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  exec(env, "INSERT INTO users(id,balance_seconds,status,plan_type) VALUES(?,?,?,?)",
    6,900,"active","hours");
  exec(env, "INSERT INTO users(id,balance_seconds,status,plan_type) VALUES(?,?,?,?)",
    7,900,"active","subscription");
  for(const id of [6,7]) {
    exec(env,
      "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
      id,"2026-09",1200,300,0,id,id);
  }

  await expireUserGiftBalance(env,6,{cutoff:"2026-10"});
  await expireUserGiftBalance(env,7,{cutoff:"2026-10"});
  const hours=row(env,"SELECT balance_seconds,status,plan_type FROM users WHERE id=6");
  const subscription=row(env,"SELECT balance_seconds,status,plan_type FROM users WHERE id=7");
  assert.deepEqual({ ...hours },{balance_seconds:0,status:"unauthorized",plan_type:null});
  assert.deepEqual({ ...subscription },{balance_seconds:0,status:"active",plan_type:"subscription"});
});
