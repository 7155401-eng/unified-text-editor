export const GIFT_TIME_ZONE = "Asia/Jerusalem";
const DEFAULT_GIFT_SECONDS = 20 * 60;
const UNPAID_STATUS = "unauthorized";

const positiveInt = (value) => {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export function giftMonthKey(at = new Date()) {
  const date = at instanceof Date ? at : new Date(at);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: GIFT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(date);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    if (year && month) return `${year}-${month}`;
  } catch (_) {}
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function ensureGiftMinuteUsageSchema(env, giftSeconds = DEFAULT_GIFT_SECONDS) {
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS gift_minute_usage (
      user_id INTEGER NOT NULL,
      year_month TEXT NOT NULL,
      seconds_granted INTEGER NOT NULL DEFAULT 0,
      seconds_used INTEGER NOT NULL DEFAULT 0,
      seconds_expired INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      claimed_at INTEGER,
      PRIMARY KEY (user_id, year_month)
    )`).run();
  } catch (_) {}
  try {
    await env.DB.prepare("ALTER TABLE gift_minute_usage ADD COLUMN claimed_at INTEGER").run();
  } catch (_) {}
  try {
    await env.DB.prepare("ALTER TABLE gift_minute_usage ADD COLUMN seconds_expired INTEGER NOT NULL DEFAULT 0").run();
  } catch (_) {}
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_gift_minute_usage_user ON gift_minute_usage(user_id, created_at)").run();
  } catch (_) {}
  try {
    await env.DB.prepare("UPDATE gift_minute_usage SET claimed_at = COALESCE(claimed_at, created_at) WHERE claimed_at IS NULL").run();
  } catch (_) {}
  try {
    await env.DB.prepare("UPDATE gift_minute_usage SET seconds_expired = COALESCE(seconds_expired, 0)").run();
  } catch (_) {}
  try {
    await env.DB.prepare(`INSERT OR IGNORE INTO gift_minute_usage
      (user_id, year_month, seconds_granted, seconds_used, seconds_expired, created_at, claimed_at)
      SELECT user_id, year_month, ?, 0, 0, claimed_at, claimed_at
      FROM gift_claims`).bind(positiveInt(giftSeconds) || DEFAULT_GIFT_SECONDS).run();
  } catch (_) {}
}

function requireBatch(env) {
  if (typeof env?.DB?.batch !== "function") {
    throw new Error("gift_expiry_requires_d1_batch");
  }
}

const remainingExpression = (alias = "g") =>
  `CASE WHEN COALESCE(${alias}.seconds_granted,0)>COALESCE(${alias}.seconds_used,0) ` +
  `THEN COALESCE(${alias}.seconds_granted,0)-COALESCE(${alias}.seconds_used,0) ELSE 0 END`;

export async function recordCurrentGiftUsage(
  env,
  userId,
  seconds,
  { monthKey = giftMonthKey(), giftSeconds = DEFAULT_GIFT_SECONDS } = {}
) {
  const uid = Number(userId);
  const key = String(monthKey || giftMonthKey());
  const requested = positiveInt(seconds);
  if (!Number.isFinite(uid) || uid <= 0 || requested <= 0) return 0;
  await ensureGiftMinuteUsageSchema(env, giftSeconds);

  const row = await env.DB.prepare(`SELECT
      COALESCE(seconds_granted,0) AS seconds_granted,
      COALESCE(seconds_used,0) AS seconds_used
    FROM gift_minute_usage
    WHERE user_id = ? AND year_month = ?
      AND COALESCE(seconds_granted,0) > COALESCE(seconds_used,0)`)
    .bind(uid, key)
    .first();
  if (!row) return 0;

  const remaining = Math.max(0, positiveInt(row.seconds_granted) - positiveInt(row.seconds_used));
  const used = Math.min(remaining, requested);
  if (used <= 0) return 0;
  await env.DB.prepare(`UPDATE gift_minute_usage
    SET seconds_used = COALESCE(seconds_used,0) + ?
    WHERE user_id = ? AND year_month = ?`)
    .bind(used, uid, key)
    .run();
  return used;
}

export async function expireUserGiftBalance(
  env,
  userId,
  { cutoff = giftMonthKey(), giftSeconds = DEFAULT_GIFT_SECONDS } = {}
) {
  const uid = Number(userId);
  const key = String(cutoff || giftMonthKey());
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ok: false, cutoff: key, error: "invalid_user_id" };
  }
  await ensureGiftMinuteUsageSchema(env, giftSeconds);

  const beforeUser = await env.DB.prepare(
    "SELECT balance_seconds, status, plan_type FROM users WHERE id = ?"
  ).bind(uid).first();
  if (!beforeUser) return { ok: false, cutoff: key, userId: uid, error: "user_not_found" };

  const summary = await env.DB.prepare(`SELECT
      COUNT(*) AS rows_count,
      COALESCE(SUM(${remainingExpression("g")}),0) AS seconds_count
    FROM gift_minute_usage g
    WHERE g.user_id = ? AND g.year_month < ?
      AND COALESCE(g.seconds_granted,0) > COALESCE(g.seconds_used,0)`)
    .bind(uid, key)
    .first();

  const expectedExpired = positiveInt(summary?.seconds_count);
  const rowsAffected = Number(summary?.rows_count || 0);
  if (!expectedExpired) {
    return {
      ok: true,
      cutoff: key,
      userId: uid,
      expiredSeconds: 0,
      balanceRemovedSeconds: 0,
      balanceSeconds: positiveInt(beforeUser.balance_seconds),
      rowsAffected: 0,
    };
  }

  requireBatch(env);
  const updateBalance = env.DB.prepare(`UPDATE users
    SET balance_seconds = MAX(0, COALESCE(balance_seconds,0) - COALESCE((
      SELECT SUM(${remainingExpression("g")})
      FROM gift_minute_usage g
      WHERE g.user_id = users.id AND g.year_month < ?
        AND COALESCE(g.seconds_granted,0) > COALESCE(g.seconds_used,0)
    ),0))
    WHERE id = ?`).bind(key, uid);

  const expireLedger = env.DB.prepare(`UPDATE gift_minute_usage
    SET seconds_expired = COALESCE(seconds_expired,0) + ${remainingExpression("gift_minute_usage")},
        seconds_used = MAX(COALESCE(seconds_used,0), COALESCE(seconds_granted,0))
    WHERE user_id = ? AND year_month < ?
      AND COALESCE(seconds_granted,0) > COALESCE(seconds_used,0)`)
    .bind(uid, key);

  const normalizeHoursState = env.DB.prepare(`UPDATE users
    SET status = ?, plan_type = NULL
    WHERE id = ? AND plan_type = 'hours' AND COALESCE(balance_seconds,0) <= 0`)
    .bind(UNPAID_STATUS, uid);

  await env.DB.batch([updateBalance, expireLedger, normalizeHoursState]);

  const afterUser = await env.DB.prepare(
    "SELECT balance_seconds, status, plan_type FROM users WHERE id = ?"
  ).bind(uid).first();
  const beforeBalance = positiveInt(beforeUser.balance_seconds);
  const afterBalance = positiveInt(afterUser?.balance_seconds);
  return {
    ok: true,
    cutoff: key,
    userId: uid,
    expiredSeconds: expectedExpired,
    balanceRemovedSeconds: Math.max(0, beforeBalance - afterBalance),
    balanceSeconds: afterBalance,
    rowsAffected,
    status: afterUser?.status ?? null,
    planType: afterUser?.plan_type ?? null,
  };
}

export async function expireAllGiftBalances(
  env,
  { cutoff = giftMonthKey(), giftSeconds = DEFAULT_GIFT_SECONDS } = {}
) {
  const key = String(cutoff || giftMonthKey());
  await ensureGiftMinuteUsageSchema(env, giftSeconds);

  const summary = await env.DB.prepare(`SELECT
      COUNT(*) AS rows_count,
      COUNT(DISTINCT user_id) AS users_count,
      COALESCE(SUM(${remainingExpression("g")}),0) AS seconds_count
    FROM gift_minute_usage g
    WHERE g.year_month < ?
      AND COALESCE(g.seconds_granted,0) > COALESCE(g.seconds_used,0)`)
    .bind(key)
    .first();

  const expectedExpired = positiveInt(summary?.seconds_count);
  const rowsAffected = Number(summary?.rows_count || 0);
  const usersAffected = Number(summary?.users_count || 0);
  if (!expectedExpired) {
    return { ok: true, cutoff: key, expiredSeconds: 0, usersAffected: 0, rowsAffected: 0 };
  }

  requireBatch(env);
  const updateBalances = env.DB.prepare(`UPDATE users
    SET balance_seconds = MAX(0, COALESCE(balance_seconds,0) - COALESCE((
      SELECT SUM(${remainingExpression("g")})
      FROM gift_minute_usage g
      WHERE g.user_id = users.id AND g.year_month < ?
        AND COALESCE(g.seconds_granted,0) > COALESCE(g.seconds_used,0)
    ),0))
    WHERE EXISTS (
      SELECT 1 FROM gift_minute_usage g2
      WHERE g2.user_id = users.id AND g2.year_month < ?
        AND COALESCE(g2.seconds_granted,0) > COALESCE(g2.seconds_used,0)
    )`).bind(key, key);

  const expireLedger = env.DB.prepare(`UPDATE gift_minute_usage
    SET seconds_expired = COALESCE(seconds_expired,0) + ${remainingExpression("gift_minute_usage")},
        seconds_used = MAX(COALESCE(seconds_used,0), COALESCE(seconds_granted,0))
    WHERE year_month < ?
      AND COALESCE(seconds_granted,0) > COALESCE(seconds_used,0)`)
    .bind(key);

  const normalizeHoursState = env.DB.prepare(`UPDATE users
    SET status = ?, plan_type = NULL
    WHERE plan_type = 'hours' AND COALESCE(balance_seconds,0) <= 0
      AND id IN (
        SELECT DISTINCT user_id FROM gift_minute_usage
        WHERE year_month < ? AND COALESCE(seconds_expired,0) > 0
      )`).bind(UNPAID_STATUS, key);

  await env.DB.batch([updateBalances, expireLedger, normalizeHoursState]);
  return {
    ok: true,
    cutoff: key,
    expiredSeconds: expectedExpired,
    usersAffected,
    rowsAffected,
  };
}
