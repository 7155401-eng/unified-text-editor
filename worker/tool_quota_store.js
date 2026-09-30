import { getToolQuotaPolicy, policyPublicView } from './tool_quota_policy.js';

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function unlimitedStatus(toolName, policy, reason) {
  return {
    ok: true,
    allowed: true,
    unlimited: true,
    reason,
    policy: policyPublicView(toolName),
    used: 0,
    remaining: null,
    retryAfterSeconds: 0,
    resetAt: null,
  };
}

async function readEvents(env, userId, toolName, sinceSec) {
  const result = await env.DB.prepare(
    `SELECT event_key, units, created_at
       FROM tool_quota_events
      WHERE user_id = ? AND tool_name = ? AND created_at >= ?
      ORDER BY created_at ASC`
  ).bind(userId, toolName, sinceSec).all();
  return Array.isArray(result?.results) ? result.results : [];
}

function summarize(policy, events, nowSec) {
  const positive = events.filter(e => int(e.units) > 0);
  const first = positive[0] || null;
  const last = positive[positive.length - 1] || null;

  if (policy.mode === 'count') {
    const used = positive.length;
    const remaining = Math.max(0, int(policy.limit, 1) - used);
    const resetAt = first ? int(first.created_at) + int(policy.windowSeconds) : null;
    return {
      allowed: remaining > 0,
      used,
      remaining,
      resetAt,
      retryAfterSeconds: remaining > 0 || !resetAt ? 0 : Math.max(1, resetAt - nowSec),
    };
  }

  if (policy.mode === 'units') {
    const used = positive.reduce((sum, e) => sum + Math.max(0, int(e.units)), 0);
    const remaining = Math.max(0, int(policy.limit) - used);
    const resetAt = first ? int(first.created_at) + int(policy.windowSeconds) : null;
    return {
      allowed: remaining > 0,
      used,
      remaining,
      resetAt,
      retryAfterSeconds: remaining > 0 || !resetAt ? 0 : Math.max(1, resetAt - nowSec),
    };
  }

  if (policy.mode === 'cooldown') {
    const until = last ? int(last.created_at) + int(policy.cooldownSeconds) : 0;
    const allowed = !last || until <= nowSec;
    return {
      allowed,
      used: last ? 1 : 0,
      remaining: allowed ? 1 : 0,
      resetAt: allowed ? null : until,
      retryAfterSeconds: allowed ? 0 : Math.max(1, until - nowSec),
    };
  }

  if (policy.mode === 'session') {
    const start = first ? int(first.created_at) : 0;
    const activeUntil = start ? start + int(policy.sessionIdleSeconds) : 0;
    const activeSession = !!start && activeUntil > nowSec;
    const weeklyUsed = positive.length > 0;
    const windowReset = start ? start + int(policy.windowSeconds) : null;
    const allowed = activeSession || !weeklyUsed;
    return {
      allowed,
      used: weeklyUsed ? 1 : 0,
      remaining: activeSession ? 0 : (weeklyUsed ? 0 : 1),
      activeSession,
      sessionEndsAt: activeSession ? activeUntil : null,
      resetAt: weeklyUsed ? windowReset : null,
      retryAfterSeconds: allowed || !windowReset ? 0 : Math.max(1, windowReset - nowSec),
    };
  }

  return { allowed: false, used: 0, remaining: 0, resetAt: null, retryAfterSeconds: 0 };
}

export async function getToolQuotaStatus(env, user, toolName, { nowSec = nowSeconds() } = {}) {
  const policy = getToolQuotaPolicy(toolName);
  if (!policy) return { ok: false, allowed: false, reason: 'unknown_tool', policy: null };
  if (!user) return { ok: false, allowed: false, reason: 'login_required', policy: policyPublicView(toolName) };
  if (user.paid || user.is_admin) return unlimitedStatus(toolName, policy, user.is_admin ? 'admin' : 'premium');
  if (policy.mode === 'unmetered') return unlimitedStatus(toolName, policy, 'free_unmetered');

  const horizon = Math.max(
    int(policy.windowSeconds),
    int(policy.cooldownSeconds),
    int(policy.sessionIdleSeconds),
    1
  );
  const events = await readEvents(env, user.id, toolName, nowSec - horizon);
  return {
    ok: true,
    unlimited: false,
    reason: '',
    policy: policyPublicView(toolName),
    ...summarize(policy, events, nowSec),
  };
}

async function existingEvent(env, userId, toolName, eventKey) {
  if (!eventKey) return null;
  return await env.DB.prepare(
    `SELECT event_key, units, created_at
       FROM tool_quota_events
      WHERE user_id = ? AND tool_name = ? AND event_key = ?
      LIMIT 1`
  ).bind(userId, toolName, eventKey).first();
}

async function insertConditionally(env, sql, bindings) {
  const result = await env.DB.prepare(sql).bind(...bindings).run();
  return (result?.meta?.changes || 0) > 0;
}

/**
 * Consume a migrated tool quota after the real action succeeded.
 *
 * eventKey is mandatory for metered tools. Re-sending the same successful
 * logical action is idempotent and returns duplicate=true without charging
 * again. The INSERT ... SELECT quota predicate is one SQLite statement, so
 * concurrent requests cannot both cross the same limit.
 */
export async function consumeToolQuota(env, user, toolName, {
  units = 1,
  eventKey = '',
  nowSec = nowSeconds(),
} = {}) {
  const policy = getToolQuotaPolicy(toolName);
  if (!policy) return { ok: false, allowed: false, reason: 'unknown_tool', policy: null };
  if (!user) return { ok: false, allowed: false, reason: 'login_required', policy: policyPublicView(toolName) };
  if (user.paid || user.is_admin || policy.mode === 'unmetered') {
    return { ...(await getToolQuotaStatus(env, user, toolName, { nowSec })), consumed: false };
  }

  const key = String(eventKey || '').trim();
  if (!key) {
    return {
      ok: false,
      allowed: false,
      reason: 'idempotency_key_required',
      policy: policyPublicView(toolName),
    };
  }

  const duplicate = await existingEvent(env, user.id, toolName, key);
  if (duplicate) {
    return {
      ...(await getToolQuotaStatus(env, user, toolName, { nowSec })),
      allowed: true,
      consumed: false,
      duplicate: true,
    };
  }

  let inserted = false;
  const windowStart = nowSec - Math.max(1, int(policy.windowSeconds, policy.cooldownSeconds || 1));
  const unitCount = Math.max(1, int(units, 1));

  if (policy.mode === 'count') {
    inserted = await insertConditionally(
      env,
      `INSERT OR IGNORE INTO tool_quota_events
         (user_id, tool_name, event_key, units, created_at)
       SELECT ?, ?, ?, 1, ?
       WHERE (
         SELECT COUNT(*)
           FROM tool_quota_events
          WHERE user_id = ? AND tool_name = ? AND units > 0 AND created_at >= ?
       ) < ?`,
      [user.id, toolName, key, nowSec, user.id, toolName, windowStart, int(policy.limit, 1)]
    );
  } else if (policy.mode === 'units') {
    inserted = await insertConditionally(
      env,
      `INSERT OR IGNORE INTO tool_quota_events
         (user_id, tool_name, event_key, units, created_at)
       SELECT ?, ?, ?, ?, ?
       WHERE (
         SELECT COALESCE(SUM(units), 0)
           FROM tool_quota_events
          WHERE user_id = ? AND tool_name = ? AND units > 0 AND created_at >= ?
       ) + ? <= ?`,
      [
        user.id, toolName, key, unitCount, nowSec,
        user.id, toolName, windowStart, unitCount, int(policy.limit),
      ]
    );
  } else if (policy.mode === 'cooldown') {
    const cooldownStart = nowSec - Math.max(1, int(policy.cooldownSeconds));
    inserted = await insertConditionally(
      env,
      `INSERT OR IGNORE INTO tool_quota_events
         (user_id, tool_name, event_key, units, created_at)
       SELECT ?, ?, ?, 1, ?
       WHERE NOT EXISTS (
         SELECT 1
           FROM tool_quota_events
          WHERE user_id = ? AND tool_name = ? AND units > 0 AND created_at > ?
       )`,
      [user.id, toolName, key, nowSec, user.id, toolName, cooldownStart]
    );
  } else if (policy.mode === 'session') {
    const status = await getToolQuotaStatus(env, user, toolName, { nowSec });
    if (status.activeSession) {
      return { ...status, allowed: true, consumed: false, activeSession: true };
    }
    inserted = await insertConditionally(
      env,
      `INSERT OR IGNORE INTO tool_quota_events
         (user_id, tool_name, event_key, units, created_at)
       SELECT ?, ?, ?, 1, ?
       WHERE NOT EXISTS (
         SELECT 1
           FROM tool_quota_events
          WHERE user_id = ? AND tool_name = ? AND units > 0 AND created_at >= ?
       )`,
      [user.id, toolName, key, nowSec, user.id, toolName, windowStart]
    );
  }

  const status = await getToolQuotaStatus(env, user, toolName, { nowSec });
  if (!inserted) {
    return {
      ...status,
      ok: true,
      allowed: false,
      consumed: false,
      reason: 'quota_exceeded',
    };
  }

  return {
    ...status,
    ok: true,
    allowed: true,
    consumed: true,
    duplicate: false,
  };
}
