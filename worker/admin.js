// צוות האתר 2026-05-07: Admin API. רק משתמשים עם is_admin=1 יכולים לקרוא לאלה.
// כל בקשה מאומתת תחילה דרך getUserFromRequest; בלי הרשאת admin → 403.

import { getUserFromRequest } from './session.js';

// משה 2026-05-10: דגל גלובלי לכיבוי "מגן הקונסול" (החוסם פתיחת devtools
// במצב דמו או בכל הסשנים). נשמר ב-app_settings כ-key 'CONSOLE_GUARD_DISABLED'
// עם value '1' אם המגן כבוי. ברירת המחדל = ריק/'0' = המגן דלוק.
// הפונקציה נצרכת מ-index.js כדי להזריק את המצב לכל HTML response.
const CONSOLE_GUARD_KEY = 'CONSOLE_GUARD_DISABLED';

export async function isConsoleGuardEnabled(env) {
  try {
    const r = await env.DB.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).bind(CONSOLE_GUARD_KEY).first();
    if (r && String(r.value) === '1') return false;
  } catch {
    // הטבלה עוד לא קיימת או DB לא זמין — נכון להתנהג כאילו המגן דלוק.
  }
  return true;
}

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
  if (path.startsWith('/api/admin/users/') && path.endsWith('/minutes') && method === 'POST') {
    const id = path.split('/').slice(-2)[0];
    return adjustUserMinutes(request, env, Number(id));
  }
  if (path.startsWith('/api/admin/users/') && path.endsWith('/recharge') && method === 'POST') {
    const id = path.split('/').slice(-2)[0];
    return rechargeUser(request, env, Number(id));
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
  if (path === '/api/admin/console-guard' && method === 'GET') {
    const enabled = await isConsoleGuardEnabled(env);
    return new Response(JSON.stringify({ enabled }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (path === '/api/admin/console-guard' && method === 'POST') {
    return setConsoleGuard(request, env, auth.user.id);
  }
  return new Response('Not found', { status: 404 });
}

async function setConsoleGuard(request, env, userId) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const enabled = !!body.enabled;
  const value = enabled ? '0' : '1';
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?)\n     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id'
  ).bind(CONSOLE_GUARD_KEY, value, nowSec, userId).run();
  return new Response(JSON.stringify({ ok: true, enabled }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
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
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin,
            balance_seconds, plan_type, plan_renew_at,
            yaad_token, paypal_payer_id, last_payment_provider, last_payment_at, failed_charge_count
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
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin,
            balance_seconds, plan_type, plan_renew_at FROM users WHERE id = ?`
  ).bind(id).first();

  return Response.json(row || { error: 'Not found' });
}

// משה 2026-05-09: התאמת יתרת זמן ידנית. delta_minutes חיובי = הוספה,
// שלילי = הורדה. מתאים גם את expires_at אם יש יתרת שעות (plan_type='hours'
// או null) — מנוי-תקופה לא נוגעים בו, רק במאזן השעות.
async function adjustUserMinutes(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response('Bad id', { status: 400 });
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const deltaMinutes = Number(body?.deltaMinutes);
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) return new Response('Bad deltaMinutes', { status: 400 });

  const row = await env.DB.prepare(
    'SELECT id, balance_seconds, expires_at, plan_type, status FROM users WHERE id = ?'
  ).bind(id).first();
  if (!row) return new Response('Not found', { status: 404 });

  const deltaSec = Math.round(deltaMinutes * 60);
  const newBalance = Math.max(0, (row.balance_seconds || 0) + deltaSec);
  const nowSec = Math.floor(Date.now() / 1000);

  let newExpires = row.expires_at || 0;
  // עבור משתמשי שעות (או חשבון חדש ללא תוכנית) — הוסף/הורד גם מ-expires_at.
  // למנוי תקופה (subscription) — לא נוגעים ב-expires_at, רק ביתרה הצדדית.
  if (row.plan_type !== 'subscription') {
    if (deltaSec > 0) {
      const base = (newExpires && newExpires > nowSec) ? newExpires : nowSec;
      newExpires = base + deltaSec;
    } else {
      newExpires = Math.max(nowSec, newExpires + deltaSec);
    }
  }

  // פתיחת חשבון = שדרוג 'unauthorized' → 'active' אם המנהל הוסיף זמן.
  const newStatus = (row.status === 'unauthorized' && deltaSec > 0) ? 'active' : row.status;
  const newPlanType = row.plan_type || (deltaSec > 0 ? 'hours' : row.plan_type);

  await env.DB.prepare(
    'UPDATE users SET balance_seconds = ?, expires_at = ?, status = ?, plan_type = ? WHERE id = ?'
  ).bind(newBalance, newExpires, newStatus, newPlanType, id).run();

  // היסטוריה: לרשום את ההתאמה בטבלת payments עם provider='admin'.
  // amount=0 כדי להבדיל מתשלומים אמיתיים.
  await env.DB.prepare(
    'INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, 'admin', 0, null, `adjust_${deltaMinutes > 0 ? '+' : ''}${deltaMinutes}min`, '', nowSec).run().catch(() => {});

  const updated = await env.DB.prepare(
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin,
            balance_seconds, plan_type, plan_renew_at FROM users WHERE id = ?`
  ).bind(id).first();

  return Response.json({ ok: true, user: updated, deltaMinutes });
}

// משה 2026-05-09: חיוב חוזר ידני ע"י המנהל באמצעות טוקן ספק שמור.
// אנחנו לא שומרים פרטי כרטיס; שומרים טוקן Authorization של יעד שריג / payer_id
// של פייפאל. הקריאה הזאת מפעילה חיוב נוסף על אותו אמצעי תשלום בסכום שנקבע.
//
// בקשה: { amount: number (₪), planCode?: 'monthly'|'yearly', packCode?: 'h1'..'h20' }
async function rechargeUser(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response('Bad id', { status: 400 });
  let body;
  try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return new Response('Bad amount', { status: 400 });

  const user = await env.DB.prepare(
    'SELECT id, email, yaad_token, paypal_payer_id, last_payment_provider FROM users WHERE id = ?'
  ).bind(id).first();
  if (!user) return new Response('Not found', { status: 404 });

  const provider = user.last_payment_provider || (user.yaad_token ? 'yaad' : (user.paypal_payer_id ? 'paypal' : null));
  if (!provider) {
    return Response.json({ error: 'אין טוקן תשלום שמור עבור משתמש זה. הוא עוד לא ביצע תשלום מוצלח.' }, { status: 400 });
  }

  // הערה חשובה: הקריאה הזאת רק מפיקה לוג ומציינת שיש לבצע ניסיון חוזר.
  // ביצוע חיוב חוזר אמיתי דורש קריאת API ייעודית של יעד שריג (J5Charge) או
  // PayPal (Reference Transaction / Subscription) — שדורשת secrets שעדיין
  // לא מוגדרים בענף הזה. כשהם יוגדרו, נחבר את הקריאה.
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, provider, amount, body?.planCode || null, body?.packCode || null, 'admin_recharge_request', nowSec).run().catch(() => {});

  return Response.json({
    ok: true,
    queued: true,
    provider,
    note: 'בקשת חיוב חוזר נרשמה. ביצוע אוטומטי דורש secrets של הספק (יוגדרו בנפרד).',
  });
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
