// צוות האתר 2026-05-07: Admin API. רק משתמשים עם is_admin=1 יכולים לקרוא לאלה.
// כל בקשה מאומתת תחילה דרך getUserFromRequest; בלי הרשאת admin → 403.

import { getUserFromRequest } from './session.js';

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: 'Not logged in', status: 401 };
  if (!user.is_admin) return { error: 'Forbidden', status: 403 };
  return { user };
}

export async function handleAdmin(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  const path = url.pathname;
  const method = request.method;

  if (path === '/api/admin/users' && method === 'GET') {
    return listUsers(request, env, url);
  }
  if (path === '/api/admin/users' && method === 'POST') {
    return createUser(request, env);
  }
  if (path.startsWith('/api/admin/users/') && method === 'PATCH') {
    const id = path.split('/').pop();
    return updateUser(request, env, Number(id));
  }
  if (path.startsWith('/api/admin/users/') && method === 'DELETE') {
    const id = path.split('/').pop();
    return deleteUser(request, env, Number(id), auth.user.id);
  }
  if (path === '/api/admin/stats' && method === 'GET') {
    return getStats(request, env);
  }
  return new Response('Not found', { status: 404 });
}

async function listUsers(request, env, url) {
  const params = url.searchParams;
  const search = (params.get('search') || '').trim().toLowerCase();
  const status = params.get('status');
  const sort = params.get('sort') || 'created_desc';
  const limit = Math.max(1, Math.min(500, Number(params.get('limit')) || 100));
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  const where = [];
  const binds = [];
  if (search) {
    where.push('email LIKE ?');
    binds.push(`%${search}%`);
  }
  if (status) {
    where.push('status = ?');
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const orderMap = {
    created_desc: 'ORDER BY id DESC',
    created_asc: 'ORDER BY id ASC',
    email_asc: 'ORDER BY email ASC',
    email_desc: 'ORDER BY email DESC',
    last_login_desc: 'ORDER BY last_login_at DESC NULLS LAST',
    expires_asc: 'ORDER BY expires_at ASC',
  };
  const orderSql = orderMap[sort] || orderMap.created_desc;

  const countQ = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM users ${whereSql}`
  ).bind(...binds).first();
  const totalCount = countQ?.c || 0;

  const rows = await env.DB.prepare(
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin
     FROM users ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  return Response.json({
    users: rows.results,
    totalCount,
    limit,
    offset,
  }, { headers: { 'cache-control': 'no-store' } });
}

async function createUser(request, env) {
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const email = String(body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return new Response('Bad email', { status: 400 });

  const status = String(body?.status || 'active');
  const expires_at = Number(body?.expires_at) || 0;
  const is_admin = body?.is_admin ? 1 : 0;

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Already exists', id: existing.id }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  const ins = await env.DB.prepare(
    'INSERT INTO users (email, status, expires_at, is_admin) VALUES (?, ?, ?, ?)'
  ).bind(email, status, expires_at, is_admin).run();

  return Response.json({ id: ins.meta.last_row_id, email, status, expires_at, is_admin });
}

async function updateUser(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response('Bad id', { status: 400 });
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const sets = [];
  const binds = [];
  if (typeof body?.status === 'string') {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (Number.isFinite(Number(body?.expires_at))) {
    sets.push('expires_at = ?');
    binds.push(Number(body.expires_at));
  }
  if (typeof body?.is_admin === 'boolean' || typeof body?.is_admin === 'number') {
    sets.push('is_admin = ?');
    binds.push(body.is_admin ? 1 : 0);
  }
  if (sets.length === 0) return new Response('No fields', { status: 400 });

  binds.push(id);
  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

  const row = await env.DB.prepare(
    'SELECT id, email, status, expires_at, created_at, last_login_at, is_admin FROM users WHERE id = ?'
  ).bind(id).first();

  return Response.json(row || { error: 'Not found' });
}

async function deleteUser(request, env, id, currentAdminId) {
  if (!Number.isFinite(id) || id <= 0) return new Response('Bad id', { status: 400 });
  if (id === currentAdminId) {
    return new Response(JSON.stringify({ error: "Can't delete yourself" }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  return Response.json({ deleted: id });
}

async function getStats(request, env) {
  const total = (await env.DB.prepare('SELECT COUNT(*) as c FROM users').first())?.c || 0;
  const active = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'active'`).first())?.c || 0;
  const unauthorized = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'unauthorized'`).first())?.c || 0;
  const disabled = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'disabled'`).first())?.c || 0;
  const admins = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE is_admin = 1`).first())?.c || 0;

  const dayAgo = Math.floor(Date.now() / 1000) - 86400;
  const weekAgo = Math.floor(Date.now() / 1000) - 86400 * 7;
  const newToday = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ?`).bind(dayAgo).first())?.c || 0;
  const newThisWeek = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ?`).bind(weekAgo).first())?.c || 0;
  const activeThisWeek = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE last_login_at >= ?`).bind(weekAgo).first())?.c || 0;

  const expiringSoon = (await env.DB.prepare(
    `SELECT COUNT(*) as c FROM users WHERE status='active' AND expires_at > 0 AND expires_at < ?`
  ).bind(Math.floor(Date.now() / 1000) + 86400 * 30).first())?.c || 0;

  return Response.json({
    total, active, unauthorized, disabled, admins,
    newToday, newThisWeek, activeThisWeek, expiringSoon,
  }, { headers: { 'cache-control': 'no-store' } });
}
