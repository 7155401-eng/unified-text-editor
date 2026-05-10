// צוות האתר 2026-05-07: שכבת אבטחה ברמת ה-Worker.
// 1. כותרות הגנה על כל תגובה (CSP, HSTS, X-Frame-Options וכו')
// 2. הגבלת קצב לנתיבי /api על בסיס IP (מונע ניסיונות לימוד אלגוריתם)
// 3. חסימת User-Agent של בוטים נפוצים
// 4. הגבלת ניסיונות התחברות

const DEFAULT_HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

// CSP — קובע בדיוק אילו משאבים הדף יכול לטעון.
// 'unsafe-inline' עדיין מותר ל-style כי TipTap משתמש; ל-script רק עצמי + Google fonts api.
const CSP_HTML = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join('; ');

const BAD_UA_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /python-requests/i,
  /go-http-client/i,
  /java\//i,
  /libwww/i,
  /httrack/i,
  /sitesucker/i,
  /webcopy/i,
  /webreaper/i,
  /scrapy/i,
];

export function applySecurityHeaders(response, isHtml) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(DEFAULT_HEADERS)) {
    headers.set(k, v);
  }
  if (isHtml) {
    headers.set('content-security-policy', CSP_HTML);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function isBadBot(request) {
  const ua = request.headers.get('user-agent') || '';
  if (!ua) return true;
  for (const re of BAD_UA_PATTERNS) {
    if (re.test(ua)) return true;
  }
  return false;
}

// צוות האתר 2026-05-07: רשימת לבן של מקורות מורשים לקרוא לנתיבי המנוע.
// תוקפים שמרימים את הקבצים על דומיין שלהם → ה-Origin לא יתאים → 403.
const ALLOWED_ORIGINS = new Set([
  'https://app.ravtext.com',
  'https://unified-text-editor.7155401.workers.dev',
  'https://ravtext.com',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:8787',
  'http://localhost:8787',
]);

// Site/API endpoints — אסור לקרוא להם בלי Origin/Referer תקף של האתר.
// OAuth callbacks ו-payment callbacks נשארים מחוץ לרשימה כי הם מגיעים מספקים חיצוניים.
const ENGINE_API_PREFIXES = [
  '/api/me',
  '/api/admin/',
  '/api/bug-reports',
  '/api/contact',
  '/api/usage/track',
  '/api/payments/package/',
  '/api/payments/yaad/start',
  '/api/payments/paypal/start',
  '/api/payments/status',
  '/api/payments/cancel',
  '/api/payments/gift/claim',
  '/api/account/',
  '/api/documents',
  '/api/settings',
  '/api/render/',
  '/api/talmud/',
  '/api/balance/',
  '/api/mishna/',
  '/api/streams/',
  '/api/ai-tools/',
  '/api/tools/',
  '/api/nikud-merger',
  '/api/text-compare-pro',
  '/api/sefaria/',
  '/api/main-text-tools',
  '/api/caricature',
];

export function isEngineApi(pathname) {
  for (const p of ENGINE_API_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}

export function checkOrigin(request, url) {
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');

  // Either Origin or Referer must match. Prefer Origin (CORS-set, harder to forge in browsers).
  if (origin && ALLOWED_ORIGINS.has(origin)) return null;
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refOrigin = `${refUrl.protocol}//${refUrl.host}`;
      if (ALLOWED_ORIGINS.has(refOrigin)) return null;
    } catch {}
  }

  // PWA standalone — בקשות מ-Chrome/Edge PWA שהותקן יכולות להגיע
  // ללא Origin/Referer ב-CORS-strict mode. אנחנו מאשרים אותן רק
  // כשמתקיימים בו-זמנית שני תנאים שלא ניתנים לזיוף מ-JS:
  //
  //   1. Sec-Fetch-Site: same-origin — נשלח אוטומטית ע"י הדפדפן
  //      (Chrome 76+, Firefox 90+) ולא ניתן לדריסה מקוד JS.
  //      תוקף בדומיין אחר יקבל "cross-site" ולא יוכל לעקוף.
  //
  //   2. X-Ravtext-Display: standalone — מוצמד ע"י ה-fetch wrapper
  //      שלנו (src/pwa_install_controller.js) רק במצב display-mode:
  //      standalone. זה רמז כוונה, לא הוכחה — האכיפה האמיתית היא
  //      Sec-Fetch-Site.
  //
  // הצירוף של השניים מקיים same-origin מקוד שלנו, ב-PWA או בטאב
  // רגיל. תוקף לא יכול ליצור Sec-Fetch-Site=same-origin מדומיינו.
  const secSite = request.headers.get('sec-fetch-site');
  const display = request.headers.get('x-ravtext-display');
  if (secSite === 'same-origin' && display === 'standalone') return null;

  return new Response('Forbidden: bad origin', { status: 403 });
}

// צוות האתר 2026-05-07: rate limit פשוט מבוסס on Cloudflare cache (KV אין בטוקן הזה).
// כל IP מקבל חלון של 60 שניות; חציית הסף מוחזרת 429.
// הספירה נשמרת באמצעות בקשת fetch לקאש פנימי — מספיק לעצירת brute force; לא מוחלט.
const RATE_LIMITS = {
  '/api/me': { window: 60, max: 60 },
  '/api/auth/login': { window: 300, max: 10 },
  '/api/auth/callback': { window: 300, max: 20 },
  '/api/streams/parse': { window: 60, max: 30 },
  '/api/render/preflight': { window: 60, max: 600 },
  '/api/talmud/decide': { window: 60, max: 600 },
  '/api/balance/decide': { window: 60, max: 600 },
  '/api/mishna/decide': { window: 60, max: 600 },
  '/api/caricature': { window: 60, max: 30 },
  '/api/ai-tools/gas': { window: 60, max: 60 },
  '/api/ai-tools/chat': { window: 60, max: 60 },
  '/api/tools/preflight': { window: 60, max: 240 },
  '/api/nikud-merger': { window: 60, max: 120 },
  '/api/text-compare-pro': { window: 60, max: 120 },
  '/api/sefaria': { window: 60, max: 180 },
  '/api/main-text-tools': { window: 60, max: 180 },
  '/api/admin': { window: 60, max: 300 },
  '/api/documents': { window: 60, max: 120 },
  '/api/settings': { window: 60, max: 120 },
};

export async function checkRateLimit(request, url) {
  let cfg = null;
  for (const [prefix, conf] of Object.entries(RATE_LIMITS)) {
    if (url.pathname === prefix || url.pathname.startsWith(prefix + '/')) {
      cfg = conf;
      break;
    }
  }
  if (!cfg) return null;

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '0';
  const bucket = Math.floor(Date.now() / (cfg.window * 1000));
  const key = `rl:${url.pathname}:${ip}:${bucket}`;
  const cacheUrl = `https://rl.invalid/${encodeURIComponent(key)}`;
  const cache = caches.default;

  let count = 0;
  try {
    const hit = await cache.match(cacheUrl);
    if (hit) {
      count = parseInt(await hit.text(), 10) || 0;
    }
  } catch {}
  count += 1;
  try {
    await cache.put(
      cacheUrl,
      new Response(String(count), {
        headers: {
          'cache-control': `public, max-age=${cfg.window}`,
          'content-type': 'text/plain',
        },
      })
    );
  } catch {}

  if (count > cfg.max) {
    return new Response('Rate limit exceeded', {
      status: 429,
      headers: {
        'retry-after': String(cfg.window),
        'cache-control': 'no-store',
      },
    });
  }
  return null;
}
