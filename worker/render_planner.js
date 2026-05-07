// צוות האתר 2026-05-07: Universal render preflight + planner.
// כל רינדור (תלמוד, שני טורים, טקסט רגיל, או כל פריסה אחרת) מחויב לעבור דרך
// /api/render/preflight לפני שהדפדפן מתחיל לפרק לעמודים. בלי תשובת השרת —
// הרינדור נעצר.
//
// תפקידי השרת:
// 1. אימות (paid/demo)
// 2. בדיקת קצב (כבר ב-security.js)
// 3. החלטות עומק רינדור: safety value, crown mode, page break hints
// 4. מנפיק token שצריך להישלח בקריאות הבאות (engine pieces)

import { getUserFromRequest } from './session.js';

// צוות האתר 2026-05-07: nonce חתום HMAC. preflight מנפיק; מנועים בודקים.
const NONCE_TTL_SEC = 120;

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDec(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function signNonce(payload, secret) {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return `${b64url(data)}.${b64url(sig)}`;
}
async function verifyNonce(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const data = b64urlDec(parts[0]);
  const sig = b64urlDec(parts[1]);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const ok = await crypto.subtle.verify('HMAC', key, sig, data);
  if (!ok) return null;
  try { return JSON.parse(new TextDecoder().decode(data)); } catch { return null; }
}

async function issueNonce(env) {
  const nowSec = Math.floor(Date.now() / 1000);
  return await signNonce({ iat: nowSec, exp: nowSec + NONCE_TTL_SEC, jti: crypto.randomUUID() }, env.SESSION_SECRET);
}

export async function checkNonce(request, env) {
  const token = request.headers.get('x-ravtext-nonce') || '';
  if (!token) return new Response('Missing nonce', { status: 403 });
  const payload = await verifyNonce(token, env.SESSION_SECRET);
  if (!payload) return new Response('Bad nonce', { status: 403 });
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec) return new Response('Expired nonce', { status: 403 });
  return null;
}

const SAFETY_MIN = 0;
const SAFETY_MAX = 400;
const SAFETY_DEFAULT = 160;
const SAFETY_STEP_UP = 20;
const SAFETY_STEP_DOWN = 20;
const OVERFLOW_THRESHOLD = 5;
const GAP_TOO_BIG = 60;

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function decideAdjustment(currentSafety, state) {
  if (state.maxOverflow > OVERFLOW_THRESHOLD) {
    return {
      newSafety: clamp(currentSafety + SAFETY_STEP_UP, SAFETY_MIN, SAFETY_MAX),
      action: 'up',
      reason: `overflow ${state.maxOverflow}px > ${OVERFLOW_THRESHOLD}px`,
    };
  }
  if (state.maxOverflow === 0 && state.avgGap > GAP_TOO_BIG && currentSafety > SAFETY_MIN) {
    return {
      newSafety: clamp(currentSafety - SAFETY_STEP_DOWN, SAFETY_MIN, SAFETY_MAX),
      action: 'down',
      reason: `avg gap ${state.avgGap}px > ${GAP_TOO_BIG}px, no overflow`,
    };
  }
  return {
    newSafety: currentSafety,
    action: 'stable',
    reason:
      state.maxOverflow > 0
        ? `overflow ${state.maxOverflow}px (within tolerance)`
        : `gap ${state.avgGap}px (acceptable)`,
  };
}

function decideTalmudCrownMode(streams, hasMain, crownLines) {
  if (!Array.isArray(streams) || streams.length === 0) return { mode: 'no-talmud' };

  if (streams.length === 1) {
    const { linesAtFull, linesAtHalf } = streams[0] || {};
    if (
      Number.isFinite(linesAtFull) &&
      Number.isFinite(linesAtHalf) &&
      linesAtFull >= crownLines &&
      linesAtHalf >= crownLines * 2
    ) {
      return { mode: 'single-split' };
    }
    return { mode: 'single-inline' };
  }

  const a = streams[0] || {};
  const b = streams[1] || {};
  const aHalf = a.linesAtHalf || 0;
  const bHalf = b.linesAtHalf || 0;

  if (aHalf >= crownLines && bHalf >= crownLines) return { mode: 'double-half' };
  if (aHalf < crownLines && bHalf < crownLines) return { mode: 'double-inline' };

  const longIdx = aHalf >= crownLines ? 0 : 1;
  const longFull = streams[longIdx]?.linesAtFull || 0;
  if (longFull >= crownLines) return { mode: 'double-full', longIdx };

  return { mode: 'double-inline' };
}

export async function handlePreflight(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const user = await getUserFromRequest(request, env);
  const layoutType = String(body?.layoutType || 'regular');

  const nonce = await issueNonce(env);
  const plan = {
    token: nonce,
    issuedAt: Date.now(),
    auth: {
      paid: !!user,
      email: user?.email || null,
    },
    layoutType,
    decisions: {},
  };

  if (layoutType === 'talmud' || layoutType === 'any') {
    const crownLines = Number(body?.talmud?.crownLines) || 4;
    const streams = Array.isArray(body?.talmud?.streams) ? body.talmud.streams : [];
    const hasMain = !!body?.talmud?.hasMain;
    plan.decisions.talmud = decideTalmudCrownMode(streams, hasMain, crownLines);
  }

  if (body?.smart?.currentSafety != null && body?.smart?.state) {
    const cs = Number(body.smart.currentSafety);
    plan.decisions.safety = decideAdjustment(
      Number.isFinite(cs) ? cs : SAFETY_DEFAULT,
      body.smart.state
    );
  } else {
    plan.decisions.safety = { newSafety: SAFETY_DEFAULT, action: 'default' };
  }

  return Response.json(plan, {
    headers: { 'cache-control': 'no-store' },
  });
}

function decideBalanceLayout(lineCount, settings) {
  const minLines = Number.isFinite(Number(settings?.minLinesForCols))
    ? Number(settings.minLinesForCols)
    : 3;
  if (lineCount < minLines * 2) {
    return { balance: false, reason: `lines ${lineCount} < ${minLines * 2}` };
  }
  const lastCenter = settings?.lastLineCenter !== false;
  const hasOrphan = lineCount % 2 === 1 && lastCenter;
  const balancedCount = hasOrphan ? lineCount - 1 : lineCount;
  const half = Math.ceil(balancedCount / 2);
  return {
    balance: true,
    rightStart: 0,
    rightEnd: half,
    leftStart: half,
    leftEnd: balancedCount,
    hasOrphan,
    centerLast: lastCenter,
  };
}

// צוות האתר 2026-05-07: פריסת משנה־wrap. מקבל pageNumber + רשימת סטרימים עם
// העדפת צד ורוחב שלהם, מחזיר את הצד הסופי (right/left) שכל סטרים יקבל בעמוד.
function decideMishnaSide(preference, pageNumber, idx) {
  if (preference === 'right' || preference === 'left') return preference;
  if (preference === 'outer') return pageNumber % 2 === 1 ? 'left' : 'right';
  if (preference === 'inner') return pageNumber % 2 === 1 ? 'right' : 'left';
  return idx % 2 === 0 ? 'right' : 'left';
}

// צוות האתר 2026-05-07: מועתק שורה־שורה מ-flow_layout.js → widthForFlowFloat.
// הפורמט המדויק קריטי: calc(N.NNNN% - 8px). חיסור 8 פיקסלים = הרווח בין זרמים.
function widthForFlowFloat(levelCount) {
  const count = Math.max(1, Number(levelCount) || 1);
  const percent = 100 / count;
  return `calc(${percent.toFixed(4)}% - 8px)`;
}

// מועתק שורה־שורה מ-mishna_wrap_layout.js → widthForStream.
function decideMishnaWidth(explicitWidth, levelCount) {
  const w = Number(explicitWidth);
  if (Number.isFinite(w) && w > 0) {
    return `${Math.max(10, Math.min(95, w))}%`;
  }
  return widthForFlowFloat(levelCount);
}

function decideMishnaLevels(rawLevelsText, streamCodes) {
  const parsed = String(rawLevelsText || '')
    .split(/[|\n;]+/)
    .map((level) =>
      (level.match(/\d{1,3}/g) || [])
        .map((n) => {
          const v = parseInt(n, 10);
          return Number.isFinite(v) && v >= 1 ? String(v).padStart(2, '0') : null;
        })
        .filter(Boolean)
    )
    .map((level) => Array.from(new Set(level)))
    .filter((level) => level.length >= 2);

  if (parsed.length > 0) return parsed;
  // Default: all streams in one level
  const codes = (streamCodes || []).filter(Boolean);
  return codes.length >= 2 ? [Array.from(new Set(codes))] : [];
}

export async function handleMishnaDecide(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const pageNumber = Number(body?.pageNumber) || 1;
  const streams = Array.isArray(body?.streams) ? body.streams : [];
  const rawLevels = body?.rawLevelsText || '';
  const codes = streams.map((s) => s?.code).filter(Boolean);

  const levels = decideMishnaLevels(rawLevels, codes);

  const assignments = streams.map((s, idx) => ({
    code: s?.code || null,
    side: decideMishnaSide(s?.sidePreference || 'auto', pageNumber, idx),
    width: decideMishnaWidth(s?.explicitWidth, streams.length),
  }));

  return Response.json({ assignments, levels }, {
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleBalanceDecide(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const lineCount = Number(body?.lineCount);
  if (!Number.isFinite(lineCount) || lineCount < 0) {
    return new Response('Bad lineCount', { status: 400 });
  }
  const decision = decideBalanceLayout(lineCount, body?.settings || {});
  return Response.json(decision, {
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleTalmudDecide(request, env) {
  // צוות האתר 2026-05-07: גפ"ת = פיצ'ר פרמיום. רק משלמים מקבלים את ההחלטות.
  const user = await getUserFromRequest(request, env);
  if (!user || !user.paid) {
    return Response.json(
      { mode: 'denied', reason: 'paid_only', message: 'גפ"ת זמין למנויים פעילים בלבד.' },
      { status: 402, headers: { 'cache-control': 'no-store' } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const crownLines = Number(body?.crownLines) || 4;
  const streams = Array.isArray(body?.streams) ? body.streams : [];
  const hasMain = !!body?.hasMain;
  const decision = decideTalmudCrownMode(streams, hasMain, crownLines);

  return Response.json(decision, {
    headers: { 'cache-control': 'no-store' },
  });
}
