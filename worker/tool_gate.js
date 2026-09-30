import { getUserFromRequest } from './session.js';
import { addServerWatermarksToHtml } from '../server/secure_export_html.js';
import {
  checkToolQuota,
  consumeToolQuota,
  getToolPolicy,
  isKnownTool,
} from './tool_quota_policy.js';

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

function quotaStatus(result) {
  if (result?.reason === 'in_progress') return 409;
  if (result?.reason === 'quota') return 429;
  if (result?.reason === 'unknown_tool') return 403;
  return 500;
}

function blockedQuotaResponse(result) {
  return Response.json({
    error: result?.reason === 'quota' ? 'quota_exceeded' : (result?.reason || 'quota_error'),
    message: result?.message || 'Tool quota is not available',
    ...result,
  }, {
    status: quotaStatus(result),
    headers: { 'cache-control': 'no-store' },
  });
}

function requestAmount(body) {
  const n = Number(body?.amount ?? body?.units ?? 1);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function offsetForTimeZone(timeZone) {
  const tz = String(timeZone || "").trim();
  if (!tz) return null;
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value || "";
    const m = part.match(/^GMT(?:(\+|-)(\d{1,2})(?::?(\d{2}))?)?$/i);
    if (!m) return null;
    if (!m[1]) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * ((Number(m[2]) || 0) * 60 + (Number(m[3]) || 0));
  } catch (_) {
    return null;
  }
}

function requestTimezoneOffset(request, body) {
  // Cloudflare supplies an IANA timezone from the request location. Prefer it
  // over client input so a free user cannot reset a daily quota by spoofing
  // Date.getTimezoneOffset(). Fallback keeps local/dev environments working.
  const serverOffset = offsetForTimeZone(request?.cf?.timezone);
  if (Number.isFinite(serverOffset)) return serverOffset;
  const n = Number(body?.timeZoneOffsetMinutes ?? body?.timezoneOffsetMinutes ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
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
  if (!isKnownTool(toolName)) {
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

  const action = String(body?.action || 'preflight').trim().toLowerCase();
  const amount = requestAmount(body);
  const timezoneOffsetMinutes = requestTimezoneOffset(request, body);
  const common = {
    env,
    user,
    toolName,
    amount,
    timezoneOffsetMinutes,
  };

  if (action === 'consume') {
    const result = await consumeToolQuota({
      ...common,
      idempotencyKey: body?.idempotencyKey || '',
    });
    if (!result?.ok) return blockedQuotaResponse(result);
    return Response.json(result, { headers: { 'cache-control': 'no-store' } });
  }

  if (action !== 'preflight' && action !== 'check') {
    return Response.json(
      { error: 'unknown_action', message: 'Use preflight, check or consume' },
      { status: 400, headers: { 'cache-control': 'no-store' } }
    );
  }

  let quota = await checkToolQuota(common);
  if (!quota?.ok) return blockedQuotaResponse(quota);

  const policy = getToolPolicy(toolName);

  // Only policies explicitly marked "preflight" retain the old web behavior
  // of charging on open. Desktop-parity tools charge at success/activity.
  if (action === 'preflight' && policy?.chargeOn === 'preflight' && !user.paid && !user.is_admin) {
    quota = await consumeToolQuota({
      ...common,
      idempotencyKey: body?.idempotencyKey || '',
    });
    if (!quota?.ok) return blockedQuotaResponse(quota);
  }

  if (action === 'check') {
    return Response.json(quota, { headers: { 'cache-control': 'no-store' } });
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = await signToolToken({
    tool: toolName,
    iat: nowSec,
    exp: nowSec + TOOL_TOKEN_TTL_SEC,
    paid: !!user?.paid,
    email: user?.email || null,
    quotaMode: policy?.mode || null,
    chargeOn: policy?.chargeOn || null,
    jti: crypto.randomUUID(),
  }, env.SESSION_SECRET);

  return Response.json({
    ...quota,
    ok: true,
    toolName,
    token,
    expiresAt: (nowSec + TOOL_TOKEN_TTL_SEC) * 1000,
  }, {
    headers: { 'cache-control': 'no-store' },
  });
}
