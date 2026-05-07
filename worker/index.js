// משה 2026-05-07: כניסה יחידה ל-Worker. שלוש משימות:
// 1. /api/auth/* — מטופל ע"י auth.js (התחברות גוגל)
// 2. /api/me — מחזיר מצב משתמש לפרונט (paid/demo + email)
// 3. כל בקשה אחרת ל-HTML — מחדיר לתוך index.html שני משתני חלון לפני שה-JS עולה,
//    כך שהמנגנון הקיים (demo_mode.js) רואה paid/demo כבר ברגע הראשון.
// כל תגובה עוברת דרך applySecurityHeaders + checkRateLimit + isBadBot.

import { handleAuth } from './auth.js';
import { getUserFromRequest } from './session.js';
import { applySecurityHeaders, checkRateLimit, isBadBot } from './security.js';
import { parseStreamsToHtml } from './stream_parser.js';
import { handlePreflight, handleTalmudDecide } from './render_planner.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isBadBot(request) && url.pathname !== '/robots.txt') {
      return new Response('Forbidden', { status: 403 });
    }

    const limited = await checkRateLimit(request, url);
    if (limited) return limited;

    let response;
    let isHtml = false;

    if (url.pathname.startsWith('/api/auth/')) {
      response = await handleAuth(request, env, url);
    } else if (url.pathname === '/api/me') {
      const user = await getUserFromRequest(request, env);
      response = Response.json(
        {
          paid: !!user,
          email: user?.email || null,
          admin: user?.is_admin === 1,
        },
        { headers: { 'cache-control': 'no-store' } }
      );
    } else if (url.pathname === '/api/render/preflight' && request.method === 'POST') {
      response = await handlePreflight(request, env);
    } else if (url.pathname === '/api/talmud/decide' && request.method === 'POST') {
      response = await handleTalmudDecide(request, env);
    } else if (url.pathname === '/api/streams/parse' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        response = new Response('Invalid JSON', { status: 400 });
      }
      if (!response) {
        const text = String(body?.text || '');
        if (text.length > 200000) {
          response = new Response('Text too large (max 200000 chars)', { status: 413 });
        } else {
          const result = parseStreamsToHtml(text);
          response = Response.json(result, {
            headers: { 'cache-control': 'no-store' },
          });
        }
      }
    } else {
      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get('content-type') || '';
      isHtml = contentType.includes('text/html');

      if (!isHtml) {
        response = assetResponse;
      } else {
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

        response = new Response(injected, {
          status: assetResponse.status,
          headers: newHeaders,
        });
      }
    }

    return applySecurityHeaders(response, isHtml);
  },
};
