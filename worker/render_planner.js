// משה 2026-05-07: Universal render preflight + planner.
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

  const plan = {
    token: crypto.randomUUID(),
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
