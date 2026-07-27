import app from './index_tidio_ai_debug_v8.js';

const DIAGNOSTICS_PATHS = new Set(['/diagnostics', '/diagnostics/', '/diagnostics/index.html']);
const STATIC_MARKER = 'RAVTEXT_DIAGNOSTICS_STATIC_V5';

async function serveDiagnosticsPage(request, env) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/diagnostics/index.html';
  assetUrl.search = '';
  const assetRequest = new Request(assetUrl.toString(), request);
  let html = '';

  try {
    const assetResponse = await env.ASSETS.fetch(assetRequest);
    html = await assetResponse.text();
  } catch (error) {
    html = '';
  }

  const headers = new Headers({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-ravtext-diagnostics-entry': 'worker/index_diagnostics_live.js',
  });

  if (!html.includes(STATIC_MARKER)) {
    return new Response(`<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>בדיקות AI</title></head>
<body style="font-family:Arial,sans-serif;max-width:760px;margin:30px auto;padding:16px;line-height:1.6;background:#f7f7fb;color:#172033">
  <main style="background:white;border:1px solid #ddd;border-radius:14px;padding:18px">
    <h1>עמוד הבדיקות עדיין לא נבנה בפריסה</h1>
    <p>ה־Worker פעיל, אבל הקובץ <code>public/diagnostics/index.html</code> עדיין לא הגיע ל־dist בפריסה החיה.</p>
    <p>יש להמתין לסיום build/deploy ולרענן חזק.</p>
    <pre style="direction:ltr;text-align:left;background:#eef2ff;padding:12px;border-radius:10px">expected_marker=${STATIC_MARKER}</pre>
  </main>
</body>
</html>`, { status: 503, headers });
  }

  return new Response(html, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (DIAGNOSTICS_PATHS.has(url.pathname)) {
      return serveDiagnosticsPage(request, env);
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
