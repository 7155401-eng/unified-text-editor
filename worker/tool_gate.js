import { getUserFromRequest } from './session.js';
import { addServerWatermarksToHtml } from '../server/secure_export_html.js';
import { getToolPolicy, isFreePreflightUnmetered, isServerManagedMeteredTool, isToolPublic } from './tool_policy.js';
import { checkToolQuotaAvailability, consumeToolUse } from './tool_quota.js';

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

async function authorizeFreePreflight(user, toolName, env) {
  if (isFreePreflightUnmetered(toolName)) {
    return { ok: true, unmetered: true, preflightConsumed: false };
  }

  if (isServerManagedMeteredTool(toolName)) {
    const state = await checkToolQuotaAvailability(user, toolName, env);
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
    // If the D1 migration is not deployed yet, still enforce on the server
    // with Cloudflare's edge cache instead of trusting browser storage.
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

  if (body?.action === 'consume_use' || body?.action === 'consume_success') {
    const toolName = String(body?.toolName || '').trim();
    if (!isToolPublic(toolName) || !isServerManagedMeteredTool(toolName)) {
      return Response.json(
        { error: 'unsupported_success_metering', message: 'Tool does not use server success metering' },
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

    let usage;
    try {
      usage = await consumeToolUse(user, toolName, env, {
        units: Math.max(1, Number(body?.units) || 1),
        idempotencyKey: body?.idempotencyKey,
      });
    } catch (_) {
      return Response.json(
        { error: 'quota_unavailable', message: 'Quota service is temporarily unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }

    if (!usage.ok) {
      const policy = getToolPolicy(toolName);
      return Response.json(
        {
          error: 'quota_exceeded',
          message: 'Free quota is currently exhausted for this tool',
          resetAt: usage.resetAt ?? null,
          remaining: usage.remaining ?? 0,
          limit: usage.limit ?? policy?.limit ?? null,
          windowSeconds: policy?.windowSeconds ?? null,
        },
        { status: 429, headers: { 'cache-control': 'no-store' } }
      );
    }

    return Response.json({
      ok: true,
      toolName,
      unlimited: !!usage.unlimited,
      idempotent: !!usage.idempotent,
      remaining: usage.remaining ?? null,
      resetAt: usage.resetAt ?? null,
    }, { headers: { 'cache-control': 'no-store' } });
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

  if (!user.paid) {
    let usage;
    try {
      usage = await authorizeFreePreflight(user, toolName, env);
    } catch (error) {
      return Response.json(
        { error: 'quota_unavailable', message: 'Quota service is temporarily unavailable' },
        { status: 503, headers: { 'cache-control': 'no-store' } }
      );
    }
    if (!usage.ok) {
      return Response.json(
        {
          error: 'quota_exceeded',
          message: isServerManagedMeteredTool(toolName)
            ? 'Free quota is currently exhausted for this tool'
            : 'Free accounts can use each tool once per day',
          resetAt: usage.resetAt ?? null,
          remaining: usage.remaining ?? 0,
          limit: usage.limit ?? policy?.limit ?? null,
          windowSeconds: policy?.windowSeconds ?? null,
        },
        { status: 429, headers: { 'cache-control': 'no-store' } }
      );
    }
    body.__usage = usage;
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
    preflightConsumed: !!body?.__usage?.preflightConsumed,
    remaining: body?.__usage?.remaining ?? null,
    resetAt: body?.__usage?.resetAt ?? null,
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
