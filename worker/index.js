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
import { handleAdmin, isConsoleGuardEnabled } from './admin.js';
import { handleVideoGallery, handleAdminVideoGallery } from './video_gallery.js';
import { handleAdminInbox, handlePublicInbox } from './inbox.js';
import { handleStorage } from './storage.js';
import { handlePayments } from './payments.js';
import { handleAccount } from './account.js';
import { handlePaymentAdmin, handlePackageLookup } from './payment_admin.js';
import { runRecurringBilling, handleManualRecur } from './recurring.js';
import { handleCaricature } from './caricature.js';
import { handleCaricatureAdmin } from './caricature_admin.js';
import { handleAiChat, handleAiTools } from './ai_tools.js';
import { handleToolPreflight } from './tool_gate.js';
import { handleNikudMerger } from './nikud_merger.js';
import { handleTextComparePro } from './text_compare_pro.js';
import { handleSefariaProxy } from './sefaria_proxy.js';
import { handleMainTextTools } from './main_text_tools.js';

async function serveAdminPage(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) {
    return new Response('Not logged in', { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  if (!user.is_admin) {
    return new Response('Forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  }
  const adminUrl = new URL(request.url);
  adminUrl.pathname = '/admin.html';
  const adminReq = new Request(adminUrl.toString(), request);
  return env.ASSETS.fetch(adminReq);
}

function isRenderPlannerApi(pathname) {
  return (
    pathname.startsWith('/api/render/') ||
    pathname.startsWith('/api/talmud/') ||
    pathname.startsWith('/api/balance/') ||
    pathname.startsWith('/api/mishna/')
  );
}

async function isAdminRenderRequest(request, env, pathname) {
  if (!isRenderPlannerApi(pathname)) return false;
  try {
    const user = await getUserFromRequest(request, env);
    return !!user?.is_admin;
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isBadBot(request) && url.pathname !== '/robots.txt') {
      return new Response('Forbidden', { status: 403 });
    }

    // צוות האתר 2026-05-07: נתיבי מנוע — רק מ-Origin/Referer מורשה.
    // משה 2026-05-17: במצב מנהל מותר להפעיל את מנוע הרינדור מכל מקור.
    // לא מסתמכים על פרמטר מהלקוח; רק session חתום + is_admin מה-DB.
    if (isEngineApi(url.pathname)) {
      const allowAnyOriginForAdminRender = await isAdminRenderRequest(request, env, url.pathname);
      if (!allowAnyOriginForAdminRender) {
        const blocked = checkOrigin(request, url);
        if (blocked) return blocked;
      }
    }

    const limited = await checkRateLimit(request, url);
    if (limited) return limited;

    let response;
    let isHtml = false;

    if (url.pathname.startsWith('/api/auth/')) {
      response = await handleAuth(request, env, url);
    } else if (url.pathname === '/api/me') {
      const user = await getUserFromRequest(request, env);
      const consoleGuardEnabled = await isConsoleGuardEnabled(env);
      response = Response.json(
        {
          loggedIn: !!user,
          paid: !!user?.paid,
          email: user?.email || null,
          admin: !!user?.is_admin,
          status: user?.status || null,
          planType: user?.plan_type || null,
          expiresAt: user?.expires_at ? user.expires_at * 1000 : null,
          balanceSeconds: user?.balance_seconds || 0,
          consoleGuardEnabled,
        },
        { headers: { 'cache-control': 'no-store' } }
      );
    } else if (
      url.pathname === '/api/admin/bug-reports' ||
      url.pathname.startsWith('/api/admin/bug-reports/') ||
      url.pathname === '/api/admin/contact-messages' ||
      url.pathname.startsWith('/api/admin/contact-messages/') ||
      url.pathname === '/api/admin/usage' ||
      /^\/api\/admin\/users\/\d+\/contact-messages$/.test(url.pathname)
    ) {
      response = await handleAdminInbox(request, env, url);
    } else if (
      url.pathname === '/api/admin/payment-config' ||
      url.pathname === '/api/admin/test-packages' ||
      url.pathname.startsWith('/api/admin/test-packages/')
    ) {
      response = await handlePaymentAdmin(request, env, url);
    } else if (url.pathname === '/api/admin/caricature-settings') {
      response = await handleCaricatureAdmin(request, env, url);
    } else if (url.pathname === '/api/admin/video-gallery/playlist') {
      response = await handleAdminVideoGallery(request, env, url);
    } else if (url.pathname.startsWith('/api/admin/')) {
      response = await handleAdmin(request, env, url);
    } else if (
      url.pathname === '/api/bug-reports' ||
      url.pathname === '/api/bug-reports/public' ||
      url.pathname === '/api/contact' ||
      url.pathname === '/api/contact/mine' ||
      url.pathname === '/api/usage/track'
    ) {
      response = await handlePublicInbox(request, env, url);
    } else if (url.pathname === '/api/video-gallery/playlist') {
      response = await handleVideoGallery(request, env, url);
    } else if (url.pathname.startsWith('/api/payments/package/')) {
      response = await handlePackageLookup(request, env, url);
    } else if (url.pathname.startsWith('/api/payments/')) {
      response = await handlePayments(request, env, url);
    } else if (url.pathname.startsWith('/api/account/')) {
      response = await handleAccount(request, env);
    } else if (
      url.pathname.startsWith('/api/documents') ||
      url.pathname === '/api/settings'
    ) {
      response = await handleStorage(request, env, url);
    } else if (url.pathname === '/api/caricature') {
      response = await handleCaricature(request, env);
    } else if (url.pathname === '/api/ai-tools/gas') {
      response = await handleAiTools(request, env);
    } else if (url.pathname === '/api/ai-tools/chat') {
      response = await handleAiChat(request);
    } else if (url.pathname === '/api/tools/preflight') {
      response = await handleToolPreflight(request, env);
    } else if (url.pathname === '/api/nikud-merger') {
      response = await handleNikudMerger(request);
    } else if (url.pathname === '/api/text-compare-pro') {
      response = await handleTextComparePro(request);
    } else if (url.pathname.startsWith('/api/sefaria/')) {
      response = await handleSefariaProxy(request, url);
    } else if (url.pathname === '/api/main-text-tools') {
      response = await handleMainTextTools(request);
    } else if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin.html') {
      response = await serveAdminPage(request, env);
      isHtml = response.headers.get('content-type')?.includes('text/html') || response.status < 400;
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
        const consoleGuardEnabled = await isConsoleGuardEnabled(env);

        const authState = {
          loggedIn: !!user,
          paid: !!user?.paid,
          email: user?.email || null,
          admin: !!user?.is_admin,
          status: user?.status || null,
          planType: user?.plan_type || null,
          expiresAt: user?.expires_at ? user.expires_at * 1000 : null,
          balanceSeconds: user?.balance_seconds || 0,
          consoleGuardEnabled,
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

  // משה 2026-05-10: cron יומי — חיוב חוזר אוטומטי. רץ כל בוקר ב-04:00 UTC.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRecurringBilling(env).catch(() => null));
  },
};
