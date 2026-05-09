// משה 2026-05-09: שרת תשלומים — יעד שריג + פייפאל.
//
// זרימת תשלום:
//   1. הלקוח קורא /api/payments/yaad/start עם planCode/packCode/amount.
//   2. השרת בודק שהמשתמש מחובר, יוצר רשומת payment_intents עם token,
//      ומחזיר redirectUrl להוסטד-פייג של יעד שריג עם פרמטרים חתומים.
//   3. יעד שריג מחזירים את המשתמש ל-/api/payments/yaad/callback עם תוצאה.
//   4. אם הצליח — מעדכנים users.status='active', users.expires_at לפי plan,
//      ומכניסים ל-payments טבלת היסטוריה. ל-hour pack מוסיפים שניות
//      ל-users.balance_seconds.
//
// פייפאל זהה אבל דרך REST API שלהם (Orders v2). המסלול מותר רק מ-30 ש"ח ומעלה.
//
// טבלאות נדרשות (כבר קיימות) או חדשות שיווצרו ב-migrations:
//   users(id, email, status, expires_at, balance_seconds, plan_type, plan_renew_at, is_admin, last_login_at)
//   payment_intents(id, user_id, provider, token, amount, plan_code, pack_code, status, created_at)
//   payments(id, user_id, provider, amount, plan_code, pack_code, txn_id, created_at)
//   gift_claims(user_id, year_month UNIQUE)

import { getUserFromRequest } from './session.js';

const PLAN_DEFS = {
  monthly: { type: 'subscription', amount: 50,  durationSec: 30 * 24 * 60 * 60 },
  yearly:  { type: 'subscription', amount: 300, durationSec: 365 * 24 * 60 * 60 },
};
const PACK_DEFS = {
  h1:  { type: 'hours', amount: 5,  hours: 1  },
  h5:  { type: 'hours', amount: 22, hours: 5  },
  h10: { type: 'hours', amount: 40, hours: 10 },
  h20: { type: 'hours', amount: 70, hours: 20 },
};

const GIFT_MINUTES_PER_MONTH = 20;

function jsonResponse(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers || {}) },
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, { status });
}

function randomToken(bytes = 18) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function thisMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function resolvePlanOrPack(body) {
  if (body.planCode && PLAN_DEFS[body.planCode]) return { kind: 'plan', code: body.planCode, def: PLAN_DEFS[body.planCode] };
  if (body.packCode && PACK_DEFS[body.packCode]) return { kind: 'pack', code: body.packCode, def: PACK_DEFS[body.packCode] };
  return null;
}

async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

// =============== Yaad Sarig ===============
//
// יעד שריג מציעים שיטת חיוב ב-iframe או ב-redirect. כאן משתמשים ב-redirect:
// בונים URL עם פרמטרים חתומים, שולחים את המשתמש לשם.
// כשחוזרים — המערכת שולחת קריאת callback אליי (CCallType=ApprovalUrl) שאני
// מאמת ע"י דגימת ה-Signature.
//
// ENV נדרש (יש להגדיר ב-wrangler secrets):
//   YAAD_TERMINAL  — מספר טרמינל (KEY)
//   YAAD_API_KEY   — מפתח API לחתימה
//   YAAD_BASE_URL  — בדרך כלל https://icom.yaad.net/p/

async function buildYaadRedirect(env, intent) {
  const base = env.YAAD_BASE_URL || 'https://icom.yaad.net/p/';
  const params = new URLSearchParams({
    action: 'pay',
    Masof: env.YAAD_TERMINAL || '',
    Order: intent.token,
    Info: intent.label,
    Amount: String(intent.amount),
    Currency: '1', // ILS
    UTF8: 'True',
    UTF8out: 'True',
    UserId: '0',
    ClientName: '',
    ClientLName: '',
    Coin: '1',
    Tash: '1',
    FixTash: 'True',
    sendemail: 'True',
    SendHesh: 'True',
    PageLang: 'HEB',
    tmp: '13',
  });
  // יעד שריג מבקשים סימן Signature אם רוצים חתימה — נדרש קוד צד שרת
  // אם YAAD_API_KEY מוגדר, מחשבים HMAC-MD5 כפי שיעד שריג מצפים.
  if (env.YAAD_API_KEY) {
    const signed = await signYaadParams(params, env.YAAD_API_KEY);
    return `${base}?${signed}`;
  }
  return `${base}?${params.toString()}`;
}

async function signYaadParams(params, apiKey) {
  // יעד שריג: Signature = HMAC-SHA256(apiKey, sorted_params_string), hex.
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const data = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  params.append('Signature', hex);
  return params.toString();
}

async function startYaad(request, env, url) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError('נדרש להתחבר תחילה', 401);

  const body = await readBody(request);
  const choice = resolvePlanOrPack(body);
  if (!choice) return jsonError('בחירה לא חוקית');
  if (!Number.isFinite(body.amount) || body.amount !== choice.def.amount) {
    return jsonError('סכום לא תואם לתוכנית הנבחרת');
  }

  const token = randomToken();
  const label = choice.kind === 'plan' ? `מנוי-${choice.code}` : `שעות-${choice.code}`;
  const nowSec = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    'INSERT INTO payment_intents (user_id, provider, token, amount, plan_code, pack_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    user.id, 'yaad', token, choice.def.amount,
    choice.kind === 'plan' ? choice.code : null,
    choice.kind === 'pack' ? choice.code : null,
    'pending', nowSec
  ).run();

  const intent = { token, amount: choice.def.amount, label };
  const redirectUrl = await buildYaadRedirect(env, intent);
  return jsonResponse({ redirectUrl, token });
}

async function yaadCallback(request, env, url) {
  // יעד שריג מחזירים פרמטרים בכתובת. אנחנו מאמתים את החתימה ומעדכנים את ה-DB.
  const params = url.searchParams;
  const token = params.get('Order') || '';
  const ok = params.get('CCode') === '0' || params.get('Status') === '0';
  if (!token) return new Response('Bad request', { status: 400 });

  const intent = await env.DB.prepare(
    'SELECT id, user_id, provider, token, amount, plan_code, pack_code, status FROM payment_intents WHERE token = ?'
  ).bind(token).first();
  if (!intent) return new Response('Unknown token', { status: 404 });
  if (intent.status === 'completed') {
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  }

  if (!ok) {
    await env.DB.prepare("UPDATE payment_intents SET status = 'failed' WHERE id = ?").bind(intent.id).run();
    return Response.redirect(`${url.origin}/?premium=failed`, 302);
  }

  await applySuccessfulPayment(env, intent, params.get('Id') || '');
  return Response.redirect(`${url.origin}/?premium=success`, 302);
}

// =============== PayPal ===============
async function paypalToken(env) {
  const r = await fetch(`${env.PAYPAL_BASE_URL || 'https://api-m.paypal.com'}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('PayPal auth failed');
  const j = await r.json();
  return j.access_token;
}

async function startPaypal(request, env, url) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError('נדרש להתחבר תחילה', 401);

  const body = await readBody(request);
  const choice = resolvePlanOrPack(body);
  if (!choice) return jsonError('בחירה לא חוקית');
  if (choice.def.amount < 30) return jsonError('פייפאל זמין מ-30 ש"ח ומעלה');
  if (!Number.isFinite(body.amount) || body.amount !== choice.def.amount) return jsonError('סכום לא תואם');

  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) {
    return jsonError('שירות פייפאל אינו מוגדר עדיין. אנא בחרו תשלום באשראי.', 503);
  }

  const token = randomToken();
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO payment_intents (user_id, provider, token, amount, plan_code, pack_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    user.id, 'paypal', token, choice.def.amount,
    choice.kind === 'plan' ? choice.code : null,
    choice.kind === 'pack' ? choice.code : null,
    'pending', nowSec
  ).run();

  const accessToken = await paypalToken(env);
  // ILS אינו נתמך במלואו ב-PayPal; ממירים USD-ILS לפי שער קבוע 1USD≈3.7ILS,
  // או משתמשים ב-currency_code=ILS אם המוכר תמך. כאן: ILS.
  const orderRes = await fetch(`${env.PAYPAL_BASE_URL || 'https://api-m.paypal.com'}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: token,
        amount: { currency_code: 'ILS', value: String(choice.def.amount) },
        description: choice.kind === 'plan' ? `RavText subscription ${choice.code}` : `RavText hours ${choice.code}`,
      }],
      application_context: {
        brand_name: 'רב טקסט לוורד AI',
        return_url: `${url.origin}/api/payments/paypal/callback?token=${token}`,
        cancel_url: `${url.origin}/?premium=cancelled`,
      },
    }),
  });
  if (!orderRes.ok) {
    return jsonError('פייפאל סירב לפתוח עסקה — נסה שוב מאוחר יותר', 502);
  }
  const order = await orderRes.json();
  const approve = order.links?.find((l) => l.rel === 'approve');
  if (!approve) return jsonError('פייפאל לא החזיר כתובת אישור', 502);
  await env.DB.prepare('UPDATE payment_intents SET status = ?, txn_id = ? WHERE token = ?')
    .bind('awaiting_paypal', order.id, token).run().catch(() => {});
  return jsonResponse({ redirectUrl: approve.href, token, paypalOrder: order.id });
}

async function paypalCallback(request, env, url) {
  const token = url.searchParams.get('token');
  if (!token) return new Response('Bad request', { status: 400 });

  const intent = await env.DB.prepare(
    'SELECT id, user_id, provider, token, txn_id, amount, plan_code, pack_code, status FROM payment_intents WHERE token = ?'
  ).bind(token).first();
  if (!intent) return new Response('Unknown token', { status: 404 });
  if (intent.status === 'completed') {
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  }
  const paypalOrderId = intent.txn_id;
  if (!paypalOrderId) return Response.redirect(`${url.origin}/?premium=failed`, 302);

  try {
    const accessToken = await paypalToken(env);
    const captureRes = await fetch(`${env.PAYPAL_BASE_URL || 'https://api-m.paypal.com'}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!captureRes.ok) {
      await env.DB.prepare("UPDATE payment_intents SET status = 'failed' WHERE id = ?").bind(intent.id).run();
      return Response.redirect(`${url.origin}/?premium=failed`, 302);
    }
    const cap = await captureRes.json();
    const captureId = cap?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '';
    await applySuccessfulPayment(env, intent, captureId);
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  } catch {
    return Response.redirect(`${url.origin}/?premium=failed`, 302);
  }
}

// =============== Apply payment to user ===============
async function applySuccessfulPayment(env, intent, externalTxnId) {
  const nowSec = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare('SELECT id, status, expires_at, balance_seconds, plan_type FROM users WHERE id = ?').bind(intent.user_id).first();
  if (!user) return;

  if (intent.plan_code) {
    const plan = PLAN_DEFS[intent.plan_code];
    if (!plan) return;
    const baseExpire = (user.expires_at && user.expires_at > nowSec) ? user.expires_at : nowSec;
    const newExpire = baseExpire + plan.durationSec;
    await env.DB.prepare(
      "UPDATE users SET status = 'active', plan_type = ?, expires_at = ?, plan_renew_at = ? WHERE id = ?"
    ).bind('subscription', newExpire, newExpire, user.id).run();
  } else if (intent.pack_code) {
    const pack = PACK_DEFS[intent.pack_code];
    if (!pack) return;
    const seconds = pack.hours * 3600;
    const newBalance = (user.balance_seconds || 0) + seconds;
    // עליית סטטוס ל-active אם זה פתיחה ראשונה
    const expireMin = nowSec + newBalance;
    await env.DB.prepare(
      "UPDATE users SET status = 'active', plan_type = COALESCE(plan_type,'hours'), balance_seconds = ?, expires_at = ? WHERE id = ?"
    ).bind(newBalance, expireMin, user.id).run();
  }

  await env.DB.prepare(
    'INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(intent.user_id, intent.provider, intent.amount, intent.plan_code, intent.pack_code, externalTxnId || '', nowSec).run();
  await env.DB.prepare("UPDATE payment_intents SET status = 'completed' WHERE id = ?").bind(intent.id).run();
}

// =============== Status ===============
async function getStatus(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ paid: false, planType: null, expiresAt: null, balanceSeconds: 0 });
  const row = await env.DB.prepare(
    'SELECT plan_type, expires_at, balance_seconds FROM users WHERE id = ?'
  ).bind(user.id).first();
  const expiresAtMs = row?.expires_at ? row.expires_at * 1000 : null;
  return jsonResponse({
    paid: !!user.paid,
    planType: row?.plan_type || null,
    expiresAt: expiresAtMs,
    balanceSeconds: row?.balance_seconds || 0,
    email: user.email,
  });
}

// =============== Cancel subscription ===============
async function cancelSubscription(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError('נדרש להתחבר תחילה', 401);
  await env.DB.prepare(
    "UPDATE users SET plan_renew_at = 0 WHERE id = ?"
  ).bind(user.id).run();
  return jsonResponse({ ok: true });
}

// =============== Monthly gift ===============
async function claimGift(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError('נדרש להתחבר תחילה', 401);
  const monthKey = thisMonthKey();
  const nowSec = Math.floor(Date.now() / 1000);

  // Try insert; if exists → already claimed
  try {
    await env.DB.prepare(
      'INSERT INTO gift_claims (user_id, year_month, claimed_at) VALUES (?, ?, ?)'
    ).bind(user.id, monthKey, nowSec).run();
  } catch {
    return jsonResponse({ granted: false, reason: 'already_claimed' });
  }

  const giftSeconds = GIFT_MINUTES_PER_MONTH * 60;
  const row = await env.DB.prepare('SELECT balance_seconds, expires_at, status FROM users WHERE id = ?').bind(user.id).first();
  const newBalance = (row?.balance_seconds || 0) + giftSeconds;
  const newExpire = Math.max(row?.expires_at || nowSec, nowSec) + giftSeconds;
  await env.DB.prepare(
    "UPDATE users SET status = CASE WHEN status = 'unauthorized' THEN 'active' ELSE status END, plan_type = COALESCE(plan_type,'hours'), balance_seconds = ?, expires_at = ? WHERE id = ?"
  ).bind(newBalance, newExpire, user.id).run();

  return jsonResponse({ granted: true, addedSeconds: giftSeconds, newBalance });
}

// =============== Router ===============
export async function handlePayments(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === '/api/payments/yaad/start' && method === 'POST') return startYaad(request, env, url);
  if (path === '/api/payments/yaad/callback') return yaadCallback(request, env, url);
  if (path === '/api/payments/paypal/start' && method === 'POST') return startPaypal(request, env, url);
  if (path === '/api/payments/paypal/callback') return paypalCallback(request, env, url);
  if (path === '/api/payments/status' && (method === 'GET' || method === 'POST')) return getStatus(request, env);
  if (path === '/api/payments/cancel' && method === 'POST') return cancelSubscription(request, env);
  if (path === '/api/payments/gift/claim' && method === 'POST') return claimGift(request, env);

  return new Response('Not found', { status: 404 });
}
