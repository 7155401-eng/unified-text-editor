// צוות האתר 2026-05-07: כניסה יחידה ל-Worker. שלוש משימות:
// 1. /api/auth/* — מטופל ע"י auth.js (התחברות גוגל)
// 2. /api/me — מחזיר מצב משתמש לפרונט (paid/demo + email)
// 3. כל בקשה אחרת ל-HTML — מחדיר לתוך index.html שני משתני חלון לפני שה-JS עולה,
//    כך שהמנגנון הקיים (demo_mode.js) רואה paid/demo כבר ברגע הראשון.
// כל תגובה עוברת דרך applySecurityHeaders + checkRateLimit + isBadBot.

import { handleAuth } from './auth.js';
import { getUserFromRequest } from './session.js';
import { applySecurityHeaders, checkRateLimit, isBadBot, isEngineApi, checkOrigin } from './security.js';
import { parseStreamsToHtml } from './stream_parser.js';
import { handlePreflight, handleTalmudDecide, handleBalanceDecide, handleMishnaDecide, checkNonce } from './render_planner.js';
import { handleAdmin } from './admin.js';
import { handleAdminInbox, handlePublicInbox } from './inbox.js';
import { handleStorage } from './storage.js';
import { handlePayments } from './payments.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isBadBot(request) && url.pathname !== '/robots.txt') {
      return new Response('Forbidden', { status: 403 });
    }

    // צוות האתר 2026-05-07: נתיבי מנוע — רק מ-Origin/Referer מורשה.
    if (isEngineApi(url.pathname)) {
      const blocked = checkOrigin(request, url);
      if (blocked) return blocked;
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
          loggedIn: !!user,
          paid: !!user?.paid,
          email: user?.email || null,
          admin: !!user?.is_admin,
          status: user?.status || null,
        },
        { headers: { 'cache-control': 'no-store' } }
      );
    } else if (
      url.pathname === '/api/admin/bug-reports' ||
      url.pathname.startsWith('/api/admin/bug-reports/') ||
      url.pathname === '/api/admin/contact-messages' ||
      url.pathname.startsWith('/api/admin/contact-messages/') ||
      url.pathname === '/api/admin/usage'
    ) {
      response = await handleAdminInbox(request, env, url);
    } else if (url.pathname.startsWith('/api/admin/')) {
      response = await handleAdmin(request, env, url);
    } else if (
      url.pathname === '/api/bug-reports' ||
      url.pathname === '/api/contact' ||
      url.pathname === '/api/usage/track'
    ) {
      response = await handlePublicInbox(request, env, url);
    } else if (url.pathname.startsWith('/api/payments/')) {
      response = await handlePayments(request, env, url);
    } else if (
      url.pathname.startsWith('/api/documents') ||
      url.pathname === '/api/settings'
    ) {
      response = await handleStorage(request, env, url);
    } else if (url.pathname === '/admin' || url.pathname === '/admin/') {
      const adminUrl = new URL(request.url);
      adminUrl.pathname = '/admin.html';
      const adminReq = new Request(adminUrl.toString(), request);
      response = await env.ASSETS.fetch(adminReq);
      isHtml = true;
    } else if (url.pathname === '/api/render/preflight' && request.method === 'POST') {
      response = await handlePreflight(request, env);
    } else if (url.pathname === '/api/talmud/decide' && request.method === 'POST') {
      const nonceFail = await checkNonce(request, env);
      response = nonceFail || await handleTalmudDecide(request, env);
    } else if (url.pathname === '/api/balance/decide' && request.method === 'POST') {
      const nonceFail = await checkNonce(request, env);
      response = nonceFail || await handleBalanceDecide(request, env);
    } else if (url.pathname === '/api/mishna/decide' && request.method === 'POST') {
      const nonceFail = await checkNonce(request, env);
      response = nonceFail || await handleMishnaDecide(request, env);
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
          loggedIn: !!user,
          paid: !!user?.paid,
          email: user?.email || null,
          admin: !!user?.is_admin,
          status: user?.status || null,
        };
        // צוות האתר 2026-05-07: paid → תצוגה מלאה (demo OFF). הצגת דמו במכל מצב אחר —
        // כולל "מחובר אך לא מאושר" (משתמש שלא שודרג ע"י צוות האתר ב-DB).
        // localStorage('ravtext.demoMode') חייב להתאפס בכל מצב לא־משלם, אחרת
        // ערך "0" שנשאר מהתחברות paid קודמת ידרוס את ברירת המחדל וייצור תצוגה מלאה זדונית.
        const flagLines = (user && user.paid)
          ? 'window.__RAVTEXT_DEMO_MODE__ = false; try{localStorage.setItem("ravtext.demoMode","0");}catch(e){}'
          : 'try{localStorage.removeItem("ravtext.demoMode");}catch(e){}delete window.__RAVTEXT_DEMO_MODE__;';
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
