// משה 2026-05-07: כניסה יחידה ל-Worker. שלוש משימות:
// 1. /api/auth/* — מטופל ע"י auth.js (התחברות גוגל)
// 2. /api/me — מחזיר מצב משתמש לפרונט (paid/demo + email)
// 3. כל בקשה אחרת ל-HTML — מחדיר לתוך index.html שני משתני חלון לפני שה-JS עולה,
//    כך שהמנגנון הקיים (demo_mode.js) רואה paid/demo כבר ברגע הראשון.

import { handleAuth } from './auth.js';
import { getUserFromRequest } from './session.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/auth/')) {
      return handleAuth(request, env, url);
    }

    if (url.pathname === '/api/me') {
      const user = await getUserFromRequest(request, env);
      return Response.json({
        paid: !!user,
        email: user?.email || null,
        admin: user?.is_admin === 1,
      }, {
        headers: {
          'cache-control': 'no-store',
        },
      });
    }

    const assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return assetResponse;
    }

    const user = await getUserFromRequest(request, env);
    const html = await assetResponse.text();

    const authState = {
      paid: !!user,
      email: user?.email || null,
      admin: user?.is_admin === 1,
    };
    const flagLines = user
      ? 'window.__RAVTEXT_DEMO_MODE__ = false; localStorage.setItem("ravtext.demoMode","0");'
      : '';
    const injection = `<script>window.__RAVTEXT_AUTH__ = ${JSON.stringify(authState)};${flagLines}</script>`;

    const injected = html.includes('</head>')
      ? html.replace('</head>', `${injection}</head>`)
      : injection + html;

    const newHeaders = new Headers(assetResponse.headers);
    newHeaders.delete('content-length');

    return new Response(injected, {
      status: assetResponse.status,
      headers: newHeaders,
    });
  },
};
