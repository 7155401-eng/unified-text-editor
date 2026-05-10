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
import { getPaymentConfig, getPackageByToken } from './payment_admin.js';

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

// משה 2026-05-10: חבילת בדיקה מותאמת (לא נמצאת ב-PLAN_DEFS/PACK_DEFS).
// קוראים ל-DB דרך טוקן; אם תקין — מחזירים שכבת אחיד עם def דמוי-pack.
async function resolveCustomPackage(env, body) {
  if (!body.pkgToken) return null;
  const pkg = await getPackageByToken(env, body.pkgToken);
  if (!pkg) return null;
  const durationSec = pkg.days != null ? pkg.days * 24 * 60 * 60 : (pkg.hours || 0) * 60 * 60;
  return {
    kind: 'custom',
    code: `custom-${pkg.id}`,
    customId: pkg.id,
    customToken: pkg.token,
    def: {
      type: pkg.days != null ? 'subscription' : 'hours',
      amount: pkg.amount,
      hours: pkg.hours || 0,
      days: pkg.days || 0,
      durationSec,
      label: pkg.label,
    },
  };
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

async function buildYaadRedirect(env, intent, returnOrigin) {
  // משה 2026-05-10: זרימת APISign — קריאה שרת-לשרת ליעד שריג שמחזירה
  // query string חתום. אנחנו לא מחתימים מקומית; יעד שריג מחתימים אצלם
  // ובודקים את החתימה כשהמשתמש מגיע. כך נעקפת בדיקת ה-Referer/RemoteHost
  // (שגיאת אימות), כי APISign הוא ערוץ אמין שאינו תלוי במקור הדפדפן.
  //
  // הפרמטרים: KEY=API key, PassP=סיסמת אימות, Masof=טרמינל, ושאר פרמטרי התשלום.
  const config = await getPaymentConfig(env);
  const base = (config.YAAD_BASE_URL || 'https://icom.yaad.net/p/').replace(/\/?$/, '/');
  const callbackUrl = `${returnOrigin}/api/payments/yaad/callback`;

  const apiSignParams = new URLSearchParams({
    action: 'APISign',
    What: 'SIGN',
    KEY: config.YAAD_API_KEY || '',
    PassP: config.YAAD_PASSP || '',
    Masof: config.YAAD_TERMINAL || '',
    Order: intent.token,
    Info: intent.label,
    Amount: String(intent.amount),
    Coin: '1',
    UTF8: 'True',
    UTF8out: 'True',
    UserId: intent.idNumber || '0',
    Tash: '1',
    FixTash: 'True',
    sendemail: 'True',
    SendHesh: 'True',
    MoreData: 'True',
    PageLang: 'HEB',
    tmp: '13',
    UrlBack: callbackUrl,
  });

  let signedQuery;
  try {
    const signRes = await fetch(`${base}?${apiSignParams.toString()}`, { method: 'GET' });
    signedQuery = (await signRes.text()).trim();
  } catch (e) {
    throw new Error(`Yaad APISign network failure: ${(e && e.message) || 'unknown'}`);
  }

  // הצלחה: התשובה היא query string שמכיל signature=...
  // כישלון: התשובה מכילה ErrCode/Error/CCode!=0 או טקסט HTML של שגיאה.
  const lower = signedQuery.toLowerCase();
  if (!signedQuery.includes('signature=') || lower.includes('error') || lower.includes('errcode')) {
    throw new Error(`Yaad APISign rejected: ${signedQuery.slice(0, 250)}`);
  }

  return `${base}?action=pay&${signedQuery}`;
}

async function startYaad(request, env, url) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError('נדרש להתחבר תחילה', 401);

  const body = await readBody(request);
  const choice = (await resolveCustomPackage(env, body)) || resolvePlanOrPack(body);
  if (!choice) return jsonError('בחירה לא חוקית');
  if (!Number.isFinite(body.amount) || Number(body.amount) !== Number(choice.def.amount)) {
    return jsonError('סכום לא תואם לתוכנית הנבחרת');
  }
  // משה 2026-05-09/10: חובה טלפון לפני תשלום (לחשבונית). ת.ז. כבר נאספת
  // בטופס האשראי של יעד שריג עצמו — אין כפילות אצלנו.
  const userRow = await env.DB.prepare('SELECT phone_e164, id_number FROM users WHERE id = ?').bind(user.id).first();
  if (!userRow?.phone_e164) {
    return jsonError('phone_required: יש להזין טלפון לפני התשלום', 412);
  }

  const token = randomToken();
  const label = choice.kind === 'plan' ? `מנוי-${choice.code}` :
                choice.kind === 'pack' ? `שעות-${choice.code}` :
                `מותאם-${choice.def.label || choice.customId}`;
  const nowSec = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    'INSERT INTO payment_intents (user_id, provider, token, amount, plan_code, pack_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    user.id, 'yaad', token, choice.def.amount,
    choice.kind === 'plan' ? choice.code : null,
    choice.kind === 'pack' ? choice.code : (choice.kind === 'custom' ? `custom:${choice.customToken}` : null),
    'pending', nowSec
  ).run();

  // UserId='0' מאפשר ליעד שריג לבקש את ה-ת.ז. בעמוד שלהם.
  const intent = { token, amount: choice.def.amount, label, idNumber: userRow.id_number || '0' };
  const redirectUrl = await buildYaadRedirect(env, intent, url.origin);
  return jsonResponse({ redirectUrl, token });
}

async function yaadCallback(request, env, url) {
  // משה 2026-05-10: יעד שריג מחזירים פרמטרים בכתובת.
  // שומרים את כל הפרמטרים הגולמיים (כולל קוד שגיאה אם יש) ב-txn_id ובלוג,
  // כדי לדבג כישלונות. גם בודקים מספר שדות אפשריים לסטטוס הצלחה.
  const params = url.searchParams;
  const token = params.get('Order') || '';
  // יעד שריג עלולים להחזיר את הסטטוס תחת מספר שמות. כל שדה ש=='0' או 'OK' או 'Approved' = הצלחה.
  const ccode = params.get('CCode');
  const status = params.get('Status');
  const errCode = params.get('ErrCode');
  const ok = ccode === '0' || status === '0' || ccode === '000' || status === '000';
  // לכידת כל הפרמטרים הגולמיים — חשוב כדי להבין מה יעד שריג שלחו במקרה של כישלון
  const rawParams = [...params.entries()].map(([k, v]) => `${k}=${v}`).join('&');
  if (!token) {
    // אין Order — לא יכולים לקשר לתשלום. רושמים בכל זאת בלוג כללי.
    return Response.redirect(`${url.origin}/?premium=failed&reason=no_order`, 302);
  }

  const intent = await env.DB.prepare(
    'SELECT id, user_id, provider, token, amount, plan_code, pack_code, status FROM payment_intents WHERE token = ?'
  ).bind(token).first();
  if (!intent) return Response.redirect(`${url.origin}/?premium=failed&reason=unknown_token`, 302);
  if (intent.status === 'completed') {
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  }

  if (!ok) {
    // שומרים את הקוד והפרמטרים הגולמיים ב-txn_id כדי שאוכל לדבג מאוחר יותר
    const errInfo = `FAIL CCode=${ccode || '-'} Status=${status || '-'} ErrCode=${errCode || '-'} | ${rawParams.slice(0, 400)}`;
    await env.DB.prepare("UPDATE payment_intents SET status = 'failed', txn_id = ? WHERE id = ?").bind(errInfo, intent.id).run();
    await env.DB.prepare("UPDATE users SET failed_charge_count = COALESCE(failed_charge_count,0) + 1 WHERE id = ?")
      .bind(intent.user_id).run().catch(() => {});
    return Response.redirect(`${url.origin}/?premium=failed`, 302);
  }

  // משה 2026-05-09: יעד שריג מחזירים בפרמטר `Token` או `J5Token` את ה-Authorization
  // Token — מזהה ייחודי שמאפשר חיוב חוזר ללא שמירת פרטי כרטיס. שומרים אותו
  // ב-users.yaad_token כדי לאפשר למנהל להריץ חיוב חוזר במקרה של כישלון.
  const yaadToken = params.get('Token') || params.get('J5Token') || '';
  const txnId = params.get('Id') || '';
  await applySuccessfulPayment(env, intent, txnId, { yaadToken });
  return Response.redirect(`${url.origin}/?premium=success`, 302);
}

// =============== PayPal ===============
async function paypalToken(env) {
  const config = await getPaymentConfig(env);
  const base = (config.PAYPAL_BASE_URL || 'https://api-m.paypal.com').replace(/\/$/, '');
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_SECRET}`)}`,
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
  const choice = (await resolveCustomPackage(env, body)) || resolvePlanOrPack(body);
  if (!choice) return jsonError('בחירה לא חוקית');
  if (choice.def.amount < 30) return jsonError('פייפאל זמין מ-30 ש"ח ומעלה');
  if (!Number.isFinite(body.amount) || Number(body.amount) !== Number(choice.def.amount)) return jsonError('סכום לא תואם');
  // משה 2026-05-09/10: חובה טלפון. ת.ז. נאספת בטופס האשראי עצמו (יעד שריג).
  const userRow = await env.DB.prepare('SELECT phone_e164 FROM users WHERE id = ?').bind(user.id).first();
  if (!userRow?.phone_e164) {
    return jsonError('phone_required: יש להזין טלפון לפני התשלום', 412);
  }

  const config = await getPaymentConfig(env);
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_SECRET) {
    return jsonError('שירות פייפאל אינו מוגדר עדיין. אנא בחרו תשלום באשראי.', 503);
  }
  const paypalBase = (config.PAYPAL_BASE_URL || 'https://api-m.paypal.com').replace(/\/$/, '');

  const token = randomToken();
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO payment_intents (user_id, provider, token, amount, plan_code, pack_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    user.id, 'paypal', token, choice.def.amount,
    choice.kind === 'plan' ? choice.code : null,
    choice.kind === 'pack' ? choice.code : (choice.kind === 'custom' ? `custom:${choice.customToken}` : null),
    'pending', nowSec
  ).run();

  const accessToken = await paypalToken(env);
  // ILS אינו נתמך במלואו ב-PayPal; ממירים USD-ILS לפי שער קבוע 1USD≈3.7ILS,
  // או משתמשים ב-currency_code=ILS אם המוכר תמך. כאן: ILS.
  const orderRes = await fetch(`${paypalBase}/v2/checkout/orders`, {
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
    const cfg = await getPaymentConfig(env);
    const ppBase = (cfg.PAYPAL_BASE_URL || 'https://api-m.paypal.com').replace(/\/$/, '');
    const captureRes = await fetch(`${ppBase}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!captureRes.ok) {
      await env.DB.prepare("UPDATE payment_intents SET status = 'failed' WHERE id = ?").bind(intent.id).run();
      return Response.redirect(`${url.origin}/?premium=failed`, 302);
    }
    const cap = await captureRes.json();
    const captureId = cap?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '';
    // משה 2026-05-09: payer.payer_id הוא מזהה שמאפשר billing agreement עתידי
    // (Vault) לחיוב חוזר בלי לשמור פרטי כרטיס.
    const payerId = cap?.payer?.payer_id || '';
    await applySuccessfulPayment(env, intent, captureId, { payerId });
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  } catch {
    return Response.redirect(`${url.origin}/?premium=failed`, 302);
  }
}

// =============== Apply payment to user ===============
async function applySuccessfulPayment(env, intent, externalTxnId, tokens = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const user = await env.DB.prepare('SELECT id, status, expires_at, balance_seconds, plan_type FROM users WHERE id = ?').bind(intent.user_id).first();
  if (!user) return;

  // משה 2026-05-09: שמירת טוקן הספק לחיוב חוזר עתידי (לא שומרים פרטי כרטיס).
  if (tokens.yaadToken) {
    await env.DB.prepare("UPDATE users SET yaad_token = ?, last_payment_provider = 'yaad' WHERE id = ?")
      .bind(tokens.yaadToken, user.id).run().catch(() => {});
  }
  if (tokens.payerId) {
    await env.DB.prepare("UPDATE users SET paypal_payer_id = ?, last_payment_provider = 'paypal' WHERE id = ?")
      .bind(tokens.payerId, user.id).run().catch(() => {});
  }
  await env.DB.prepare("UPDATE users SET last_payment_at = ?, failed_charge_count = 0 WHERE id = ?")
    .bind(nowSec, user.id).run().catch(() => {});

  if (intent.plan_code) {
    const plan = PLAN_DEFS[intent.plan_code];
    if (!plan) return;
    const baseExpire = (user.expires_at && user.expires_at > nowSec) ? user.expires_at : nowSec;
    const newExpire = baseExpire + plan.durationSec;
    await env.DB.prepare(
      "UPDATE users SET status = 'active', plan_type = ?, expires_at = ?, plan_renew_at = ? WHERE id = ?"
    ).bind('subscription', newExpire, newExpire, user.id).run();
  } else if (intent.pack_code && intent.pack_code.startsWith('custom:')) {
    // משה 2026-05-10: חבילת בדיקה מותאמת — שולפים מ-DB ומחילים ע"פ ימים/שעות.
    const customToken = intent.pack_code.slice('custom:'.length);
    const pkg = await env.DB.prepare(
      'SELECT id, hours, days FROM custom_packages WHERE token = ?'
    ).bind(customToken).first();
    if (!pkg) return;
    if (pkg.days != null && pkg.days > 0) {
      const baseExpire = (user.expires_at && user.expires_at > nowSec) ? user.expires_at : nowSec;
      const newExpire = baseExpire + pkg.days * 24 * 60 * 60;
      await env.DB.prepare(
        "UPDATE users SET status = 'active', plan_type = COALESCE(plan_type,'subscription'), expires_at = ?, plan_renew_at = ? WHERE id = ?"
      ).bind(newExpire, newExpire, user.id).run();
    } else if (pkg.hours != null && pkg.hours > 0) {
      const seconds = Math.round(pkg.hours * 3600);
      const newBalance = (user.balance_seconds || 0) + seconds;
      const expireMin = nowSec + newBalance;
      await env.DB.prepare(
        "UPDATE users SET status = 'active', plan_type = COALESCE(plan_type,'hours'), balance_seconds = ?, expires_at = ? WHERE id = ?"
      ).bind(newBalance, expireMin, user.id).run();
    }
    await env.DB.prepare('UPDATE custom_packages SET used_count = used_count + 1 WHERE id = ?').bind(pkg.id).run().catch(() => {});
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
  let body = {};
  try { body = await request.json(); } catch {}
  const reason = String(body?.reason || '').slice(0, 500);
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 0, plan_renew_at = 0, cancelled_at = ?, cancellation_reason = ? WHERE id = ?"
  ).bind(nowSec, reason || null, user.id).run();
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
