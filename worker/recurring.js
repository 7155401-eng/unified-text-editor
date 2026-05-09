// משה 2026-05-10: חיוב חוזר אוטומטי. רץ בכל בוקר (cron 04:00 UTC) ובודק
// אילו מנויים מסתיימים בקרוב; מבצע חיוב חוזר דרך הטוקן הקיים אצל הספק:
//
//   • Yaad J5Charge — שולח Authorization Token + סכום, יעד שריג מחייבים את
//     אותו אמצעי תשלום בלי שאנחנו מחזיקים פרטי כרטיס.
//   • PayPal Reference Transaction — ב-PayPal זה דורש Billing Agreement שנוצר
//     בעת התשלום הראשון. אנחנו שומרים payer_id מההזמנה הראשונה ומשתמשים בו
//     ליצירת הסכם חיוב חוזר. (אם אין הסכם — ננסה ליצור אותו דרך orders/v2
//     עם payment_source.token.)
//
// המצב 'subscription_active=0' או failed_charge_count >= 3 = לא מחייבים.
// כל ניסיון נרשם בטבלת recurring_charges עם status=succeeded/failed.

import { getPaymentConfig } from './payment_admin.js';

const PLAN_AMOUNT = { monthly: 50, yearly: 300 };
const PLAN_DURATION_SEC = { monthly: 30 * 24 * 3600, yearly: 365 * 24 * 3600 };
const RENEW_WINDOW_SEC = 24 * 3600; // מחייבים 24 שעות לפני התפוגה
const MAX_FAILED = 3;

export async function runRecurringBilling(env) {
  const nowSec = Math.floor(Date.now() / 1000);
  const cutoff = nowSec + RENEW_WINDOW_SEC;

  const rows = await env.DB.prepare(
    `SELECT id, email, plan_type, expires_at, balance_seconds,
            subscription_active, last_payment_provider,
            yaad_token, paypal_payer_id, failed_charge_count, id_number
     FROM users
     WHERE subscription_active = 1
       AND plan_type = 'subscription'
       AND expires_at IS NOT NULL
       AND expires_at <= ?
       AND COALESCE(failed_charge_count, 0) < ?`
  ).bind(cutoff, MAX_FAILED).all();

  const list = rows?.results || [];
  const summary = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  for (const u of list) {
    summary.processed += 1;
    // הקצאת תקופה חדשה — חודש עבור monthly, שנה עבור yearly. אנחנו לא יודעים
    // איזה מהם זה כי plan_type מאחד subscription. נסיק מהסכום של התשלום
    // האחרון; אם אין — ברירת מחדל monthly.
    const planRow = await env.DB.prepare(
      `SELECT plan_code FROM payments
       WHERE user_id = ? AND plan_code IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    ).bind(u.id).first();
    const planCode = (planRow?.plan_code === 'yearly') ? 'yearly' : 'monthly';
    const amount = PLAN_AMOUNT[planCode];
    const durationSec = PLAN_DURATION_SEC[planCode];

    let result = null;
    if (u.last_payment_provider === 'yaad' && u.yaad_token) {
      result = await chargeYaadRecurring(env, u, amount, planCode);
    } else if (u.last_payment_provider === 'paypal' && u.paypal_payer_id) {
      result = await chargePaypalRecurring(env, u, amount, planCode);
    } else {
      summary.skipped += 1;
      await logCharge(env, u.id, u.last_payment_provider || 'unknown', amount, 'skipped', null, 'no provider token');
      continue;
    }

    if (result.ok) {
      summary.succeeded += 1;
      const newExpire = (u.expires_at && u.expires_at > nowSec ? u.expires_at : nowSec) + durationSec;
      await env.DB.prepare(
        `UPDATE users SET expires_at = ?, plan_renew_at = ?, last_payment_at = ?,
                          failed_charge_count = 0
         WHERE id = ?`
      ).bind(newExpire, newExpire, nowSec, u.id).run();
      await env.DB.prepare(
        'INSERT INTO payments (user_id, provider, amount, plan_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(u.id, u.last_payment_provider, amount, planCode, result.txnId || '', nowSec).run();
      await logCharge(env, u.id, u.last_payment_provider, amount, 'succeeded', result.txnId, null);
    } else {
      summary.failed += 1;
      await env.DB.prepare(
        'UPDATE users SET failed_charge_count = COALESCE(failed_charge_count, 0) + 1 WHERE id = ?'
      ).bind(u.id).run();
      await logCharge(env, u.id, u.last_payment_provider, amount, 'failed', null, result.error || 'unknown');
    }
  }
  return summary;
}

async function logCharge(env, userId, provider, amount, status, txnId, error) {
  const nowSec = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO recurring_charges (user_id, provider, amount, status, txn_id, error, attempted_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(userId, provider || 'unknown', amount, status, txnId || null, error || null, nowSec).run().catch(() => {});
}

// =============== Yaad J5Charge ===============
async function chargeYaadRecurring(env, user, amount, planCode) {
  // משה 2026-05-10: יעד שריג מאפשרים חיוב חוזר ע"י Authorization Token שנשמר
  // אצלנו (yaad_token) ב-callback של התשלום הראשון. ה-API נקרא אצלם 'J5'
  // (Direct Debit). הקריאה היא ל-icom.yaad.net/p/ עם action=APISign+pay
  // ופרמטר 'J5' שמסמן חיוב חוזר.
  const config = await getPaymentConfig(env);
  if (!config.YAAD_TERMINAL || !config.YAAD_API_KEY) {
    return { ok: false, error: 'yaad not configured' };
  }
  const base = (config.YAAD_BASE_URL || 'https://icom.yaad.net/p/').replace(/\/?$/, '/');
  const params = new URLSearchParams({
    action: 'pay',
    Masof: config.YAAD_TERMINAL,
    Amount: String(amount),
    UserId: user.id_number || '0',
    Order: `renew-${user.id}-${Date.now()}`,
    Info: `חידוש מנוי ${planCode}`,
    Coin: '1',
    UTF8: 'True',
    UTF8out: 'True',
    Tash: '1',
    FixTash: 'True',
    sendemail: 'True',
    PageLang: 'HEB',
    J5: 'True',
    AuthNum: user.yaad_token,
  });
  // חתימה
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const data = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(config.YAAD_API_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  params.append('Signature', hex);

  try {
    const r = await fetch(`${base}?${params.toString()}`, { method: 'GET', redirect: 'manual' });
    // יעד שריג מחזירים text/html או query-string-like response עם CCode=0 בהצלחה
    const txt = await r.text();
    const ok = /CCode=0|Status=0/.test(txt) || /<\s*Status\s*>0<\/Status>/.test(txt);
    if (!ok) return { ok: false, error: txt.slice(0, 200) };
    const idMatch = txt.match(/Id=(\d+)/) || txt.match(/<Id>(\d+)<\/Id>/);
    return { ok: true, txnId: idMatch ? idMatch[1] : '' };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fetch failed' };
  }
}

// =============== PayPal Reference Transaction ===============
async function chargePaypalRecurring(env, user, amount, planCode) {
  // משה 2026-05-10: PayPal Reference Transaction דורש Billing Agreement.
  // אנחנו נוצר אותו ע"י קריאה ל-orders/v2 עם payment_source שמתבסס על
  // payer_id קיים. אם הסוחר לא הופעל ל-Reference Transactions אצל פייפאל,
  // הקריאה תיכשל ונרשום שגיאה — המשתמש יקבל מייל לחדש ידנית.
  const config = await getPaymentConfig(env);
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_SECRET) {
    return { ok: false, error: 'paypal not configured' };
  }
  const ppBase = (config.PAYPAL_BASE_URL || 'https://api-m.paypal.com').replace(/\/$/, '');

  let accessToken;
  try {
    const r = await fetch(`${ppBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_SECRET}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!r.ok) return { ok: false, error: 'paypal auth failed' };
    accessToken = (await r.json()).access_token;
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'paypal auth fetch failed' };
  }

  try {
    const r = await fetch(`${ppBase}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: `renew-${user.id}-${Date.now()}`,
          amount: { currency_code: 'ILS', value: String(amount) },
          description: `חידוש מנוי ${planCode}`,
        }],
        payment_source: {
          paypal: { vault_id: user.paypal_payer_id },
        },
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return { ok: false, error: `${r.status}: ${txt.slice(0, 200)}` };
    }
    const order = await r.json();
    const captureId = order?.purchase_units?.[0]?.payments?.captures?.[0]?.id || order.id;
    return { ok: true, txnId: captureId };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'paypal charge failed' };
  }
}

// =============== Manual trigger (admin) ===============
export async function handleManualRecur(request, env) {
  // משה 2026-05-10: כפתור ↻ של המנהל מפעיל את הלולאה ידנית.
  // נשמר תאימות לאחור — קוד קודם פשוט רשם בקשה. עכשיו הוא באמת מחייב.
  const summary = await runRecurringBilling(env);
  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
