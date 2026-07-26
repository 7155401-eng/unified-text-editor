import { getUserFromRequest } from './session.js';

const GIFT_MINUTES_PER_MONTH = 20;
const GIFT_SECONDS_PER_MONTH = GIFT_MINUTES_PER_MONTH * 60;
const MAX_USAGE_TICK_SECONDS = 60;

function jsonResponse(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

function jsonError(message, status = 400) {
  return jsonResponse({ error: message }, { status });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function monthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function positiveSeconds(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function isSubscriptionActive(row, now = nowSec()) {
  return row?.status === 'active'
    && row?.plan_type === 'subscription'
    && (!row?.expires_at || Number(row.expires_at) >= now);
}

function visibleExpiresAt(row, now = nowSec()) {
  return isSubscriptionActive(row, now) && row?.expires_at ? Number(row.expires_at) * 1000 : null;
}

async function ensureGiftUsageTable(env) {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS gift_minute_usage (
         user_id INTEGER NOT NULL,
         year_month TEXT NOT NULL,
         seconds_granted INTEGER NOT NULL DEFAULT 0,
         seconds_used INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (user_id, year_month)
       )`
    ).run();
    await env.DB.prepare(
      'CREATE INDEX IF NOT EXISTS idx_gift_minute_usage_user ON gift_minute_usage(user_id, created_at)'
    ).run();
  } catch (_) {}
}

async function getUserRow(env, id) {
  return await env.DB.prepare(
    'SELECT id, email, status, expires_at, is_admin, plan_type, balance_seconds FROM users WHERE id = ?'
  ).bind(id).first();
}

async function requireLoggedUser(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: jsonError('login_required', 401) };
  return { user };
}

async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: jsonError('Not logged in', 401) };
  if (!user.is_admin) return { error: jsonError('Forbidden', 403) };
  return { user };
}

async function setMinuteAccessState(env, id, balanceSeconds, row, now = nowSec()) {
  const keepSubscription = isSubscriptionActive(row, now);
  const nextStatus = keepSubscription || balanceSeconds > 0 ? 'active' : 'free';
  const nextPlanType = keepSubscription
    ? 'subscription'
    : (balanceSeconds > 0 ? (row?.plan_type || 'hours') : null);
  const nextExpiresAt = keepSubscription ? row.expires_at : null;

  await env.DB.prepare(
    'UPDATE users SET balance_seconds = ?, status = ?, plan_type = ?, expires_at = ? WHERE id = ?'
  ).bind(balanceSeconds, nextStatus, nextPlanType, nextExpiresAt, id).run();

  return { nextStatus, nextPlanType, nextExpiresAt };
}

async function recordGiftUsage(env, userId, consumedSeconds) {
  let remaining = positiveSeconds(consumedSeconds);
  if (remaining <= 0) return 0;

  await ensureGiftUsageTable(env);
  let rows = [];
  try {
    const r = await env.DB.prepare(
      `SELECT user_id, year_month, claimed_at, seconds_granted, seconds_used
       FROM gift_minute_usage
       WHERE user_id = ?
         AND COALESCE(seconds_granted, 0) > COALESCE(seconds_used, 0)
       ORDER BY claimed_at ASC`
    ).bind(userId).all();
    rows = r?.results || [];
  } catch (_) {
    return 0;
  }

  let recorded = 0;
  for (const claim of rows) {
    if (remaining <= 0) break;
    const granted = positiveSeconds(claim.seconds_granted);
    const used = positiveSeconds(claim.seconds_used);
    const room = Math.max(0, granted - used);
    const add = Math.min(room, remaining);
    if (add <= 0) continue;
    await env.DB.prepare(
      `UPDATE gift_minute_usage
       SET seconds_used = COALESCE(seconds_used, 0) + ?
       WHERE user_id = ? AND year_month = ?`
    ).bind(add, userId, claim.year_month).run();
    remaining -= add;
    recorded += add;
  }
  return recorded;
}

export async function handlePaymentStatus(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) {
    return jsonResponse({
      paid: false,
      planType: null,
      expiresAt: null,
      balanceSeconds: 0,
    });
  }

  const row = await getUserRow(env, user.id);
  const now = nowSec();
  const balanceSeconds = positiveSeconds(row?.balance_seconds);
  const subscriptionActive = isSubscriptionActive(row, now);
  const minuteActive = row?.status === 'active' && balanceSeconds > 0;
  const paid = subscriptionActive || minuteActive || !!user.paid;

  if (!paid && row?.status === 'active' && balanceSeconds <= 0 && !subscriptionActive) {
    await setMinuteAccessState(env, user.id, 0, row, now).catch(() => null);
  }

  return jsonResponse({
    paid,
    planType: minuteActive && !subscriptionActive ? 'hours' : (row?.plan_type || null),
    expiresAt: visibleExpiresAt(row, now),
    balanceSeconds,
    email: user.email,
  });
}

export async function handleUsageTick(request, env) {
  if (request.method !== 'POST') return jsonError('method_not_allowed', 405);

  const auth = await requireLoggedUser(request, env);
  if (auth.error) return auth.error;

  const body = await readJson(request);
  const requested = Math.round(Number(body?.seconds) || MAX_USAGE_TICK_SECONDS);
  const seconds = Math.max(1, Math.min(MAX_USAGE_TICK_SECONDS, requested));
  const row = await getUserRow(env, auth.user.id);
  if (!row) return jsonError('user_not_found', 404);

  const now = nowSec();
  const subscriptionActive = isSubscriptionActive(row, now);
  const balance = positiveSeconds(row.balance_seconds);

  // מנוי תקופתי פעיל נותן פרימיום בפני עצמו, ולכן לא שורף יתרת דקות צדדית בזמן המנוי.
  if (subscriptionActive) {
    return jsonResponse({
      ok: true,
      consumedSeconds: 0,
      balanceSeconds: balance,
      paid: true,
      expiresAt: visibleExpiresAt(row, now),
    });
  }

  if (balance <= 0 || row.status !== 'active') {
    await setMinuteAccessState(env, auth.user.id, 0, row, now).catch(() => null);
    return jsonResponse({
      ok: true,
      consumedSeconds: 0,
      balanceSeconds: 0,
      paid: false,
      expired: true,
    });
  }

  const consumed = Math.min(seconds, balance);
  const nextBalance = Math.max(0, balance - consumed);
  await setMinuteAccessState(env, auth.user.id, nextBalance, row, now);
  const giftUsedRecorded = await recordGiftUsage(env, auth.user.id, consumed).catch(() => 0);

  return jsonResponse({
    ok: true,
    consumedSeconds: consumed,
    giftUsedRecorded,
    balanceSeconds: nextBalance,
    paid: nextBalance > 0,
    expired: nextBalance <= 0,
  });
}

export async function handleGiftClaim(request, env) {
  if (request.method !== 'POST') return jsonError('method_not_allowed', 405);

  const auth = await requireLoggedUser(request, env);
  if (auth.error) return auth.error;

  await ensureGiftUsageTable(env);
  const key = monthKey();
  const now = nowSec();

  try {
    await env.DB.prepare(
      'INSERT INTO gift_claims (user_id, year_month, claimed_at) VALUES (?, ?, ?)'
    ).bind(auth.user.id, key, now).run();
  } catch (_) {
    return jsonResponse({ granted: false, reason: 'already_claimed' });
  }

  await env.DB.prepare(
    `INSERT INTO gift_minute_usage (user_id, year_month, seconds_granted, seconds_used, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id, year_month) DO UPDATE SET
       seconds_granted = excluded.seconds_granted,
       created_at = excluded.created_at`
  ).bind(auth.user.id, key, GIFT_SECONDS_PER_MONTH, now).run().catch(() => {});

  const row = await getUserRow(env, auth.user.id);
  const currentBalance = positiveSeconds(row?.balance_seconds);
  const nextBalance = currentBalance + GIFT_SECONDS_PER_MONTH;
  const keepSubscription = isSubscriptionActive(row, now);
  const nextStatus = 'active';
  const nextPlanType = keepSubscription ? 'subscription' : (row?.plan_type || 'hours');
  const nextExpiresAt = keepSubscription ? row.expires_at : null;

  await env.DB.prepare(
    'UPDATE users SET status = ?, plan_type = ?, balance_seconds = ?, expires_at = ? WHERE id = ?'
  ).bind(nextStatus, nextPlanType, nextBalance, nextExpiresAt, auth.user.id).run();

  return jsonResponse({
    granted: true,
    addedSeconds: GIFT_SECONDS_PER_MONTH,
    newBalance: nextBalance,
    freeMinutes: {
      grantedSeconds: GIFT_SECONDS_PER_MONTH,
      usedSeconds: 0,
      unusedSeconds: GIFT_SECONDS_PER_MONTH,
    },
  });
}

export async function handleAdminMinuteAdjust(request, env, url) {
  if (request.method !== 'POST') return jsonError('method_not_allowed', 405);

  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  const m = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/minutes$/);
  const id = Number(m?.[1]);
  if (!Number.isFinite(id) || id <= 0) return jsonError('Bad id', 400);

  const body = await readJson(request);
  const deltaMinutes = Number(body?.deltaMinutes);
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) return jsonError('Bad deltaMinutes', 400);

  const row = await getUserRow(env, id);
  if (!row) return jsonError('Not found', 404);

  const deltaSec = Math.round(deltaMinutes * 60);
  const nextBalance = Math.max(0, positiveSeconds(row.balance_seconds) + deltaSec);
  const now = nowSec();
  const keepSubscription = isSubscriptionActive(row, now);
  const nextStatus = keepSubscription || nextBalance > 0 ? 'active' : 'free';
  const nextPlanType = keepSubscription ? 'subscription' : (nextBalance > 0 ? (row.plan_type || 'hours') : null);
  const nextExpiresAt = keepSubscription ? row.expires_at : null;

  await env.DB.prepare(
    'UPDATE users SET balance_seconds = ?, expires_at = ?, status = ?, plan_type = ? WHERE id = ?'
  ).bind(nextBalance, nextExpiresAt, nextStatus, nextPlanType, id).run();

  await env.DB.prepare(
    'INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, 'admin', 0, null, `adjust_${deltaMinutes > 0 ? '+' : ''}${deltaMinutes}min`, '', now).run().catch(() => {});

  const updated = await getUserRow(env, id);
  return jsonResponse({ ok: true, user: updated, deltaMinutes });
}

export async function handleAdminMinuteUsage(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;

  await ensureGiftUsageTable(env);
  const params = url.searchParams;
  const search = (params.get('search') || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(500, Number(params.get('limit')) || 100));
  const offset = Math.max(0, Number(params.get('offset')) || 0);

  const where = [];
  const binds = [];
  if (search) {
    where.push('LOWER(u.email) LIKE ?');
    binds.push(`%${search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countQ = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM users u ${whereSql}`
  ).bind(...binds).first();
  const totalCount = countQ?.c || 0;

  const rows = await env.DB.prepare(
    `WITH gift AS (
       SELECT user_id,
              SUM(COALESCE(seconds_granted, 0)) AS gift_seconds_granted,
              SUM(COALESCE(seconds_used, 0)) AS gift_seconds_used
       FROM gift_minute_usage
       GROUP BY user_id
     )
     SELECT u.id, u.email, u.status, u.plan_type, u.balance_seconds,
            COALESCE(g.gift_seconds_granted, 0) AS gift_seconds_granted,
            COALESCE(g.gift_seconds_used, 0) AS gift_seconds_used,
            CASE
              WHEN COALESCE(g.gift_seconds_granted, 0) - COALESCE(g.gift_seconds_used, 0) > 0
              THEN COALESCE(g.gift_seconds_granted, 0) - COALESCE(g.gift_seconds_used, 0)
              ELSE 0
            END AS gift_seconds_unused
     FROM users u
     LEFT JOIN gift g ON g.user_id = u.id
     ${whereSql}
     ORDER BY u.id DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();

  return jsonResponse({
    users: rows?.results || [],
    totalCount,
    limit,
    offset,
  });
}

export function buildMinuteUsageClientScript() {
  return `;(function(){
    var state = window.__RAVTEXT_AUTH__ || {};
    if (!state.loggedIn || !(Number(state.balanceSeconds || 0) > 0)) return;
    var lastActive = Date.now();
    var ticking = false;
    function markActive(){ lastActive = Date.now(); }
    ['keydown','keyup','mousedown','pointerdown','touchstart','click','input','paste','scroll'].forEach(function(name){
      window.addEventListener(name, markActive, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', function(){ if (!document.hidden) markActive(); }, { passive: true });
    function isActiveUse(){
      return !document.hidden && document.hasFocus && document.hasFocus() && Date.now() - lastActive < 120000;
    }
    async function tick(){
      if (ticking || !isActiveUse()) return;
      ticking = true;
      try {
        var res = await fetch('/api/payments/usage/tick', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ seconds: 60 })
        });
        if (res.ok) {
          var data = await res.json();
          window.__RAVTEXT_AUTH__ = window.__RAVTEXT_AUTH__ || {};
          if (typeof data.balanceSeconds === 'number') window.__RAVTEXT_AUTH__.balanceSeconds = data.balanceSeconds;
          if (typeof data.paid === 'boolean') window.__RAVTEXT_AUTH__.paid = data.paid;
          if (data.expired || data.paid === false) {
            try { localStorage.removeItem('ravtext.demoMode'); } catch(e) {}
            try { delete window.__RAVTEXT_DEMO_MODE__; } catch(e) { window.__RAVTEXT_DEMO_MODE__ = true; }
            window.dispatchEvent(new CustomEvent('ravtext:premium-expired', { detail: data }));
            setTimeout(function(){ location.reload(); }, 250);
          }
        }
      } catch(e) {
      } finally {
        ticking = false;
      }
    }
    setInterval(tick, 60000);
  })();`;
}
