// משה 2026-05-07: thin client for /api/render/preflight.
// כל רינדור (כל פריסה) קורא לזה לפני domPack. אם השרת לא זמין — הרינדור נעצר.

const ENDPOINT = '/api/render/preflight';

// Backward-compatibility shim for older cached V9 render code.
// The current V9 path applies the real spacing through applyV9MainBottomGap.
// Older bundles may still call applyV9VisualSafetyGap from global scope; keep
// that call from crashing while the modern gap pass remains authoritative.
function installLegacyV9VisualSafetyGapShim() {
  try {
    const root = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (!root || typeof root.applyV9VisualSafetyGap === 'function') return;

    root.applyV9VisualSafetyGap = function applyV9VisualSafetyGap(container, options = {}) {
      if (typeof root.applyV9MainBottomGap === 'function') {
        return root.applyV9MainBottomGap(container, options);
      }
      try {
        const target = container && container.querySelectorAll ? container : document;
        for (const pageEl of Array.from(target.querySelectorAll?.('.page.v9-page, .v9-page') || [])) {
          if (pageEl?.dataset) pageEl.dataset.v9VisualSafetyGapShim = '1';
        }
      } catch (_) {
        // Compatibility only: never let a legacy visual-safety call break render.
      }
      return [];
    };
  } catch (_) {
    // Compatibility only: keep render preflight side-effect free on unsupported runtimes.
  }
}

installLegacyV9VisualSafetyGapShim();

// Helper: figure out which layout type is currently active.
function detectLayoutType() {
  if (typeof localStorage === 'undefined') return 'regular';
  if (localStorage.getItem('ravtext.talmudLayout') === '1') return 'talmud';
  if (localStorage.getItem('ravtext.mishnaWrap') === '1') return 'mishna-wrap';
  if (localStorage.getItem('ravtext.balancedColumns') === '1') return 'balanced';
  return 'regular';
}

let _lastPlan = null;
let _lastPlanAt = 0;

export function getLastPlan() {
  return _lastPlan;
}

// צוות האתר 2026-05-07: בכל קריאה לנתיב מנוע אחר (talmud/balance/mishna),
// יש לכלול את הטוקן בכותרת x-ravtext-nonce. הטוקן תקף 120 שניות; preflight חדש מנפיק חדש.
export function getNonceHeader() {
  if (_lastPlan?.token) return { 'x-ravtext-nonce': _lastPlan.token };
  return {};
}

// משה 2026-05-14: timeout קשיח של 8 שניות. ראינו מקרים שבהם fetch תקוע
// (Cloudflare cold start / connection issue) וה-await ל-runPreflight לא חוזר
// לעולם, אז ה-"מרענן..." נשאר נצח על המסך. עם AbortController + timeout,
// אם השרת לא מגיב — fetch יזרוק וההודעה המתאימה תוצג.
const PREFLIGHT_TIMEOUT_MS = 8000;

export async function runPreflight({ contentSignature, smart, talmud } = {}) {
  const body = {
    layoutType: detectLayoutType(),
    contentSignature: contentSignature || null,
    timestamp: Date.now(),
  };
  if (smart) body.smart = smart;
  if (talmud) body.talmud = talmud;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)
    : null;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) {
      throw new Error(`Render preflight failed: HTTP ${res.status}`);
    }
    const plan = await res.json();
    _lastPlan = plan;
    _lastPlanAt = Date.now();
    return plan;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Render preflight timeout after ${PREFLIGHT_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
