// משה 2026-05-09: תיבת ניהול — דיווחי באגים/עדכונים, פניות, לוג שימושים.
// נתיבים פומביים (דורשים login) — הגשת דיווח/פנייה/אירוע שימוש.
// נתיבי מנהל — הצגה, עריכה, מחיקה, סינון.

import { getUserFromRequest } from './session.js';

const ALLOWED_STATUSES_BUILTIN = new Set(['new', 'planning', 'in_dev', 'done']);
const MAX_TITLE = 200;
const MAX_BODY = 5000;
const MAX_NOTE = 5000;
const MAX_DETAIL = 1000;
const MAX_TAG = 60;
const MAIL_RELAY_DELIVER_URL = 'https://shchiche.com/wp-json/ravtext-mail/v1/deliver';
const MAIL_RELAY_TOKEN_TTL_SEC = 5 * 60;
const MAIL_RETRY_MAX_DELAY_SEC = 60 * 60;

function jsonRes(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers || {}) },
  });
}

function bad(msg, status = 400) { return jsonRes({ error: msg }, { status }); }

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n) : s;
}

function sanitizeStatus(s) {
  s = String(s == null ? 'new' : s).trim();
  if (!s) return 'new';
  if (ALLOWED_STATUSES_BUILTIN.has(s)) return s;
  // תיוג מותאם אישית — מותר עד MAX_TAG, רק תווים סבירים.
  return clip(s.replace(/[\u0000-\u001F\u007F]/g, ''), MAX_TAG);
}

async function requireLogin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: bad('Not logged in', 401) };
  return { user };
}

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: bad('Not logged in', 401) };
  if (!user.is_admin) return { error: bad('Forbidden', 403) };
  return { user };
}

async function ensureMailRelaySchema(env) {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS mail_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      user_email TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      relay_token TEXT,
      relay_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      next_attempt_at INTEGER NOT NULL DEFAULT 0,
      UNIQUE(kind, source_id)
    )
  `).run();
  await env.DB.prepare(
    'CREATE INDEX IF NOT EXISTS idx_mail_notifications_pending ON mail_notifications(status, next_attempt_at, id)'
  ).run();
}

function randomRelayToken() {
  try {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  } catch (_) {
    return `${crypto.randomUUID?.() || Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

async function queueMailNotification(env, { kind, sourceId, userEmail, subject, body }) {
  await ensureMailRelaySchema(env);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT OR IGNORE INTO mail_notifications
      (kind, source_id, user_email, subject, body, status, attempts, created_at, next_attempt_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).bind(
    clip(kind, 40),
    Number(sourceId),
    clip(userEmail || '', 320),
    clip(subject, 300),
    clip(body, 12000),
    now,
    now,
  ).run();
  return env.DB.prepare(
    'SELECT id, status FROM mail_notifications WHERE kind = ? AND source_id = ?'
  ).bind(clip(kind, 40), Number(sourceId)).first();
}

async function markMailAttemptFailed(env, row, errorText) {
  const attempts = Math.max(0, Number(row?.attempts) || 0) + 1;
  const delay = Math.min(MAIL_RETRY_MAX_DELAY_SEC, 60 * Math.pow(2, Math.min(attempts - 1, 6)));
  const nextAttempt = Math.floor(Date.now() / 1000) + delay;
  await env.DB.prepare(`
    UPDATE mail_notifications
    SET attempts = ?, last_error = ?, next_attempt_at = ?, relay_token = NULL, relay_expires_at = NULL
    WHERE id = ? AND status = 'pending'
  `).bind(attempts, clip(errorText || 'mail_relay_failed', 1000), nextAttempt, row.id).run();
}

async function deliverMailNotification(env, notificationId) {
  await ensureMailRelaySchema(env);
  const row = await env.DB.prepare(`
    SELECT id, kind, source_id, user_email, subject, body, status, attempts, created_at
    FROM mail_notifications WHERE id = ?
  `).bind(Number(notificationId)).first();
  if (!row || row.status === 'sent') return !!row;

  const token = randomRelayToken();
  const expires = Math.floor(Date.now() / 1000) + MAIL_RELAY_TOKEN_TTL_SEC;
  await env.DB.prepare(`
    UPDATE mail_notifications
    SET relay_token = ?, relay_expires_at = ?
    WHERE id = ? AND status = 'pending'
  `).bind(token, expires, row.id).run();

  let response;
  try {
    response = await fetch(MAIL_RELAY_DELIVER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body: JSON.stringify({ id: row.id, token }),
    });
  } catch (error) {
    await markMailAttemptFailed(env, row, error?.message || String(error));
    return false;
  }

  let data = null;
  let responseText = '';
  try {
    responseText = await response.text();
    data = JSON.parse(responseText || '{}');
  } catch (_) {}

  if (!response.ok || data?.sent !== true) {
    const detail = data?.error || data?.message || responseText || `HTTP ${response.status}`;
    await markMailAttemptFailed(env, row, detail);
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    UPDATE mail_notifications
    SET status = 'sent', sent_at = ?, attempts = attempts + 1, last_error = NULL,
        relay_token = NULL, relay_expires_at = NULL
    WHERE id = ?
  `).bind(now, row.id).run();
  return true;
}

export async function deliverPendingMailNotifications(env, limit = 20) {
  await ensureMailRelaySchema(env);
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(`
    SELECT id
    FROM mail_notifications
    WHERE status = 'pending' AND COALESCE(next_attempt_at, 0) <= ?
    ORDER BY id ASC
    LIMIT ?
  `).bind(now, Math.max(1, Math.min(100, Number(limit) || 20))).all();

  let sent = 0;
  for (const row of rows.results || []) {
    if (await deliverMailNotification(env, row.id).catch(() => false)) sent += 1;
  }
  return { checked: (rows.results || []).length, sent };
}

export async function handleMailRelayPull(request, env, url) {
  if (request.method !== 'GET') return bad('method_not_allowed', 405);
  await ensureMailRelaySchema(env);
  const id = Number(url.searchParams.get('id'));
  const token = String(url.searchParams.get('token') || '');
  if (!Number.isFinite(id) || id <= 0 || token.length < 24 || token.length > 160) {
    return bad('invalid_relay_token', 400);
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    SELECT id, kind, source_id, user_email, subject, body, created_at
    FROM mail_notifications
    WHERE id = ? AND status = 'pending' AND relay_token = ? AND relay_expires_at >= ?
  `).bind(id, token, now).first();
  if (!row) return bad('relay_token_not_found_or_expired', 404);

  return jsonRes({
    ok: true,
    notification: {
      id: row.id,
      kind: row.kind,
      sourceId: row.source_id,
      userEmail: row.user_email || '',
      subject: row.subject,
      body: row.body,
      createdAt: row.created_at,
    },
  });
}

function mailBody({ kindLabel, id, userEmail, title = '', text }) {
  const lines = [
    'פנייה חדשה התקבלה דרך app.ravtext.com',
    '',
    `סוג: ${kindLabel}`,
    `מזהה במערכת: #${id}`,
    `מאת: ${userEmail || 'לא ידוע'}`,
  ];
  if (title) lines.push(`כותרת: ${title}`);
  lines.push('', 'תוכן הפנייה:', text, '', 'הפנייה נשמרה גם בלוח המנהל של RavText.');
  return lines.join('\n');
}

async function queueAndDeliverUserMail(env, spec) {
  const queued = await queueMailNotification(env, spec);
  if (!queued?.id) return false;
  if (queued.status === 'sent') return true;
  return deliverMailNotification(env, queued.id);
}

// ====== נתיבים פומביים (דורש login) ======

export async function handlePublicInbox(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  // משה 2026-05-10: לוח עדכוני פיתוח — נתון פתוח לכולם, גם בלי התחברות.
  // מציג רק רשומות שהמנהל פרסם (source='admin'). דיווחי משתמשים
  // (source='user') הולכים לתיבת המנהל בלבד ולא מופיעים כאן עד שהמנהל
  // יוצר רשומה משלו על בסיסם.
  // לעולם לא מחזיר admin_note (הערה פרטית למנהל).
  if (path === '/api/bug-reports/public' && method === 'GET') {
    return listPublicBugReports(request, env, url);
  }

  // שאר הנתיבים — דורש login.
  const auth = await requireLogin(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;

  if (path === '/api/bug-reports' && method === 'POST') return submitBugReport(request, env, user);
  if (path === '/api/contact' && method === 'POST') return submitContact(request, env, user);
  // משה 2026-05-10: המשתמש רואה את הפניות שלו עצמו ב"אזור שלו" באפליקציה.
  if (path === '/api/contact/mine' && method === 'GET') return listMyContactMessages(request, env, user);
  if (path === '/api/usage/track' && method === 'POST') return trackUsage(request, env, user);
  return new Response('Not found', { status: 404 });
}

async function listMyContactMessages(request, env, user) {
  const params = new URL(request.url).searchParams;
  const limit = Math.max(1, Math.min(200, Number(params.get('limit')) || 50));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const rows = await env.DB.prepare(
    `SELECT id, body, created_at, read_at
     FROM contact_messages WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE user_id = ?`
  ).bind(user.id).first();
  return jsonRes({
    items: rows.results || [],
    totalCount: totalRow?.c || 0,
    limit,
    offset,
  });
}

async function listPublicBugReports(request, env, url) {
  const params = url.searchParams;
  const limit = Math.max(1, Math.min(500, Number(params.get('limit')) || 200));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  // לא מציגים admin_note — שדה פרטי למנהל בלבד.
  // לא מציגים user_email — פרטיות של מי שדיווח.
  // משה 2026-05-10: רק רשומות שהמנהל פרסם (source='admin'). דיווחי משתמשים
  // לא מופיעים כאן אוטומטית — הם מגיעים לתיבת המנהל בלבד.
  const rows = await env.DB.prepare(
    `SELECT id, source, title, body, status, created_at, updated_at
     FROM bug_reports WHERE source = 'admin' ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM bug_reports WHERE source = 'admin'`
  ).first();
  return jsonRes({
    items: rows.results || [],
    totalCount: totalRow?.c || 0,
    limit,
    offset,
  });
}

async function submitBugReport(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return bad('Bad JSON'); }
  const title = clip(body?.title, MAX_TITLE).trim();
  const text = clip(body?.body, MAX_BODY).trim();
  if (!title || !text) return bad('כותרת ופירוט חובה');
  const meta = body?.meta && typeof body.meta === 'object'
    ? clip(JSON.stringify(body.meta), 2000) : null;
  const now = Math.floor(Date.now() / 1000);
  const ins = await env.DB.prepare(
    `INSERT INTO bug_reports (user_id, user_email, source, title, body, status, meta, created_at, updated_at)
     VALUES (?, ?, 'user', ?, ?, 'new', ?, ?, ?)`
  ).bind(user.id, user.email, title, text, meta, now, now).run();

  // לוג שימוש מקביל
  await env.DB.prepare(
    `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
     VALUES (?, ?, 'bug_submit', ?, ?)`
  ).bind(user.id, user.email, JSON.stringify({ id: ins.meta.last_row_id, title }), now).run().catch(() => {});

  const mailDelivered = await queueAndDeliverUserMail(env, {
    kind: 'bug_report',
    sourceId: ins.meta.last_row_id,
    userEmail: user.email,
    subject: `RavText — דיווח באג חדש — ${title}`,
    body: mailBody({
      kindLabel: 'דיווח באג',
      id: ins.meta.last_row_id,
      userEmail: user.email,
      title,
      text,
    }),
  }).catch(() => false);

  return jsonRes({ ok: true, id: ins.meta.last_row_id, mailDelivered });
}

async function submitContact(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return bad('Bad JSON'); }
  const text = clip(body?.body, MAX_BODY).trim();
  if (!text) return bad('פתק ריק');
  const meta = body?.meta && typeof body.meta === 'object'
    ? clip(JSON.stringify(body.meta), 2000) : null;
  const now = Math.floor(Date.now() / 1000);
  const ins = await env.DB.prepare(
    `INSERT INTO contact_messages (user_id, user_email, body, meta, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, text, meta, now).run();

  await env.DB.prepare(
    `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
     VALUES (?, ?, 'contact_submit', ?, ?)`
  ).bind(user.id, user.email, JSON.stringify({ id: ins.meta.last_row_id }), now).run().catch(() => {});

  const mailDelivered = await queueAndDeliverUserMail(env, {
    kind: 'contact',
    sourceId: ins.meta.last_row_id,
    userEmail: user.email,
    subject: `RavText — פנייה חדשה מהאתר — ${user.email || 'משתמש'}`,
    body: mailBody({
      kindLabel: 'צור קשר',
      id: ins.meta.last_row_id,
      userEmail: user.email,
      text,
    }),
  }).catch(() => false);

  return jsonRes({ ok: true, id: ins.meta.last_row_id, mailDelivered });
}

async function trackUsage(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return bad('Bad JSON'); }
  const event = clip(body?.event, 60).trim();
  if (!event) return bad('event חובה');
  const detail = body?.detail != null
    ? clip(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail), MAX_DETAIL)
    : null;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, event, detail, now).run();
  return jsonRes({ ok: true });
}

// ====== נתיבי מנהל ======

export async function handleAdminInbox(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/admin/bug-reports' && method === 'GET') return listBugReports(request, env, url);
  if (path === '/api/admin/bug-reports' && method === 'POST') return adminCreateBugReport(request, env, auth.user);
  if (path.startsWith('/api/admin/bug-reports/')) {
    const id = Number(path.split('/').pop());
    if (method === 'PATCH') return updateBugReport(request, env, id);
    if (method === 'DELETE') return deleteBugReport(request, env, id);
  }
  if (path === '/api/admin/contact-messages' && method === 'GET') return listContactMessages(request, env, url);
  if (path.startsWith('/api/admin/contact-messages/')) {
    const tail = path.slice('/api/admin/contact-messages/'.length);
    if (tail.endsWith('/read') && method === 'POST') {
      const id = Number(tail.slice(0, -'/read'.length));
      return markContactRead(request, env, id);
    }
    const id = Number(tail);
    if (method === 'DELETE') return deleteContactMessage(request, env, id);
  }
  if (path === '/api/admin/usage' && method === 'GET') return listUsage(request, env, url);
  // משה 2026-05-10: בכרטיס משתמש בפאנל ניהול — כפתור "פניות" שמציג את הפניות שלו.
  const userContactMatch = path.match(/^\/api\/admin\/users\/(\d+)\/contact-messages$/);
  if (userContactMatch && method === 'GET') {
    return listContactMessagesForUser(request, env, Number(userContactMatch[1]));
  }
  return new Response('Not found', { status: 404 });
}

async function listContactMessagesForUser(request, env, userId) {
  if (!Number.isFinite(userId) || userId <= 0) return bad('Bad user id');
  const params = new URL(request.url).searchParams;
  const limit = Math.max(1, Math.min(500, Number(params.get('limit')) || 200));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, body, meta, created_at, read_at
     FROM contact_messages WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE user_id = ?`
  ).bind(userId).first();
  const unreadRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE user_id = ? AND read_at IS NULL`
  ).bind(userId).first();
  return jsonRes({
    items: rows.results || [],
    totalCount: totalRow?.c || 0,
    unreadCount: unreadRow?.c || 0,
    limit,
    offset,
  });
}

async function listBugReports(request, env, url) {
  const params = url.searchParams;
  const search = (params.get('search') || '').trim().toLowerCase();
  const status = (params.get('status') || '').trim();
  const source = (params.get('source') || '').trim();
  const limit = Math.max(1, Math.min(500, Number(params.get('limit')) || 100));
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  const where = [];
  const binds = [];
  if (search) {
    where.push('(LOWER(title) LIKE ? OR LOWER(body) LIKE ? OR LOWER(IFNULL(user_email,\'\')) LIKE ? OR LOWER(IFNULL(admin_note,\'\')) LIKE ?)');
    const q = `%${search}%`;
    binds.push(q, q, q, q);
  }
  if (status) { where.push('status = ?'); binds.push(status); }
  if (source) { where.push('source = ?'); binds.push(source); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM bug_reports ${whereSql}`
  ).bind(...binds).first();
  const totalCount = totalRow?.c || 0;

  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, source, title, body, status, admin_note,
            meta, created_at, updated_at
     FROM bug_reports ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) as c FROM bug_reports GROUP BY status`
  ).all();

  return jsonRes({
    items: rows.results,
    totalCount,
    limit,
    offset,
    counts: (counts.results || []).reduce((m, r) => { m[r.status] = r.c; return m; }, {}),
  });
}

async function adminCreateBugReport(request, env, user) {
  let body;
  try { body = await request.json(); } catch { return bad('Bad JSON'); }
  const title = clip(body?.title, MAX_TITLE).trim();
  const text = clip(body?.body, MAX_BODY).trim();
  if (!title || !text) return bad('כותרת ופירוט חובה');
  const status = sanitizeStatus(body?.status || 'planning');
  const adminNote = body?.admin_note ? clip(body.admin_note, MAX_NOTE) : null;
  const now = Math.floor(Date.now() / 1000);
  const ins = await env.DB.prepare(
    `INSERT INTO bug_reports (user_id, user_email, source, title, body, status, admin_note, created_at, updated_at)
     VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, title, text, status, adminNote, now, now).run();
  return jsonRes({ ok: true, id: ins.meta.last_row_id });
}

async function updateBugReport(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad('Bad id');
  let body;
  try { body = await request.json(); } catch { return bad('Bad JSON'); }
  const sets = [];
  const binds = [];
  if (typeof body?.status === 'string') {
    sets.push('status = ?'); binds.push(sanitizeStatus(body.status));
  }
  if (typeof body?.title === 'string') {
    const t = clip(body.title, MAX_TITLE).trim();
    if (!t) return bad('כותרת ריקה');
    sets.push('title = ?'); binds.push(t);
  }
  if (typeof body?.body === 'string') {
    const t = clip(body.body, MAX_BODY).trim();
    if (!t) return bad('פירוט ריק');
    sets.push('body = ?'); binds.push(t);
  }
  if ('admin_note' in (body || {})) {
    const note = body.admin_note == null ? null : clip(String(body.admin_note), MAX_NOTE);
    sets.push('admin_note = ?'); binds.push(note);
  }
  if (sets.length === 0) return bad('No fields');
  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); binds.push(now);
  binds.push(id);
  await env.DB.prepare(`UPDATE bug_reports SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  const row = await env.DB.prepare(
    `SELECT id, user_id, user_email, source, title, body, status, admin_note, meta, created_at, updated_at
     FROM bug_reports WHERE id = ?`
  ).bind(id).first();
  return jsonRes(row || { error: 'Not found' }, { status: row ? 200 : 404 });
}

async function deleteBugReport(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad('Bad id');
  await env.DB.prepare('DELETE FROM bug_reports WHERE id = ?').bind(id).run();
  return jsonRes({ deleted: id });
}

async function listContactMessages(request, env, url) {
  const params = url.searchParams;
  const search = (params.get('search') || '').trim().toLowerCase();
  const unreadOnly = params.get('unread') === '1';
  const limit = Math.max(1, Math.min(500, Number(params.get('limit')) || 100));
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  const where = [];
  const binds = [];
  if (search) {
    where.push('(LOWER(body) LIKE ? OR LOWER(IFNULL(user_email,\'\')) LIKE ?)');
    const q = `%${search}%`;
    binds.push(q, q);
  }
  if (unreadOnly) where.push('(read_at IS NULL OR read_at = 0)');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages ${whereSql}`
  ).bind(...binds).first();
  const totalCount = totalRow?.c || 0;
  const unreadRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE read_at IS NULL OR read_at = 0`
  ).first();

  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, body, read_at, meta, created_at
     FROM contact_messages ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  return jsonRes({
    items: rows.results,
    totalCount,
    unreadCount: unreadRow?.c || 0,
    limit,
    offset,
  });
}

async function markContactRead(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad('Bad id');
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE contact_messages SET read_at = ? WHERE id = ?').bind(now, id).run();
  return jsonRes({ ok: true, id, read_at: now });
}

async function deleteContactMessage(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad('Bad id');
  await env.DB.prepare('DELETE FROM contact_messages WHERE id = ?').bind(id).run();
  return jsonRes({ deleted: id });
}

async function listUsage(request, env, url) {
  const params = url.searchParams;
  const userId = Number(params.get('user_id')) || 0;
  const event = (params.get('event') || '').trim();
  const search = (params.get('search') || '').trim().toLowerCase();
  const fromTs = Number(params.get('from')) || 0;
  const toTs = Number(params.get('to')) || 0;
  const limit = Math.max(1, Math.min(1000, Number(params.get('limit')) || 200));
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  const where = [];
  const binds = [];
  if (userId > 0) { where.push('user_id = ?'); binds.push(userId); }
  if (event) { where.push('event = ?'); binds.push(event); }
  if (search) {
    where.push('(LOWER(IFNULL(user_email,\'\')) LIKE ? OR LOWER(IFNULL(detail,\'\')) LIKE ?)');
    const q = `%${search}%`;
    binds.push(q, q);
  }
  if (fromTs > 0) { where.push('created_at >= ?'); binds.push(fromTs); }
  if (toTs > 0) { where.push('created_at <= ?'); binds.push(toTs); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM usage_events ${whereSql}`
  ).bind(...binds).first();
  const totalCount = totalRow?.c || 0;

  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, event, detail, created_at
     FROM usage_events ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  // אגרגציה: כמה אירועים לכל סוג ב-7 הימים האחרונים
  const weekAgo = Math.floor(Date.now() / 1000) - 86400 * 7;
  const byEvent = await env.DB.prepare(
    `SELECT event, COUNT(*) as c FROM usage_events WHERE created_at >= ? GROUP BY event ORDER BY c DESC`
  ).bind(weekAgo).all();

  // אגרגציה: top users ב-7 ימים
  const topUsers = await env.DB.prepare(
    `SELECT user_email, COUNT(*) as c FROM usage_events
     WHERE created_at >= ? AND user_email IS NOT NULL
     GROUP BY user_email ORDER BY c DESC LIMIT 20`
  ).bind(weekAgo).all();

  return jsonRes({
    items: rows.results,
    totalCount,
    limit,
    offset,
    summaryByEvent: byEvent.results || [],
    topUsersWeek: topUsers.results || [],
  });
}
