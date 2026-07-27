const originalFetch = globalThis.fetch.bind(globalThis);

function shouldPatchGeminiUrl(url) {
  return url &&
    url.hostname === 'generativelanguage.googleapis.com' &&
    url.searchParams &&
    url.searchParams.has('key');
}

function patchedGeminiFetch(input, init) {
  if (typeof input !== 'string' && !(input instanceof URL)) return null;

  let url;
  try {
    url = new URL(String(input));
  } catch (_) {
    return null;
  }

  if (!shouldPatchGeminiUrl(url)) return null;

  const apiKey = url.searchParams.get('key') || '';
  url.searchParams.delete('key');

  const nextInit = { ...(init || {}) };
  const headers = new Headers(nextInit.headers || {});
  if (apiKey && !headers.has('x-goog-api-key')) {
    headers.set('x-goog-api-key', apiKey);
  }
  nextInit.headers = headers;

  return originalFetch(url.toString(), nextInit);
}

// Google AI Studio now creates Gemini auth keys in formats that are not guaranteed to work
// through the legacy `?key=` query style. Normalize every Gemini API call to the current
// `x-goog-api-key` header style before importing the existing worker chain.
if (!globalThis.__RAVTEXT_GEMINI_X_GOOG_API_KEY_PATCH__) {
  const wrappedFetch = (input, init) => {
    const patched = patchedGeminiFetch(input, init);
    if (patched) return patched;
    return originalFetch(input, init);
  };
  globalThis.fetch = wrappedFetch;
  globalThis.__RAVTEXT_GEMINI_X_GOOG_API_KEY_PATCH__ = true;
}

const appPromise = import('./index_tidio_ai_debug_v7.js').then((mod) => mod.default);

export default {
  async fetch(request, env, ctx) {
    const app = await appPromise;
    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const app = await appPromise;
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
