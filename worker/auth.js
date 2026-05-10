// צוות האתר 2026-05-07: Google OAuth flow. /api/auth/login → גוגל → /api/auth/callback → עוגייה + redirect הביתה.
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
  // Preserve the post-login destination via the OAuth `state` parameter so the
  // callback knows where to send the user (e.g., back to the premium overlay).
  const next = url.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    access_type: 'online',
    prompt: 'select_account',
    state: safeNext,
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
  // משה 2026-05-10: שומרים שם פרטי + משפחה מ-Google userinfo כדי לשלוח אותם
  // ליעד שריג כ-ClientName/ClientLName. בלי זה יעד שריג דוחים עם שגיאה 401.
  const firstName = String(info.given_name || '').trim().slice(0, 50);
  const lastName = String(info.family_name || '').trim().slice(0, 50);

  const nowSec = Math.floor(Date.now() / 1000);
  let row = await env.DB.prepare(
    'SELECT id, email, status, expires_at FROM users WHERE email = ?'
  ).bind(email).first();

  // צוות האתר 2026-05-07: דרישה — כל משתמש גוגל מאומת מתחבר. רק הסטטוס ב-DB
  // קובע אם הוא משלם (active) או דמו (unauthorized). צוות האתר רואה את המייל ב-DB,
  // יכול לשדרג סטטוס, ובכניסה הבאה המשתמש מקבל פרמיום אוטומטית.
  // הטקסטים וההגדרות שלו (טבלאות נפרדות בעתיד) קשורים למייל ולכן נשמרים בין כניסות.
  if (!row) {
    await env.DB.prepare(
      'INSERT INTO users (email, status, expires_at, is_admin, first_name, last_name) VALUES (?, ?, 0, 0, ?, ?)'
    ).bind(email, 'unauthorized', firstName || null, lastName || null).run();
    row = await env.DB.prepare(
      'SELECT id, email, status, expires_at FROM users WHERE email = ?'
    ).bind(email).first();
  }

  // משה 2026-05-10: עדכון שם בכל כניסה (מקרים: משתמש קיים שמיגרציה הוסיפה לו עמודות
  // ריקות, או שינוי שם בגוגל). לא דורסים אם אין שם חדש.
  await env.DB.prepare(
    'UPDATE users SET last_login_at = ?, first_name = COALESCE(NULLIF(?, \'\'), first_name), last_name = COALESCE(NULLIF(?, \'\'), last_name) WHERE id = ?'
  ).bind(nowSec, firstName, lastName, row.id).run();

  // עוגייה ניתנת תמיד. paid/demo נקבע בכל בקשה לפי status ב-DB.
  const cookie = await buildSessionCookie(email, env);
  const isPaid = row.status === 'active' && (!row.expires_at || row.expires_at >= nowSec);
  const stateNext = url.searchParams.get('state');
  const safeNext = stateNext && stateNext.startsWith('/') && !stateNext.startsWith('//') ? stateNext : null;
  const dest = safeNext || (isPaid ? '/' : '/?login=demo');
  return new Response(null, {
    status: 302,
    headers: {
      'set-cookie': cookie,
      location: `${url.origin}${dest}`,
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
