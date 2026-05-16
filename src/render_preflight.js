// משה 2026-05-07: thin client for /api/render/preflight.
// כל רינדור (כל פריסה) קורא לזה לפני domPack. אם השרת לא זמין — הרינדור נעצר.

const ENDPOINT = '/api/render/preflight';

function detectLayoutType() {
  if (typeof localStorage === 'undefined') return 'regular';
  if (localStorage.getItem('ravtext.talmudLayout') === '1') return 'talmud';
  if (localStorage.getItem('ravtext.mishnaWrap') === '1') return 'mishna-wrap';
  if (localStorage.getItem('ravtext.balancedColumns') === '1') return 'balanced';
  return 'regular';
}

let _lastPlan = null;
let _lastPlanAt = 0;

export function getLastPlan() { return _lastPlan; }

export function getNonceHeader() {
  if (_lastPlan?.token) return { 'x-ravtext-nonce': _lastPlan.token };
  return {};
}

const PREFLIGHT_TIMEOUT_MS = 8000;

export async function runPreflight({ contentSignature, smart, talmud, signal } = {}) {
  const body = { layoutType: detectLayoutType(), contentSignature: contentSignature || null, timestamp: Date.now() };
  if (smart) body.smart = smart;
  if (talmud) body.talmud = talmud;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS) : null;
  const abortFromOutside = () => { try { controller?.abort(); } catch (_) {} };

  if (signal && controller) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abortFromOutside, { once: true });
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) throw new Error(`Render preflight failed: HTTP ${res.status}`);
    const plan = await res.json();
    _lastPlan = plan;
    _lastPlanAt = Date.now();
    return plan;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      if (signal?.aborted) {
        const e = new Error('Render preflight aborted by user');
        e.name = 'AbortError';
        throw e;
      }
      throw new Error(`Render preflight timeout after ${PREFLIGHT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (signal && controller) signal.removeEventListener('abort', abortFromOutside);
  }
}
