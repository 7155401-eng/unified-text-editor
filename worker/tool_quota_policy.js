// Server-authoritative free/Premium policy registry for RavText tools.
//
// Desktop parity rules are intentionally expressed as data here. The browser may
// display quota state, but only the Worker decides whether a free action is
// available and records successful use.
//
// Premium/admin accounts always bypass RavText usage quotas.

export const DAY_SECONDS = 24 * 60 * 60;
export const WEEK_SECONDS = 7 * DAY_SECONDS;
export const SESSION_IDLE_SECONDS = 15 * 60;

export const TOOL_POLICIES = Object.freeze({
  "word-extractor": Object.freeze({ mode: "unmetered", chargeOn: "none" }),
  "torah-transcription": Object.freeze({ mode: "unmetered", chargeOn: "none" }),
  "text-compare-pro": Object.freeze({ mode: "unmetered", chargeOn: "none" }),
  "torah-tools": Object.freeze({ mode: "unmetered", chargeOn: "none" }),

  "comparator-tool": Object.freeze({
    mode: "session",
    limit: 1,
    windowSeconds: WEEK_SECONDS,
    sessionIdleSeconds: SESSION_IDLE_SECONDS,
    chargeOn: "activity",
  }),

  "nikud-merger": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SECONDS,
    windowKind: "rolling",
    chargeOn: "success",
  }),
  "sefaria-downloader": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SECONDS,
    windowKind: "rolling",
    chargeOn: "success",
  }),
  "sefaria-live": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SECONDS,
    windowKind: "rolling",
    chargeOn: "success",
  }),
  "torah-ocr": Object.freeze({
    mode: "count",
    limit: 1,
    windowSeconds: WEEK_SECONDS,
    windowKind: "rolling",
    chargeOn: "success",
  }),

  "torah-nikud": Object.freeze({
    mode: "units",
    limit: 500,
    windowKind: "local-day",
    chargeOn: "success",
    unitName: "chars",
  }),

  "haredi-caricature": Object.freeze({
    mode: "cooldown",
    cooldownSeconds: DAY_SECONDS,
    chargeOn: "success",
  }),

  // Current web-only tool whose old-desktop parity has not been established yet.
  // Preserve the pre-existing one-per-day behavior until its own audit is done.
  "css-ai": Object.freeze({
    mode: "count",
    limit: 1,
    windowKind: "utc-day",
    chargeOn: "preflight",
  }),
});

export function getToolPolicy(toolName) {
  return TOOL_POLICIES[String(toolName || "").trim()] || null;
}

export function isKnownTool(toolName) {
  return !!getToolPolicy(toolName);
}

export function isUnlimitedUser(user) {
  return !!(user && (user.paid || user.is_admin));
}

function int(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function clampTimezoneOffsetMinutes(value) {
  return Math.max(-14 * 60, Math.min(14 * 60, int(value, 0)));
}

export function localDayBucketStart(nowSec, timezoneOffsetMinutes = 0) {
  const offsetSec = clampTimezoneOffsetMinutes(timezoneOffsetMinutes) * 60;
  return Math.floor((int(nowSec) + offsetSec) / DAY_SECONDS) * DAY_SECONDS - offsetSec;
}

export function utcDayBucketStart(nowSec) {
  return Math.floor(int(nowSec) / DAY_SECONDS) * DAY_SECONDS;
}

export function emptyQuotaState() {
  return {
    window_start: 0,
    uses: 0,
    units: 0,
    last_activity: 0,
    last_success: 0,
  };
}

function normalizedState(row) {
  return {
    window_start: int(row?.window_start),
    uses: Math.max(0, int(row?.uses)),
    units: Math.max(0, int(row?.units)),
    last_activity: int(row?.last_activity),
    last_success: int(row?.last_success),
  };
}

function retryAfterRolling(state, policy, nowSec) {
  if (!state.window_start || !policy.windowSeconds) return 0;
  return Math.max(0, state.window_start + int(policy.windowSeconds) - nowSec);
}

export function evaluateQuotaState(policy, stateLike, {
  nowSec = Math.floor(Date.now() / 1000),
  amount = 1,
  timezoneOffsetMinutes = 0,
} = {}) {
  if (!policy) return { allowed: false, reason: "unknown_tool" };
  if (policy.mode === "unmetered") {
    return { allowed: true, unlimited: true, remaining: null, retryAfterSeconds: 0 };
  }

  const now = int(nowSec);
  const state = normalizedState(stateLike);
  const requested = Math.max(1, int(amount, 1));

  if (policy.mode === "count") {
    const limit = Math.max(1, int(policy.limit, 1));
    let reset = false;
    let bucketStart = state.window_start;

    if (policy.windowKind === "utc-day") {
      bucketStart = utcDayBucketStart(now);
      reset = state.window_start !== bucketStart;
    } else if (policy.windowKind === "local-day") {
      bucketStart = localDayBucketStart(now, timezoneOffsetMinutes);
      reset = state.window_start !== bucketStart;
    } else {
      const windowSec = Math.max(1, int(policy.windowSeconds, WEEK_SECONDS));
      reset = !state.window_start || now - state.window_start >= windowSec;
      if (reset) bucketStart = now;
    }

    const used = reset ? 0 : state.uses;
    const remaining = Math.max(0, limit - used);
    let retryAfterSeconds = 0;
    if (remaining <= 0) {
      if (policy.windowKind === "utc-day" || policy.windowKind === "local-day") {
        retryAfterSeconds = Math.max(0, bucketStart + DAY_SECONDS - now);
      } else {
        retryAfterSeconds = retryAfterRolling(state, policy, now);
      }
    }
    return {
      allowed: remaining > 0,
      reason: remaining > 0 ? "" : "quota",
      remaining,
      limit,
      used,
      reset,
      bucketStart,
      retryAfterSeconds,
    };
  }

  if (policy.mode === "units") {
    const limit = Math.max(1, int(policy.limit, 1));
    const bucketStart = policy.windowKind === "utc-day"
      ? utcDayBucketStart(now)
      : localDayBucketStart(now, timezoneOffsetMinutes);
    const reset = state.window_start !== bucketStart;
    const used = reset ? 0 : state.units;
    const remaining = Math.max(0, limit - used);
    const allowed = requested <= remaining;
    return {
      allowed,
      reason: allowed ? "" : "quota",
      amount: requested,
      remaining,
      limit,
      used,
      reset,
      bucketStart,
      retryAfterSeconds: allowed ? 0 : Math.max(0, bucketStart + DAY_SECONDS - now),
    };
  }

  if (policy.mode === "cooldown") {
    const cooldown = Math.max(1, int(policy.cooldownSeconds, DAY_SECONDS));
    const elapsed = state.last_success > 0 ? now - state.last_success : cooldown;
    const allowed = state.last_success <= 0 || elapsed >= cooldown;
    return {
      allowed,
      reason: allowed ? "" : "quota",
      remaining: allowed ? 1 : 0,
      limit: 1,
      retryAfterSeconds: allowed ? 0 : Math.max(0, cooldown - elapsed),
    };
  }

  if (policy.mode === "session") {
    const idle = Math.max(1, int(policy.sessionIdleSeconds, SESSION_IDLE_SECONDS));
    const windowSec = Math.max(1, int(policy.windowSeconds, WEEK_SECONDS));
    const limit = Math.max(1, int(policy.limit, 1));
    const active = state.last_activity > 0 && now - state.last_activity < idle;
    const reset = !state.window_start || now - state.window_start >= windowSec;
    const used = reset ? 0 : state.uses;
    const remaining = Math.max(0, limit - used);
    const allowed = active || remaining > 0;
    return {
      allowed,
      reason: allowed ? "" : "quota",
      activeSession: active,
      reset,
      used,
      remaining: active ? remaining : remaining,
      limit,
      retryAfterSeconds: allowed ? 0 : retryAfterRolling(state, policy, now),
      sessionIdleSeconds: idle,
    };
  }

  return { allowed: false, reason: "unsupported_policy" };
}

export function quotaMessageHe(toolName, policy, availability = {}) {
  if (!policy || policy.mode === "unmetered") return "";
  if (policy.mode === "units") {
    return `${toolName}: למשתמש חינמי עד ${policy.limit} תווים ביום. נשארו ${Math.max(0, Number(availability.remaining) || 0)} תווים.`;
  }
  if (policy.mode === "cooldown") {
    return `${toolName}: למשתמש חינמי שימוש מוצלח אחד בכל 24 שעות.`;
  }
  if (policy.mode === "session") {
    return `${toolName}: למשתמש חינמי סשן אחד של עד 15 דקות בכל 7 ימים. בפרימיום השימוש ללא הגבלה.`;
  }
  if (policy.mode === "count" && policy.windowSeconds === WEEK_SECONDS) {
    return `${toolName}: למשתמש חינמי שימוש מוצלח אחד בכל 7 ימים. בפרימיום השימוש ללא הגבלה.`;
  }
  return `${toolName}: המכסה החינמית נוצלה. בפרימיום השימוש ללא הגבלה.`;
}

let schemaPromise = null;

export async function ensureToolQuotaSchema(env) {
  if (!env?.DB?.prepare) throw new Error("Tool quota database is unavailable");
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS tool_quota_state (
          user_id INTEGER NOT NULL,
          tool_name TEXT NOT NULL,
          window_start INTEGER NOT NULL DEFAULT 0,
          uses INTEGER NOT NULL DEFAULT 0,
          units INTEGER NOT NULL DEFAULT 0,
          last_activity INTEGER NOT NULL DEFAULT 0,
          last_success INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, tool_name)
        )
      `).run();
      await env.DB.prepare(`
        CREATE TABLE IF NOT EXISTS tool_quota_receipts (
          user_id INTEGER NOT NULL,
          tool_name TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          amount INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          applied_at INTEGER,
          response_json TEXT,
          PRIMARY KEY (user_id, tool_name, idempotency_key)
        )
      `).run();
      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_tool_quota_state_updated
        ON tool_quota_state(updated_at)
      `).run();
      await env.DB.prepare(`
        CREATE INDEX IF NOT EXISTS idx_tool_quota_receipts_created
        ON tool_quota_receipts(created_at)
      `).run();
      return true;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

async function readState(env, userId, toolName) {
  const row = await env.DB.prepare(`
    SELECT window_start, uses, units, last_activity, last_success
    FROM tool_quota_state
    WHERE user_id = ? AND tool_name = ?
  `).bind(userId, toolName).first();
  return row ? normalizedState(row) : null;
}

async function insertEmptyState(env, userId, toolName, nowSec) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_state
      (user_id, tool_name, window_start, uses, units, last_activity, last_success, updated_at)
    VALUES (?, ?, 0, 0, 0, 0, 0, ?)
  `).bind(userId, toolName, nowSec).run();
}

async function seedFromLegacyUsage(env, userId, toolName, policy, nowSec) {
  const existing = await readState(env, userId, toolName);
  if (existing) return existing;

  let legacy = null;
  try {
    legacy = await env.DB.prepare(`
      SELECT created_at, usage_date
      FROM tool_usage
      WHERE user_id = ? AND tool_name = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(userId, toolName).first();
  } catch (_) {}

  if (!legacy || policy.mode === "unmetered" || policy.mode === "units") {
    await insertEmptyState(env, userId, toolName, nowSec);
    return readState(env, userId, toolName);
  }

  const created = Math.max(0, int(legacy.created_at));
  let windowStart = created;
  let uses = 1;
  let lastActivity = 0;
  let lastSuccess = created;

  if (policy.mode === "count" && policy.windowKind === "utc-day") {
    windowStart = utcDayBucketStart(created || nowSec);
  } else if (policy.mode === "cooldown") {
    windowStart = 0;
    uses = 0;
  } else if (policy.mode === "session") {
    lastActivity = created;
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_state
      (user_id, tool_name, window_start, uses, units, last_activity, last_success, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?)
  `).bind(userId, toolName, windowStart, uses, lastActivity, lastSuccess, nowSec).run();

  return readState(env, userId, toolName);
}

function availabilityResult(toolName, policy, availability, extras = {}) {
  return {
    ok: !!availability.allowed,
    toolName,
    policy: {
      mode: policy.mode,
      chargeOn: policy.chargeOn,
      limit: policy.limit ?? null,
      windowSeconds: policy.windowSeconds ?? null,
      cooldownSeconds: policy.cooldownSeconds ?? null,
      sessionIdleSeconds: policy.sessionIdleSeconds ?? null,
      unitName: policy.unitName || null,
    },
    quota: availability,
    message: quotaMessageHe(toolName, policy, availability),
    ...extras,
  };
}

export async function checkToolQuota({
  env,
  user,
  toolName,
  amount = 1,
  nowSec = Math.floor(Date.now() / 1000),
  timezoneOffsetMinutes = 0,
} = {}) {
  const policy = getToolPolicy(toolName);
  if (!policy) return { ok: false, reason: "unknown_tool", toolName };

  if (isUnlimitedUser(user)) {
    return availabilityResult(toolName, policy, { allowed: true, unlimited: true, remaining: null }, { unlimited: true });
  }
  if (policy.mode === "unmetered") {
    return availabilityResult(toolName, policy, { allowed: true, unlimited: true, remaining: null }, { unmetered: true });
  }

  await ensureToolQuotaSchema(env);
  const state = await seedFromLegacyUsage(env, user.id, toolName, policy, nowSec) || emptyQuotaState();
  const availability = evaluateQuotaState(policy, state, {
    nowSec,
    amount,
    timezoneOffsetMinutes,
  });
  return availabilityResult(toolName, policy, availability);
}

function cleanIdempotencyKey(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.slice(0, 180);
}

async function claimReceipt(env, userId, toolName, idempotencyKey, amount, nowSec) {
  const key = cleanIdempotencyKey(idempotencyKey);
  if (!key) return { claimed: true, key: "" };

  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_receipts
      (user_id, tool_name, idempotency_key, amount, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).bind(userId, toolName, key, amount, nowSec).run();

  if ((inserted?.meta?.changes || 0) > 0) return { claimed: true, key };

  const row = await env.DB.prepare(`
    SELECT status, response_json
    FROM tool_quota_receipts
    WHERE user_id = ? AND tool_name = ? AND idempotency_key = ?
  `).bind(userId, toolName, key).first();

  if (row?.response_json && (row.status === "applied" || row.status === "rejected")) {
    try {
      return { claimed: false, key, replay: { ...JSON.parse(row.response_json), idempotent: true } };
    } catch (_) {}
  }
  return { claimed: false, key, pending: true };
}

async function finishReceipt(env, userId, toolName, key, status, result, nowSec) {
  if (!key) return;
  try {
    await env.DB.prepare(`
      UPDATE tool_quota_receipts
      SET status = ?, applied_at = ?, response_json = ?
      WHERE user_id = ? AND tool_name = ? AND idempotency_key = ?
    `).bind(status, nowSec, JSON.stringify(result), userId, toolName, key).run();
  } catch (_) {}
}

async function atomicConsumeCount(env, userId, toolName, policy, nowSec, timezoneOffsetMinutes) {
  await insertEmptyState(env, userId, toolName, nowSec);
  const limit = Math.max(1, int(policy.limit, 1));

  if (policy.windowKind === "utc-day" || policy.windowKind === "local-day") {
    const bucketStart = policy.windowKind === "utc-day"
      ? utcDayBucketStart(nowSec)
      : localDayBucketStart(nowSec, timezoneOffsetMinutes);
    return env.DB.prepare(`
      UPDATE tool_quota_state
      SET window_start = ?,
          uses = CASE WHEN window_start <> ? THEN 1 ELSE uses + 1 END,
          last_success = ?,
          updated_at = ?
      WHERE user_id = ? AND tool_name = ?
        AND (window_start <> ? OR uses < ?)
    `).bind(
      bucketStart, bucketStart, nowSec, nowSec,
      userId, toolName, bucketStart, limit
    ).run();
  }

  const windowSec = Math.max(1, int(policy.windowSeconds, WEEK_SECONDS));
  return env.DB.prepare(`
    UPDATE tool_quota_state
    SET window_start = CASE
          WHEN window_start = 0 OR ? - window_start >= ? THEN ?
          ELSE window_start
        END,
        uses = CASE
          WHEN window_start = 0 OR ? - window_start >= ? THEN 1
          ELSE uses + 1
        END,
        last_success = ?,
        updated_at = ?
    WHERE user_id = ? AND tool_name = ?
      AND (window_start = 0 OR ? - window_start >= ? OR uses < ?)
  `).bind(
    nowSec, windowSec, nowSec,
    nowSec, windowSec,
    nowSec, nowSec,
    userId, toolName,
    nowSec, windowSec, limit
  ).run();
}

async function atomicConsumeUnits(env, userId, toolName, policy, amount, nowSec, timezoneOffsetMinutes) {
  await insertEmptyState(env, userId, toolName, nowSec);
  const bucketStart = policy.windowKind === "utc-day"
    ? utcDayBucketStart(nowSec)
    : localDayBucketStart(nowSec, timezoneOffsetMinutes);
  const limit = Math.max(1, int(policy.limit, 1));
  const units = Math.max(1, int(amount, 1));

  return env.DB.prepare(`
    UPDATE tool_quota_state
    SET window_start = ?,
        units = CASE WHEN window_start <> ? THEN ? ELSE units + ? END,
        last_success = ?,
        updated_at = ?
    WHERE user_id = ? AND tool_name = ?
      AND (window_start <> ? OR units + ? <= ?)
  `).bind(
    bucketStart, bucketStart, units, units,
    nowSec, nowSec,
    userId, toolName,
    bucketStart, units, limit
  ).run();
}

async function atomicConsumeCooldown(env, userId, toolName, policy, nowSec) {
  await insertEmptyState(env, userId, toolName, nowSec);
  const cooldown = Math.max(1, int(policy.cooldownSeconds, DAY_SECONDS));
  return env.DB.prepare(`
    UPDATE tool_quota_state
    SET last_success = ?, updated_at = ?
    WHERE user_id = ? AND tool_name = ?
      AND (last_success = 0 OR ? - last_success >= ?)
  `).bind(nowSec, nowSec, userId, toolName, nowSec, cooldown).run();
}

async function atomicConsumeSession(env, userId, toolName, policy, nowSec) {
  await insertEmptyState(env, userId, toolName, nowSec);
  const windowSec = Math.max(1, int(policy.windowSeconds, WEEK_SECONDS));
  const idle = Math.max(1, int(policy.sessionIdleSeconds, SESSION_IDLE_SECONDS));
  const limit = Math.max(1, int(policy.limit, 1));

  return env.DB.prepare(`
    UPDATE tool_quota_state
    SET window_start = CASE
          WHEN window_start = 0 OR ? - window_start >= ? THEN ?
          ELSE window_start
        END,
        uses = CASE
          WHEN last_activity > 0 AND ? - last_activity < ? THEN uses
          WHEN window_start = 0 OR ? - window_start >= ? THEN 1
          ELSE uses + 1
        END,
        last_activity = ?,
        last_success = ?,
        updated_at = ?
    WHERE user_id = ? AND tool_name = ?
      AND (
        (last_activity > 0 AND ? - last_activity < ?)
        OR window_start = 0
        OR ? - window_start >= ?
        OR uses < ?
      )
  `).bind(
    nowSec, windowSec, nowSec,
    nowSec, idle,
    nowSec, windowSec,
    nowSec, nowSec, nowSec,
    userId, toolName,
    nowSec, idle,
    nowSec, windowSec,
    limit
  ).run();
}

export async function consumeToolQuota({
  env,
  user,
  toolName,
  amount = 1,
  idempotencyKey = "",
  nowSec = Math.floor(Date.now() / 1000),
  timezoneOffsetMinutes = 0,
} = {}) {
  const policy = getToolPolicy(toolName);
  if (!policy) return { ok: false, reason: "unknown_tool", toolName };

  if (isUnlimitedUser(user)) {
    return availabilityResult(toolName, policy, { allowed: true, unlimited: true, remaining: null }, { unlimited: true, consumed: false });
  }
  if (policy.mode === "unmetered") {
    return availabilityResult(toolName, policy, { allowed: true, unlimited: true, remaining: null }, { unmetered: true, consumed: false });
  }

  await ensureToolQuotaSchema(env);
  await seedFromLegacyUsage(env, user.id, toolName, policy, nowSec);

  const units = Math.max(1, int(amount, 1));
  const receipt = await claimReceipt(env, user.id, toolName, idempotencyKey, units, nowSec);
  if (receipt.replay) return receipt.replay;
  if (!receipt.claimed && receipt.pending) {
    return { ok: false, reason: "in_progress", toolName, retryAfterSeconds: 1 };
  }

  let writeResult;
  if (policy.mode === "count") {
    writeResult = await atomicConsumeCount(env, user.id, toolName, policy, nowSec, timezoneOffsetMinutes);
  } else if (policy.mode === "units") {
    writeResult = await atomicConsumeUnits(env, user.id, toolName, policy, units, nowSec, timezoneOffsetMinutes);
  } else if (policy.mode === "cooldown") {
    writeResult = await atomicConsumeCooldown(env, user.id, toolName, policy, nowSec);
  } else if (policy.mode === "session") {
    writeResult = await atomicConsumeSession(env, user.id, toolName, policy, nowSec);
  } else {
    const result = { ok: false, reason: "unsupported_policy", toolName };
    await finishReceipt(env, user.id, toolName, receipt.key, "rejected", result, nowSec);
    return result;
  }

  const changed = Number(writeResult?.meta?.changes || 0) > 0;
  const state = await readState(env, user.id, toolName) || emptyQuotaState();
  const availability = evaluateQuotaState(policy, state, {
    nowSec,
    amount: units,
    timezoneOffsetMinutes,
  });

  const result = availabilityResult(toolName, policy, availability, {
    ok: changed,
    consumed: changed,
    reason: changed ? "" : "quota",
  });

  // For a just-consumed count/cooldown/session action, evaluateQuotaState()
  // naturally reports the NEXT action as blocked. Preserve the current action's
  // success while still returning remaining/retry metadata for the UI.
  if (changed) result.ok = true;

  await finishReceipt(env, user.id, toolName, receipt.key, changed ? "applied" : "rejected", result, nowSec);
  return result;
}
