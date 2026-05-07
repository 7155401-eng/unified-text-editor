// משה 2026-05-07: Google OAuth flow. /api/auth/login → גוגל → /api/auth/callback → עוגייה + redirect הביתה.
// משתמש שאימייל שלו לא רשום ב-DB → redirect ל-/?login=denied (האתר נשאר במצב דמו).

import { buildSessionCookie, buildClearCookie } from './session.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export async function handleAuth(request, env, url) {
  if (url.pathname === '/api/auth/login') {
    return startLogin(env, url);
  }
  if (url.pathname === '/api/auth/callback') {
    return handleCallback(request, env, url);
  }
  if (url.pathname === '/api/auth/logout') {
    return logout(url);
  }
  return new Response('Not found', { status: 404 });
}

function startLogin(env, url) {
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response('Google OAuth not configured yet', { status: 503 });
  }
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    access_type: 'online',
    prompt: 'select_account',
  });
  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

async function handleCallback(request, env, url) {
  const code = url.searchParams.get('code');
  if (!code) {
    return Response.redirect(`${url.origin}/?login=cancelled`, 302);
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response('Google OAuth not configured yet', { status: 503 });
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    return Response.redirect(`${url.origin}/?login=token_error`, 302);
  }
  const { access_token } = await tokenRes.json();
  if (!access_token) {
    return Response.redirect(`${url.origin}/?login=no_token`, 302);
  }

  const infoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!infoRes.ok) {
    return Response.redirect(`${url.origin}/?login=info_error`, 302);
  }
  const info = await infoRes.json();
  const email = (info.email || '').toLowerCase().trim();
  if (!email || info.email_verified === false) {
    return Response.redirect(`${url.origin}/?login=no_email`, 302);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT id, email, status, expires_at FROM users WHERE email = ?'
  ).bind(email).first();

  if (!row) {
    return Response.redirect(`${url.origin}/?login=denied`, 302);
  }
  if (row.status !== 'active') {
    return Response.redirect(`${url.origin}/?login=disabled`, 302);
  }
  if (row.expires_at && row.expires_at < nowSec) {
    return Response.redirect(`${url.origin}/?login=expired`, 302);
  }

  await env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowSec, row.id).run();

  const cookie = await buildSessionCookie(email, env);
  return new Response(null, {
    status: 302,
    headers: {
      'set-cookie': cookie,
      location: `${url.origin}/`,
    },
  });
}

function logout(url) {
  return new Response(null, {
    status: 302,
    headers: {
      'set-cookie': buildClearCookie(),
      location: `${url.origin}/`,
    },
  });
}
