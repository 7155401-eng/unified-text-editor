// צוות האתר 2026-05-07: API שמירה/טעינה של תכולת המשתמש.
// משתמשים מחוברים בלבד (כל סטטוס — paid או unauthorized).
// אנונימיים → 401, נשארים אפמריים.
// מגבלות גודל: מסמך 1MB, settings 100KB. כל בקשה מאומתת.

import { getUserFromRequest } from './session.js';

const MAX_DOC_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 100 * 1024;

async function requireUser(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: 'Not logged in', status: 401 };
  return { user };
}

export async function handleStorage(request, env, url) {
  const auth = await requireUser(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  const path = url.pathname;
  const method = request.method;

  if (path === '/api/documents/current' && method === 'GET') {
    return getCurrent(env, auth.user);
  }
  if (path === '/api/documents/current' && method === 'PUT') {
    return putCurrent(request, env, auth.user);
  }
  if (path === '/api/settings' && method === 'GET') {
    return getSettings(env, auth.user);
  }
  if (path === '/api/settings' && method === 'PUT') {
    return putSettings(request, env, auth.user);
  }
  return new Response('Not found', { status: 404 });
}

async function getCurrent(env, user) {
  const row = await env.DB.prepare(
    `SELECT id, title, content_json, size_bytes, updated_at
     FROM documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (!row) {
    return Response.json({ document: null }, { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({
    document: {
      id: row.id,
      title: row.title,
      content: JSON.parse(row.content_json),
      sizeBytes: row.size_bytes,
      updatedAt: row.updated_at,
    },
  }, { headers: { 'cache-control': 'no-store' } });
}

async function putCurrent(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const content = body?.content;
  if (content == null) return new Response('Missing content', { status: 400 });

  const json = JSON.stringify(content);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > MAX_DOC_BYTES) {
    return new Response(`Document too large: ${bytes} > ${MAX_DOC_BYTES}`, { status: 413 });
  }

  const title = String(body?.title || '').slice(0, 200);
  const now = Math.floor(Date.now() / 1000);

  // upsert: keep one "current" document per user (the most recently updated)
  const existing = await env.DB.prepare(
    `SELECT id FROM documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(user.id).first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE documents SET title = ?, content_json = ?, size_bytes = ?, updated_at = ? WHERE id = ?`
    ).bind(title, json, bytes, now, existing.id).run();
    return Response.json({ id: existing.id, sizeBytes: bytes, updatedAt: now });
  } else {
    const ins = await env.DB.prepare(
      `INSERT INTO documents (user_id, title, content_json, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(user.id, title, json, bytes, now, now).run();
    return Response.json({ id: ins.meta.last_row_id, sizeBytes: bytes, updatedAt: now });
  }
}

async function getSettings(env, user) {
  const row = await env.DB.prepare(
    `SELECT settings_json, size_bytes, updated_at FROM user_settings WHERE user_id = ?`
  ).bind(user.id).first();

  if (!row) {
    return Response.json({ settings: {} }, { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({
    settings: JSON.parse(row.settings_json),
    sizeBytes: row.size_bytes,
    updatedAt: row.updated_at,
  }, { headers: { 'cache-control': 'no-store' } });
}

async function putSettings(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const settings = body?.settings;
  if (settings == null || typeof settings !== 'object') {
    return new Response('Missing settings object', { status: 400 });
  }

  const json = JSON.stringify(settings);
  const bytes = new TextEncoder().encode(json).byteLength;
  if (bytes > MAX_SETTINGS_BYTES) {
    return new Response(`Settings too large: ${bytes} > ${MAX_SETTINGS_BYTES}`, { status: 413 });
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, settings_json, size_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       settings_json = excluded.settings_json,
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at`
  ).bind(user.id, json, bytes, now).run();

  return Response.json({ sizeBytes: bytes, updatedAt: now });
}
