// משה 2026-05-10: שני ראוטרים ניהוליים:
//
//   1) /api/admin/payment-config (GET/POST)
//      GET — מחזיר מצב הגדרות התשלום (האם מוגדר, 4 תווים אחרונים בלבד).
//      POST — מאמת מול PayPal (קריאת OAuth חיה) ושומר בטבלת app_settings.
//      הקוד שב-payments.js קורא דרך getPaymentConfig() — לכן עדכון בדף
//      הניהולי משפיע מיידית על תשלומים אמיתיים, בלי פריסה מחדש.
//
//   2) /api/admin/test-packages (GET/POST/DELETE)
//      ניהול חבילות בדיקה ייעודיות. כל חבילה מקבלת token מקרי ומופיעה
//      רק בכתובת /?premium=1&pkg=<token>. לא נראית לציבור.
//
// כל הראוטרים דורשים is_admin=1.

import { getUserFromRequest } from './session.js';

const SETTING_KEYS = [
  'YAAD_TERMINAL',
  'YAAD_API_KEY',
  'YAAD_BASE_URL',
  'YAAD_PASSP',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_SECRET',
  'PAYPAL_BASE_URL',
];

function jsonResponse(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers || {}) },
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, { status });
}

function maskValue(value) {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 4) return '****';
  return '****' + str.slice(-4);
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: 'Not logged in', status: 401 };
  if (!user.is_admin) return { error: 'Forbidden', status: 403 };
  return { user };
}

function randomToken(bytes = 12) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// =============== Read helpers (used by payments.js too) ===============

export async function getPaymentConfig(env) {
  // קריאה: שולפים את כל ה-keys מ-app_settings, ומה שחסר — נופלים ל-env.
  const result = {};
  let rows = [];
  try {
    const stmt = env.DB.prepare('SELECT key, value FROM app_settings WHERE key IN (' + SETTING_KEYS.map(() => '?').join(',') + ')');
    const r = await stmt.bind(...SETTING_KEYS).all();
    rows = r?.results || [];
  } catch {
    // הטבלה עוד לא קיימת (לפני הרצת המיגרציה) — נופלים ל-env בלבד
  }
  for (const row of rows) {
    if (row && row.key && row.value) result[row.key] = row.value;
  }
  for (const key of SETTING_KEYS) {
    if (!result[key] && env[key]) result[key] = env[key];
  }
  return result;
}

// =============== Payment config ===============

async function getConfigStatus(request, env) {
  const config = await getPaymentConfig(env);
  const status = {};
  for (const key of SETTING_KEYS) {
    status[key] = {
      configured: !!config[key],
      masked: maskValue(config[key]),
    };
  }
  return jsonResponse({ status });
}

async function savePaymentConfig(request, env, userId) {
  const body = await readBody(request);
  // משה 2026-05-10: התקבלו 0 עד 6 ערכים. שדה ריק מתעלמים, שדה עם תוכן —
  // שומרים. כך אפשר לעדכן רק PayPal בלי לדרוס Yaad ולהיפך.
  const updates = {};
  for (const key of SETTING_KEYS) {
    if (typeof body[key] === 'string' && body[key].trim()) {
      updates[key] = body[key].trim();
    }
  }

  // אם מעדכנים PayPal — מאמתים מולם בקריאת OAuth חיה לפני שמירה.
  // החיבור הוא לפרוד (PayPal Live) — לא Sandbox.
  if (updates.PAYPAL_CLIENT_ID || updates.PAYPAL_SECRET) {
    const cfgNow = await getPaymentConfig(env);
    const clientId = updates.PAYPAL_CLIENT_ID || cfgNow.PAYPAL_CLIENT_ID;
    const secret = updates.PAYPAL_SECRET || cfgNow.PAYPAL_SECRET;
    const base = updates.PAYPAL_BASE_URL || cfgNow.PAYPAL_BASE_URL || 'https://api-m.paypal.com';
    if (!clientId || !secret) {
      return jsonError('צריך גם Client ID וגם Secret של PayPal');
    }
    try {
      const r = await fetch(`${base.replace(/\/$/, '')}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return jsonError(`PayPal סירב לאמת — בדוק שהמפתחות נכונים. (${r.status}: ${txt.slice(0, 120)})`, 400);
      }
    } catch (e) {
      return jsonError(`לא הצלחנו להגיע ל-PayPal לאימות. (${(e && e.message) || 'שגיאה'})`, 502);
    }
  }

  // שמירה
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [key, value] of Object.entries(updates)) {
    await env.DB.prepare(
      'INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?)\n       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id'
    ).bind(key, value, nowSec, userId).run();
  }

  return jsonResponse({ ok: true, saved: Object.keys(updates) });
}

// =============== Custom packages ===============

async function listPackages(request, env) {
  const r = await env.DB.prepare(
    'SELECT id, token, label, amount, hours, days, created_at, expires_at, used_count, max_uses, active FROM custom_packages ORDER BY id DESC LIMIT 200'
  ).all();
  return jsonResponse({ packages: r?.results || [] });
}

async function createPackage(request, env, userId) {
  const body = await readBody(request);
  const label = (body.label || '').trim();
  const amount = Number(body.amount);
  const hours = body.hours == null || body.hours === '' ? null : Number(body.hours);
  const days = body.days == null || body.days === '' ? null : Number(body.days);
  const maxUses = body.maxUses == null || body.maxUses === '' ? null : Number(body.maxUses);
  const expiresAt = body.expiresAt == null || body.expiresAt === '' ? null : Number(body.expiresAt);

  if (!label) return jsonError('חסר שם לחבילה');
  if (!Number.isFinite(amount) || amount <= 0) return jsonError('סכום לא חוקי');
  if (hours != null && (!Number.isFinite(hours) || hours <= 0)) return jsonError('שעות לא חוקיות');
  if (days != null && (!Number.isFinite(days) || days <= 0)) return jsonError('ימים לא חוקיים');
  if (hours == null && days == null) return jsonError('צריך לציין או שעות או ימים');

  const token = randomToken(12);
  const nowSec = Math.floor(Date.now() / 1000);
  const ins = await env.DB.prepare(
    'INSERT INTO custom_packages (token, label, amount, hours, days, created_by_user_id, created_at, expires_at, max_uses, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
  ).bind(token, label, amount, hours, days, userId, nowSec, expiresAt, maxUses).run();

  return jsonResponse({
    id: ins.meta.last_row_id,
    token,
    label,
    amount,
    hours,
    days,
    expiresAt,
    maxUses,
    active: 1,
    used_count: 0,
    created_at: nowSec,
  });
}

async function deletePackage(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return jsonError('id לא חוקי');
  await env.DB.prepare('UPDATE custom_packages SET active = 0 WHERE id = ?').bind(id).run();
  return jsonResponse({ ok: true });
}

// =============== Public lookup by token (used by premium page) ===============

export async function getPackageByToken(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT id, token, label, amount, hours, days, expires_at, used_count, max_uses, active FROM custom_packages WHERE token = ? AND active = 1'
  ).bind(token).first();
  if (!row) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (row.expires_at && row.expires_at > 0 && row.expires_at < nowSec) return null;
  if (row.max_uses && row.used_count >= row.max_uses) return null;
  return row;
}

export async function handlePackageLookup(request, env, url) {
  // נתיב ציבורי: GET /api/payments/package/:token — מחזיר פרטי חבילה לקריאה
  // מהדף הקדמי בלבד (label + amount + duration). לא חושף שום סוד.
  const m = url.pathname.match(/\/api\/payments\/package\/([A-Za-z0-9_-]+)$/);
  if (!m) return new Response('Not found', { status: 404 });
  const pkg = await getPackageByToken(env, m[1]);
  if (!pkg) return jsonError('חבילה לא נמצאה או שפג תוקפה', 404);
  return jsonResponse({
    token: pkg.token,
    label: pkg.label,
    amount: pkg.amount,
    hours: pkg.hours,
    days: pkg.days,
  });
}

// =============== Router ===============

export async function handlePaymentAdmin(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return jsonError(auth.error, auth.status);

  const path = url.pathname;
  const method = request.method;

  if (path === '/api/admin/payment-config' && method === 'GET') return getConfigStatus(request, env);
  if (path === '/api/admin/payment-config' && method === 'POST') return savePaymentConfig(request, env, auth.user.id);

  if (path === '/api/admin/test-packages' && method === 'GET') return listPackages(request, env);
  if (path === '/api/admin/test-packages' && method === 'POST') return createPackage(request, env, auth.user.id);
  if (path.startsWith('/api/admin/test-packages/') && method === 'DELETE') {
    const id = Number(path.split('/').pop());
    return deletePackage(request, env, id);
  }

  return new Response('Not found', { status: 404 });
}
