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
