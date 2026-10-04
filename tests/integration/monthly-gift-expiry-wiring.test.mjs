import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { buildSessionCookie, getUserFromRequest } from "../../worker/session.js";
import {
  ensureGiftMinuteUsageSchema,
  giftMonthKey,
} from "../../worker/gift_expiry.js";
import {
  handleAdminMinuteAdjust,
  handleAdminMinuteUsage,
  handleGiftClaim,
  handlePaymentStatus,
  handleUsageTick,
} from "../../worker/minute_access.js";

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
    this.prepareCount = 0;
  }
  prepare(sql) {
    this.prepareCount++;
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

function makeEnv() {
  const DB = new D1Db();
  DB.db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      status TEXT,
      expires_at INTEGER,
      is_admin INTEGER NOT NULL DEFAULT 0,
      plan_type TEXT,
      balance_seconds INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE gift_claims (
      user_id INTEGER NOT NULL,
      year_month TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, year_month)
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      amount INTEGER NOT NULL,
      plan_code TEXT,
      pack_code TEXT,
      txn_id TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return { DB, SESSION_SECRET: "gift-wiring-test-secret" };
}

const exec = (env, sql, ...args) => env.DB.db.prepare(sql).run(...args);
const row = (env, sql, ...args) => env.DB.db.prepare(sql).get(...args);

async function cookieFor(email, env) {
  return (await buildSessionCookie(email, env)).split(";")[0];
}

async function requestFor(email, env, path, init = {}) {
  const cookie = await cookieFor(email, env);
  return new Request("https://example.test" + path, {
    ...init,
    headers: {
      cookie,
      ...(init.headers || {}),
    },
  });
}

test("gift schema setup is cached after the first verified initialization", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  const firstCount = env.DB.prepareCount;
  assert(firstCount > 0);
  await ensureGiftMinuteUsageSchema(env);
  assert.equal(env.DB.prepareCount, firstCount, "schema DDL/checks repeated in the same worker DB binding");
});

test("session expiry refreshes paid state before any endpoint consumes the user", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    1,"expired@example.test","active",null,0,"hours",900);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    1,"2000-01",1200,300,0,1,1);

  const request = await requestFor("expired@example.test",env,"/api/me");
  const user = await getUserFromRequest(request,env);
  assert(user);
  assert.equal(user.paid,false);
  assert.equal(user.balance_seconds,0);
  assert.equal(user.status,"unauthorized");
  assert.equal(user.plan_type,null);
  assert.deepEqual(
    { ...row(env,"SELECT seconds_used,seconds_expired FROM gift_minute_usage WHERE user_id=1") },
    {seconds_used:1200,seconds_expired:900}
  );

  const status = await handlePaymentStatus(request,env);
  const body = await status.json();
  assert.equal(body.paid,false);
  assert.equal(body.balanceSeconds,0);
});

test("usage tick consumes balance and attributes only current-month gift usage", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  const month = giftMonthKey();
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    2,"tick@example.test","active",null,0,"hours",1200);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    2,month,1200,0,0,2,2);

  const request = await requestFor("tick@example.test",env,"/api/payments/usage/tick",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({seconds:60}),
  });
  const response=await handleUsageTick(request,env);
  const body=await response.json();
  assert.equal(body.consumedSeconds,60);
  assert.equal(body.giftUsedRecorded,60);
  assert.equal(body.balanceSeconds,1140);
  assert.equal(row(env,"SELECT balance_seconds FROM users WHERE id=2").balance_seconds,1140);
  assert.equal(row(env,
    "SELECT seconds_used FROM gift_minute_usage WHERE user_id=2 AND year_month=?",month).seconds_used,60);
});

test("gift claim uses the Israel month and creates an expiry-aware ledger row", async () => {
  const env = makeEnv();
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    3,"claim@example.test","unauthorized",null,0,null,0);

  const request=await requestFor("claim@example.test",env,"/api/payments/gift/claim",{method:"POST"});
  const response=await handleGiftClaim(request,env);
  const body=await response.json();
  assert.equal(body.granted,true);
  assert.equal(body.addedSeconds,1200);
  assert.equal(body.newBalance,1200);
  assert.equal(body.freeMinutes.expiredSeconds,0);

  const gift=row(env,
    "SELECT year_month,seconds_granted,seconds_used,seconds_expired FROM gift_minute_usage WHERE user_id=3");
  assert.deepEqual({ ...gift },{
    year_month:giftMonthKey(),
    seconds_granted:1200,
    seconds_used:0,
    seconds_expired:0,
  });
});

test("admin minute report expires old gifts and separates used expired and current unused", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  const month=giftMonthKey();
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    10,"admin@example.test","active",null,1,"subscription",0);
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    11,"target@example.test","active",null,0,"hours",4500);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    11,"2000-01",1200,300,0,1,1);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    11,month,1200,200,0,2,2);

  const request=await requestFor("admin@example.test",env,"/api/admin/minute-usage?limit=500&offset=0");
  const response=await handleAdminMinuteUsage(request,env,new URL(request.url));
  const body=await response.json();
  const target=body.users.find(u=>u.id===11);
  assert(target);
  assert.equal(body.giftMonth,month);
  assert.equal(target.balance_seconds,3600);
  assert.equal(target.gift_seconds_granted,2400);
  assert.equal(target.gift_seconds_used,500);
  assert.equal(target.gift_seconds_expired,900);
  assert.equal(target.gift_seconds_unused,1000);
});

test("admin addition occurs after target stale-gift expiry and records acting admin", async () => {
  const env = makeEnv();
  await ensureGiftMinuteUsageSchema(env);
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    20,"admin2@example.test","active",null,1,"subscription",0);
  exec(env,
    "INSERT INTO users(id,email,status,expires_at,is_admin,plan_type,balance_seconds) VALUES(?,?,?,?,?,?,?)",
    21,"adjust@example.test","active",null,0,"hours",900);
  exec(env,
    "INSERT INTO gift_minute_usage(user_id,year_month,seconds_granted,seconds_used,seconds_expired,created_at,claimed_at) VALUES(?,?,?,?,?,?,?)",
    21,"2000-01",1200,300,0,1,1);

  const request=await requestFor("admin2@example.test",env,"/api/admin/users/21/minutes",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({deltaMinutes:20}),
  });
  const response=await handleAdminMinuteAdjust(request,env,new URL(request.url));
  const body=await response.json();
  assert.equal(body.deltaMinutes,20);
  assert.equal(body.adjustedByUserId,20);
  assert.equal(body.user.balance_seconds,1200);
  assert.equal(body.user.status,"active");
  assert.equal(body.user.plan_type,"hours");
  assert.equal(row(env,"SELECT seconds_expired FROM gift_minute_usage WHERE user_id=21").seconds_expired,900);
  assert.equal(row(env,"SELECT txn_id FROM payments WHERE user_id=21 ORDER BY id DESC LIMIT 1").txn_id,"admin_user_20");
});

test("worker cron serializes global gift expiry after recurring billing", () => {
  const source=fs.readFileSync(new URL("../../worker/index.js",import.meta.url),"utf8");
  assert.match(source,/import \{ expireAllGiftBalances \} from '\.\/gift_expiry\.js';/);
  const scheduled=source.slice(source.indexOf("async scheduled("));
  const billing=scheduled.indexOf("runRecurringBilling(env)");
  const expiry=scheduled.indexOf(".then(() => expireAllGiftBalances(env)");
  assert(billing>=0&&expiry>billing,"gift expiry must run after recurring billing in the same promise chain");
  assert.doesNotMatch(scheduled,/ctx\.waitUntil\(expireAllGiftBalances\(/,
    "gift expiry must not race recurring billing in a separate waitUntil");
});


test("payment routing has one gift/status implementation and admin UI exposes expiry", () => {
  const payments=fs.readFileSync(new URL("../../worker/payments.js",import.meta.url),"utf8");
  assert.match(payments,/import \{ handleGiftClaim, handlePaymentStatus \} from '\.\/minute_access\.js';/);
  assert.match(payments,/return handlePaymentStatus\(request, env\)/);
  assert.match(payments,/return handleGiftClaim\(request, env\)/);
  assert.doesNotMatch(payments,/function thisMonthKey\(/);
  assert.doesNotMatch(payments,/async function getStatus\(/);
  assert.doesNotMatch(payments,/async function claimGift\(/);

  for(const relative of ["../../admin_minutes_tab.js","../../public/admin_minutes_tab.js"]){
    const ui=fs.readFileSync(new URL(relative,import.meta.url),"utf8");
    assert.match(ui,/gift_seconds_expired/);
    assert.match(ui,/דקות מתנה שפגו בסוף חודש/);
    assert.match(ui,/מתנת החודש שעדיין נותרה/);
  }

  const worker=fs.readFileSync(new URL("../../worker/index.js",import.meta.url),"utf8");
  assert.match(worker,/admin_minutes_tab\.js\?v=20261004a/);
});
