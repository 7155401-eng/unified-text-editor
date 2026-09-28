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

// ★ משה 28/09/2026 — "רוב הבעיות קיימות בו, איני יודע אם משהו תוקן בכלל".
//
// זה היה השורש האמיתי לכך שתיקונים נפרסו ולא הגיעו למסך.
// נמדד על הייצוא שלו מ-04:39, אחרי שהפריסה של d84bb1b הסתיימה
// בהצלחה ב-00:08 UTC:
//   • ה-CSS החדש **כן** הופיע בייצוא
//   • 3,726 שורות עדיין בגובה 20.15px — כלומר ה-JS הישן
//   • מספר הגרסה לא הוצג כלל
//
// ההסבר: ב-vite.config.js יש `PUBLIC_CACHE_BUST`, אבל הוא מוסיף
// `?v=timestamp` **רק לקובצי CSS**. index.html עצמו נשמר במטמון
// הדפדפן, ומכיוון שהוא זה שמפנה אל קובץ ה-JS עם ה-hash, דפדפן
// שמחזיק HTML ישן ימשיך לטעון את ה-JS הישן — גם אחרי פריסה מוצלחת.
// כך נוצר בדיוק מה שמשה ראה: העיצוב מתעדכן והמנוע לא.
//
// התיקון: מסמך HTML מוגש עם `no-cache`. זה אינו מבטל מטמון —
// הדפדפן עדיין שומר עותק, אבל **חייב לשאול את השרת** אם הוא עדכני
// לפני שהוא משתמש בו. קובצי ה-JS וה-CSS עצמם נשארים עם מטמון ארוך,
// כי שמם כולל hash שמשתנה בכל בנייה.
const HTML_NO_CACHE = 'no-cache, must-revalidate';

function withFreshHtmlHeaders(response) {
  try {
    const type = response.headers.get('content-type') || '';
    if (!type.includes('text/html')) return response;
    const headers = new Headers(response.headers);
    headers.set('cache-control', HTML_NO_CACHE);
    headers.set('x-ravtext-html-cache', 'revalidate');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (_) {
    return response;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (DIAGNOSTICS_PATHS.has(url.pathname)) {
      return serveDiagnosticsPage(request, env);
    }
    const response = await app.fetch(request, env, ctx);
    return withFreshHtmlHeaders(response);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
