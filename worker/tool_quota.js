import { getToolPolicy } from "./tool_policy.js";

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

function rollingCountPolicy(toolName) {
  const policy = getToolPolicy(toolName);
  if (
    !policy ||
    !["success-metered-ready", "action-metered-ready"].includes(policy.migrationState) ||
    policy.freeMode !== "count" ||
    !(safeInt(policy.limit) > 0) ||
    !(safeInt(policy.windowSeconds) > 0)
  ) {
    return null;
  }
  return policy;
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

async function currentCountState(user, toolName, policy, env, nowSec) {
  const cutoff = rollingWindowCutoff(nowSec, policy.windowSeconds);
  const row = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(units), 0) AS used_units,
      MIN(created_at) AS first_event_at
    FROM tool_quota_events
    WHERE user_id = ?
      AND tool_name = ?
      AND event_kind = ?
      AND created_at >= ?
  `).bind(user.id, toolName, policy.eventKind || "success", cutoff).first();

  const used = Math.max(0, safeInt(row?.used_units));
  const limit = Math.max(1, safeInt(policy.limit, 1));
  const remaining = Math.max(0, limit - used);
  const resetAt = remaining > 0 ? null : quotaResetAt(row?.first_event_at, policy.windowSeconds);

  return {
    ok: remaining > 0,
    reason: remaining > 0 ? "" : "quota",
    used,
    limit,
    remaining,
    resetAt,
    windowSeconds: safeInt(policy.windowSeconds),
  };
}

export async function checkToolQuotaAvailability(user, toolName, env, options = {}) {
  if (!user) return { ok: false, reason: "login" };
  if (user.paid || user.is_admin) {
    return { ok: true, unlimited: true, remaining: null, resetAt: null };
  }

  const policy = rollingCountPolicy(toolName);
  if (!policy) {
    return { ok: false, reason: "unsupported_policy" };
  }

  await ensureToolQuotaSchema(env);
  const nowSec = safeInt(options.nowSec, Math.floor(Date.now() / 1000));
  return currentCountState(user, toolName, policy, env, nowSec);
}

async function findIdempotentEvent(user, toolName, env, idempotencyKey) {
  if (!idempotencyKey) return null;
  return env.DB.prepare(`
    SELECT id, created_at, units
    FROM tool_quota_events
    WHERE user_id = ? AND tool_name = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(user.id, toolName, idempotencyKey).first();
}

export async function consumeToolUse(user, toolName, env, options = {}) {
  if (!user) return { ok: false, reason: "login" };
  if (user.paid || user.is_admin) {
    return { ok: true, unlimited: true, idempotent: false };
  }

  const policy = rollingCountPolicy(toolName);
  if (!policy) {
    return { ok: false, reason: "unsupported_policy" };
  }

  await ensureToolQuotaSchema(env);

  const nowSec = safeInt(options.nowSec, Math.floor(Date.now() / 1000));
  const units = Math.max(1, safeInt(options.units, 1));
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);

  const existing = await findIdempotentEvent(user, toolName, env, idempotencyKey);
  if (existing) {
    return {
      ok: true,
      idempotent: true,
      eventId: existing.id,
      createdAt: existing.created_at,
    };
  }

  const cutoff = rollingWindowCutoff(nowSec, policy.windowSeconds);
  const limit = Math.max(1, safeInt(policy.limit, 1));
  const eventKind = String(policy.eventKind || "success");

  // One statement does the quota check and the write. D1/SQLite serializes the
  // write transaction, so two simultaneous first-use requests cannot both
  // commit a successful-use event.
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO tool_quota_events
      (user_id, tool_name, event_kind, units, idempotency_key, created_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (
      SELECT COALESCE(SUM(units), 0)
      FROM tool_quota_events
      WHERE user_id = ?
        AND tool_name = ?
        AND event_kind = ?
        AND created_at >= ?
    ) + ? <= ?
  `).bind(
    user.id, toolName, eventKind, units, idempotencyKey, nowSec,
    user.id, toolName, eventKind, cutoff,
    units, limit
  ).run();

  if ((inserted?.meta?.changes || 0) > 0) {
    const state = await currentCountState(user, toolName, policy, env, nowSec);
    return {
      ok: true,
      idempotent: false,
      used: state.used,
      remaining: state.remaining,
      resetAt: state.resetAt,
    };
  }

  // Concurrent retry with the same key: the other request may have inserted
  // after our first idempotency lookup.
  const racedExisting = await findIdempotentEvent(user, toolName, env, idempotencyKey);
  if (racedExisting) {
    return {
      ok: true,
      idempotent: true,
      eventId: racedExisting.id,
      createdAt: racedExisting.created_at,
    };
  }

  return currentCountState(user, toolName, policy, env, nowSec);
}


export async function consumeSuccessfulToolUse(user, toolName, env, options = {}) {
  const policy = getToolPolicy(toolName);
  if (policy?.eventKind && policy.eventKind !== "success") {
    return { ok: false, reason: "wrong_event_kind" };
  }
  return consumeToolUse(user, toolName, env, options);
}
