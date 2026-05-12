import { getUserFromRequest } from './session.js';

const TOOL_TOKEN_TTL_SEC = 120;

const PUBLIC_TOOLS = new Set([
  'nikud-merger',
  'word-extractor',
  'text-compare-pro',
  'comparator-tool',
  'sefaria-downloader',
  'sefaria-live',
  'torah-transcription',
  'torah-nikud',
  'haredi-caricature',
  'css-ai',
  'torah-tools',
]);

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

async function consumeFreeUse(user, toolName, env) {
  const usageDate = todayKey();
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO tool_usage (user_id, tool_name, usage_date, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(user.id, toolName, usageDate, nowSec).run();
    if ((inserted?.meta?.changes || 0) > 0) return { ok: true };
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
      return { ok: true };
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

  const toolName = String(body?.toolName || '').trim();
  if (!PUBLIC_TOOLS.has(toolName)) {
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

  if (!user.paid) {
    const usage = await consumeFreeUse(user, toolName, env);
    if (!usage.ok) {
      return Response.json(
        { error: 'quota_exceeded', message: 'Free accounts can use each tool once per day' },
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
  }, {
    headers: { 'cache-control': 'no-store' },
  });
}
