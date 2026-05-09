// משה 2026-05-09: API פרטי חשבון — טלפון (חובה לפני תשלום).
//   GET  /api/account/me     → פרטי החשבון לרבות טלפון
//   PUT  /api/account/phone  → שמירת טלפון + מדינה

import { getUserFromRequest } from './session.js';

const COUNTRY_DIAL = {
  IL: '972', US: '1', CA: '1', GB: '44', FR: '33', BE: '32',
  DE: '49', CH: '41', AT: '43', NL: '31', IT: '39', ES: '34',
  AU: '61', NZ: '64', AR: '54', BR: '55', MX: '52', ZA: '27',
  RU: '7', UA: '380', CZ: '420', PL: '48', HU: '36', RO: '40',
  TR: '90', AE: '971', JO: '962', EG: '20',
};

function normalizeDigits(s) {
  return String(s || '').replace(/\D+/g, '');
}

// המרת קלט מקומי + מדינה ל-E.164 (ללא +).
// IL + 0521234567 → 972521234567
// US + 5551234567 → 15551234567
// אם המספר כבר מתחיל בקוד המדינה → לא נכפיל.
function toE164(country, raw) {
  const dial = COUNTRY_DIAL[country];
  if (!dial) return null;
  let digits = normalizeDigits(raw);
  if (!digits) return null;
  // מסיר 0 מוביל מקומי (נפוץ בישראל)
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (digits.startsWith(dial)) return digits;
  return dial + digits;
}

function isValidPhone(country, raw) {
  const e164 = toE164(country, raw);
  if (!e164) return false;
  // אורך סביר: 7-15 ספרות (כולל קוד מדינה) — תקן ITU
  return e164.length >= 7 && e164.length <= 15;
}

function jsonResponse(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...(init.headers || {}) },
  });
}

async function getMe(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, { status: 401 });
  const row = await env.DB.prepare(
    'SELECT phone, phone_country, phone_e164 FROM users WHERE id = ?'
  ).bind(user.id).first();
  return jsonResponse({
    email: user.email,
    phone: row?.phone || '',
    phoneCountry: row?.phone_country || 'IL',
    phoneE164: row?.phone_e164 || '',
    hasPhone: !!(row?.phone_e164),
  });
}

async function putPhone(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse({ error: 'Not logged in' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Bad JSON' }, { status: 400 }); }

  const country = String(body?.country || 'IL').toUpperCase();
  const raw = String(body?.phone || '').trim();
  if (!COUNTRY_DIAL[country]) return jsonResponse({ error: 'מדינה לא נתמכת' }, { status: 400 });
  if (!isValidPhone(country, raw)) return jsonResponse({ error: 'מספר טלפון לא תקין' }, { status: 400 });

  const e164 = toE164(country, raw);
  await env.DB.prepare(
    'UPDATE users SET phone = ?, phone_country = ?, phone_e164 = ? WHERE id = ?'
  ).bind(raw, country, e164, user.id).run();

  return jsonResponse({ ok: true, phone: raw, phoneCountry: country, phoneE164: e164 });
}

export async function handleAccount(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  if (path === '/api/account/me' && method === 'GET') return getMe(request, env);
  if (path === '/api/account/phone' && method === 'PUT') return putPhone(request, env);
  return new Response('Not found', { status: 404 });
}
