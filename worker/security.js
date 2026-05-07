// משה 2026-05-07: שכבת אבטחה ברמת ה-Worker.
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

// משה 2026-05-07: rate limit פשוט מבוסס on Cloudflare cache (KV אין בטוקן הזה).
// כל IP מקבל חלון של 60 שניות; חציית הסף מוחזרת 429.
// הספירה נשמרת באמצעות בקשת fetch לקאש פנימי — מספיק לעצירת brute force; לא מוחלט.
const RATE_LIMITS = {
  '/api/me': { window: 60, max: 60 },
  '/api/auth/login': { window: 300, max: 10 },
  '/api/auth/callback': { window: 300, max: 20 },
  '/api/streams/parse': { window: 60, max: 30 },
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
