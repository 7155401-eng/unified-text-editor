import { getUserFromRequest } from './session.js';
import { addServerWatermarksToHtml } from '../server/secure_export_html.js';
import {
  getToolPolicy,
  isFreePreflightUnmetered,
  isServerManagedMeteredTool,
  isToolPublic,
} from './tool_policy.js';
import { checkToolQuotaAvailability, consumeToolQuota } from './tool_quota.js';

const TOOL_TOKEN_TTL_SEC = 120;
const DEMO_BLOCK_MS = 5 * 60 * 1000;

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signToolToken(payload, secret) {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return `${b64url(data)}.${b64url(sig)}`;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function requestTriesToDisableWatermark(body) {
  return [
    body?.removeWatermark === true,
    body?.hideWatermark === true,
    body?.watermark === false,
    body?.forceWatermark === false,
    body?.demoWatermark === false,
    body?.watermarkOpacity === 0,
    body?.watermarkOpacity === '0',
  ].some(Boolean);
}

async function handleSecureExportHtmlAction(request, env, body) {
  const user = await getUserFromRequest(request, env);
  const paid = !!user?.paid;

  if (!paid && requestTriesToDisableWatermark(body)) {
    return Response.json(
      { error: 'watermark_tampering', blocked: true },
      {
        status: 403,
        headers: {
          'cache-control': 'no-store',
          'set-cookie': `ravtext_demo_blocked_until=${Date.now() + DEMO_BLOCK_MS}; Path=/; SameSite=Lax`,
        },
      }
    );
  }

  const html = String(body?.html || '');
  if (!html.trim()) {
    return Response.json(
      { error: 'empty_html' },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  const finalHtml = paid ? html : addServerWatermarksToHtml(html);
  return new Response(finalHtml, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-ravtext-auth-source': 'ravtext_session',
      'x-ravtext-user-paid': paid ? '1' : '0',
      'x-ravtext-watermark-forced': paid ? '0' : '1',
    },
  });
}

function quotaOptions(request, body) {
  const amount = Number(body?.amount ?? body?.units ?? 1);
  const fallbackOffset = Number(body?.timeZoneOffsetMinutes ?? body?.timezoneOffsetMinutes ?? 0);
  return {
    units: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1,
    amount: Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1,
    timeZone: String(request?.cf?.timezone || '').trim(),
    timezoneOffsetMinutes: Number.isFinite(fallbackOffset) ? Math.trunc(fallbackOffset) : 0,
  };
}

function quotaMessage(toolName, policy, state = {}) {
  if (!policy) return 'המכסה החינמית אינה זמינה כרגע.';
  const remaining = Math.max(0, Number(state.remaining) || 0);
  if (policy.freeMode === 'units') {
    return `${toolName}: בחשבון חינמי ניתן להשתמש עד ${policy.limit} ${policy.unit === 'characters' ? 'תווים' : 'יחידות'} ביום. נשארו ${remaining}.`;
  }
  if (policy.freeMode === 'session') {
    return `${toolName}: בחשבון חינמי ניתן לפתוח סשן עבודה אחד של 15 דקות בכל 7 ימים. בפרימיום השימוש ללא הגבלה.`;
  }
  if (policy.freeMode === 'cooldown') {
    return `${toolName}: בחשבון חינמי ניתן לבצע פעולה מוצלחת אחת בכל 24 שעות. בפרימיום השימוש ללא הגבלה.`;
  }
  if (policy.freeMode === 'count' && Number(policy.windowSeconds) === 7 * 24 * 60 * 60) {
    return `${toolName}: בחשבון חינמי ניתן לבצע פעולה מוצלחת אחת בכל 7 ימים. בפרימיום השימוש ללא הגבלה.`;
  }
  return `${toolName}: המכסה החינמית נוצלה. בפרימיום השימוש ללא הגבלה.`;
}

function serverQuotaPayload(toolName, policy, state = {}) {
  return {
    ok: !!state.ok,
    toolName,
    reason: state.reason || '',
    unlimited: !!state.unlimited,
    used: state.used ?? null,
    limit: state.limit ?? policy?.limit ?? null,
    remaining: state.remaining ?? null,
    resetAt: state.resetAt ?? null,
    requested: state.requested ?? null,
    sessionIdleSeconds: state.sessionIdleSeconds ?? policy?.sessionIdleSeconds ?? null,
    message: quotaMessage(toolName, policy, state),
    policy: policy ? {
      freeMode: policy.freeMode,
      premiumMode: policy.premiumMode,
      chargeOn: policy.chargeOn,
      migrationState: policy.migrationState,
      limit: policy.limit ?? null,
      windowSeconds: policy.windowSeconds ?? null,
      sessionIdleSeconds: policy.sessionIdleSeconds ?? null,
      unit: policy.unit ?? null,
      window: policy.window ?? null,
    } : null,
  };
}

async function authorizeFreePreflight(user, toolName, env, request, body) {
  if (isFreePreflightUnmetered(toolName)) {
    return { ok: true, unmetered: true, preflightConsumed: false };
  }

  if (isServerManagedMeteredTool(toolName)) {
    const state = await checkToolQuotaAvailability(user, toolName, env, quotaOptions(request, body));
    return { ...state, preflightConsumed: false };
  }

  const usageDate = todayKey();
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO tool_usage (user_id, tool_name, usage_date, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(user.id, toolName, usageDate, nowSec).run();
    if ((inserted?.meta?.changes || 0) > 0) return { ok: true, preflightConsumed: true };
    return { ok: false, reason: 'quota' };
  } catch (_) {
    const cache = caches.default;
    const cacheUrl = `https://tool-usage.invalid/${encodeURIComponent(`${user.id}:${toolName}:${usageDate}`)}`;
    try {
      const hit = await cache.match(cacheUrl);
      if (hit) return { ok: false, reason: 'quota' };
      await cache.put(
        cacheUrl,
        new Response('1', { headers: { 'cache-control': 'public, max-age=86400' } })
      );
      return { ok: true, preflightConsumed: true };
    } catch {
      return { ok: false, reason: 'quota' };
    }
  }
}

export async function handleToolPreflight(request, env) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'method_not_allowed', message: 'Use POST' },
      { status: 405, headers: { 'cache-control': 'no-store' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'invalid_json', message: 'Invalid request body' },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  if (body?.action === 'secure_export_html') {
    return handleSecureExportHtmlAction(request, env, body);
  }

  const toolName = String(body?.toolName || '').trim();
  if (!isToolPublic(toolName)) {
    return Response.json(
      { error: 'unknown_tool', message: 'Tool is not allowed' },
      { status: 403, headers: { 'cache-control': 'no-store' } }
    );
  }

  const user = await getUserFromRequest(request, env);
  if (!user) {
    return Response.json(
      { error: 'login_required', message: 'Login is required for this tool' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  const policy = getToolPolicy(toolName);
  const action = String(body?.action || 'preflight').trim().toLowerCase();

  if (action === 'check' || action === 'consume') {
    if (!isServerManagedMeteredTool(toolName)) {
      return Response.json(
        { error: 'unsupported_policy_action', message: 'This tool is not server-metered yet' },
        { status: 400, headers: { 'cache-control': 'no-store' } }
      );
    }

    let state;
    try {
      state = action === 'consume'
        ? await consumeToolQuota(user, toolName, env, {
            ...quotaOptions(request, body),
            idempotencyKey: body?.idempotencyKey || body?.idempotency_key || '',
          })
        : await checkToolQuotaAvailability(user, toolName, env, quotaOptions(request, body));
    } catch (_) {
      return Response.json(
        { error: 'quota_unavailable', message: 'Quota service is temporarily unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }

    const payload = serverQuotaPayload(toolName, policy, state);
    if (!state.ok) {
      return Response.json(
        { error: state.reason === 'quota' ? 'quota_exceeded' : (state.reason || 'quota_error'), ...payload },
        { status: state.reason === 'quota' ? 429 : 400, headers: { 'cache-control': 'no-store' } }
      );
    }
    return Response.json(payload, { headers: { 'cache-control': 'no-store' } });
  }

  if (action !== 'preflight') {
    return Response.json(
      { error: 'unknown_action', message: 'Use preflight, check or consume' },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  let usage = { ok: true };
  if (!user.paid && !user.is_admin) {
    try {
      usage = await authorizeFreePreflight(user, toolName, env, request, body);
    } catch (_) {
      return Response.json(
        { error: 'quota_unavailable', message: 'Quota service is temporarily unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }
    if (!usage.ok) {
      const payload = serverQuotaPayload(toolName, policy, usage);
      return Response.json(
        {
          error: 'quota_exceeded',
          ...payload,
          message: isServerManagedMeteredTool(toolName)
            ? payload.message
            : 'Free accounts can use this legacy tool once per day',
        },
        { status: 429, headers: { 'cache-control': 'no-store' } }
      );
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signToolToken({
    tool: toolName,
    iat: nowSec,
    exp: nowSec + TOOL_TOKEN_TTL_SEC,
    paid: !!user?.paid,
    email: user?.email || null,
    jti: crypto.randomUUID(),
  }, env.SESSION_SECRET);

  return Response.json({
    ok: true,
    toolName,
    token,
    expiresAt: (nowSec + TOOL_TOKEN_TTL_SEC) * 1000,
    unmetered: !user?.paid && isFreePreflightUnmetered(toolName),
    preflightConsumed: !!usage?.preflightConsumed,
    remaining: usage?.remaining ?? null,
    resetAt: usage?.resetAt ?? null,
    policy: policy ? {
      freeMode: policy.freeMode,
      premiumMode: policy.premiumMode,
      chargeOn: policy.chargeOn,
      migrationState: policy.migrationState,
      limit: policy.limit ?? null,
      windowSeconds: policy.windowSeconds ?? null,
      sessionIdleSeconds: policy.sessionIdleSeconds ?? null,
      unit: policy.unit ?? null,
      window: policy.window ?? null,
    } : null,
  }, {
    headers: { 'cache-control': 'no-store' },
  });
}
