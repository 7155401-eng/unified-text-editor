import { getToolPolicy, isServerManagedMeteredTool } from "./tool_policy.js";

let schemaReady = false;

async function ensureToolQuotaSchema(env) {
  if (schemaReady) return;
  if (!env?.DB) throw new Error("TOOL_QUOTA_DB_UNAVAILABLE");

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS tool_quota_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 1,
      idempotency_key TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, tool_name, idempotency_key)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tool_quota_events_lookup
    ON tool_quota_events(user_id, tool_name, event_kind, created_at)
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_tool_quota_events_idempotency
    ON tool_quota_events(user_id, tool_name, idempotency_key)
  `).run();

  schemaReady = true;
}

const safeInt = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

function meteredPolicy(toolName) {
  const policy = getToolPolicy(toolName);
  return policy && isServerManagedMeteredTool(toolName) ? policy : null;
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();
  if (!key) return null;
  return key.slice(0, 160);
}

export function rollingWindowCutoff(nowSec, windowSeconds) {
  return Math.max(0, safeInt(nowSec) - Math.max(1, safeInt(windowSeconds)));
}

export function quotaResetAt(firstEventAt, windowSeconds) {
  const first = safeInt(firstEventAt);
  return first > 0 ? first + Math.max(1, safeInt(windowSeconds)) : null;
}

function fallbackLocalDayBounds(nowSec, timezoneOffsetMinutes = 0) {
  const offset = Math.max(-14 * 60, Math.min(14 * 60, safeInt(timezoneOffsetMinutes))) * 60;
  const start = Math.floor((safeInt(nowSec) + offset) / 86400) * 86400 - offset;
  return { startSec: start, endSec: start + 86400 };
}

function zoneParts(epochSec, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(safeInt(epochSec) * 1000));
  const out = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = Number(p.value);
  return out;
}

function zoneOffsetMinutesAt(epochSec, timeZone) {
  const p = zoneParts(epochSec, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000;
  return Math.round((wallAsUtc - safeInt(epochSec)) / 60);
}

function midnightEpochForYmd(year, month, day, timeZone, fallbackOffsetMinutes = 0) {
  const wallMidnightUtc = Date.UTC(year, month - 1, day, 0, 0, 0) / 1000;
  try {
    let offset = zoneOffsetMinutesAt(wallMidnightUtc, timeZone);
    let candidate = wallMidnightUtc - offset * 60;
    const refined = zoneOffsetMinutesAt(candidate, timeZone);
    if (refined !== offset) candidate = wallMidnightUtc - refined * 60;
    return candidate;
  } catch (_) {
    const offset = Math.max(-14 * 60, Math.min(14 * 60, safeInt(fallbackOffsetMinutes))) * 60;
    return wallMidnightUtc - offset;
  }
}

export function localDayBoundsSec(nowSec, {
  timeZone = "",
  timezoneOffsetMinutes = 0,
} = {}) {
  const tz = String(timeZone || "").trim();
  if (!tz) return fallbackLocalDayBounds(nowSec, timezoneOffsetMinutes);

  try {
    const p = zoneParts(nowSec, tz);
    const startSec = midnightEpochForYmd(p.year, p.month, p.day, tz, timezoneOffsetMinutes);
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    const endSec = midnightEpochForYmd(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      next.getUTCDate(),
      tz,
      timezoneOffsetMinutes
    );
    if (endSec > startSec) return { startSec, endSec };
  } catch (_) {}

  return fallbackLocalDayBounds(nowSec, timezoneOffsetMinutes);
}

async function findIdempotentEvent(user, toolName, env, idempotencyKey) {
  if (!idempotencyKey) return null;
  return env.DB.prepare(`
    SELECT id, created_at, units, event_kind
    FROM tool_quota_events
    WHERE user_id = ? AND tool_name = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(user.id, toolName, idempotencyKey).first();
}

async function currentRollingCountState(user, toolName, policy, env, nowSec) {
  const cutoff = rollingWindowCutoff(nowSec, policy.windowSeconds);
  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(units), 0) AS used_units,
      MIN(created_at) AS first_event_at
    FROM tool_quota_events
    WHERE user_id = ?
      AND tool_name = ?
      AND event_kind = 'success'
      AND created_at >= ?
  `).bind(user.id, toolName, cutoff).first();

  const used = Math.max(0, safeInt(row?.used_units));
  const limit = Math.max(1, safeInt(policy.limit, 1));
  const remaining = Math.max(0, limit - used);
  const resetAt = remaining > 0 ? null : quotaResetAt(row?.first_event_at, policy.windowSeconds);

  return {
    ok: remaining > 0,
    reason: remaining > 0 ? "" : "quota",
    mode: "count",
    used,
    limit,
    remaining,
    resetAt,
    windowSeconds: safeInt(policy.windowSeconds),
  };
}

async function currentUnitState(user, toolName, policy, env, nowSec, options) {
  const { startSec, endSec } = localDayBoundsSec(nowSec, options);
  const row = await env.DB.prepare(`
    SELECT COALESCE(SUM(units), 0) AS used_units
    FROM tool_quota_events
    WHERE user_id = ?
      AND tool_name = ?
      AND event_kind = 'success'
      AND created_at >= ?
      AND created_at < ?
  `).bind(user.id, toolName, startSec, endSec).first();

  const used = Math.max(0, safeInt(row?.used_units));
  const limit = Math.max(1, safeInt(policy.limit, 1));
  const remaining = Math.max(0, limit - used);
  const amount = Math.max(1, safeInt(options?.units ?? options?.amount, 1));

  return {
    ok: amount <= remaining,
    reason: amount <= remaining ? "" : "quota",
    mode: "units",
    used,
    limit,
    remaining,
    requested: amount,
    resetAt: endSec,
    unit: policy.unit || "units",
  };
}

async function currentCooldownState(user, toolName, policy, env, nowSec) {
  const row = await env.DB.prepare(`
    SELECT MAX(created_at) AS last_event_at
    FROM tool_quota_events
    WHERE user_id = ?
      AND tool_name = ?
      AND event_kind = 'success'
  `).bind(user.id, toolName).first();

  const last = Math.max(0, safeInt(row?.last_event_at));
  const windowSeconds = Math.max(1, safeInt(policy.windowSeconds, 86400));
  const resetAt = last ? last + windowSeconds : null;
  const ok = !last || safeInt(nowSec) >= resetAt;

  return {
    ok,
    reason: ok ? "" : "quota",
    mode: "cooldown",
    used: ok ? 0 : 1,
    limit: 1,
    remaining: ok ? 1 : 0,
    resetAt: ok ? null : resetAt,
    windowSeconds,
  };
}

async function currentSessionState(user, toolName, policy, env, nowSec) {
  const cutoff = rollingWindowCutoff(nowSec, policy.windowSeconds);
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS used_sessions,
      MIN(created_at) AS first_event_at
    FROM tool_quota_events
    WHERE user_id = ?
      AND tool_name = ?
      AND event_kind = 'session-start'
      AND created_at >= ?
  `).bind(user.id, toolName, cutoff).first();

  const used = Math.max(0, safeInt(row?.used_sessions));
  const limit = Math.max(1, safeInt(policy.limit, 1));
  const remaining = Math.max(0, limit - used);
  const resetAt = remaining > 0 ? null : quotaResetAt(row?.first_event_at, policy.windowSeconds);

  // A 15-minute session belongs to the already-open Comparator window.
  // A NEW window may open only while the weekly session is still unused.
  return {
    ok: remaining > 0,
    reason: remaining > 0 ? "" : "quota",
    mode: "session",
    used,
    limit,
    remaining,
    resetAt,
    windowSeconds: safeInt(policy.windowSeconds),
    sessionIdleSeconds: safeInt(policy.sessionIdleSeconds, 15 * 60),
  };
}

export async function checkToolQuotaAvailability(user, toolName, env, options = {}) {
  if (!user) return { ok: false, reason: "login" };
  if (user.paid || user.is_admin) {
    return { ok: true, unlimited: true, remaining: null, resetAt: null };
  }

  const policy = meteredPolicy(toolName);
  if (!policy) return { ok: false, reason: "unsupported_policy" };

  await ensureToolQuotaSchema(env);
  const nowSec = safeInt(options.nowSec, Math.floor(Date.now() / 1000));

  if (policy.freeMode === "count") {
    return currentRollingCountState(user, toolName, policy, env, nowSec);
  }
  if (policy.freeMode === "units") {
    return currentUnitState(user, toolName, policy, env, nowSec, options);
  }
  if (policy.freeMode === "cooldown") {
    return currentCooldownState(user, toolName, policy, env, nowSec);
  }
  if (policy.freeMode === "session") {
    return currentSessionState(user, toolName, policy, env, nowSec);
  }

  return { ok: false, reason: "unsupported_policy" };
}

async function consumeRollingCount(user, toolName, policy, env, nowSec, units, idempotencyKey) {
  const cutoff = rollingWindowCutoff(nowSec, policy.windowSeconds);
  const limit = Math.max(1, safeInt(policy.limit, 1));

  // Keep this statement shape stable: existing regression tests exercise the
  // atomic weekly-success path used by Nikud Merger.
  return env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_events
      (user_id, tool_name, event_kind, units, idempotency_key, created_at)
    SELECT ?, ?, 'success', ?, ?, ?
    WHERE (
      SELECT COALESCE(SUM(units), 0)
      FROM tool_quota_events
      WHERE user_id = ?
        AND tool_name = ?
        AND event_kind = 'success'
        AND created_at >= ?
    ) + ? <= ?
  `).bind(
    user.id, toolName, units, idempotencyKey, nowSec,
    user.id, toolName, cutoff,
    units, limit
  ).run();
}

async function consumeUnits(user, toolName, policy, env, nowSec, units, options, idempotencyKey) {
  const { startSec, endSec } = localDayBoundsSec(nowSec, options);
  const limit = Math.max(1, safeInt(policy.limit, 1));
  return env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_events
      (user_id, tool_name, event_kind, units, idempotency_key, created_at)
    SELECT ?, ?, 'success', ?, ?, ?
    WHERE (
      SELECT COALESCE(SUM(units), 0)
      FROM tool_quota_events
      WHERE user_id = ?
        AND tool_name = ?
        AND event_kind = 'success'
        AND created_at >= ?
        AND created_at < ?
    ) + ? <= ?
  `).bind(
    user.id, toolName, units, idempotencyKey, nowSec,
    user.id, toolName, startSec, endSec,
    units, limit
  ).run();
}

async function consumeCooldown(user, toolName, policy, env, nowSec, idempotencyKey) {
  const cutoff = Math.max(0, nowSec - Math.max(1, safeInt(policy.windowSeconds, 86400)));
  return env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_events
      (user_id, tool_name, event_kind, units, idempotency_key, created_at)
    SELECT ?, ?, 'success', 1, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM tool_quota_events
      WHERE user_id = ?
        AND tool_name = ?
        AND event_kind = 'success'
        AND created_at > ?
    )
  `).bind(
    user.id, toolName, idempotencyKey, nowSec,
    user.id, toolName, cutoff
  ).run();
}

async function consumeSession(user, toolName, policy, env, nowSec, idempotencyKey) {
  const cutoff = rollingWindowCutoff(nowSec, policy.windowSeconds);
  const limit = Math.max(1, safeInt(policy.limit, 1));
  return env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_events
      (user_id, tool_name, event_kind, units, idempotency_key, created_at)
    SELECT ?, ?, 'session-start', 1, ?, ?
    WHERE (
      SELECT COUNT(*)
      FROM tool_quota_events
      WHERE user_id = ?
        AND tool_name = ?
        AND event_kind = 'session-start'
        AND created_at >= ?
    ) < ?
  `).bind(
    user.id, toolName, idempotencyKey, nowSec,
    user.id, toolName, cutoff, limit
  ).run();
}

export async function consumeToolQuota(user, toolName, env, options = {}) {
  if (!user) return { ok: false, reason: "login" };
  if (user.paid || user.is_admin) {
    return { ok: true, unlimited: true, idempotent: false };
  }

  const policy = meteredPolicy(toolName);
  if (!policy) return { ok: false, reason: "unsupported_policy" };

  await ensureToolQuotaSchema(env);

  const nowSec = safeInt(options.nowSec, Math.floor(Date.now() / 1000));
  const units = Math.max(1, safeInt(options.units ?? options.amount, 1));
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);

  const existing = await findIdempotentEvent(user, toolName, env, idempotencyKey);
  if (existing) {
    return {
      ok: true,
      idempotent: true,
      eventId: existing.id,
      createdAt: existing.created_at,
      units: existing.units,
      eventKind: existing.event_kind,
    };
  }

  let inserted;
  if (policy.freeMode === "count") {
    inserted = await consumeRollingCount(user, toolName, policy, env, nowSec, units, idempotencyKey);
  } else if (policy.freeMode === "units") {
    inserted = await consumeUnits(user, toolName, policy, env, nowSec, units, options, idempotencyKey);
  } else if (policy.freeMode === "cooldown") {
    inserted = await consumeCooldown(user, toolName, policy, env, nowSec, idempotencyKey);
  } else if (policy.freeMode === "session") {
    inserted = await consumeSession(user, toolName, policy, env, nowSec, idempotencyKey);
  } else {
    return { ok: false, reason: "unsupported_policy" };
  }

  if ((inserted?.meta?.changes || 0) > 0) {
    const state = await checkToolQuotaAvailability(user, toolName, env, {
      ...options,
      nowSec,
      units,
    });
    return {
      ok: true,
      idempotent: false,
      used: state.used ?? null,
      remaining: state.remaining ?? null,
      resetAt: state.resetAt ?? null,
      sessionIdleSeconds: state.sessionIdleSeconds ?? null,
    };
  }

  // Concurrent retry with the same key: another request may have inserted
  // between the first lookup and our atomic statement.
  const racedExisting = await findIdempotentEvent(user, toolName, env, idempotencyKey);
  if (racedExisting) {
    return {
      ok: true,
      idempotent: true,
      eventId: racedExisting.id,
      createdAt: racedExisting.created_at,
      units: racedExisting.units,
      eventKind: racedExisting.event_kind,
    };
  }

  return checkToolQuotaAvailability(user, toolName, env, {
    ...options,
    nowSec,
    units,
  });
}

// Backward-compatible API already used by Nikud Merger.
export async function consumeSuccessfulToolUse(user, toolName, env, options = {}) {
  return consumeToolQuota(user, toolName, env, options);
}
