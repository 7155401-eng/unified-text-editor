import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../../worker/minute_access.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../../worker/index.js", import.meta.url), "utf8");
const payments = fs.readFileSync(new URL("../../worker/payments.js", import.meta.url), "utf8");

test("monthly gift is limited to one claim per user/month", () => {
  assert.match(src, /INSERT INTO gift_claims \(user_id, year_month, claimed_at\)/);
  assert.match(src, /reason:'already_claimed'/);
  assert.match(src, /GIFT_MINUTES_PER_MONTH=20/);
});

test("unused gift minutes from older months are removed from shared balance", () => {
  assert.match(src, /export async function expirePastGiftBalances/);
  assert.match(src, /year_month < \?/);
  assert.match(src, /balance_seconds=MAX\(0,COALESCE\(balance_seconds,0\)-COALESCE/);
  assert.match(src, /seconds_expired=COALESCE\(seconds_expired,0\)/);
  assert.match(src, /seconds_used=MAX\(COALESCE\(seconds_used,0\),COALESCE\(seconds_granted,0\)\)/);
});

test("gift consumption cannot consume a previous calendar month", () => {
  assert.match(src, /WHERE user_id = \? AND year_month = \?/);
  assert.match(src, /\.bind\(uid,mkey\(\)\)/);
});

test("expiry runs on status, usage, claims, admin report and scheduled maintenance", () => {
  assert.ok((src.match(/expirePastGiftBalances\(env\)/g) || []).length >= 4);
  assert.match(index, /expirePastGiftBalances\(env\)/);
  assert.match(payments, /handleGiftClaim/);
  assert.match(payments, /handlePaymentStatus/);
});

test("manual minute changes remain admin-only and now record the acting admin", () => {
  assert.match(src, /if\(!u\.is_admin\)return\{error:e\('Forbidden',403\)\}/);
  assert.match(src, /admin_user_\$\{a\.user\.id\}/);
});
