// משה 2026-05-07: thin client for /api/render/preflight.
// כל רינדור (כל פריסה) קורא לזה לפני domPack. אם השרת לא זמין — הרינדור נעצר.

const ENDPOINT = '/api/render/preflight';

// Helper: figure out which layout type is currently active.
function detectLayoutType() {
  if (typeof localStorage === 'undefined') return 'regular';
  if (localStorage.getItem('ravtext.talmudLayout') === '1') return 'talmud';
  if (localStorage.getItem('ravtext.mishna_wrap_layout') === '1') return 'mishna-wrap';
  if (localStorage.getItem('ravtext.balancedColumns') === '1') return 'balanced';
  return 'regular';
}

let _lastPlan = null;
let _lastPlanAt = 0;

export function getLastPlan() {
  return _lastPlan;
}

export async function runPreflight({ contentSignature, smart, talmud } = {}) {
  const body = {
    layoutType: detectLayoutType(),
    contentSignature: contentSignature || null,
    timestamp: Date.now(),
  };
  if (smart) body.smart = smart;
  if (talmud) body.talmud = talmud;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Render preflight failed: HTTP ${res.status}`);
  }
  const plan = await res.json();
  _lastPlan = plan;
  _lastPlanAt = Date.now();
  return plan;
}
