// משה 2026-05-07: HMAC-signed session cookie. payload = base64(JSON), signature = base64(HMAC-SHA256).
// בלי תלות ב-DB לקריאת זהות (מהיר). DB נבדק שוב לוודא שהמנוי עדיין פעיל.

const COOKIE_NAME = 'ravtext_session';
const COOKIE_TTL_SEC = 7 * 24 * 60 * 60;

function b64urlEncode(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - str.length % 4) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function sign(payloadObj, secret) {
  const json = JSON.stringify(payloadObj);
  const dataBytes = new TextEncoder().encode(json);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, dataBytes);
  return `${b64urlEncode(dataBytes)}.${b64urlEncode(sig)}`;
}

async function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const dataBytes = b64urlDecode(parts[0]);
  const sigBytes = b64urlDecode(parts[1]);
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, dataBytes);
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(dataBytes));
  } catch {
    return null;
  }
}

function parseCookieHeader(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export async function getUserFromRequest(request, env) {
  const token = parseCookieHeader(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return null;
  const payload = await verify(token, env.SESSION_SECRET);
  if (!payload || !payload.email) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec) return null;

  const row = await env.DB.prepare(
    'SELECT id, email, status, expires_at, is_admin FROM users WHERE email = ?'
  ).bind(payload.email).first();
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.expires_at && row.expires_at < nowSec) return null;
  return row;
}

export async function buildSessionCookie(email, env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = { email, iat: nowSec, exp: nowSec + COOKIE_TTL_SEC };
  const token = await sign(payload, env.SESSION_SECRET);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_TTL_SEC}`;
}

export function buildClearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
