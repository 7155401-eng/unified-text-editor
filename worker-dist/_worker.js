const COOKIE_NAME = "ravtext_session";
const COOKIE_TTL_SEC = 7 * 24 * 60 * 60;
function b64urlEncode(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - str.length % 4) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function hmacKey(secret) {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}
async function sign(payloadObj, secret) {
  const json2 = JSON.stringify(payloadObj);
  const dataBytes = new TextEncoder().encode(json2);
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return `${b64urlEncode(dataBytes)}.${b64urlEncode(sig)}`;
}
async function verify(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const dataBytes = b64urlDecode(parts[0]);
  const sigBytes = b64urlDecode(parts[1]);
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(dataBytes));
  } catch {
    return null;
  }
}
function parseCookieHeader(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k === name) return part.slice(eq + 1).trim();
  }
  return null;
}
async function getUserFromRequest(request, env) {
  const token = parseCookieHeader(request.headers.get("cookie"), COOKIE_NAME);
  if (!token) return null;
  const payload = await verify(token, env.SESSION_SECRET);
  if (!payload || !payload.email) return null;
  const nowSec2 = Math.floor(Date.now() / 1e3);
  if (payload.exp && payload.exp < nowSec2) return null;
  const row = await env.DB.prepare(
    "SELECT id, email, status, expires_at, is_admin, plan_type, balance_seconds FROM users WHERE email = ?"
  ).bind(payload.email).first();
  if (!row) return null;
  const notExpired = !row.expires_at || row.expires_at >= nowSec2;
  const isPaid = row.status === "active" && notExpired;
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    expires_at: row.expires_at,
    is_admin: row.is_admin === 1,
    paid: isPaid,
    plan_type: row.plan_type || null,
    balance_seconds: row.balance_seconds || 0
  };
}
async function buildSessionCookie(email, env) {
  const nowSec2 = Math.floor(Date.now() / 1e3);
  const payload = { email, iat: nowSec2, exp: nowSec2 + COOKIE_TTL_SEC };
  const token = await sign(payload, env.SESSION_SECRET);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_TTL_SEC}`;
}
function buildClearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
async function handleAuth(request, env, url) {
  if (url.pathname === "/api/auth/login" || url.pathname === "/api/auth/go") {
    return startLogin(env, url);
  }
  if (url.pathname === "/api/auth/start-url" && request.method === "POST") {
    return startLoginJson(env, url);
  }
  if (url.pathname === "/api/auth/callback") {
    return handleCallback(request, env, url);
  }
  if (url.pathname === "/api/auth/logout") {
    return logout(url);
  }
  return new Response("Not found", { status: 404 });
}
function buildGoogleAuthUrl(env, url) {
  const next = url.searchParams.get("next") || "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: "code",
    scope: "openid email",
    access_type: "online",
    prompt: "select_account",
    state: safeNext
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}
function startLogin(env, url) {
  if (!env.GOOGLE_CLIENT_ID) {
    return new Response("Google OAuth not configured yet", { status: 503 });
  }
  return new Response(null, {
    status: 302,
    headers: { location: buildGoogleAuthUrl(env, url), "cache-control": "no-store" }
  });
}
function startLoginJson(env, url) {
  if (!env.GOOGLE_CLIENT_ID) {
    return Response.json({ error: "not_configured" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return Response.json(
    { url: buildGoogleAuthUrl(env, url) },
    { headers: { "cache-control": "no-store, private", "pragma": "no-cache" } }
  );
}
async function handleCallback(request, env, url) {
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response(null, { status: 302, headers: { location: `${url.origin}/?login=cancelled`, "cache-control": "no-store" } });
  }
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response("Google OAuth not configured yet", { status: 503 });
  }
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/api/auth/callback`,
      grant_type: "authorization_code"
    })
  });
  if (!tokenRes.ok) {
    return new Response(null, { status: 302, headers: { location: `${url.origin}/?login=token_error`, "cache-control": "no-store" } });
  }
  const { access_token } = await tokenRes.json();
  if (!access_token) {
    return new Response(null, { status: 302, headers: { location: `${url.origin}/?login=no_token`, "cache-control": "no-store" } });
  }
  const infoRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${access_token}` }
  });
  if (!infoRes.ok) {
    return new Response(null, { status: 302, headers: { location: `${url.origin}/?login=info_error`, "cache-control": "no-store" } });
  }
  const info = await infoRes.json();
  const email = (info.email || "").toLowerCase().trim();
  if (!email || info.email_verified === false) {
    return new Response(null, { status: 302, headers: { location: `${url.origin}/?login=no_email`, "cache-control": "no-store" } });
  }
  const firstName = String(info.given_name || "").trim().slice(0, 50);
  const lastName = String(info.family_name || "").trim().slice(0, 50);
  const nowSec2 = Math.floor(Date.now() / 1e3);
  let row = await env.DB.prepare(
    "SELECT id, email, status, expires_at FROM users WHERE email = ?"
  ).bind(email).first();
  if (!row) {
    await env.DB.prepare(
      "INSERT INTO users (email, status, expires_at, is_admin, first_name, last_name) VALUES (?, ?, 0, 0, ?, ?)"
    ).bind(email, "unauthorized", firstName || null, lastName || null).run();
    row = await env.DB.prepare(
      "SELECT id, email, status, expires_at FROM users WHERE email = ?"
    ).bind(email).first();
  }
  await env.DB.prepare(
    "UPDATE users SET last_login_at = ?, first_name = COALESCE(NULLIF(?, ''), first_name), last_name = COALESCE(NULLIF(?, ''), last_name) WHERE id = ?"
  ).bind(nowSec2, firstName, lastName, row.id).run();
  const cookie = await buildSessionCookie(email, env);
  const isPaid = row.status === "active" && (!row.expires_at || row.expires_at >= nowSec2);
  const stateNext = url.searchParams.get("state");
  const safeNext = stateNext && stateNext.startsWith("/") && !stateNext.startsWith("//") && stateNext !== "/" ? stateNext : null;
  const dest = safeNext ? safeNext : isPaid ? "/" : "/?login=demo";
  return new Response(null, {
    status: 302,
    headers: {
      "set-cookie": cookie,
      location: `${url.origin}${dest}`,
      "cache-control": "no-store"
    }
  });
}
function logout(url) {
  return new Response(null, {
    status: 302,
    headers: {
      "set-cookie": buildClearCookie(),
      location: `${url.origin}/`,
      "cache-control": "no-store"
    }
  });
}
const DEFAULT_HEADERS = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin"
};
const CSP_HTML = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
  "upgrade-insecure-requests"
].join("; ");
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
  /scrapy/i
];
function applySecurityHeaders(response, isHtml) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(DEFAULT_HEADERS)) {
    headers.set(k, v);
  }
  if (isHtml) {
    headers.set("content-security-policy", CSP_HTML);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
function isBadBot(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua) return true;
  for (const re of BAD_UA_PATTERNS) {
    if (re.test(ua)) return true;
  }
  return false;
}
const ALLOWED_ORIGINS = /* @__PURE__ */ new Set([
  "https://app.ravtext.com",
  "https://unified-text-editor.7155401.workers.dev",
  "https://ravtext.com",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "http://127.0.0.1:8787",
  "http://localhost:8787"
]);
const ENGINE_API_PREFIXES = [
  "/api/me",
  "/api/admin/",
  "/api/bug-reports",
  "/api/contact",
  "/api/usage/track",
  "/api/video-gallery/",
  "/api/payments/package/",
  "/api/payments/yaad/start",
  "/api/payments/paypal/start",
  "/api/payments/status",
  "/api/payments/cancel",
  "/api/payments/gift/claim",
  "/api/account/",
  "/api/documents",
  "/api/settings",
  "/api/render/",
  "/api/talmud/",
  "/api/balance/",
  "/api/mishna/",
  "/api/streams/",
  "/api/ai-tools/",
  "/api/tools/",
  "/api/nikud-merger",
  "/api/text-compare-pro",
  "/api/sefaria/",
  "/api/main-text-tools",
  "/api/caricature"
];
function isEngineApi(pathname) {
  for (const p of ENGINE_API_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  return false;
}
function checkOrigin(request, url) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (origin && ALLOWED_ORIGINS.has(origin)) return null;
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refOrigin = `${refUrl.protocol}//${refUrl.host}`;
      if (ALLOWED_ORIGINS.has(refOrigin)) return null;
    } catch {
    }
  }
  const secSite = request.headers.get("sec-fetch-site");
  const display = request.headers.get("x-ravtext-display");
  if (secSite === "same-origin" && display === "standalone") return null;
  return new Response("Forbidden: bad origin", { status: 403 });
}
const RATE_LIMITS = {
  "/api/me": { window: 60, max: 60 },
  "/api/auth/login": { window: 300, max: 10 },
  "/api/auth/callback": { window: 300, max: 20 },
  "/api/streams/parse": { window: 60, max: 30 },
  "/api/render/preflight": { window: 60, max: 600 },
  "/api/talmud/decide": { window: 60, max: 600 },
  "/api/balance/decide": { window: 60, max: 600 },
  "/api/mishna/decide": { window: 60, max: 600 },
  "/api/caricature": { window: 60, max: 30 },
  "/api/ai-tools/gas": { window: 60, max: 60 },
  "/api/ai-tools/chat": { window: 60, max: 60 },
  "/api/tools/preflight": { window: 60, max: 240 },
  "/api/nikud-merger": { window: 60, max: 120 },
  "/api/text-compare-pro": { window: 60, max: 120 },
  "/api/sefaria": { window: 60, max: 180 },
  "/api/main-text-tools": { window: 60, max: 180 },
  "/api/video-gallery": { window: 60, max: 120 },
  "/api/admin": { window: 60, max: 300 },
  "/api/documents": { window: 60, max: 120 },
  "/api/settings": { window: 60, max: 120 }
};
async function checkRateLimit(request, url) {
  let cfg = null;
  for (const [prefix, conf] of Object.entries(RATE_LIMITS)) {
    if (url.pathname === prefix || url.pathname.startsWith(prefix + "/")) {
      cfg = conf;
      break;
    }
  }
  if (!cfg) return null;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "0";
  const bucket = Math.floor(Date.now() / (cfg.window * 1e3));
  const key = `rl:${url.pathname}:${ip}:${bucket}`;
  const cacheUrl = `https://rl.invalid/${encodeURIComponent(key)}`;
  const cache = caches.default;
  let count = 0;
  try {
    const hit = await cache.match(cacheUrl);
    if (hit) {
      count = parseInt(await hit.text(), 10) || 0;
    }
  } catch {
  }
  count += 1;
  try {
    await cache.put(
      cacheUrl,
      new Response(String(count), {
        headers: {
          "cache-control": `public, max-age=${cfg.window}`,
          "content-type": "text/plain"
        }
      })
    );
  } catch {
  }
  if (count > cfg.max) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: {
        "retry-after": String(cfg.window),
        "cache-control": "no-store"
      }
    });
  }
  return null;
}
const PALETTE$1 = [
  { bg: "#FEE2E2", fg: "#7F1D1D" },
  { bg: "#DBEAFE", fg: "#1E3A8A" },
  { bg: "#DCFCE7", fg: "#14532D" },
  { bg: "#FEF3C7", fg: "#78350F" },
  { bg: "#F3E8FF", fg: "#581C87" },
  { bg: "#CFFAFE", fg: "#164E63" },
  { bg: "#FCE7F3", fg: "#831843" },
  { bg: "#E5E7EB", fg: "#1F2937" }
];
const DEFAULT_STREAM_LABELS = {
  "01": "מגן אברהם",
  "02": "משנה ברורה",
  "03": "ביאור הלכה",
  "04": "טורי זהב",
  "05": "כף החיים"
};
function defaultLabelForCode(code) {
  return DEFAULT_STREAM_LABELS[code] || `זרם ${code}`;
}
function colorFor$1(streamCode) {
  const n = parseInt(streamCode, 10);
  if (Number.isFinite(n) && n >= 1) {
    return PALETTE$1[(n - 1) % PALETTE$1.length];
  }
  let h = 0;
  for (const ch of streamCode) h = h * 31 + ch.charCodeAt(0) >>> 0;
  return PALETTE$1[h % PALETTE$1.length];
}
function escapeHtml$3(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
let _uidCounter = 0;
function uid() {
  _uidCounter++;
  return `auto-${Date.now().toString(36)}-${_uidCounter}`;
}
function wrapMark(streamCode, symbol, body) {
  const c = colorFor$1(streamCode);
  const u = uid();
  return `<span class="stream-marker stream-${escapeHtml$3(streamCode)}" data-stream="${escapeHtml$3(streamCode)}" data-uid="${u}" data-symbol="${escapeHtml$3(symbol)}" style="background-color:${c.bg};color:${c.fg};border-radius:3px;padding:0 3px;font-weight:600;" title="${escapeHtml$3(defaultLabelForCode(streamCode))}">` + body + "</span>";
}
const PATTERNS = [
  {
    name: "curly",
    rx: /\{([^{}\n]{1,200})\}/g,
    streamFor: () => "curly",
    symbolFor: (m) => `{${m[1]}}`,
    bodyFor: (m) => m[0]
  },
  {
    name: "atNN",
    rx: /@(\d{1,3})/g,
    streamFor: (m) => String(parseInt(m[1], 10)).padStart(2, "0"),
    symbolFor: (m) => `@${m[1]}`,
    bodyFor: (m) => m[0]
  },
  {
    name: "bracketN",
    rx: /\[(\d{1,3})\]/g,
    streamFor: (m) => `b${m[1]}`,
    symbolFor: (m) => `[${m[1]}]`,
    bodyFor: (m) => m[0]
  },
  {
    name: "parenN",
    rx: /\((\d{1,3})\)/g,
    streamFor: (m) => `p${m[1]}`,
    symbolFor: (m) => `(${m[1]})`,
    bodyFor: (m) => m[0]
  },
  {
    name: "asterisk",
    rx: /(\*{1,5})(?!\*)/g,
    streamFor: (m) => `asterisk-${m[1].length}`,
    symbolFor: (m) => m[1],
    bodyFor: (m) => m[0]
  },
  {
    name: "dagger",
    rx: /[†‡]/g,
    streamFor: (m) => m[0] === "†" ? "dagger" : "double-dagger",
    symbolFor: (m) => m[0],
    bodyFor: (m) => m[0]
  }
];
function parseStreamsToHtml(text) {
  if (typeof text !== "string") {
    return { html: "", stats: { total: 0, byStream: {}, byPattern: {} } };
  }
  const events = [];
  for (const p of PATTERNS) {
    let m;
    p.rx.lastIndex = 0;
    while ((m = p.rx.exec(text)) !== null) {
      events.push({
        start: m.index,
        end: m.index + m[0].length,
        streamCode: p.streamFor(m),
        symbol: p.symbolFor(m),
        body: p.bodyFor(m),
        patternName: p.name
      });
    }
  }
  events.sort((a, b) => a.start - b.start || a.end - b.end);
  const accepted = [];
  let cursor = 0;
  for (const e of events) {
    if (e.start < cursor) continue;
    accepted.push(e);
    cursor = e.end;
  }
  let out = "";
  let i = 0;
  for (const e of accepted) {
    if (i < e.start) out += escapeHtml$3(text.slice(i, e.start));
    out += wrapMark(e.streamCode, e.symbol, escapeHtml$3(e.body));
    i = e.end;
  }
  if (i < text.length) out += escapeHtml$3(text.slice(i));
  const paragraphs = out.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  const html = paragraphs.length ? paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n") : `<p>${out.replace(/\n/g, "<br>")}</p>`;
  const stats = { total: accepted.length, byStream: {}, byPattern: {} };
  for (const e of accepted) {
    stats.byStream[e.streamCode] = (stats.byStream[e.streamCode] || 0) + 1;
    stats.byPattern[e.patternName] = (stats.byPattern[e.patternName] || 0) + 1;
  }
  return { html, stats };
}
const NONCE_TTL_SEC = 120;
function b64url$1(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDec(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - str.length % 4) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function signNonce(payload, secret) {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${b64url$1(data)}.${b64url$1(sig)}`;
}
async function verifyNonce(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const data = b64urlDec(parts[0]);
  const sig = b64urlDec(parts[1]);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify("HMAC", key, sig, data);
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    return null;
  }
}
async function issueNonce(env) {
  const nowSec2 = Math.floor(Date.now() / 1e3);
  return await signNonce({ iat: nowSec2, exp: nowSec2 + NONCE_TTL_SEC, jti: crypto.randomUUID() }, env.SESSION_SECRET);
}
async function checkNonce(request, env) {
  const token = request.headers.get("x-ravtext-nonce") || "";
  if (!token) return new Response("Missing nonce", { status: 403 });
  const payload = await verifyNonce(token, env.SESSION_SECRET);
  if (!payload) return new Response("Bad nonce", { status: 403 });
  const nowSec2 = Math.floor(Date.now() / 1e3);
  if (payload.exp && payload.exp < nowSec2) return new Response("Expired nonce", { status: 403 });
  return null;
}
const SAFETY_MIN = 0;
const SAFETY_MAX = 400;
const SAFETY_DEFAULT = 160;
const SAFETY_STEP_UP = 20;
const SAFETY_STEP_DOWN = 20;
const OVERFLOW_THRESHOLD = 5;
const GAP_TOO_BIG = 60;
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}
function decideAdjustment(currentSafety, state) {
  if (state.maxOverflow > OVERFLOW_THRESHOLD) {
    return {
      newSafety: clamp(currentSafety + SAFETY_STEP_UP, SAFETY_MIN, SAFETY_MAX),
      action: "up",
      reason: `overflow ${state.maxOverflow}px > ${OVERFLOW_THRESHOLD}px`
    };
  }
  if (Number.isFinite(state.awkwardSplits) && state.awkwardSplits > 0 && currentSafety < SAFETY_MAX) {
    return {
      newSafety: clamp(currentSafety + SAFETY_STEP_UP, SAFETY_MIN, SAFETY_MAX),
      action: "up",
      reason: `${state.awkwardSplits} awkward mid-line split(s)`
    };
  }
  if (state.maxOverflow === 0 && state.avgGap > GAP_TOO_BIG && currentSafety > SAFETY_MIN) {
    return {
      newSafety: clamp(currentSafety - SAFETY_STEP_DOWN, SAFETY_MIN, SAFETY_MAX),
      action: "down",
      reason: `avg gap ${state.avgGap}px > ${GAP_TOO_BIG}px, no overflow`
    };
  }
  return {
    newSafety: currentSafety,
    action: "stable",
    reason: state.maxOverflow > 0 ? `overflow ${state.maxOverflow}px (within tolerance)` : state.awkwardSplits > 0 ? `${state.awkwardSplits} awkward split(s) but cap reached` : `gap ${state.avgGap}px (acceptable)`
  };
}
function decideTalmudCrownMode(streams, hasMain, crownLines) {
  if (!Array.isArray(streams) || streams.length === 0) return { mode: "no-talmud" };
  if (streams.length === 1) {
    const { linesAtFull, linesAtHalf } = streams[0] || {};
    if (Number.isFinite(linesAtFull) && Number.isFinite(linesAtHalf) && linesAtFull >= crownLines && linesAtHalf >= crownLines * 2) {
      return { mode: "single-split" };
    }
    return { mode: "single-inline" };
  }
  const a = streams[0] || {};
  const b = streams[1] || {};
  const aHalf = a.linesAtHalf || 0;
  const bHalf = b.linesAtHalf || 0;
  if (aHalf >= crownLines && bHalf >= crownLines) return { mode: "double-half" };
  if (aHalf < crownLines && bHalf < crownLines) return { mode: "double-inline" };
  const longIdx = aHalf >= crownLines ? 0 : 1;
  const longFull = streams[longIdx]?.linesAtFull || 0;
  if (longFull >= crownLines) return { mode: "double-full", longIdx };
  return { mode: "double-inline" };
}
async function handlePreflight(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const user = await getUserFromRequest(request, env);
  const layoutType = String(body?.layoutType || "regular");
  const nonce = await issueNonce(env);
  const plan = {
    token: nonce,
    issuedAt: Date.now(),
    auth: {
      paid: !!user,
      email: user?.email || null
    },
    layoutType,
    decisions: {}
  };
  if (layoutType === "talmud" || layoutType === "any") {
    const crownLines = Number(body?.talmud?.crownLines) || 4;
    const streams = Array.isArray(body?.talmud?.streams) ? body.talmud.streams : [];
    const hasMain = !!body?.talmud?.hasMain;
    plan.decisions.talmud = decideTalmudCrownMode(streams, hasMain, crownLines);
  }
  if (body?.smart?.currentSafety != null && body?.smart?.state) {
    const cs = Number(body.smart.currentSafety);
    plan.decisions.safety = decideAdjustment(
      Number.isFinite(cs) ? cs : SAFETY_DEFAULT,
      body.smart.state
    );
  } else {
    plan.decisions.safety = { newSafety: SAFETY_DEFAULT, action: "default" };
  }
  return Response.json(plan, {
    headers: { "cache-control": "no-store" }
  });
}
function decideBalanceLayout(lineCount, settings) {
  const minLines = Number.isFinite(Number(settings?.minLinesForCols)) ? Number(settings.minLinesForCols) : 3;
  if (lineCount < minLines * 2) {
    return { balance: false, reason: `lines ${lineCount} < ${minLines * 2}` };
  }
  const lastCenter = settings?.lastLineCenter !== false;
  const hasOrphan = lineCount % 2 === 1 && lastCenter;
  const balancedCount = hasOrphan ? lineCount - 1 : lineCount;
  const half = Math.ceil(balancedCount / 2);
  return {
    balance: true,
    rightStart: 0,
    rightEnd: half,
    leftStart: half,
    leftEnd: balancedCount,
    hasOrphan,
    centerLast: lastCenter
  };
}
function decideMishnaSide(preference, pageNumber, idx) {
  if (preference === "right" || preference === "left") return preference;
  if (preference === "outer") return pageNumber % 2 === 1 ? "left" : "right";
  if (preference === "inner") return pageNumber % 2 === 1 ? "right" : "left";
  return idx % 2 === 0 ? "right" : "left";
}
function widthForFlowFloat(levelCount) {
  const count = Math.max(1, Number(levelCount) || 1);
  const percent = 100 / count;
  return `calc(${percent.toFixed(4)}% - 8px)`;
}
function decideMishnaWidth(explicitWidth, levelCount) {
  const w = Number(explicitWidth);
  if (Number.isFinite(w) && w > 0) {
    return `${Math.max(10, Math.min(95, w))}%`;
  }
  return widthForFlowFloat(levelCount);
}
function decideMishnaLevels(rawLevelsText, streamCodes) {
  const parsed = String(rawLevelsText || "").split(/[|\n;]+/).map(
    (level) => (level.match(/\d{1,3}/g) || []).map((n) => {
      const v = parseInt(n, 10);
      return Number.isFinite(v) && v >= 1 ? String(v).padStart(2, "0") : null;
    }).filter(Boolean)
  ).map((level) => Array.from(new Set(level))).filter((level) => level.length >= 2);
  if (parsed.length > 0) return parsed;
  const codes = (streamCodes || []).filter(Boolean);
  return codes.length >= 2 ? [Array.from(new Set(codes))] : [];
}
async function handleMishnaDecide(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const pageNumber = Number(body?.pageNumber) || 1;
  const streams = Array.isArray(body?.streams) ? body.streams : [];
  const rawLevels = body?.rawLevelsText || "";
  const codes = streams.map((s) => s?.code).filter(Boolean);
  const levels = decideMishnaLevels(rawLevels, codes);
  const assignments = streams.map((s, idx) => ({
    code: s?.code || null,
    side: decideMishnaSide(s?.sidePreference || "auto", pageNumber, idx),
    width: decideMishnaWidth(s?.explicitWidth, streams.length)
  }));
  return Response.json({ assignments, levels }, {
    headers: { "cache-control": "no-store" }
  });
}
async function handleBalanceDecide(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const lineCount = Number(body?.lineCount);
  if (!Number.isFinite(lineCount) || lineCount < 0) {
    return new Response("Bad lineCount", { status: 400 });
  }
  const decision = decideBalanceLayout(lineCount, body?.settings || {});
  return Response.json(decision, {
    headers: { "cache-control": "no-store" }
  });
}
async function handleTalmudDecide(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user || !user.paid) {
    return Response.json(
      { mode: "denied", reason: "paid_only", message: 'גפ"ת זמין למנויים פעילים בלבד.' },
      { status: 402, headers: { "cache-control": "no-store" } }
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const crownLines = Number(body?.crownLines) || 4;
  const streams = Array.isArray(body?.streams) ? body.streams : [];
  const hasMain = !!body?.hasMain;
  const decision = decideTalmudCrownMode(streams, hasMain, crownLines);
  return Response.json(decision, {
    headers: { "cache-control": "no-store" }
  });
}
const SETTING_KEYS = [
  "YAAD_TERMINAL",
  "YAAD_API_KEY",
  "YAAD_BASE_URL",
  "YAAD_PASSP",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_SECRET",
  "PAYPAL_BASE_URL"
];
function jsonResponse$9(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...init.headers || {} }
  });
}
function jsonError$1(message, status = 400) {
  return jsonResponse$9({ error: message }, { status });
}
function maskValue(value) {
  if (!value) return null;
  const str = String(value);
  if (str.length <= 4) return "****";
  return "****" + str.slice(-4);
}
async function readBody$1(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
async function requireAdmin$3(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: "Not logged in", status: 401 };
  if (!user.is_admin) return { error: "Forbidden", status: 403 };
  return { user };
}
function randomToken$2(bytes = 12) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function getPaymentConfig(env) {
  const result = {};
  let rows = [];
  try {
    const stmt = env.DB.prepare("SELECT key, value FROM app_settings WHERE key IN (" + SETTING_KEYS.map(() => "?").join(",") + ")");
    const r = await stmt.bind(...SETTING_KEYS).all();
    rows = r?.results || [];
  } catch {
  }
  for (const row of rows) {
    if (row && row.key && row.value) result[row.key] = row.value;
  }
  for (const key of SETTING_KEYS) {
    if (!result[key] && env[key]) result[key] = env[key];
  }
  return result;
}
async function getConfigStatus(request, env) {
  const config = await getPaymentConfig(env);
  const status = {};
  for (const key of SETTING_KEYS) {
    status[key] = {
      configured: !!config[key],
      masked: maskValue(config[key])
    };
  }
  return jsonResponse$9({ status });
}
async function savePaymentConfig(request, env, userId) {
  const body = await readBody$1(request);
  const updates = {};
  for (const key of SETTING_KEYS) {
    if (typeof body[key] === "string" && body[key].trim()) {
      updates[key] = body[key].trim();
    }
  }
  if (updates.PAYPAL_CLIENT_ID || updates.PAYPAL_SECRET) {
    const cfgNow = await getPaymentConfig(env);
    const clientId = updates.PAYPAL_CLIENT_ID || cfgNow.PAYPAL_CLIENT_ID;
    const secret = updates.PAYPAL_SECRET || cfgNow.PAYPAL_SECRET;
    const base = updates.PAYPAL_BASE_URL || cfgNow.PAYPAL_BASE_URL || "https://api-m.paypal.com";
    if (!clientId || !secret) {
      return jsonError$1("צריך גם Client ID וגם Secret של PayPal");
    }
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        return jsonError$1(`PayPal סירב לאמת — בדוק שהמפתחות נכונים. (${r.status}: ${txt.slice(0, 120)})`, 400);
      }
    } catch (e) {
      return jsonError$1(`לא הצלחנו להגיע ל-PayPal לאימות. (${e && e.message || "שגיאה"})`, 502);
    }
  }
  const nowSec2 = Math.floor(Date.now() / 1e3);
  for (const [key, value] of Object.entries(updates)) {
    await env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?)\n       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id"
    ).bind(key, value, nowSec2, userId).run();
  }
  return jsonResponse$9({ ok: true, saved: Object.keys(updates) });
}
async function listPackages(request, env) {
  const r = await env.DB.prepare(
    "SELECT id, token, label, amount, hours, days, created_at, expires_at, used_count, max_uses, active FROM custom_packages ORDER BY id DESC LIMIT 200"
  ).all();
  return jsonResponse$9({ packages: r?.results || [] });
}
async function createPackage(request, env, userId) {
  const body = await readBody$1(request);
  const label = (body.label || "").trim();
  const amount = Number(body.amount);
  const hours = body.hours == null || body.hours === "" ? null : Number(body.hours);
  const days = body.days == null || body.days === "" ? null : Number(body.days);
  const maxUses = body.maxUses == null || body.maxUses === "" ? null : Number(body.maxUses);
  const expiresAt = body.expiresAt == null || body.expiresAt === "" ? null : Number(body.expiresAt);
  if (!label) return jsonError$1("חסר שם לחבילה");
  if (!Number.isFinite(amount) || amount <= 0) return jsonError$1("סכום לא חוקי");
  if (hours != null && (!Number.isFinite(hours) || hours <= 0)) return jsonError$1("שעות לא חוקיות");
  if (days != null && (!Number.isFinite(days) || days <= 0)) return jsonError$1("ימים לא חוקיים");
  if (hours == null && days == null) return jsonError$1("צריך לציין או שעות או ימים");
  const token = randomToken$2(12);
  const nowSec2 = Math.floor(Date.now() / 1e3);
  const ins = await env.DB.prepare(
    "INSERT INTO custom_packages (token, label, amount, hours, days, created_by_user_id, created_at, expires_at, max_uses, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
  ).bind(token, label, amount, hours, days, userId, nowSec2, expiresAt, maxUses).run();
  return jsonResponse$9({
    id: ins.meta.last_row_id,
    token,
    label,
    amount,
    hours,
    days,
    expiresAt,
    maxUses,
    active: 1,
    used_count: 0,
    created_at: nowSec2
  });
}
async function deletePackage(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return jsonError$1("id לא חוקי");
  await env.DB.prepare("UPDATE custom_packages SET active = 0 WHERE id = ?").bind(id).run();
  return jsonResponse$9({ ok: true });
}
async function getPackageByToken(env, token) {
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT id, token, label, amount, hours, days, expires_at, used_count, max_uses, active FROM custom_packages WHERE token = ? AND active = 1"
  ).bind(token).first();
  if (!row) return null;
  const nowSec2 = Math.floor(Date.now() / 1e3);
  if (row.expires_at && row.expires_at > 0 && row.expires_at < nowSec2) return null;
  if (row.max_uses && row.used_count >= row.max_uses) return null;
  return row;
}
async function handlePackageLookup(request, env, url) {
  const m = url.pathname.match(/\/api\/payments\/package\/([A-Za-z0-9_-]+)$/);
  if (!m) return new Response("Not found", { status: 404 });
  const pkg = await getPackageByToken(env, m[1]);
  if (!pkg) return jsonError$1("חבילה לא נמצאה או שפג תוקפה", 404);
  return jsonResponse$9({
    token: pkg.token,
    label: pkg.label,
    amount: pkg.amount,
    hours: pkg.hours,
    days: pkg.days
  });
}
async function handlePaymentAdmin(request, env, url) {
  const auth = await requireAdmin$3(request, env);
  if (auth.error) return jsonError$1(auth.error, auth.status);
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/admin/payment-config" && method === "GET") return getConfigStatus(request, env);
  if (path === "/api/admin/payment-config" && method === "POST") return savePaymentConfig(request, env, auth.user.id);
  if (path === "/api/admin/test-packages" && method === "GET") return listPackages(request, env);
  if (path === "/api/admin/test-packages" && method === "POST") return createPackage(request, env, auth.user.id);
  if (path.startsWith("/api/admin/test-packages/") && method === "DELETE") {
    const id = Number(path.split("/").pop());
    return deletePackage(request, env, id);
  }
  return new Response("Not found", { status: 404 });
}
const PLAN_AMOUNT = { monthly: 50, yearly: 300 };
const PLAN_DURATION_SEC = { monthly: 30 * 24 * 3600, yearly: 365 * 24 * 3600 };
const RENEW_WINDOW_SEC = 24 * 3600;
const MAX_FAILED = 3;
async function runRecurringBilling(env) {
  const nowSec2 = Math.floor(Date.now() / 1e3);
  const cutoff = nowSec2 + RENEW_WINDOW_SEC;
  const rows = await env.DB.prepare(
    `SELECT id, email, plan_type, expires_at, balance_seconds,
            subscription_active, last_payment_provider,
            yaad_token, paypal_payer_id, failed_charge_count, id_number
     FROM users
     WHERE subscription_active = 1
       AND plan_type = 'subscription'
       AND expires_at IS NOT NULL
       AND expires_at <= ?
       AND COALESCE(failed_charge_count, 0) < ?`
  ).bind(cutoff, MAX_FAILED).all();
  const list = rows?.results || [];
  const summary = { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
  for (const u of list) {
    summary.processed += 1;
    const planRow = await env.DB.prepare(
      `SELECT plan_code FROM payments
       WHERE user_id = ? AND plan_code IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    ).bind(u.id).first();
    const planCode = planRow?.plan_code === "yearly" ? "yearly" : "monthly";
    const amount = PLAN_AMOUNT[planCode];
    const durationSec = PLAN_DURATION_SEC[planCode];
    let result = null;
    if (u.last_payment_provider === "yaad" && u.yaad_token) {
      result = await chargeYaadRecurring(env, u, amount, planCode);
    } else if (u.last_payment_provider === "paypal" && u.paypal_payer_id) {
      result = await chargePaypalRecurring(env, u, amount, planCode);
    } else {
      summary.skipped += 1;
      await logCharge(env, u.id, u.last_payment_provider || "unknown", amount, "skipped", null, "no provider token");
      continue;
    }
    if (result.ok) {
      summary.succeeded += 1;
      const newExpire = (u.expires_at && u.expires_at > nowSec2 ? u.expires_at : nowSec2) + durationSec;
      await env.DB.prepare(
        `UPDATE users SET expires_at = ?, plan_renew_at = ?, last_payment_at = ?,
                          failed_charge_count = 0
         WHERE id = ?`
      ).bind(newExpire, newExpire, nowSec2, u.id).run();
      await env.DB.prepare(
        "INSERT INTO payments (user_id, provider, amount, plan_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(u.id, u.last_payment_provider, amount, planCode, result.txnId || "", nowSec2).run();
      await logCharge(env, u.id, u.last_payment_provider, amount, "succeeded", result.txnId, null);
    } else {
      summary.failed += 1;
      await env.DB.prepare(
        "UPDATE users SET failed_charge_count = COALESCE(failed_charge_count, 0) + 1 WHERE id = ?"
      ).bind(u.id).run();
      await logCharge(env, u.id, u.last_payment_provider, amount, "failed", null, result.error || "unknown");
    }
  }
  return summary;
}
async function logCharge(env, userId, provider, amount, status, txnId, error) {
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "INSERT INTO recurring_charges (user_id, provider, amount, status, txn_id, error, attempted_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(userId, provider || "unknown", amount, status, txnId || null, error || null, nowSec2).run().catch(() => {
  });
}
async function chargeYaadRecurring(env, user, amount, planCode) {
  const config = await getPaymentConfig(env);
  if (!config.YAAD_TERMINAL || !config.YAAD_API_KEY) {
    return { ok: false, error: "yaad not configured" };
  }
  const base = (config.YAAD_BASE_URL || "https://icom.yaad.net/p/").replace(/\/?$/, "/");
  const params = new URLSearchParams({
    action: "APISign",
    What: "VERIFY",
    KEY: config.YAAD_API_KEY,
    PassP: config.YAAD_PASSP || "",
    Masof: config.YAAD_TERMINAL,
    Amount: String(amount),
    UserId: user.id_number || "0",
    Order: `renew-${user.id}-${Date.now()}`,
    Info: `חידוש מנוי ${planCode}`,
    Coin: "1",
    UTF8: "True",
    UTF8out: "True",
    Tash: "1",
    FixTash: "True",
    sendemail: "True",
    PageLang: "HEB",
    J5: "True",
    AuthNum: user.yaad_token
  });
  try {
    const r = await fetch(`${base}?${params.toString()}`, { method: "GET", redirect: "manual" });
    const txt = await r.text();
    const ok = /CCode=0|Status=0/.test(txt) || /<\s*Status\s*>0<\/Status>/.test(txt);
    if (!ok) return { ok: false, error: txt.slice(0, 200) };
    const idMatch = txt.match(/Id=(\d+)/) || txt.match(/<Id>(\d+)<\/Id>/);
    return { ok: true, txnId: idMatch ? idMatch[1] : "" };
  } catch (e) {
    return { ok: false, error: e && e.message || "fetch failed" };
  }
}
async function chargePaypalRecurring(env, user, amount, planCode) {
  const config = await getPaymentConfig(env);
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_SECRET) {
    return { ok: false, error: "paypal not configured" };
  }
  const ppBase = (config.PAYPAL_BASE_URL || "https://api-m.paypal.com").replace(/\/$/, "");
  let accessToken;
  try {
    const r = await fetch(`${ppBase}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials"
    });
    if (!r.ok) return { ok: false, error: "paypal auth failed" };
    accessToken = (await r.json()).access_token;
  } catch (e) {
    return { ok: false, error: e && e.message || "paypal auth fetch failed" };
  }
  try {
    const r = await fetch(`${ppBase}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: `renew-${user.id}-${Date.now()}`,
          amount: { currency_code: "ILS", value: String(amount) },
          description: `חידוש מנוי ${planCode}`
        }],
        payment_source: {
          paypal: { vault_id: user.paypal_payer_id }
        }
      })
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      return { ok: false, error: `${r.status}: ${txt.slice(0, 200)}` };
    }
    const order = await r.json();
    const captureId = order?.purchase_units?.[0]?.payments?.captures?.[0]?.id || order.id;
    return { ok: true, txnId: captureId };
  } catch (e) {
    return { ok: false, error: e && e.message || "paypal charge failed" };
  }
}
const CONSOLE_GUARD_KEY = "CONSOLE_GUARD_DISABLED";
async function isConsoleGuardEnabled(env) {
  try {
    const r = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = ?"
    ).bind(CONSOLE_GUARD_KEY).first();
    if (r && String(r.value) === "1") return false;
  } catch {
  }
  return true;
}
async function requireAdmin$2(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: "Not logged in", status: 401 };
  if (!user.is_admin) return { error: "Forbidden", status: 403 };
  return { user };
}
async function handleAdmin(request, env, url) {
  const auth = await requireAdmin$2(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/admin/users" && method === "GET") {
    return listUsers(request, env, url);
  }
  if (path === "/api/admin/users" && method === "POST") {
    return createUser(request, env);
  }
  if (path.startsWith("/api/admin/users/") && path.endsWith("/minutes") && method === "POST") {
    const id = path.split("/").slice(-2)[0];
    return adjustUserMinutes(request, env, Number(id));
  }
  if (path.startsWith("/api/admin/users/") && path.endsWith("/recharge") && method === "POST") {
    const id = path.split("/").slice(-2)[0];
    return rechargeUser(request, env, Number(id));
  }
  if (path.startsWith("/api/admin/users/") && method === "PATCH") {
    const id = path.split("/").pop();
    return updateUser(request, env, Number(id));
  }
  if (path.startsWith("/api/admin/users/") && method === "DELETE") {
    const id = path.split("/").pop();
    return deleteUser(request, env, Number(id), auth.user.id);
  }
  if (path === "/api/admin/stats" && method === "GET") {
    return getStats(request, env);
  }
  if (path === "/api/admin/recurring/run" && method === "POST") {
    const summary = await runRecurringBilling(env);
    return Response.json(summary);
  }
  if (path.startsWith("/api/admin/users/") && path.endsWith("/cancel") && method === "POST") {
    const id = path.split("/").slice(-2)[0];
    return cancelUserSubscription(request, env, Number(id));
  }
  if (path === "/api/admin/console-guard" && method === "GET") {
    const enabled = await isConsoleGuardEnabled(env);
    return new Response(JSON.stringify({ enabled }), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  if (path === "/api/admin/console-guard" && method === "POST") {
    return setConsoleGuard(request, env, auth.user.id);
  }
  if (path === "/api/admin/payments-report" && method === "GET") {
    return getPaymentsReport(request, env, url);
  }
  return new Response("Not found", { status: 404 });
}
async function getPaymentsReport(request, env, url) {
  const params = url.searchParams;
  const search = (params.get("search") || "").trim().toLowerCase();
  const provider = params.get("provider");
  const status = params.get("status");
  const limit = Math.max(1, Math.min(500, Number(params.get("limit")) || 100));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const txnsQuery = `
    SELECT p.id as record_id, p.user_id, p.provider, p.amount, p.plan_code, p.pack_code, p.txn_id, p.created_at, 'completed' as status, 'payment' as record_type
    FROM payments p
    UNION ALL
    SELECT pi.id as record_id, pi.user_id, pi.provider, pi.amount, pi.plan_code, pi.pack_code, pi.txn_id, pi.created_at, pi.status, 'intent' as record_type
    FROM payment_intents pi
    WHERE pi.status != 'completed'
  `;
  const where = [];
  const binds = [];
  if (search) {
    where.push("u.email LIKE ?");
    binds.push(`%${search}%`);
  }
  if (provider) {
    where.push("t.provider = ?");
    binds.push(provider);
  }
  if (status) {
    where.push("t.status = ?");
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countQ = await env.DB.prepare(
    `WITH txns AS (${txnsQuery})
     SELECT COUNT(*) as c FROM txns t LEFT JOIN users u ON t.user_id = u.id ${whereSql}`
  ).bind(...binds).first();
  const totalCount = countQ?.c || 0;
  const rows = await env.DB.prepare(
    `WITH txns AS (${txnsQuery})
     SELECT t.*, u.email
     FROM txns t
     LEFT JOIN users u ON t.user_id = u.id
     ${whereSql}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  return Response.json({
    payments: rows.results,
    totalCount,
    limit,
    offset
  }, { headers: { "cache-control": "no-store" } });
}
async function cancelUserSubscription(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response("Bad id", { status: 400 });
  let body = {};
  try {
    body = await request.json();
  } catch {
  }
  const reason = String(body?.reason || "admin").slice(0, 500);
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 0, plan_renew_at = 0, cancelled_at = ?, cancellation_reason = ? WHERE id = ?"
  ).bind(nowSec2, reason, id).run();
  return Response.json({ ok: true });
}
async function setConsoleGuard(request, env, userId) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const enabled = !!body.enabled;
  const value = enabled ? "0" : "1";
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?)\n     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id"
  ).bind(CONSOLE_GUARD_KEY, value, nowSec2, userId).run();
  return new Response(JSON.stringify({ ok: true, enabled }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
async function listUsers(request, env, url) {
  const params = url.searchParams;
  const search = (params.get("search") || "").trim().toLowerCase();
  const status = params.get("status");
  const sort = params.get("sort") || "created_desc";
  const limit = Math.max(1, Math.min(500, Number(params.get("limit")) || 100));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const where = [];
  const binds = [];
  if (search) {
    where.push("email LIKE ?");
    binds.push(`%${search}%`);
  }
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderMap = {
    created_desc: "ORDER BY id DESC",
    created_asc: "ORDER BY id ASC",
    email_asc: "ORDER BY email ASC",
    email_desc: "ORDER BY email DESC",
    last_login_desc: "ORDER BY last_login_at DESC NULLS LAST",
    expires_asc: "ORDER BY expires_at ASC"
  };
  const orderSql = orderMap[sort] || orderMap.created_desc;
  const countQ = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM users ${whereSql}`
  ).bind(...binds).first();
  const totalCount = countQ?.c || 0;
  const rows = await env.DB.prepare(
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin,
            balance_seconds, plan_type, plan_renew_at,
            yaad_token, paypal_payer_id, last_payment_provider, last_payment_at, failed_charge_count,
            subscription_active, cancelled_at, cancellation_reason, id_number
     FROM users ${whereSql} ${orderSql} LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  return Response.json({
    users: rows.results,
    totalCount,
    limit,
    offset
  }, { headers: { "cache-control": "no-store" } });
}
async function createUser(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return new Response("Bad email", { status: 400 });
  const status = String(body?.status || "active");
  const expires_at = Number(body?.expires_at) || 0;
  const is_admin = body?.is_admin ? 1 : 0;
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) {
    return new Response(JSON.stringify({ error: "Already exists", id: existing.id }), {
      status: 409,
      headers: { "content-type": "application/json" }
    });
  }
  const ins = await env.DB.prepare(
    "INSERT INTO users (email, status, expires_at, is_admin) VALUES (?, ?, ?, ?)"
  ).bind(email, status, expires_at, is_admin).run();
  return Response.json({ id: ins.meta.last_row_id, email, status, expires_at, is_admin });
}
async function updateUser(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response("Bad id", { status: 400 });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const sets = [];
  const binds = [];
  if (typeof body?.status === "string") {
    sets.push("status = ?");
    binds.push(body.status);
  }
  if (Number.isFinite(Number(body?.expires_at))) {
    sets.push("expires_at = ?");
    binds.push(Number(body.expires_at));
  }
  if (typeof body?.is_admin === "boolean" || typeof body?.is_admin === "number") {
    sets.push("is_admin = ?");
    binds.push(body.is_admin ? 1 : 0);
  }
  if (sets.length === 0) return new Response("No fields", { status: 400 });
  binds.push(id);
  await env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  const row = await env.DB.prepare(
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin,
            balance_seconds, plan_type, plan_renew_at FROM users WHERE id = ?`
  ).bind(id).first();
  return Response.json(row || { error: "Not found" });
}
async function adjustUserMinutes(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response("Bad id", { status: 400 });
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const deltaMinutes = Number(body?.deltaMinutes);
  if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) return new Response("Bad deltaMinutes", { status: 400 });
  const row = await env.DB.prepare(
    "SELECT id, balance_seconds, expires_at, plan_type, status FROM users WHERE id = ?"
  ).bind(id).first();
  if (!row) return new Response("Not found", { status: 404 });
  const deltaSec = Math.round(deltaMinutes * 60);
  const newBalance = Math.max(0, (row.balance_seconds || 0) + deltaSec);
  const nowSec2 = Math.floor(Date.now() / 1e3);
  let newExpires = row.expires_at || 0;
  if (row.plan_type !== "subscription") {
    if (deltaSec > 0) {
      const base = newExpires && newExpires > nowSec2 ? newExpires : nowSec2;
      newExpires = base + deltaSec;
    } else {
      newExpires = Math.max(nowSec2, newExpires + deltaSec);
    }
  }
  const newStatus = row.status === "unauthorized" && deltaSec > 0 ? "active" : row.status;
  const newPlanType = row.plan_type || (deltaSec > 0 ? "hours" : row.plan_type);
  await env.DB.prepare(
    "UPDATE users SET balance_seconds = ?, expires_at = ?, status = ?, plan_type = ? WHERE id = ?"
  ).bind(newBalance, newExpires, newStatus, newPlanType, id).run();
  await env.DB.prepare(
    "INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, "admin", 0, null, `adjust_${deltaMinutes > 0 ? "+" : ""}${deltaMinutes}min`, "", nowSec2).run().catch(() => {
  });
  const updated = await env.DB.prepare(
    `SELECT id, email, status, expires_at, created_at, last_login_at, is_admin,
            balance_seconds, plan_type, plan_renew_at FROM users WHERE id = ?`
  ).bind(id).first();
  return Response.json({ ok: true, user: updated, deltaMinutes });
}
async function rechargeUser(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return new Response("Bad id", { status: 400 });
  const user = await env.DB.prepare(
    "SELECT id, expires_at, subscription_active FROM users WHERE id = ?"
  ).bind(id).first();
  if (!user) return new Response("Not found", { status: 404 });
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 1, expires_at = COALESCE(NULLIF(expires_at, 0), 0) WHERE id = ?"
  ).bind(id).run();
  await env.DB.prepare("UPDATE users SET expires_at = ? WHERE id = ? AND (expires_at IS NULL OR expires_at > ?)").bind(nowSec2, id, nowSec2 + 23 * 3600).run();
  const summary = await runRecurringBilling(env);
  const last = await env.DB.prepare(
    "SELECT status, error, txn_id, attempted_at FROM recurring_charges WHERE user_id = ? ORDER BY id DESC LIMIT 1"
  ).bind(id).first();
  return Response.json({ ok: true, summary, last });
}
async function deleteUser(request, env, id, currentAdminId) {
  if (!Number.isFinite(id) || id <= 0) return new Response("Bad id", { status: 400 });
  if (id === currentAdminId) {
    return new Response(JSON.stringify({ error: "Can't delete yourself" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });
  }
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return Response.json({ deleted: id });
}
async function getStats(request, env) {
  const total = (await env.DB.prepare("SELECT COUNT(*) as c FROM users").first())?.c || 0;
  const active = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'active'`).first())?.c || 0;
  const unauthorized = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'unauthorized'`).first())?.c || 0;
  const disabled = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE status = 'disabled'`).first())?.c || 0;
  const admins = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE is_admin = 1`).first())?.c || 0;
  const dayAgo = Math.floor(Date.now() / 1e3) - 86400;
  const weekAgo = Math.floor(Date.now() / 1e3) - 86400 * 7;
  const newToday = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ?`).bind(dayAgo).first())?.c || 0;
  const newThisWeek = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ?`).bind(weekAgo).first())?.c || 0;
  const activeThisWeek = (await env.DB.prepare(`SELECT COUNT(*) as c FROM users WHERE last_login_at >= ?`).bind(weekAgo).first())?.c || 0;
  const expiringSoon = (await env.DB.prepare(
    `SELECT COUNT(*) as c FROM users WHERE status='active' AND expires_at > 0 AND expires_at < ?`
  ).bind(Math.floor(Date.now() / 1e3) + 86400 * 30).first())?.c || 0;
  return Response.json({
    total,
    active,
    unauthorized,
    disabled,
    admins,
    newToday,
    newThisWeek,
    activeThisWeek,
    expiringSoon
  }, { headers: { "cache-control": "no-store" } });
}
const PLAYLIST_ID_KEY = "VIDEO_GALLERY_PLAYLIST_ID";
const PLAYLIST_NAME_KEY = "VIDEO_GALLERY_PLAYLIST_NAME";
const DEFAULT_GALLERY_NAME = "סרטוני עזרה והדרכה";
function json$1(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
function parsePlaylistId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.searchParams.get("list") || raw;
  } catch {
    const match = raw.match(/[?&]list=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : raw.replace(/^list=/, "").trim();
  }
}
function isValidPlaylistId(value) {
  const id = parsePlaylistId(value);
  return /^[A-Za-z0-9_-]{3,200}$/.test(id);
}
function decodeXml(value) {
  return String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10))).trim();
}
function pick(text, regex) {
  const m = String(text || "").match(regex);
  return m ? decodeXml(m[1]) : "";
}
function parseYoutubeFeed(xml) {
  const entries = String(xml || "").match(/<entry\b[\s\S]*?<\/entry>/g) || [];
  return entries.map((entry) => {
    const videoId = pick(entry, /<yt:videoId>([\s\S]*?)<\/yt:videoId>/) || pick(entry, /<id>yt:video:([\s\S]*?)<\/id>/);
    const title = pick(entry, /<media:title>([\s\S]*?)<\/media:title>/) || pick(entry, /<title>([\s\S]*?)<\/title>/) || "סרטון";
    const published = pick(entry, /<published>([\s\S]*?)<\/published>/);
    const thumbnail = pick(entry, /<media:thumbnail[^>]*url="([^"]+)"/);
    if (!videoId) return null;
    return {
      videoId,
      title,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      published
    };
  }).filter(Boolean).slice(0, 80);
}
async function fetchPlaylistVideos(playlistId) {
  if (!playlistId) return [];
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  try {
    const res = await fetch(feedUrl, {
      headers: {
        "accept": "application/atom+xml, application/xml, text/xml",
        "user-agent": "RavText video gallery"
      }
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseYoutubeFeed(xml);
  } catch {
    return [];
  }
}
async function readSetting(env, key) {
  try {
    const row = await env.DB.prepare(
      "SELECT value FROM app_settings WHERE key = ?"
    ).bind(key).first();
    return row ? String(row.value || "") : "";
  } catch {
    return "";
  }
}
async function writeSetting(env, key, value, userId) {
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES (?, ?, ?, ?)\nON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id"
  ).bind(key, String(value || ""), nowSec2, userId || null).run();
}
async function readServerPlaylist(env, includeItems = false) {
  const playlistId = parsePlaylistId(await readSetting(env, PLAYLIST_ID_KEY)) || parsePlaylistId(env.VIDEO_GALLERY_PLAYLIST_ID || "");
  const name = String(await readSetting(env, PLAYLIST_NAME_KEY) || env.VIDEO_GALLERY_PLAYLIST_NAME || DEFAULT_GALLERY_NAME).trim() || DEFAULT_GALLERY_NAME;
  const data = {
    configured: !!playlistId,
    name,
    playlistId
  };
  if (includeItems) {
    data.items = await fetchPlaylistVideos(playlistId);
  }
  return data;
}
async function requireAdmin$1(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: json$1({ error: "Not logged in" }, 401) };
  if (!user.is_admin) return { error: json$1({ error: "Forbidden" }, 403) };
  return { user };
}
async function handleVideoGallery(request, env, url) {
  if (request.method !== "GET") {
    return json$1({ error: "Method not allowed" }, 405);
  }
  const playlist = await readServerPlaylist(env, true);
  return json$1(playlist);
}
async function handleAdminVideoGallery(request, env, url) {
  const auth = await requireAdmin$1(request, env);
  if (auth.error) return auth.error;
  if (request.method === "GET") {
    const playlist = await readServerPlaylist(env, true);
    return json$1(playlist);
  }
  if (request.method !== "POST") {
    return json$1({ error: "Method not allowed" }, 405);
  }
  let body = {};
  try {
    body = await request.json();
  } catch {
    return json$1({ error: "Bad JSON" }, 400);
  }
  const playlistId = parsePlaylistId(
    body.playlistId || body.playlist_id || body.playlist || body.list || body.url || ""
  );
  if (!playlistId || !isValidPlaylistId(playlistId)) {
    return json$1({ error: "Invalid playlistId" }, 400);
  }
  const name = String(body.name || body.title || DEFAULT_GALLERY_NAME).trim() || DEFAULT_GALLERY_NAME;
  await writeSetting(env, PLAYLIST_ID_KEY, playlistId, auth.user.id);
  await writeSetting(env, PLAYLIST_NAME_KEY, name, auth.user.id);
  const items = await fetchPlaylistVideos(playlistId);
  return json$1({
    ok: true,
    configured: true,
    name,
    playlistId,
    items
  });
}
const ALLOWED_STATUSES_BUILTIN = /* @__PURE__ */ new Set(["new", "planning", "in_dev", "done"]);
const MAX_TITLE = 200;
const MAX_BODY = 5e3;
const MAX_NOTE = 5e3;
const MAX_DETAIL$1 = 1e3;
const MAX_TAG = 60;
function jsonRes(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...init.headers || {} }
  });
}
function bad(msg, status = 400) {
  return jsonRes({ error: msg }, { status });
}
function clip$2(s, n) {
  s = String(s == null ? "" : s);
  return s.length > n ? s.slice(0, n) : s;
}
function sanitizeStatus(s) {
  s = String(s == null ? "new" : s).trim();
  if (!s) return "new";
  if (ALLOWED_STATUSES_BUILTIN.has(s)) return s;
  return clip$2(s.replace(/[\u0000-\u001F\u007F]/g, ""), MAX_TAG);
}
async function requireLogin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: bad("Not logged in", 401) };
  return { user };
}
async function requireAdmin(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: bad("Not logged in", 401) };
  if (!user.is_admin) return { error: bad("Forbidden", 403) };
  return { user };
}
async function handlePublicInbox(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/bug-reports/public" && method === "GET") {
    return listPublicBugReports(request, env, url);
  }
  const auth = await requireLogin(request, env);
  if (auth.error) return auth.error;
  const user = auth.user;
  if (path === "/api/bug-reports" && method === "POST") return submitBugReport(request, env, user);
  if (path === "/api/contact" && method === "POST") return submitContact(request, env, user);
  if (path === "/api/contact/mine" && method === "GET") return listMyContactMessages(request, env, user);
  if (path === "/api/usage/track" && method === "POST") return trackUsage(request, env, user);
  return new Response("Not found", { status: 404 });
}
async function listMyContactMessages(request, env, user) {
  const params = new URL(request.url).searchParams;
  const limit = Math.max(1, Math.min(200, Number(params.get("limit")) || 50));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const rows = await env.DB.prepare(
    `SELECT id, body, created_at, read_at
     FROM contact_messages WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(user.id, limit, offset).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE user_id = ?`
  ).bind(user.id).first();
  return jsonRes({
    items: rows.results || [],
    totalCount: totalRow?.c || 0,
    limit,
    offset
  });
}
async function listPublicBugReports(request, env, url) {
  const params = url.searchParams;
  const limit = Math.max(1, Math.min(500, Number(params.get("limit")) || 200));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const rows = await env.DB.prepare(
    `SELECT id, source, title, body, status, created_at, updated_at
     FROM bug_reports WHERE source = 'admin' ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM bug_reports WHERE source = 'admin'`
  ).first();
  return jsonRes({
    items: rows.results || [],
    totalCount: totalRow?.c || 0,
    limit,
    offset
  });
}
async function submitBugReport(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Bad JSON");
  }
  const title = clip$2(body?.title, MAX_TITLE).trim();
  const text = clip$2(body?.body, MAX_BODY).trim();
  if (!title || !text) return bad("כותרת ופירוט חובה");
  const meta = body?.meta && typeof body.meta === "object" ? clip$2(JSON.stringify(body.meta), 2e3) : null;
  const now = Math.floor(Date.now() / 1e3);
  const ins = await env.DB.prepare(
    `INSERT INTO bug_reports (user_id, user_email, source, title, body, status, meta, created_at, updated_at)
     VALUES (?, ?, 'user', ?, ?, 'new', ?, ?, ?)`
  ).bind(user.id, user.email, title, text, meta, now, now).run();
  await env.DB.prepare(
    `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
     VALUES (?, ?, 'bug_submit', ?, ?)`
  ).bind(user.id, user.email, JSON.stringify({ id: ins.meta.last_row_id, title }), now).run().catch(() => {
  });
  return jsonRes({ ok: true, id: ins.meta.last_row_id });
}
async function submitContact(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Bad JSON");
  }
  const text = clip$2(body?.body, MAX_BODY).trim();
  if (!text) return bad("פתק ריק");
  const meta = body?.meta && typeof body.meta === "object" ? clip$2(JSON.stringify(body.meta), 2e3) : null;
  const now = Math.floor(Date.now() / 1e3);
  const ins = await env.DB.prepare(
    `INSERT INTO contact_messages (user_id, user_email, body, meta, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, text, meta, now).run();
  await env.DB.prepare(
    `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
     VALUES (?, ?, 'contact_submit', ?, ?)`
  ).bind(user.id, user.email, JSON.stringify({ id: ins.meta.last_row_id }), now).run().catch(() => {
  });
  return jsonRes({ ok: true, id: ins.meta.last_row_id });
}
async function trackUsage(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Bad JSON");
  }
  const event = clip$2(body?.event, 60).trim();
  if (!event) return bad("event חובה");
  const detail = body?.detail != null ? clip$2(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail), MAX_DETAIL$1) : null;
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, event, detail, now).run();
  return jsonRes({ ok: true });
}
async function handleAdminInbox(request, env, url) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return auth.error;
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/admin/bug-reports" && method === "GET") return listBugReports(request, env, url);
  if (path === "/api/admin/bug-reports" && method === "POST") return adminCreateBugReport(request, env, auth.user);
  if (path.startsWith("/api/admin/bug-reports/")) {
    const id = Number(path.split("/").pop());
    if (method === "PATCH") return updateBugReport(request, env, id);
    if (method === "DELETE") return deleteBugReport(request, env, id);
  }
  if (path === "/api/admin/contact-messages" && method === "GET") return listContactMessages(request, env, url);
  if (path.startsWith("/api/admin/contact-messages/")) {
    const tail = path.slice("/api/admin/contact-messages/".length);
    if (tail.endsWith("/read") && method === "POST") {
      const id2 = Number(tail.slice(0, -"/read".length));
      return markContactRead(request, env, id2);
    }
    const id = Number(tail);
    if (method === "DELETE") return deleteContactMessage(request, env, id);
  }
  if (path === "/api/admin/usage" && method === "GET") return listUsage(request, env, url);
  const userContactMatch = path.match(/^\/api\/admin\/users\/(\d+)\/contact-messages$/);
  if (userContactMatch && method === "GET") {
    return listContactMessagesForUser(request, env, Number(userContactMatch[1]));
  }
  return new Response("Not found", { status: 404 });
}
async function listContactMessagesForUser(request, env, userId) {
  if (!Number.isFinite(userId) || userId <= 0) return bad("Bad user id");
  const params = new URL(request.url).searchParams;
  const limit = Math.max(1, Math.min(500, Number(params.get("limit")) || 200));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, body, meta, created_at, read_at
     FROM contact_messages WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE user_id = ?`
  ).bind(userId).first();
  const unreadRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE user_id = ? AND read_at IS NULL`
  ).bind(userId).first();
  return jsonRes({
    items: rows.results || [],
    totalCount: totalRow?.c || 0,
    unreadCount: unreadRow?.c || 0,
    limit,
    offset
  });
}
async function listBugReports(request, env, url) {
  const params = url.searchParams;
  const search = (params.get("search") || "").trim().toLowerCase();
  const status = (params.get("status") || "").trim();
  const source = (params.get("source") || "").trim();
  const limit = Math.max(1, Math.min(500, Number(params.get("limit")) || 100));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const where = [];
  const binds = [];
  if (search) {
    where.push("(LOWER(title) LIKE ? OR LOWER(body) LIKE ? OR LOWER(IFNULL(user_email,'')) LIKE ? OR LOWER(IFNULL(admin_note,'')) LIKE ?)");
    const q = `%${search}%`;
    binds.push(q, q, q, q);
  }
  if (status) {
    where.push("status = ?");
    binds.push(status);
  }
  if (source) {
    where.push("source = ?");
    binds.push(source);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM bug_reports ${whereSql}`
  ).bind(...binds).first();
  const totalCount = totalRow?.c || 0;
  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, source, title, body, status, admin_note,
            meta, created_at, updated_at
     FROM bug_reports ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  const counts = await env.DB.prepare(
    `SELECT status, COUNT(*) as c FROM bug_reports GROUP BY status`
  ).all();
  return jsonRes({
    items: rows.results,
    totalCount,
    limit,
    offset,
    counts: (counts.results || []).reduce((m, r) => {
      m[r.status] = r.c;
      return m;
    }, {})
  });
}
async function adminCreateBugReport(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Bad JSON");
  }
  const title = clip$2(body?.title, MAX_TITLE).trim();
  const text = clip$2(body?.body, MAX_BODY).trim();
  if (!title || !text) return bad("כותרת ופירוט חובה");
  const status = sanitizeStatus(body?.status || "planning");
  const adminNote = body?.admin_note ? clip$2(body.admin_note, MAX_NOTE) : null;
  const now = Math.floor(Date.now() / 1e3);
  const ins = await env.DB.prepare(
    `INSERT INTO bug_reports (user_id, user_email, source, title, body, status, admin_note, created_at, updated_at)
     VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, user.email, title, text, status, adminNote, now, now).run();
  return jsonRes({ ok: true, id: ins.meta.last_row_id });
}
async function updateBugReport(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad("Bad id");
  let body;
  try {
    body = await request.json();
  } catch {
    return bad("Bad JSON");
  }
  const sets = [];
  const binds = [];
  if (typeof body?.status === "string") {
    sets.push("status = ?");
    binds.push(sanitizeStatus(body.status));
  }
  if (typeof body?.title === "string") {
    const t = clip$2(body.title, MAX_TITLE).trim();
    if (!t) return bad("כותרת ריקה");
    sets.push("title = ?");
    binds.push(t);
  }
  if (typeof body?.body === "string") {
    const t = clip$2(body.body, MAX_BODY).trim();
    if (!t) return bad("פירוט ריק");
    sets.push("body = ?");
    binds.push(t);
  }
  if ("admin_note" in (body || {})) {
    const note = body.admin_note == null ? null : clip$2(String(body.admin_note), MAX_NOTE);
    sets.push("admin_note = ?");
    binds.push(note);
  }
  if (sets.length === 0) return bad("No fields");
  const now = Math.floor(Date.now() / 1e3);
  sets.push("updated_at = ?");
  binds.push(now);
  binds.push(id);
  await env.DB.prepare(`UPDATE bug_reports SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run();
  const row = await env.DB.prepare(
    `SELECT id, user_id, user_email, source, title, body, status, admin_note, meta, created_at, updated_at
     FROM bug_reports WHERE id = ?`
  ).bind(id).first();
  return jsonRes(row || { error: "Not found" }, { status: row ? 200 : 404 });
}
async function deleteBugReport(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad("Bad id");
  await env.DB.prepare("DELETE FROM bug_reports WHERE id = ?").bind(id).run();
  return jsonRes({ deleted: id });
}
async function listContactMessages(request, env, url) {
  const params = url.searchParams;
  const search = (params.get("search") || "").trim().toLowerCase();
  const unreadOnly = params.get("unread") === "1";
  const limit = Math.max(1, Math.min(500, Number(params.get("limit")) || 100));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const where = [];
  const binds = [];
  if (search) {
    where.push("(LOWER(body) LIKE ? OR LOWER(IFNULL(user_email,'')) LIKE ?)");
    const q = `%${search}%`;
    binds.push(q, q);
  }
  if (unreadOnly) where.push("(read_at IS NULL OR read_at = 0)");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages ${whereSql}`
  ).bind(...binds).first();
  const totalCount = totalRow?.c || 0;
  const unreadRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM contact_messages WHERE read_at IS NULL OR read_at = 0`
  ).first();
  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, body, read_at, meta, created_at
     FROM contact_messages ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  return jsonRes({
    items: rows.results,
    totalCount,
    unreadCount: unreadRow?.c || 0,
    limit,
    offset
  });
}
async function markContactRead(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad("Bad id");
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.prepare("UPDATE contact_messages SET read_at = ? WHERE id = ?").bind(now, id).run();
  return jsonRes({ ok: true, id, read_at: now });
}
async function deleteContactMessage(request, env, id) {
  if (!Number.isFinite(id) || id <= 0) return bad("Bad id");
  await env.DB.prepare("DELETE FROM contact_messages WHERE id = ?").bind(id).run();
  return jsonRes({ deleted: id });
}
async function listUsage(request, env, url) {
  const params = url.searchParams;
  const userId = Number(params.get("user_id")) || 0;
  const event = (params.get("event") || "").trim();
  const search = (params.get("search") || "").trim().toLowerCase();
  const fromTs = Number(params.get("from")) || 0;
  const toTs = Number(params.get("to")) || 0;
  const limit = Math.max(1, Math.min(1e3, Number(params.get("limit")) || 200));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const where = [];
  const binds = [];
  if (userId > 0) {
    where.push("user_id = ?");
    binds.push(userId);
  }
  if (event) {
    where.push("event = ?");
    binds.push(event);
  }
  if (search) {
    where.push("(LOWER(IFNULL(user_email,'')) LIKE ? OR LOWER(IFNULL(detail,'')) LIKE ?)");
    const q = `%${search}%`;
    binds.push(q, q);
  }
  if (fromTs > 0) {
    where.push("created_at >= ?");
    binds.push(fromTs);
  }
  if (toTs > 0) {
    where.push("created_at <= ?");
    binds.push(toTs);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totalRow = await env.DB.prepare(
    `SELECT COUNT(*) as c FROM usage_events ${whereSql}`
  ).bind(...binds).first();
  const totalCount = totalRow?.c || 0;
  const rows = await env.DB.prepare(
    `SELECT id, user_id, user_email, event, detail, created_at
     FROM usage_events ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).bind(...binds, limit, offset).all();
  const weekAgo = Math.floor(Date.now() / 1e3) - 86400 * 7;
  const byEvent = await env.DB.prepare(
    `SELECT event, COUNT(*) as c FROM usage_events WHERE created_at >= ? GROUP BY event ORDER BY c DESC`
  ).bind(weekAgo).all();
  const topUsers = await env.DB.prepare(
    `SELECT user_email, COUNT(*) as c FROM usage_events
     WHERE created_at >= ? AND user_email IS NOT NULL
     GROUP BY user_email ORDER BY c DESC LIMIT 20`
  ).bind(weekAgo).all();
  return jsonRes({
    items: rows.results,
    totalCount,
    limit,
    offset,
    summaryByEvent: byEvent.results || [],
    topUsersWeek: topUsers.results || []
  });
}
const MAX_DOC_BYTES = 1024 * 1024;
const MAX_SETTINGS_BYTES = 100 * 1024;
async function requireUser(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: "Not logged in", status: 401 };
  return { user };
}
async function handleStorage(request, env, url) {
  const auth = await requireUser(request, env);
  if (auth.error) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  }
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/documents/current" && method === "GET") {
    return getCurrent(env, auth.user);
  }
  if (path === "/api/documents/current" && method === "PUT") {
    return putCurrent(request, env, auth.user);
  }
  if (path === "/api/settings" && method === "GET") {
    return getSettings$1(env, auth.user);
  }
  if (path === "/api/settings" && method === "PUT") {
    return putSettings(request, env, auth.user);
  }
  if (path === "/api/settings" && method === "PATCH") {
    return patchSettings(request, env, auth.user);
  }
  return new Response("Not found", { status: 404 });
}
async function getCurrent(env, user) {
  const row = await env.DB.prepare(
    `SELECT id, title, content_json, size_bytes, updated_at
     FROM documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(user.id).first();
  if (!row) {
    return Response.json({ document: null }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({
    document: {
      id: row.id,
      title: row.title,
      content: JSON.parse(row.content_json),
      sizeBytes: row.size_bytes,
      updatedAt: row.updated_at
    }
  }, { headers: { "cache-control": "no-store" } });
}
async function putCurrent(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const content = body?.content;
  if (content == null) return new Response("Missing content", { status: 400 });
  const json2 = JSON.stringify(content);
  const bytes = new TextEncoder().encode(json2).byteLength;
  if (bytes > MAX_DOC_BYTES) {
    return new Response(`Document too large: ${bytes} > ${MAX_DOC_BYTES}`, { status: 413 });
  }
  const title = String(body?.title || "").slice(0, 200);
  const now = Math.floor(Date.now() / 1e3);
  const existing = await env.DB.prepare(
    `SELECT id FROM documents WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(user.id).first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE documents SET title = ?, content_json = ?, size_bytes = ?, updated_at = ? WHERE id = ?`
    ).bind(title, json2, bytes, now, existing.id).run();
    return Response.json({ id: existing.id, sizeBytes: bytes, updatedAt: now });
  } else {
    const ins = await env.DB.prepare(
      `INSERT INTO documents (user_id, title, content_json, size_bytes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(user.id, title, json2, bytes, now, now).run();
    return Response.json({ id: ins.meta.last_row_id, sizeBytes: bytes, updatedAt: now });
  }
}
async function getSettings$1(env, user) {
  const row = await env.DB.prepare(
    `SELECT settings_json, size_bytes, updated_at FROM user_settings WHERE user_id = ?`
  ).bind(user.id).first();
  if (!row) {
    return Response.json({ settings: {} }, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({
    settings: JSON.parse(row.settings_json),
    sizeBytes: row.size_bytes,
    updatedAt: row.updated_at
  }, { headers: { "cache-control": "no-store" } });
}
async function putSettings(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const settings = body?.settings;
  if (settings == null || typeof settings !== "object") {
    return new Response("Missing settings object", { status: 400 });
  }
  const json2 = JSON.stringify(settings);
  const bytes = new TextEncoder().encode(json2).byteLength;
  if (bytes > MAX_SETTINGS_BYTES) {
    return new Response(`Settings too large: ${bytes} > ${MAX_SETTINGS_BYTES}`, { status: 413 });
  }
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, settings_json, size_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       settings_json = excluded.settings_json,
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at`
  ).bind(user.id, json2, bytes, now).run();
  return Response.json({ sizeBytes: bytes, updatedAt: now });
}
async function patchSettings(request, env, user) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  const patch = body?.settings;
  if (patch == null || typeof patch !== "object") {
    return new Response("Missing settings object", { status: 400 });
  }
  const row = await env.DB.prepare(
    `SELECT settings_json FROM user_settings WHERE user_id = ?`
  ).bind(user.id).first();
  let settings = {};
  if (row?.settings_json) {
    try {
      settings = JSON.parse(row.settings_json) || {};
    } catch {
      settings = {};
    }
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete settings[key];
    else settings[key] = String(value);
  }
  const json2 = JSON.stringify(settings);
  const bytes = new TextEncoder().encode(json2).byteLength;
  if (bytes > MAX_SETTINGS_BYTES) {
    return new Response(`Settings too large: ${bytes} > ${MAX_SETTINGS_BYTES}`, { status: 413 });
  }
  const now = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    `INSERT INTO user_settings (user_id, settings_json, size_bytes, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       settings_json = excluded.settings_json,
       size_bytes = excluded.size_bytes,
       updated_at = excluded.updated_at`
  ).bind(user.id, json2, bytes, now).run();
  return Response.json({ sizeBytes: bytes, updatedAt: now });
}
const PLAN_DEFS = {
  monthly: { type: "subscription", amount: 50, durationSec: 30 * 24 * 60 * 60 },
  yearly: { type: "subscription", amount: 300, durationSec: 365 * 24 * 60 * 60 }
};
const PACK_DEFS = {
  h1: { type: "hours", amount: 5, hours: 1 },
  h5: { type: "hours", amount: 22, hours: 5 },
  h10: { type: "hours", amount: 40, hours: 10 },
  h20: { type: "hours", amount: 70, hours: 20 }
};
const GIFT_MINUTES_PER_MONTH = 20;
function jsonResponse$8(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...init.headers || {} }
  });
}
function jsonError(message, status = 400) {
  return jsonResponse$8({ error: message }, { status });
}
function randomToken$1(bytes = 18) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function thisMonthKey() {
  const d = /* @__PURE__ */ new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function resolvePlanOrPack(body) {
  if (body.planCode && PLAN_DEFS[body.planCode]) return { kind: "plan", code: body.planCode, def: PLAN_DEFS[body.planCode] };
  if (body.packCode && PACK_DEFS[body.packCode]) return { kind: "pack", code: body.packCode, def: PACK_DEFS[body.packCode] };
  return null;
}
async function resolveCustomPackage(env, body) {
  if (!body.pkgToken) return null;
  const pkg = await getPackageByToken(env, body.pkgToken);
  if (!pkg) return null;
  const durationSec = pkg.days != null ? pkg.days * 24 * 60 * 60 : (pkg.hours || 0) * 60 * 60;
  return {
    kind: "custom",
    code: `custom-${pkg.id}`,
    customId: pkg.id,
    customToken: pkg.token,
    def: {
      type: pkg.days != null ? "subscription" : "hours",
      amount: pkg.amount,
      hours: pkg.hours || 0,
      days: pkg.days || 0,
      durationSec,
      label: pkg.label
    }
  };
}
async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
async function buildYaadRedirect(env, intent, returnOrigin) {
  const config = await getPaymentConfig(env);
  const base = (config.YAAD_BASE_URL || "https://icom.yaad.net/p/").replace(/\/?$/, "/");
  const callbackUrl = `${returnOrigin}/api/payments/yaad/callback`;
  const apiSignParams = new URLSearchParams({
    action: "APISign",
    What: "SIGN",
    KEY: config.YAAD_API_KEY || "",
    PassP: config.YAAD_PASSP || "",
    Masof: config.YAAD_TERMINAL || "",
    Order: intent.token,
    Info: intent.label,
    Amount: String(intent.amount),
    Coin: "1",
    UTF8: "True",
    UTF8out: "True",
    UserId: intent.idNumber,
    ClientName: intent.firstName || "",
    ClientLName: intent.lastName || "",
    Tash: "1",
    FixTash: "True",
    sendemail: "True",
    SendHesh: "True",
    MoreData: "True",
    PageLang: "HEB",
    tmp: "13",
    UrlBack: callbackUrl
  });
  let signedQuery;
  try {
    const signRes = await fetch(`${base}?${apiSignParams.toString()}`, { method: "GET" });
    signedQuery = (await signRes.text()).trim();
  } catch (e) {
    throw new Error(`Yaad APISign network failure: ${e && e.message || "unknown"}`);
  }
  const lower = signedQuery.toLowerCase();
  if (!signedQuery.includes("signature=") || lower.includes("error") || lower.includes("errcode")) {
    throw new Error(`Yaad APISign rejected: ${signedQuery.slice(0, 250)}`);
  }
  return `${base}?action=pay&${signedQuery}`;
}
async function startYaad(request, env, url) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError("נדרש להתחבר תחילה", 401);
  const body = await readBody(request);
  const choice = await resolveCustomPackage(env, body) || resolvePlanOrPack(body);
  if (!choice) return jsonError("בחירה לא חוקית");
  if (!Number.isFinite(body.amount) || Number(body.amount) !== Number(choice.def.amount)) {
    return jsonError("סכום לא תואם לתוכנית הנבחרת");
  }
  const userRow = await env.DB.prepare(
    "SELECT phone_e164, id_number, first_name, last_name, email FROM users WHERE id = ?"
  ).bind(user.id).first();
  if (!userRow?.phone_e164) {
    return jsonError("phone_required: יש להזין טלפון לפני התשלום", 412);
  }
  const token = randomToken$1();
  const label = choice.kind === "plan" ? `מנוי-${choice.code}` : choice.kind === "pack" ? `שעות-${choice.code}` : `מותאם-${choice.def.label || choice.customId}`;
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "INSERT INTO payment_intents (user_id, provider, token, amount, plan_code, pack_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    user.id,
    "yaad",
    token,
    choice.def.amount,
    choice.kind === "plan" ? choice.code : null,
    choice.kind === "pack" ? choice.code : choice.kind === "custom" ? `custom:${choice.customToken}` : null,
    "pending",
    nowSec2
  ).run();
  const fallback = (userRow.email || "").split("@")[0] || "לקוח";
  const firstName = (userRow.first_name || fallback).slice(0, 30);
  const lastName = (userRow.last_name || fallback).slice(0, 30);
  const intent = {
    token,
    amount: choice.def.amount,
    label,
    idNumber: userRow.id_number || "0",
    firstName,
    lastName
  };
  const redirectUrl = await buildYaadRedirect(env, intent, url.origin);
  return jsonResponse$8({ redirectUrl, token });
}
async function yaadCallback(request, env, url) {
  const params = url.searchParams;
  const token = params.get("Order") || "";
  const ccode = params.get("CCode");
  const status = params.get("Status");
  const errCode = params.get("ErrCode");
  const ok = ccode === "0" || status === "0" || ccode === "000" || status === "000";
  const rawParams = [...params.entries()].map(([k, v]) => `${k}=${v}`).join("&");
  if (!token) {
    return Response.redirect(`${url.origin}/?premium=failed&reason=no_order`, 302);
  }
  const intent = await env.DB.prepare(
    "SELECT id, user_id, provider, token, amount, plan_code, pack_code, status FROM payment_intents WHERE token = ?"
  ).bind(token).first();
  if (!intent) return Response.redirect(`${url.origin}/?premium=failed&reason=unknown_token`, 302);
  if (intent.status === "completed") {
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  }
  if (!ok) {
    const errInfo = `FAIL CCode=${ccode || "-"} Status=${status || "-"} ErrCode=${errCode || "-"} | ${rawParams.slice(0, 400)}`;
    await env.DB.prepare("UPDATE payment_intents SET status = 'failed', txn_id = ? WHERE id = ?").bind(errInfo, intent.id).run();
    await env.DB.prepare("UPDATE users SET failed_charge_count = COALESCE(failed_charge_count,0) + 1 WHERE id = ?").bind(intent.user_id).run().catch(() => {
    });
    return Response.redirect(`${url.origin}/?premium=failed`, 302);
  }
  const yaadToken = params.get("Token") || params.get("J5Token") || "";
  const txnId = params.get("Id") || "";
  await applySuccessfulPayment(env, intent, txnId, { yaadToken });
  return Response.redirect(`${url.origin}/?premium=success`, 302);
}
async function paypalToken(env) {
  const config = await getPaymentConfig(env);
  const base = (config.PAYPAL_BASE_URL || "https://api-m.paypal.com").replace(/\/$/, "");
  const r = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!r.ok) throw new Error("PayPal auth failed");
  const j = await r.json();
  return j.access_token;
}
async function startPaypal(request, env, url) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError("נדרש להתחבר תחילה", 401);
  const body = await readBody(request);
  const choice = await resolveCustomPackage(env, body) || resolvePlanOrPack(body);
  if (!choice) return jsonError("בחירה לא חוקית");
  if (choice.def.amount < 30) return jsonError('פייפאל זמין מ-30 ש"ח ומעלה');
  if (!Number.isFinite(body.amount) || Number(body.amount) !== Number(choice.def.amount)) return jsonError("סכום לא תואם");
  const userRow = await env.DB.prepare("SELECT phone_e164 FROM users WHERE id = ?").bind(user.id).first();
  if (!userRow?.phone_e164) {
    return jsonError("phone_required: יש להזין טלפון לפני התשלום", 412);
  }
  const config = await getPaymentConfig(env);
  if (!config.PAYPAL_CLIENT_ID || !config.PAYPAL_SECRET) {
    return jsonError("שירות פייפאל אינו מוגדר עדיין. אנא בחרו תשלום באשראי.", 503);
  }
  const paypalBase = (config.PAYPAL_BASE_URL || "https://api-m.paypal.com").replace(/\/$/, "");
  const token = randomToken$1();
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "INSERT INTO payment_intents (user_id, provider, token, amount, plan_code, pack_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    user.id,
    "paypal",
    token,
    choice.def.amount,
    choice.kind === "plan" ? choice.code : null,
    choice.kind === "pack" ? choice.code : choice.kind === "custom" ? `custom:${choice.customToken}` : null,
    "pending",
    nowSec2
  ).run();
  const accessToken = await paypalToken(env);
  const orderRes = await fetch(`${paypalBase}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: token,
        amount: { currency_code: "ILS", value: String(choice.def.amount) },
        description: choice.kind === "plan" ? `RavText subscription ${choice.code}` : `RavText hours ${choice.code}`
      }],
      application_context: {
        brand_name: "רב טקסט לוורד AI",
        return_url: `${url.origin}/api/payments/paypal/callback?token=${token}`,
        cancel_url: `${url.origin}/?premium=cancelled`
      }
    })
  });
  if (!orderRes.ok) {
    return jsonError("פייפאל סירב לפתוח עסקה — נסה שוב מאוחר יותר", 502);
  }
  const order = await orderRes.json();
  const approve = order.links?.find((l) => l.rel === "approve");
  if (!approve) return jsonError("פייפאל לא החזיר כתובת אישור", 502);
  await env.DB.prepare("UPDATE payment_intents SET status = ?, txn_id = ? WHERE token = ?").bind("awaiting_paypal", order.id, token).run().catch(() => {
  });
  return jsonResponse$8({ redirectUrl: approve.href, token, paypalOrder: order.id });
}
async function paypalCallback(request, env, url) {
  const token = url.searchParams.get("token");
  if (!token) return new Response("Bad request", { status: 400 });
  const intent = await env.DB.prepare(
    "SELECT id, user_id, provider, token, txn_id, amount, plan_code, pack_code, status FROM payment_intents WHERE token = ?"
  ).bind(token).first();
  if (!intent) return new Response("Unknown token", { status: 404 });
  if (intent.status === "completed") {
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  }
  const paypalOrderId = intent.txn_id;
  if (!paypalOrderId) return Response.redirect(`${url.origin}/?premium=failed`, 302);
  try {
    const accessToken = await paypalToken(env);
    const cfg = await getPaymentConfig(env);
    const ppBase = (cfg.PAYPAL_BASE_URL || "https://api-m.paypal.com").replace(/\/$/, "");
    const captureRes = await fetch(`${ppBase}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    });
    if (!captureRes.ok) {
      await env.DB.prepare("UPDATE payment_intents SET status = 'failed' WHERE id = ?").bind(intent.id).run();
      return Response.redirect(`${url.origin}/?premium=failed`, 302);
    }
    const cap = await captureRes.json();
    const captureId = cap?.purchase_units?.[0]?.payments?.captures?.[0]?.id || "";
    const payerId = cap?.payer?.payer_id || "";
    await applySuccessfulPayment(env, intent, captureId, { payerId });
    return Response.redirect(`${url.origin}/?premium=success`, 302);
  } catch {
    return Response.redirect(`${url.origin}/?premium=failed`, 302);
  }
}
async function applySuccessfulPayment(env, intent, externalTxnId, tokens = {}) {
  const nowSec2 = Math.floor(Date.now() / 1e3);
  const user = await env.DB.prepare("SELECT id, status, expires_at, balance_seconds, plan_type FROM users WHERE id = ?").bind(intent.user_id).first();
  if (!user) return;
  if (tokens.yaadToken) {
    await env.DB.prepare("UPDATE users SET yaad_token = ?, last_payment_provider = 'yaad' WHERE id = ?").bind(tokens.yaadToken, user.id).run().catch(() => {
    });
  }
  if (tokens.payerId) {
    await env.DB.prepare("UPDATE users SET paypal_payer_id = ?, last_payment_provider = 'paypal' WHERE id = ?").bind(tokens.payerId, user.id).run().catch(() => {
    });
  }
  await env.DB.prepare("UPDATE users SET last_payment_at = ?, failed_charge_count = 0 WHERE id = ?").bind(nowSec2, user.id).run().catch(() => {
  });
  if (intent.plan_code) {
    const plan = PLAN_DEFS[intent.plan_code];
    if (!plan) return;
    const baseExpire = user.expires_at && user.expires_at > nowSec2 ? user.expires_at : nowSec2;
    const newExpire = baseExpire + plan.durationSec;
    await env.DB.prepare(
      "UPDATE users SET status = 'active', plan_type = ?, expires_at = ?, plan_renew_at = ? WHERE id = ?"
    ).bind("subscription", newExpire, newExpire, user.id).run();
  } else if (intent.pack_code && intent.pack_code.startsWith("custom:")) {
    const customToken = intent.pack_code.slice("custom:".length);
    const pkg = await env.DB.prepare(
      "SELECT id, hours, days FROM custom_packages WHERE token = ?"
    ).bind(customToken).first();
    if (!pkg) return;
    if (pkg.days != null && pkg.days > 0) {
      const baseExpire = user.expires_at && user.expires_at > nowSec2 ? user.expires_at : nowSec2;
      const newExpire = baseExpire + pkg.days * 24 * 60 * 60;
      await env.DB.prepare(
        "UPDATE users SET status = 'active', plan_type = COALESCE(plan_type,'subscription'), expires_at = ?, plan_renew_at = ? WHERE id = ?"
      ).bind(newExpire, newExpire, user.id).run();
    } else if (pkg.hours != null && pkg.hours > 0) {
      const seconds = Math.round(pkg.hours * 3600);
      const newBalance = (user.balance_seconds || 0) + seconds;
      const expireMin = nowSec2 + newBalance;
      await env.DB.prepare(
        "UPDATE users SET status = 'active', plan_type = COALESCE(plan_type,'hours'), balance_seconds = ?, expires_at = ? WHERE id = ?"
      ).bind(newBalance, expireMin, user.id).run();
    }
    await env.DB.prepare("UPDATE custom_packages SET used_count = used_count + 1 WHERE id = ?").bind(pkg.id).run().catch(() => {
    });
  } else if (intent.pack_code) {
    const pack = PACK_DEFS[intent.pack_code];
    if (!pack) return;
    const seconds = pack.hours * 3600;
    const newBalance = (user.balance_seconds || 0) + seconds;
    const expireMin = nowSec2 + newBalance;
    await env.DB.prepare(
      "UPDATE users SET status = 'active', plan_type = COALESCE(plan_type,'hours'), balance_seconds = ?, expires_at = ? WHERE id = ?"
    ).bind(newBalance, expireMin, user.id).run();
  }
  await env.DB.prepare(
    "INSERT INTO payments (user_id, provider, amount, plan_code, pack_code, txn_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(intent.user_id, intent.provider, intent.amount, intent.plan_code, intent.pack_code, externalTxnId || "", nowSec2).run();
  await env.DB.prepare("UPDATE payment_intents SET status = 'completed' WHERE id = ?").bind(intent.id).run();
}
async function getStatus(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse$8({ paid: false, planType: null, expiresAt: null, balanceSeconds: 0 });
  const row = await env.DB.prepare(
    "SELECT plan_type, expires_at, balance_seconds FROM users WHERE id = ?"
  ).bind(user.id).first();
  const expiresAtMs = row?.expires_at ? row.expires_at * 1e3 : null;
  return jsonResponse$8({
    paid: !!user.paid,
    planType: row?.plan_type || null,
    expiresAt: expiresAtMs,
    balanceSeconds: row?.balance_seconds || 0,
    email: user.email
  });
}
async function cancelSubscription(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError("נדרש להתחבר תחילה", 401);
  let body = {};
  try {
    body = await request.json();
  } catch {
  }
  const reason = String(body?.reason || "").slice(0, 500);
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 0, plan_renew_at = 0, cancelled_at = ?, cancellation_reason = ? WHERE id = ?"
  ).bind(nowSec2, reason || null, user.id).run();
  return jsonResponse$8({ ok: true });
}
async function claimGift(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonError("נדרש להתחבר תחילה", 401);
  const monthKey = thisMonthKey();
  const nowSec2 = Math.floor(Date.now() / 1e3);
  try {
    await env.DB.prepare(
      "INSERT INTO gift_claims (user_id, year_month, claimed_at) VALUES (?, ?, ?)"
    ).bind(user.id, monthKey, nowSec2).run();
  } catch {
    return jsonResponse$8({ granted: false, reason: "already_claimed" });
  }
  const giftSeconds = GIFT_MINUTES_PER_MONTH * 60;
  const row = await env.DB.prepare("SELECT balance_seconds, expires_at, status FROM users WHERE id = ?").bind(user.id).first();
  const newBalance = (row?.balance_seconds || 0) + giftSeconds;
  const newExpire = Math.max(row?.expires_at || nowSec2, nowSec2) + giftSeconds;
  await env.DB.prepare(
    "UPDATE users SET status = CASE WHEN status = 'unauthorized' THEN 'active' ELSE status END, plan_type = COALESCE(plan_type,'hours'), balance_seconds = ?, expires_at = ? WHERE id = ?"
  ).bind(newBalance, newExpire, user.id).run();
  return jsonResponse$8({ granted: true, addedSeconds: giftSeconds, newBalance });
}
async function handlePayments(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/payments/yaad/start" && method === "POST") return startYaad(request, env, url);
  if (path === "/api/payments/yaad/callback") return yaadCallback(request, env, url);
  if (path === "/api/payments/paypal/start" && method === "POST") return startPaypal(request, env, url);
  if (path === "/api/payments/paypal/callback") return paypalCallback(request, env, url);
  if (path === "/api/payments/status" && (method === "GET" || method === "POST")) return getStatus(request, env);
  if (path === "/api/payments/cancel" && method === "POST") return cancelSubscription(request, env);
  if (path === "/api/payments/gift/claim" && method === "POST") return claimGift(request, env);
  return new Response("Not found", { status: 404 });
}
const COUNTRY_DIAL = {
  IL: "972",
  US: "1",
  CA: "1",
  GB: "44",
  FR: "33",
  BE: "32",
  DE: "49",
  CH: "41",
  AT: "43",
  NL: "31",
  IT: "39",
  ES: "34",
  AU: "61",
  NZ: "64",
  AR: "54",
  BR: "55",
  MX: "52",
  ZA: "27",
  RU: "7",
  UA: "380",
  CZ: "420",
  PL: "48",
  HU: "36",
  RO: "40",
  TR: "90",
  AE: "971",
  JO: "962",
  EG: "20"
};
function normalizeDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}
function toE164(country, raw) {
  const dial = COUNTRY_DIAL[country];
  if (!dial) return null;
  let digits = normalizeDigits(raw);
  if (!digits) return null;
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.startsWith(dial)) return digits;
  return dial + digits;
}
function isValidPhone(country, raw) {
  const e164 = toE164(country, raw);
  if (!e164) return false;
  return e164.length >= 7 && e164.length <= 15;
}
function jsonResponse$7(obj, init = {}) {
  return new Response(JSON.stringify(obj), {
    status: init.status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...init.headers || {} }
  });
}
async function getMe(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse$7({ error: "Not logged in" }, { status: 401 });
  const row = await env.DB.prepare(
    "SELECT phone, phone_country, phone_e164, id_number, subscription_active FROM users WHERE id = ?"
  ).bind(user.id).first();
  return jsonResponse$7({
    email: user.email,
    phone: row?.phone || "",
    phoneCountry: row?.phone_country || "IL",
    phoneE164: row?.phone_e164 || "",
    hasPhone: !!row?.phone_e164,
    idNumber: row?.id_number || "",
    hasIdNumber: !!row?.id_number,
    subscriptionActive: row?.subscription_active == null ? true : !!row.subscription_active
  });
}
async function putIdNumber(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse$7({ error: "Not logged in" }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse$7({ error: "Bad JSON" }, { status: 400 });
  }
  const raw = String(body?.idNumber || "").trim();
  const digits = raw.replace(/\D+/g, "");
  if (digits.length < 5 || digits.length > 12) {
    return jsonResponse$7({ error: "מספר ת.ז. חייב להיות בין 5 ל-12 ספרות" }, { status: 400 });
  }
  await env.DB.prepare("UPDATE users SET id_number = ? WHERE id = ?").bind(digits, user.id).run();
  return jsonResponse$7({ ok: true, idNumber: digits });
}
async function cancelByUser(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse$7({ error: "Not logged in" }, { status: 401 });
  let body = {};
  try {
    body = await request.json();
  } catch {
  }
  const reason = String(body?.reason || "").slice(0, 500);
  const nowSec2 = Math.floor(Date.now() / 1e3);
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 0, plan_renew_at = 0, cancelled_at = ?, cancellation_reason = ? WHERE id = ?"
  ).bind(nowSec2, reason || null, user.id).run();
  return jsonResponse$7({ ok: true });
}
async function reactivate(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse$7({ error: "Not logged in" }, { status: 401 });
  const row = await env.DB.prepare("SELECT expires_at FROM users WHERE id = ?").bind(user.id).first();
  await env.DB.prepare(
    "UPDATE users SET subscription_active = 1, plan_renew_at = ?, cancelled_at = NULL, cancellation_reason = NULL WHERE id = ?"
  ).bind(row?.expires_at || 0, user.id).run();
  return jsonResponse$7({ ok: true });
}
async function putPhone(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return jsonResponse$7({ error: "Not logged in" }, { status: 401 });
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse$7({ error: "Bad JSON" }, { status: 400 });
  }
  const country = String(body?.country || "IL").toUpperCase();
  const raw = String(body?.phone || "").trim();
  if (!COUNTRY_DIAL[country]) return jsonResponse$7({ error: "מדינה לא נתמכת" }, { status: 400 });
  if (!isValidPhone(country, raw)) return jsonResponse$7({ error: "מספר טלפון לא תקין" }, { status: 400 });
  const e164 = toE164(country, raw);
  await env.DB.prepare(
    "UPDATE users SET phone = ?, phone_country = ?, phone_e164 = ? WHERE id = ?"
  ).bind(raw, country, e164, user.id).run();
  return jsonResponse$7({ ok: true, phone: raw, phoneCountry: country, phoneE164: e164 });
}
async function handleAccount(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  if (path === "/api/account/me" && method === "GET") return getMe(request, env);
  if (path === "/api/account/phone" && method === "PUT") return putPhone(request, env);
  if (path === "/api/account/id-number" && method === "PUT") return putIdNumber(request, env);
  if (path === "/api/account/cancel" && method === "POST") return cancelByUser(request, env);
  if (path === "/api/account/reactivate" && method === "POST") return reactivate(request, env);
  return new Response("Not found", { status: 404 });
}
const DEFAULT_IMAGE_MODEL = "gemini-3-pro-image-preview";
const MAX_DETAIL = 1800;
const MAX_PREVIEW = 220;
const MAX_SCENE_TEXT = 8e3;
const MAX_COUNT = 4;
const DEFAULT_SYSTEM_PROMPT = [
  "You are a server-side image generator for a Hebrew/English caricature tool.",
  "Create a clean, family-friendly editorial caricature illustration from the user scene.",
  "Do not include signatures, artist names, watermarks, logos, copyright marks, or hidden corner text.",
  "Return image output, not a text-only answer."
].join("\n");
const DEFAULT_HARD_RULES = [
  "No signature. No watermark. No artist name. No logo. No copyright mark.",
  "No unrelated text unless the user explicitly requested visible text as part of the scene.",
  "Keep the output safe, non-explicit, and family-friendly."
].join("\n");
function jsonResponse$6(body, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
function clip$1(value, max) {
  const s = String(value == null ? "" : value);
  return s.length > max ? s.slice(0, max) : s;
}
function nowSec() {
  return Math.floor(Date.now() / 1e3);
}
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function normalizeText(value, max = MAX_SCENE_TEXT) {
  return clip$1(String(value || "").replace(/\u200B/g, "").replace(/\u00A0/g, " ").replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), max);
}
async function getAppSetting(env, key) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first();
    return row && row.value != null ? String(row.value) : null;
  } catch {
    return null;
  }
}
async function getSetting(env, key, fallback = "") {
  const fromEnv = env && env[key] != null ? String(env[key]).trim() : "";
  if (fromEnv) return fromEnv;
  const fromDb = String(await getAppSetting(env, key) || "").trim();
  return fromDb || fallback;
}
async function getBoolSetting(env, key, fallback = false) {
  const v = String(await getSetting(env, key, fallback ? "1" : "0")).trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(v);
}
async function getCaricatureConfig(env) {
  return {
    imageModel: await getSetting(env, "CARICATURE_IMAGE_MODEL", DEFAULT_IMAGE_MODEL),
    systemPrompt: await getSetting(env, "CARICATURE_SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT),
    hardRules: await getSetting(env, "CARICATURE_HARD_RULES", DEFAULT_HARD_RULES),
    negativeDefault: await getSetting(env, "CARICATURE_NEGATIVE_DEFAULT", ""),
    referenceImageB64: await getSetting(env, "CARICATURE_REFERENCE_IMAGE_B64", ""),
    referenceImageMime: await getSetting(env, "CARICATURE_REFERENCE_IMAGE_MIME", "image/jpeg"),
    debug: await getBoolSetting(env, "CARICATURE_DEBUG", false)
  };
}
function clientApiKey(bodyJson) {
  return String(
    bodyJson?.api_key || bodyJson?.apiKey || bodyJson?.gemini_api_key || bodyJson?.geminiApiKey || bodyJson?.user_key || bodyJson?.userKey || bodyJson?.image_api_key || ""
  ).trim();
}
function summarizeRequestBody(bodyJson) {
  const sceneText = String(bodyJson?.scene_text || "").trim();
  return {
    prompt_type: clip$1(bodyJson?.prompt_type, 80),
    model: clip$1(bodyJson?.model || bodyJson?.image_model || "", 120),
    style_key: clip$1(bodyJson?.style_key, 180),
    aspect: clip$1(bodyJson?.aspect, 30),
    count: Math.max(0, Math.min(Number(bodyJson?.count) || 0, 20)),
    polish: !!bodyJson?.polish,
    negative_len: String(bodyJson?.negative || "").length,
    scene_text_len: sceneText.length,
    scene_text_preview: clip$1(sceneText.replace(/\s+/g, " "), MAX_PREVIEW),
    key_source: clientApiKey(bodyJson) ? "client_supplied" : "missing"
  };
}
function summarizeResult(responseJson, statusCode, durationMs) {
  const images = Array.isArray(responseJson?.images) ? responseJson.images : [];
  const errorCode = responseJson?.error || (statusCode >= 400 ? `http_${statusCode}` : null);
  return {
    upstream_status: statusCode,
    status: statusCode >= 200 && statusCode < 300 && images.length > 0 && !responseJson?.error ? "success" : "error",
    image_count: images.length,
    error_code: errorCode ? clip$1(errorCode, 120) : null,
    error_message: errorCode ? clip$1(responseJson?.message || errorCode, 700) : null,
    duration_ms: durationMs
  };
}
async function logCaricatureUsage(env, request, requestBodyJson, summary, startedMs) {
  if (!env.DB) return;
  let user = null;
  try {
    user = await getUserFromRequest(request, env);
  } catch {
    user = null;
  }
  const detail = clip$1(JSON.stringify({
    tool: "haredi-caricature",
    action: "generate",
    ...summarizeRequestBody(requestBodyJson || {}),
    ...summary || { status: "error", error_code: "unknown", duration_ms: Date.now() - startedMs }
  }), MAX_DETAIL);
  try {
    await env.DB.prepare(
      `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(user?.id || null, user?.email || null, "haredi_caricature_generate", detail, nowSec()).run();
  } catch {
  }
}
function geminiUrl(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}
function extractGeminiImages(data) {
  const images = [];
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const cand of candidates) {
    const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) images.push(String(inlineData.data));
    }
  }
  return images;
}
function extractGeminiText(data) {
  const out = [];
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  for (const cand of candidates) {
    const parts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
    for (const part of parts) if (part.text) out.push(String(part.text));
    if (cand.finishReason) out.push(`[finishReason: ${cand.finishReason}]`);
  }
  if (data?.promptFeedback) out.push(`[promptFeedback: ${JSON.stringify(data.promptFeedback)}]`);
  return out.join("\n").trim();
}
function makePrompt(cfg, bodyJson) {
  const sceneText = normalizeText(bodyJson.scene_text);
  const styleKey = normalizeText(bodyJson.style_key || "איור מצחיק/הומוריסטי/משעשע", 240);
  const aspect = normalizeText(bodyJson.aspect || "1:1", 30);
  const negative = [cfg.negativeDefault, bodyJson.negative].map((x) => normalizeText(x, 1200)).filter(Boolean).join("\n");
  return [
    cfg.systemPrompt,
    "",
    "Hard rules:",
    cfg.hardRules,
    "",
    `Visual style key: ${styleKey}`,
    `Aspect ratio: ${aspect}`,
    negative ? `Negative constraints:
${negative}` : "",
    "",
    "User scene to illustrate:",
    sceneText
  ].filter(Boolean).join("\n");
}
function makeImageParts(prompt, cfg) {
  const parts = [];
  if (cfg.referenceImageB64) {
    parts.push({
      inlineData: {
        mimeType: cfg.referenceImageMime || "image/jpeg",
        data: cfg.referenceImageB64
      }
    });
  }
  parts.push({ text: prompt });
  return parts;
}
async function callGeminiImage({ apiKey, model, prompt, cfg }) {
  const response = await fetch(geminiUrl(model, apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: makeImageParts(prompt, cfg) }],
      generationConfig: {
        temperature: 0.85,
        responseModalities: ["TEXT", "IMAGE"]
      }
    })
  });
  const text = await response.text();
  const data = safeJsonParse(text);
  if (!response.ok) {
    return {
      images: [],
      text: extractGeminiText(data),
      error: `${model}: HTTP ${response.status}: ${clip$1(text, 900)}`,
      httpStatus: response.status
    };
  }
  return {
    images: extractGeminiImages(data),
    text: extractGeminiText(data),
    httpStatus: response.status
  };
}
async function handleDirectGemini(request, env, cfg, bodyJson, startedMs) {
  const sceneText = normalizeText(bodyJson?.scene_text);
  if (!sceneText) {
    const out2 = { error: "empty_scene_text", message: "לא התקבל טקסט הוראה בשדה scene_text" };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out2, 400, Date.now() - startedMs), startedMs);
    return jsonResponse$6(out2, 400);
  }
  const apiKey = clientApiKey(bodyJson);
  if (!apiKey) {
    const out2 = {
      error: "client_api_key_required",
      message: "No personal Gemini key was received. Add a key in the global AI key settings or in the caricature widget."
    };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out2, 401, Date.now() - startedMs), startedMs);
    return jsonResponse$6(out2, 401);
  }
  const count = Math.max(1, Math.min(Number(bodyJson.count) || 1, MAX_COUNT));
  const basePrompt = makePrompt(cfg, { ...bodyJson, scene_text: sceneText });
  const images = [];
  const noImageTexts = [];
  let lastError = "";
  let lastHttpStatus = 200;
  for (let i = 0; i < count; i++) {
    const prompt = count > 1 ? `${basePrompt}

Variation ${i + 1} of ${count}: keep the same scene but vary composition and gestures.` : basePrompt;
    const r = await callGeminiImage({ apiKey, model: cfg.imageModel, prompt, cfg });
    lastHttpStatus = r.httpStatus || lastHttpStatus;
    if (r.error) lastError = r.error;
    if (r.text) noImageTexts.push(r.text);
    for (const img of r.images || []) {
      images.push(img);
      if (images.length >= count) break;
    }
    if (images.length >= count) break;
  }
  if (!images.length) {
    const out2 = {
      error: "no_images",
      message: lastError || `${cfg.imageModel}: no images`,
      gemini_text: clip$1(noImageTexts.join("\n"), cfg.debug ? 1400 : 500)
    };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out2, lastHttpStatus >= 400 ? 502 : 200, Date.now() - startedMs), startedMs);
    return jsonResponse$6(out2, 200);
  }
  const out = {
    images,
    model: cfg.imageModel,
    count: images.length,
    ...cfg.debug ? { prompt_preview: clip$1(basePrompt, 1200) } : {}
  };
  await logCaricatureUsage(env, request, bodyJson, summarizeResult(out, 200, Date.now() - startedMs), startedMs);
  return jsonResponse$6(out, 200);
}
async function handleCaricature(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") return jsonResponse$6({ error: "method_not_allowed", message: "Use POST" }, 405);
  const startedMs = Date.now();
  let body = "";
  let bodyJson = null;
  try {
    body = await request.text();
    bodyJson = safeJsonParse(body);
    if (!bodyJson || typeof bodyJson !== "object") {
      const out = { error: "bad_json", message: "Request body must be JSON" };
      await logCaricatureUsage(env, request, null, summarizeResult(out, 400, Date.now() - startedMs), startedMs);
      return jsonResponse$6(out, 400);
    }
  } catch (error) {
    await logCaricatureUsage(env, request, null, {
      status: "error",
      image_count: 0,
      error_code: "bad_request_body",
      error_message: error?.message || String(error),
      duration_ms: Date.now() - startedMs
    }, startedMs);
    return jsonResponse$6({ error: "bad_request_body", message: "Could not read request body" }, 400);
  }
  const cfg = await getCaricatureConfig(env);
  return handleDirectGemini(request, env, cfg, bodyJson, startedMs);
}
const KEYS = [
  "CARICATURE_GAS_URL",
  "CARICATURE_USE_GAS_FALLBACK",
  "CARICATURE_IMAGE_MODEL",
  "CARICATURE_SYSTEM_PROMPT",
  "CARICATURE_HARD_RULES",
  "CARICATURE_NEGATIVE_DEFAULT",
  "CARICATURE_REFERENCE_IMAGE_MIME",
  "CARICATURE_REFERENCE_IMAGE_B64",
  "CARICATURE_DEBUG"
];
const SECRET_KEYS = /* @__PURE__ */ new Set();
const DEFAULTS = {
  CARICATURE_USE_GAS_FALLBACK: "1",
  CARICATURE_IMAGE_MODEL: "gemini-3-pro-image-preview",
  CARICATURE_REFERENCE_IMAGE_MIME: "image/jpeg",
  CARICATURE_DEBUG: "0"
};
function json(obj, status = 200) {
  return Response.json(obj, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
async function adminOnly(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return { error: json({ error: "Not logged in" }, 401) };
  if (!user.is_admin) return { error: json({ error: "Forbidden" }, 403) };
  return { user };
}
function clip(v, n) {
  const s = String(v == null ? "" : v);
  return s.length > n ? s.slice(0, n) : s;
}
function clean(key, value) {
  const s = String(value == null ? "" : value);
  if (key === "CARICATURE_REFERENCE_IMAGE_B64") return s.replace(/\s+/g, "").slice(0, 25e5);
  if (key === "CARICATURE_SYSTEM_PROMPT" || key === "CARICATURE_HARD_RULES") return clip(s, 3e4);
  if (key === "CARICATURE_NEGATIVE_DEFAULT") return clip(s, 5e3);
  if (key === "CARICATURE_GAS_URL") return clip(s.trim(), 1500);
  if (key === "CARICATURE_IMAGE_MODEL") return clip(s.trim(), 160);
  if (key === "CARICATURE_REFERENCE_IMAGE_MIME") return clip(s.trim() || "image/jpeg", 100);
  if (key === "CARICATURE_USE_GAS_FALLBACK" || key === "CARICATURE_DEBUG") {
    return ["1", "true", "yes", "on", "enabled"].includes(s.trim().toLowerCase()) ? "1" : "0";
  }
  return clip(s, 5e3);
}
async function readDb(env) {
  if (!env.DB) return {};
  const placeholders = KEYS.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`
  ).bind(...KEYS).all();
  const out = {};
  for (const r of rows.results || []) {
    out[r.key] = r.value;
  }
  return out;
}
function expose(key, value) {
  const s = String(value || "");
  if (SECRET_KEYS.has(key)) {
    return {
      present: !!s,
      length: s.length,
      masked: s ? `${s.slice(0, 6)}…${s.slice(-4)}` : ""
    };
  }
  if (key === "CARICATURE_REFERENCE_IMAGE_B64") {
    return {
      present: !!s,
      length: s.length,
      preview: s ? s.slice(0, 32) + "…" : ""
    };
  }
  return value == null ? "" : String(value);
}
async function getSettings(env) {
  const db = await readDb(env);
  const settings = {};
  for (const key of KEYS) {
    const envValue = env?.[key] != null ? String(env[key]) : "";
    const dbValue = db[key] != null ? String(db[key]) : "";
    const value = envValue || dbValue || DEFAULTS[key] || "";
    settings[key] = {
      value: expose(key, value),
      source: envValue ? "env" : dbValue ? "db" : "default",
      editable: !envValue,
      secret: SECRET_KEYS.has(key)
    };
  }
  return json({ ok: true, settings });
}
async function saveSettings(request, env, user) {
  if (!env.DB) return json({ error: "DB is not configured" }, 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  const input = body?.settings && typeof body.settings === "object" ? body.settings : body || {};
  const now = Math.floor(Date.now() / 1e3);
  const saved = [];
  for (const key of KEYS) {
    if (!(key in input)) continue;
    if (env?.[key] != null) continue;
    const value = clean(key, input[key]);
    await env.DB.prepare(
      `INSERT INTO app_settings (key,value,updated_at,updated_by_user_id)
       VALUES (?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         value=excluded.value,
         updated_at=excluded.updated_at,
         updated_by_user_id=excluded.updated_by_user_id`
    ).bind(key, value, now, user.id || null).run();
    saved.push(key);
  }
  return json({ ok: true, saved });
}
async function handleCaricatureAdmin(request, env, url) {
  const auth = await adminOnly(request, env);
  if (auth.error) return auth.error;
  if (url.pathname !== "/api/admin/caricature-settings") {
    return json({ error: "Not found" }, 404);
  }
  if (request.method === "GET") return getSettings(env);
  if (request.method === "POST") return saveSettings(request, env, auth.user);
  return json({ error: "method_not_allowed" }, 405);
}
const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw/exec";
const TOOL_PROMPT_TYPES = /* @__PURE__ */ new Set([
  "nikud_regular",
  "nikud_torah",
  "nikud_judge_regular",
  "nikud_judge_torah",
  "audio_regular",
  "audio_torah",
  "ocr_handwriting",
  "printed",
  "elevenlabs_transcribe",
  "claude_edition",
  "torah_style_ancient",
  "torah_style_modern",
  "torah_style_combined"
]);
const CHAT_PROVIDERS = {
  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    model: "claude-sonnet-4-5",
    pick: (data) => data?.content?.[0]?.text
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o",
    pick: (data) => data?.choices?.[0]?.message?.content
  },
  google: {
    model: "gemini-2.0-flash-exp",
    pick: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text
  },
  mistral: {
    url: "https://api.mistral.ai/v1/chat/completions",
    model: "mistral-large-latest",
    pick: (data) => data?.choices?.[0]?.message?.content
  },
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile",
    pick: (data) => data?.choices?.[0]?.message?.content
  },
  deepseek: {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    pick: (data) => data?.choices?.[0]?.message?.content
  }
};
function jsonResponse$5(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
function readSameOrigin(request) {
  try {
    const reqUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin === reqUrl.origin) return true;
    const referer = request.headers.get("referer");
    if (referer && new URL(referer).origin === reqUrl.origin) return true;
    return request.headers.get("sec-fetch-site") === "same-origin";
  } catch {
    return false;
  }
}
function scrubForLog(body) {
  const clone = { ...body };
  delete clone.text;
  delete clone.files;
  delete clone.ocr_examples;
  delete clone.api_key;
  delete clone.access_code;
  clone._text_chars = body?.text ? String(body.text).length : 0;
  clone._files_count = Array.isArray(body?.files) ? body.files.length : 0;
  clone._has_api_key = !!body?.api_key;
  clone._has_access_code = !!body?.access_code;
  return clone;
}
async function handleAiTools(request, env) {
  if (request.method !== "POST") {
    return jsonResponse$5({ error: "method_not_allowed", message: "Use POST" }, 405);
  }
  if (!readSameOrigin(request)) {
    return jsonResponse$5({ error: "forbidden", message: "Bad origin" }, 403);
  }
  let bodyText = "";
  let body;
  try {
    bodyText = await request.text();
    body = JSON.parse(bodyText || "{}");
  } catch {
    return jsonResponse$5({ error: "invalid_json", message: "Invalid request body" }, 400);
  }
  const promptType = String(body?.prompt_type || "");
  if (!TOOL_PROMPT_TYPES.has(promptType)) {
    return jsonResponse$5({ error: "forbidden_prompt_type", message: "Unsupported tool request" }, 400);
  }
  try {
    console.log(`[ai-tools] ${JSON.stringify(scrubForLog(body))}`);
  } catch {
  }
  const gasUrl = (env.RAVTEXT_GAS_URL || env.AI_TOOLS_GAS_URL || DEFAULT_GAS_URL).trim();
  if (!gasUrl) {
    return jsonResponse$5({ error: "server_error", message: "AI tools server is not configured" }, 500);
  }
  try {
    const upstream = await fetch(gasUrl, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: bodyText
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8"
      }
    });
  } catch (error) {
    return jsonResponse$5({
      error: "proxy_fetch_failed",
      message: error && error.message ? error.message : String(error)
    }, 502);
  }
}
function chatHeaders(provider, apiKey) {
  if (provider === "anthropic") {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`
  };
}
function chatBody(provider, prompt, model) {
  if (provider === "anthropic") {
    return {
      model,
      max_tokens: 2e3,
      messages: [{ role: "user", content: prompt }]
    };
  }
  if (provider === "google") {
    return {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2e3 }
    };
  }
  return {
    model,
    max_tokens: 2e3,
    messages: [{ role: "user", content: prompt }]
  };
}
async function handleAiChat(request) {
  if (request.method !== "POST") {
    return jsonResponse$5({ error: "method_not_allowed", message: "Use POST" }, 405);
  }
  if (!readSameOrigin(request)) {
    return jsonResponse$5({ error: "forbidden", message: "Bad origin" }, 403);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse$5({ error: "invalid_json", message: "Invalid request body" }, 400);
  }
  const provider = String(body?.provider || "").toLowerCase();
  const cfg = CHAT_PROVIDERS[provider];
  const prompt = String(body?.prompt || "");
  const apiKey = String(body?.api_key || "");
  if (!cfg || !prompt || !apiKey) {
    return jsonResponse$5({ error: "bad_request", message: "Missing provider, prompt, or API key" }, 400);
  }
  const model = cfg.model;
  const url = provider === "google" ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}` : cfg.url;
  try {
    console.log(`[ai-chat] provider=${provider} prompt_chars=${prompt.length}`);
  } catch {
  }
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: chatHeaders(provider, apiKey),
      body: JSON.stringify(chatBody(provider, prompt, model))
    });
    const upstreamText = await upstream.text();
    let data;
    try {
      data = JSON.parse(upstreamText);
    } catch {
      data = { raw: upstreamText };
    }
    const text = cfg.pick(data);
    return jsonResponse$5({
      text: text || JSON.stringify(data),
      provider,
      status: upstream.status
    }, upstream.ok ? 200 : upstream.status);
  } catch (error) {
    return jsonResponse$5({
      error: "proxy_fetch_failed",
      message: error && error.message ? error.message : String(error)
    }, 502);
  }
}
const WATERMARK_TEXTS = [
  "טקסט זה הודפס מתוך מערכת רב טקסט לוורד AI",
  "הופק במצב דמו במערכת רב טקסט לוורד AI",
  "מסמך לדוגמה — מערכת רב טקסט לוורד AI",
  "תוצר בדיקה במערכת רב טקסט לוורד AI",
  "טיוטת דמו — רב טקסט לוורד AI",
  "תצוגה מקדימה — רב טקסט לוורד AI",
  "גרסת ניסיון — רב טקסט לוורד AI",
  "RavText AI — מצב הדגמה",
  "הודפס בגרסת דמו של רב טקסט לוורד AI",
  "מצב דמו פעיל — רב טקסט לוורד AI",
  "אין להפיץ — מצב דמו במערכת רב טקסט",
  "תוצר ניסיוני — רב טקסט AI"
];
function randomToken() {
  try {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  } catch (_) {
    return Math.random().toString(36).slice(2, 14);
  }
}
function escapeHtml$2(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function watermarkStyle(className) {
  return `<style data-ravtext-server-watermark="1">
.${className}{display:inline!important;color:#991b1b!important;background:rgba(254,226,226,.92)!important;border:1px solid rgba(153,27,27,.45)!important;padding:0 .18em!important;margin:0 .1em!important;font-weight:700!important;white-space:normal!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;user-select:none!important}
</style>`;
}
function makeMark(className, index2) {
  const text = WATERMARK_TEXTS[index2 % WATERMARK_TEXTS.length];
  return ` <span class="${className}" data-ravtext-server-watermark="1">${escapeHtml$2(text)}</span> `;
}
function watermarkTextChunk(text, className, state) {
  if (!text || !/[\p{L}\p{N}]{4,}/u.test(text)) return text;
  const parts = text.split(/(\s+)/);
  let words = 0;
  let changed = false;
  const out = [];
  for (const part of parts) {
    out.push(part);
    if (!/\S/u.test(part)) continue;
    words += 1;
    state.totalWords += 1;
    if (words >= state.nextEvery || state.totalWords % state.globalEvery === 0) {
      out.push(makeMark(className, state.count++));
      state.nextEvery = 32 + Math.floor(Math.random() * 28);
      words = 0;
      changed = true;
    }
  }
  return changed ? out.join("") : text;
}
function addServerWatermarksToHtml(html) {
  const className = `rt-server-wm-${randomToken()}`;
  const state = { count: 0, totalWords: 0, globalEvery: 45, nextEvery: 28 };
  let skip = false;
  const output = String(html || "").replace(/(<[^>]+>|[^<]+)/g, (token) => {
    if (token.startsWith("<")) {
      const lower = token.toLowerCase();
      if (/^<(script|style|textarea|title|svg|canvas)\b/.test(lower)) skip = true;
      if (/^<\/(script|style|textarea|title|svg|canvas)>/.test(lower)) skip = false;
      return token;
    }
    return skip ? token : watermarkTextChunk(token, className, state);
  });
  const atLeastOne = state.count > 0 ? output : output.replace(/(<body\b[^>]*>)/i, `$1${makeMark(className, 0)}`);
  if (/<\/head>/i.test(atLeastOne)) return atLeastOne.replace(/<\/head>/i, `${watermarkStyle(className)}</head>`);
  return `${watermarkStyle(className)}${atLeastOne}`;
}
const TOOL_TOKEN_TTL_SEC = 120;
const DEMO_BLOCK_MS = 5 * 60 * 1e3;
const PUBLIC_TOOLS = /* @__PURE__ */ new Set([
  "nikud-merger",
  "word-extractor",
  "text-compare-pro",
  "comparator-tool",
  "sefaria-downloader",
  "sefaria-live",
  "torah-transcription",
  "torah-nikud",
  "haredi-caricature",
  "css-ai",
  "torah-tools"
]);
function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function signToolToken(payload, secret) {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${b64url(data)}.${b64url(sig)}`;
}
function todayKey() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function requestTriesToDisableWatermark(body) {
  return [
    body?.removeWatermark === true,
    body?.hideWatermark === true,
    body?.watermark === false,
    body?.forceWatermark === false,
    body?.demoWatermark === false,
    body?.watermarkOpacity === 0,
    body?.watermarkOpacity === "0"
  ].some(Boolean);
}
async function handleSecureExportHtmlAction(request, env, body) {
  const user = await getUserFromRequest(request, env);
  const paid = !!user?.paid;
  if (!paid && requestTriesToDisableWatermark(body)) {
    return Response.json(
      { error: "watermark_tampering", blocked: true },
      {
        status: 403,
        headers: {
          "cache-control": "no-store",
          "set-cookie": `ravtext_demo_blocked_until=${Date.now() + DEMO_BLOCK_MS}; Path=/; SameSite=Lax`
        }
      }
    );
  }
  const html = String(body?.html || "");
  if (!html.trim()) {
    return Response.json(
      { error: "empty_html" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  const finalHtml = paid ? html : addServerWatermarksToHtml(html);
  return new Response(finalHtml, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-ravtext-auth-source": "ravtext_session",
      "x-ravtext-user-paid": paid ? "1" : "0",
      "x-ravtext-watermark-forced": paid ? "0" : "1"
    }
  });
}
async function consumeFreeUse(user, toolName, env) {
  const usageDate = todayKey();
  const nowSec2 = Math.floor(Date.now() / 1e3);
  try {
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO tool_usage (user_id, tool_name, usage_date, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(user.id, toolName, usageDate, nowSec2).run();
    if ((inserted?.meta?.changes || 0) > 0) return { ok: true };
    return { ok: false, reason: "quota" };
  } catch (_) {
    const cache = caches.default;
    const cacheUrl = `https://tool-usage.invalid/${encodeURIComponent(`${user.id}:${toolName}:${usageDate}`)}`;
    try {
      const hit = await cache.match(cacheUrl);
      if (hit) return { ok: false, reason: "quota" };
      await cache.put(
        cacheUrl,
        new Response("1", { headers: { "cache-control": "public, max-age=86400" } })
      );
      return { ok: true };
    } catch {
      return { ok: false, reason: "quota" };
    }
  }
}
async function handleToolPreflight(request, env) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed", message: "Use POST" },
      { status: 405, headers: { "cache-control": "no-store" } }
    );
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "invalid_json", message: "Invalid request body" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }
  if (body?.action === "secure_export_html") {
    return handleSecureExportHtmlAction(request, env, body);
  }
  const toolName = String(body?.toolName || "").trim();
  if (!PUBLIC_TOOLS.has(toolName)) {
    return Response.json(
      { error: "unknown_tool", message: "Tool is not allowed" },
      { status: 403, headers: { "cache-control": "no-store" } }
    );
  }
  const user = await getUserFromRequest(request, env);
  if (!user) {
    return Response.json(
      { error: "login_required", message: "Login is required for this tool" },
      { status: 401, headers: { "cache-control": "no-store" } }
    );
  }
  if (!user.paid) {
    const usage = await consumeFreeUse(user, toolName, env);
    if (!usage.ok) {
      return Response.json(
        { error: "quota_exceeded", message: "Free accounts can use each tool once per day" },
        { status: 429, headers: { "cache-control": "no-store" } }
      );
    }
  }
  const nowSec2 = Math.floor(Date.now() / 1e3);
  const token = await signToolToken({
    tool: toolName,
    iat: nowSec2,
    exp: nowSec2 + TOOL_TOKEN_TTL_SEC,
    paid: !!user?.paid,
    email: user?.email || null,
    jti: crypto.randomUUID()
  }, env.SESSION_SECRET);
  return Response.json({
    ok: true,
    toolName,
    token,
    expiresAt: (nowSec2 + TOOL_TOKEN_TTL_SEC) * 1e3
  }, {
    headers: { "cache-control": "no-store" }
  });
}
const HEBREW_BLOCK = "\\u0590-\\u05FF";
const HEBREW_NIKUD_TAAM = "\\u0591-\\u05C7";
const HEBREW_LETTERS = "\\u05D0-\\u05EA";
const _RE_NIKUD_TAAM = new RegExp(`[${HEBREW_NIKUD_TAAM}]`, "g");
const _RE_NOT_HEBREW = new RegExp(`[^${HEBREW_BLOCK}]`, "g");
function stripNikudAndTaam(text) {
  return String(text).replace(_RE_NIKUD_TAAM, "");
}
function getPureHebrew(text) {
  return String(text).replace(_RE_NOT_HEBREW, "");
}
const _RE_INTERNAL_VAV_YUD = new RegExp(
  `(?<=[${HEBREW_LETTERS}])(?<![וי])[וי](?=[${HEBREW_LETTERS}])`,
  "g"
);
function getSkeleton(text) {
  const stripped = stripNikudAndTaam(text);
  return stripped.replace(_RE_INTERNAL_VAV_YUD, "");
}
function normalize(text) {
  try {
    return String(text).normalize("NFC");
  } catch (_) {
    return String(text);
  }
}
const SCOPE_OFF = "off";
const SCOPE_VOC = "voc";
const SCOPE_CLEAN = "clean";
const SCOPE_BOTH = "both";
class FilterConfig {
  constructor(init = {}) {
    this.nikud = SCOPE_CLEAN;
    this.taamim = SCOPE_BOTH;
    this.periods = SCOPE_VOC;
    this.commas = SCOPE_VOC;
    this.colons = SCOPE_VOC;
    this.semicolons = SCOPE_VOC;
    this.dashes = SCOPE_VOC;
    this.question_exclaim = SCOPE_VOC;
    this.quotes = SCOPE_OFF;
    this.hebrew_geresh = SCOPE_OFF;
    this.maqaf = SCOPE_VOC;
    this.round_brackets = SCOPE_VOC;
    this.square_brackets = SCOPE_VOC;
    this.curly_brackets = SCOPE_VOC;
    this.angle_brackets = SCOPE_VOC;
    this.digits = SCOPE_VOC;
    this.latin_letters = SCOPE_VOC;
    this.at_markers = SCOPE_VOC;
    this.asterisks = SCOPE_VOC;
    this.hashes = SCOPE_VOC;
    this.extra_spaces = SCOPE_BOTH;
    this.line_breaks = SCOPE_BOTH;
    this.ignore_ranges = [
      ["{", "}", SCOPE_VOC],
      ["<<", ">>", SCOPE_VOC]
    ];
    this.flexible_ktiv = true;
    this.case_insensitive_latin = true;
    Object.assign(this, init);
  }
  toDict() {
    return {
      nikud: this.nikud,
      taamim: this.taamim,
      periods: this.periods,
      commas: this.commas,
      colons: this.colons,
      semicolons: this.semicolons,
      dashes: this.dashes,
      question_exclaim: this.question_exclaim,
      quotes: this.quotes,
      hebrew_geresh: this.hebrew_geresh,
      maqaf: this.maqaf,
      round_brackets: this.round_brackets,
      square_brackets: this.square_brackets,
      curly_brackets: this.curly_brackets,
      angle_brackets: this.angle_brackets,
      digits: this.digits,
      latin_letters: this.latin_letters,
      at_markers: this.at_markers,
      asterisks: this.asterisks,
      hashes: this.hashes,
      extra_spaces: this.extra_spaces,
      line_breaks: this.line_breaks,
      ignore_ranges: this.ignore_ranges.map((r) => r.slice()),
      flexible_ktiv: this.flexible_ktiv,
      case_insensitive_latin: this.case_insensitive_latin
    };
  }
  static fromDict(data) {
    return new FilterConfig(data || {});
  }
  static presetLoose() {
    return new FilterConfig();
  }
  static presetStrict() {
    const c = new FilterConfig();
    const fields = [
      "periods",
      "commas",
      "colons",
      "semicolons",
      "dashes",
      "question_exclaim",
      "quotes",
      "hebrew_geresh",
      "maqaf",
      "round_brackets",
      "square_brackets",
      "curly_brackets",
      "angle_brackets",
      "digits",
      "latin_letters",
      "at_markers",
      "asterisks",
      "hashes"
    ];
    for (const f of fields) c[f] = SCOPE_OFF;
    c.ignore_ranges = [];
    c.flexible_ktiv = false;
    return c;
  }
  static presetMidrash() {
    const c = new FilterConfig();
    c.at_markers = SCOPE_BOTH;
    c.hebrew_geresh = SCOPE_VOC;
    return c;
  }
}
const _NIKUD_RANGE = "\\u05B0-\\u05BC\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7";
const _TAAMIM_RANGE = "\\u0591-\\u05AF\\u05BD\\u05C0\\u05C3\\u05C6";
const _HEBREW_MAQAF = "\\u05BE";
const _HEBREW_GERESH = "\\u05F3\\u05F4";
const _CHAR_RULES = [
  ["nikud", _NIKUD_RANGE],
  ["taamim", _TAAMIM_RANGE],
  ["periods", "\\."],
  ["commas", ","],
  ["colons", ":"],
  ["semicolons", ";"],
  ["dashes", "\\-\\u2013\\u2014"],
  ["question_exclaim", "\\?!"],
  ["quotes", "\"'`"],
  ["hebrew_geresh", _HEBREW_GERESH],
  ["maqaf", _HEBREW_MAQAF],
  ["round_brackets", "\\(\\)"],
  ["square_brackets", "\\[\\]"],
  ["curly_brackets", "\\{\\}"],
  ["angle_brackets", "<>"],
  ["digits", "0-9"],
  ["latin_letters", "A-Za-z"],
  ["asterisks", "\\*"],
  ["hashes", "#"],
  ["line_breaks", "\\n\\r"]
];
function _escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function _buildCharPattern(config, scope) {
  const parts = [];
  for (const [fieldName, charRegex] of _CHAR_RULES) {
    const fieldScope = config[fieldName] !== void 0 ? config[fieldName] : SCOPE_OFF;
    if (fieldScope === SCOPE_BOTH || fieldScope === scope) {
      parts.push(charRegex);
    }
  }
  if (parts.length === 0) return /(?!)/g;
  return new RegExp("[" + parts.join("") + "]", "g");
}
function _buildAtPattern(config, scope) {
  const fieldScope = config.at_markers !== void 0 ? config.at_markers : SCOPE_OFF;
  if (fieldScope === SCOPE_BOTH || fieldScope === scope) {
    return /@\d+/g;
  }
  return null;
}
function _buildRangeRemovers(config, scope) {
  const patterns = [];
  for (const item of config.ignore_ranges || []) {
    if (!item || item.length < 3) continue;
    const opener = item[0], closer = item[1], itemScope = item[2];
    if (!opener || !closer) continue;
    if (itemScope === SCOPE_OFF) continue;
    if (itemScope !== SCOPE_BOTH && itemScope !== scope) continue;
    const pat = new RegExp(`${_escapeRegex(opener)}[\\s\\S]*?${_escapeRegex(closer)}`, "g");
    patterns.push(pat);
  }
  return patterns;
}
function stripIgnoredRanges(text, config, scope) {
  let t = String(text);
  for (const pat of _buildRangeRemovers(config, scope)) {
    t = t.replace(pat, "");
  }
  return t;
}
function cleanTextFull(text, config, scope) {
  let t = stripIgnoredRanges(text, config, scope);
  const atPat = _buildAtPattern(config, scope);
  if (atPat) t = t.replace(atPat, "");
  return t;
}
function cleanForCompare(text, config, scope = SCOPE_BOTH) {
  let t = stripIgnoredRanges(text, config, scope);
  const atPat = _buildAtPattern(config, scope);
  if (atPat) t = t.replace(atPat, "");
  const pat = _buildCharPattern(config, scope);
  t = t.replace(pat, "");
  const spacesScope = config.extra_spaces !== void 0 ? config.extra_spaces : SCOPE_OFF;
  if (spacesScope === SCOPE_BOTH || spacesScope === scope) {
    t = t.replace(/\s+/g, " ");
  }
  const latinScope = config.latin_letters !== void 0 ? config.latin_letters : SCOPE_OFF;
  if (config.case_insensitive_latin && latinScope !== SCOPE_BOTH) {
    t = t.toLowerCase();
  }
  return t.trim();
}
const IssueKind = Object.freeze({
  NO_NIKUD: "no_nikud",
  PARTIAL_NIKUD: "partial_nikud",
  MISSING_SHIN_DOT: "missing_shin_dot",
  DOUBLE_NIKUD: "double_nikud"
});
const HEBREW_LETTER_RE = /[א-ת]/;
const NIKUD_RANGE_RE = /[\u05B0-\u05BC\u05BF\u05C1-\u05C2\u05C4-\u05C5\u05C7]/;
const SHIN = "ש";
const SHIN_DOT_RIGHT = "ׁ";
const SHIN_DOT_LEFT = "ׂ";
const WORD_PATTERN = /[א-ת֑-ׇ]+/g;
function hasAnyNikud(word) {
  return new RegExp(`[\\u05B0-\\u05BC\\u05BF\\u05C1-\\u05C2\\u05C4-\\u05C5\\u05C7]`).test(word);
}
function countLettersWithoutNikud(word) {
  let lettersTotal = 0;
  let lettersWithout = 0;
  let i = 0;
  while (i < word.length) {
    const ch = word[i];
    if (HEBREW_LETTER_RE.test(ch)) {
      lettersTotal += 1;
      let hasNikudAfter = false;
      let j = i + 1;
      while (j < word.length && NIKUD_RANGE_RE.test(word[j])) {
        hasNikudAfter = true;
        j += 1;
      }
      if (!hasNikudAfter) lettersWithout += 1;
      i = j;
    } else {
      i += 1;
    }
  }
  return [lettersWithout, lettersTotal];
}
function checkText(text, ignoreShort = true) {
  const issues = [];
  const words = String(text).match(WORD_PATTERN) || [];
  for (let pos = 0; pos < words.length; pos++) {
    const word = words[pos];
    const lettersCount = (word.match(/[א-ת]/g) || []).length;
    if (lettersCount === 0) continue;
    if (ignoreShort && lettersCount === 1) continue;
    if (!hasAnyNikud(word)) {
      issues.push({
        kind: IssueKind.NO_NIKUD,
        word,
        position: pos,
        description: "מילה ללא ניקוד כלל"
      });
      continue;
    }
    const [without, total] = countLettersWithoutNikud(word);
    if (without > 1 && total > 1) {
      issues.push({
        kind: IssueKind.PARTIAL_NIKUD,
        word,
        position: pos,
        description: `${without} אותיות מתוך ${total} ללא ניקוד`
      });
    }
    if (word.includes(SHIN)) {
      let idx = word.indexOf(SHIN);
      while (idx !== -1) {
        const nextChars = word.slice(idx + 1, idx + 4);
        if (!nextChars.includes(SHIN_DOT_RIGHT) && !nextChars.includes(SHIN_DOT_LEFT)) {
          issues.push({
            kind: IssueKind.MISSING_SHIN_DOT,
            word,
            position: pos,
            description: "ש' ללא ניקוד ימני/שמאלי"
          });
          break;
        }
        idx = word.indexOf(SHIN, idx + 1);
      }
    }
  }
  return issues;
}
function summarizeIssues(issues) {
  const summary = {
    [IssueKind.NO_NIKUD]: 0,
    [IssueKind.PARTIAL_NIKUD]: 0,
    [IssueKind.MISSING_SHIN_DOT]: 0,
    [IssueKind.DOUBLE_NIKUD]: 0
  };
  for (const issue of issues) {
    summary[issue.kind] = (summary[issue.kind] || 0) + 1;
  }
  summary.total = issues.length;
  return summary;
}
const HEBREW_WORD_RE_SOURCE = "([\\(\\[\\]]*[\\u0590-\\u05FF'\\n\\r]+[\\)\\]]*)";
const HEBREW_WORD_RE_FULL = new RegExp("^" + HEBREW_WORD_RE_SOURCE + "$");
const SegmentKind = Object.freeze({
  PASSTHROUGH: "passthrough",
  UNCHANGED: "unchanged",
  INSERTED: "inserted",
  DELETED: "deleted",
  SPELLING_DIFF: "spelling_diff"
});
function makeSegment(kind, text, original = "") {
  return { kind, text, original };
}
function _isMatch(a, b, config) {
  const aClean = cleanForCompare(a, config, SCOPE_CLEAN);
  const bClean = cleanForCompare(b, config, SCOPE_VOC);
  if (aClean === bClean) return true;
  const p1 = getPureHebrew(a);
  const p2 = getPureHebrew(b);
  if (p1 && p1 === p2) return true;
  if (config.flexible_ktiv) {
    const s1 = getSkeleton(a);
    const s2 = getSkeleton(b);
    if (s1 && s1 === s2) return true;
  }
  return false;
}
function _isHebrewToken(token) {
  return HEBREW_WORD_RE_FULL.test(token);
}
const LOOKAHEAD_LIMIT = 5;
const SEQUENCE_CHECK = 3;
function _findBestMatchAhead(cleanToken, cleanTokens, cIndex, vocWords, vIndex, config) {
  let bestIdx = -1;
  let bestScore = -1;
  let checkedValid = 0;
  let searchOffset = 1;
  while (checkedValid < LOOKAHEAD_LIMIT && vIndex + searchOffset < vocWords.length) {
    const idx = vIndex + searchOffset;
    const candidate = vocWords[idx];
    if (getPureHebrew(candidate).length === 0) {
      searchOffset += 1;
      continue;
    }
    checkedValid += 1;
    if (!_isMatch(cleanToken, candidate, config)) {
      searchOffset += 1;
      continue;
    }
    let sequenceMatches = 0;
    let lookaheadValid = 0;
    let cOff = 1, vOff = 1;
    while (lookaheadValid < SEQUENCE_CHECK && cIndex + cOff < cleanTokens.length && idx + vOff < vocWords.length) {
      const nextC = cleanTokens[cIndex + cOff];
      if (getPureHebrew(nextC).length === 0) {
        cOff += 1;
        continue;
      }
      const nextV = vocWords[idx + vOff];
      if (getPureHebrew(nextV).length === 0) {
        vOff += 1;
        continue;
      }
      if (_isMatch(nextC, nextV, config)) sequenceMatches += 1;
      lookaheadValid += 1;
      cOff += 1;
      vOff += 1;
    }
    const score = 1 + sequenceMatches;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
    searchOffset += 1;
  }
  return [bestIdx, bestScore];
}
function _hebrewSplit(text) {
  const tokens = [];
  const re = new RegExp(HEBREW_WORD_RE_SOURCE, "g");
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push(text.slice(last, m.index));
    tokens.push(m[0]);
    last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  tokens.push(text.slice(last));
  return tokens;
}
function _hebrewFindAll(text) {
  const result = [];
  const re = new RegExp(HEBREW_WORD_RE_SOURCE, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    result.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return result;
}
function merge(cleanText, vocalizedText, opts = {}) {
  let { config = null, progressCallback = null, stopFlag = null, mode = "word" } = opts;
  if (config === null) config = new FilterConfig();
  cleanText = normalize(cleanText);
  vocalizedText = normalize(vocalizedText);
  cleanText = cleanTextFull(cleanText, config, SCOPE_CLEAN);
  vocalizedText = cleanTextFull(vocalizedText, config, SCOPE_VOC);
  if (mode === "char") {
    return _mergeCharLevel(cleanText, vocalizedText, config, progressCallback);
  }
  const cleanTokens = _hebrewSplit(cleanText);
  const vocWords = _hebrewFindAll(vocalizedText);
  const segments = [];
  let vIdx = 0;
  let matchCount = 0;
  let stopped = false;
  const total = cleanTokens.length;
  let lastPct = -1;
  for (let cIdx = 0; cIdx < cleanTokens.length; cIdx++) {
    const token = cleanTokens[cIdx];
    if (stopFlag && stopFlag.stop) {
      stopped = true;
      break;
    }
    if (progressCallback && total > 0) {
      const pct = Math.floor(cIdx / total * 100);
      if (pct !== lastPct) {
        progressCallback(pct);
        lastPct = pct;
      }
    }
    if (!_isHebrewToken(token)) {
      if (token) segments.push(makeSegment(SegmentKind.PASSTHROUGH, token));
      continue;
    }
    const pureToken = getPureHebrew(token);
    if (!pureToken) {
      segments.push(makeSegment(SegmentKind.PASSTHROUGH, token));
      continue;
    }
    while (vIdx < vocWords.length && !getPureHebrew(vocWords[vIdx])) vIdx += 1;
    if (vIdx >= vocWords.length) {
      segments.push(makeSegment(SegmentKind.INSERTED, token));
      continue;
    }
    const currentVoc = vocWords[vIdx];
    if (_isMatch(token, currentVoc, config)) {
      const aClean = cleanForCompare(token, config, SCOPE_CLEAN);
      const bClean = cleanForCompare(currentVoc, config, SCOPE_VOC);
      if (aClean !== bClean) {
        segments.push(makeSegment(SegmentKind.SPELLING_DIFF, currentVoc, token));
      } else {
        segments.push(makeSegment(SegmentKind.UNCHANGED, currentVoc));
      }
      vIdx += 1;
      matchCount += 1;
      continue;
    }
    const [
      bestIdx
      /* , _score */
    ] = _findBestMatchAhead(
      token,
      cleanTokens,
      cIdx,
      vocWords,
      vIdx,
      config
    );
    if (bestIdx !== -1) {
      for (let i = vIdx; i < bestIdx; i++) {
        segments.push(makeSegment(SegmentKind.DELETED, vocWords[i] + " "));
      }
      const found = vocWords[bestIdx];
      const aClean = cleanForCompare(token, config, SCOPE_CLEAN);
      const bClean = cleanForCompare(found, config, SCOPE_VOC);
      if (aClean !== bClean) {
        segments.push(makeSegment(SegmentKind.SPELLING_DIFF, found, token));
      } else {
        segments.push(makeSegment(SegmentKind.UNCHANGED, found));
      }
      vIdx = bestIdx + 1;
      matchCount += 1;
    } else {
      segments.push(makeSegment(SegmentKind.INSERTED, token));
    }
  }
  if (!stopped) {
    for (let i = vIdx; i < vocWords.length; i++) {
      segments.push(makeSegment(SegmentKind.DELETED, vocWords[i] + " "));
    }
  }
  let cleanWordCount = 0;
  for (const t of cleanTokens) {
    if (_isHebrewToken(t) && getPureHebrew(t)) cleanWordCount += 1;
  }
  let vocWordCount = 0;
  for (const w of vocWords) {
    if (getPureHebrew(w)) vocWordCount += 1;
  }
  return {
    segments,
    matchCount,
    cleanWordCount,
    vocWordCount,
    stopped,
    get matchRatio() {
      return this.matchCount / Math.max(1, this.cleanWordCount);
    }
  };
}
function _seqMatcher(a, b) {
  const b2j = /* @__PURE__ */ new Map();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch).push(j);
  }
  function findLongestMatch(alo, ahi, blo, bhi) {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = /* @__PURE__ */ new Map();
    for (let i = alo; i < ahi; i++) {
      const newJ2len = /* @__PURE__ */ new Map();
      const indices = b2j.get(a[i]) || [];
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newJ2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newJ2len;
    }
    return [besti, bestj, bestsize];
  }
  function getMatchingBlocks() {
    const queue = [[0, a.length, 0, b.length]];
    const matchingBlocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
      if (k > 0) {
        matchingBlocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    matchingBlocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged = [];
    let i1 = 0, j1 = 0, k1 = 0;
    for (const [i2, j2, k2] of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) merged.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) merged.push([i1, j1, k1]);
    merged.push([a.length, b.length, 0]);
    return merged;
  }
  function getOpcodes() {
    const opcodes = [];
    let i = 0, j = 0;
    for (const [ai, bj, size] of getMatchingBlocks()) {
      let tag = "";
      if (i < ai && j < bj) tag = "replace";
      else if (i < ai) tag = "delete";
      else if (j < bj) tag = "insert";
      if (tag) opcodes.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      if (size) opcodes.push(["equal", ai, i, bj, j]);
    }
    return opcodes;
  }
  return { getOpcodes };
}
function _mergeCharLevel(cleanText, vocalizedText, config, progressCallback) {
  const vocPlainChars = [];
  const vocOrigIndices = [];
  for (let idx = 0; idx < vocalizedText.length; idx++) {
    const ch = vocalizedText[idx];
    const stripped = stripNikudAndTaam(ch);
    if (stripped) {
      vocPlainChars.push(stripped);
      vocOrigIndices.push(idx);
    }
  }
  const vocPlain = vocPlainChars.join("");
  const matcher = _seqMatcher(cleanText, vocPlain);
  const segments = [];
  let matchCount = 0;
  function vocSlice(j1, j2) {
    if (j1 >= vocOrigIndices.length) return "";
    const start = vocOrigIndices[j1];
    let end;
    if (j2 >= vocOrigIndices.length) end = vocalizedText.length;
    else end = vocOrigIndices[j2];
    return vocalizedText.slice(start, end);
  }
  for (const [op, i1, i2, j1, j2] of matcher.getOpcodes()) {
    if (op === "equal") {
      const text = vocSlice(j1, j2);
      if (text) {
        segments.push(makeSegment(SegmentKind.UNCHANGED, text));
        matchCount += text.split(/\s+/).filter(Boolean).length;
      }
    } else if (op === "insert") {
      const text = vocSlice(j1, j2);
      if (text) segments.push(makeSegment(SegmentKind.DELETED, text));
    } else if (op === "delete") {
      const text = cleanText.slice(i1, i2);
      if (text) segments.push(makeSegment(SegmentKind.INSERTED, text));
    } else if (op === "replace") {
      const vocText = vocSlice(j1, j2);
      const cleanPart = cleanText.slice(i1, i2);
      if (vocText) segments.push(makeSegment(SegmentKind.DELETED, vocText));
      if (cleanPart) segments.push(makeSegment(SegmentKind.INSERTED, cleanPart));
    }
  }
  if (progressCallback) progressCallback(100);
  const cleanWordCount = cleanText.split(/\s+/).filter(Boolean).length;
  const vocWordCount = vocalizedText.split(/\s+/).filter(Boolean).length;
  return {
    segments,
    matchCount,
    cleanWordCount,
    vocWordCount,
    stopped: false,
    get matchRatio() {
      return this.matchCount / Math.max(1, this.cleanWordCount);
    }
  };
}
const MultiMode = Object.freeze({
  CHAIN: "chain",
  VOTING: "voting",
  BEST_MATCH: "best_match",
  MANUAL_REVIEW: "manual_review"
});
function makeMultiSegment(opts) {
  return {
    kind: opts.kind,
    text: opts.text || "",
    original: opts.original || "",
    options: opts.options || [],
    chosenSource: opts.chosenSource !== void 0 ? opts.chosenSource : -1,
    get hasOptions() {
      return (this.options || []).length > 1;
    }
  };
}
function mergeAllSources(cleanText, sources, opts = {}) {
  let { config = null, progressCallback = null, stopFlag = null, mode = "word" } = opts;
  if (!sources || sources.length === 0) {
    return { segments: [], sourceNames: [], statsPerSource: [], mode: MultiMode.CHAIN };
  }
  const allSegments = [];
  const stats = [];
  for (let srcIdx = 0; srcIdx < sources.length; srcIdx++) {
    const [name, text] = sources[srcIdx];
    const srcResult = merge(cleanText, text, {
      config,
      progressCallback: null,
      stopFlag,
      mode
    });
    let matched = 0;
    for (const seg of srcResult.segments) {
      const ms = makeMultiSegment({
        kind: seg.kind,
        text: seg.text,
        original: seg.original,
        options: [],
        chosenSource: seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF ? srcIdx : -1
      });
      allSegments.push(ms);
      if (seg.kind === SegmentKind.UNCHANGED || seg.kind === SegmentKind.SPELLING_DIFF) {
        matched += 1;
      }
    }
    if (srcIdx < sources.length - 1) {
      allSegments.push(makeMultiSegment({
        kind: SegmentKind.PASSTHROUGH,
        text: `

━━━ ${name} ↓ | ${sources[srcIdx + 1][0]} ↑ ━━━

`,
        original: "",
        options: [],
        chosenSource: -1
      }));
    }
    stats.push({ matched, source: name });
  }
  return {
    segments: allSegments,
    sourceNames: sources.map((s) => s[0]),
    statsPerSource: stats,
    mode: MultiMode.CHAIN
  };
}
function jsonResponse$4(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
async function handleNikudMerger(request) {
  if (request.method !== "POST") {
    return jsonResponse$4({ error: "method_not_allowed", message: "Use POST" }, 405);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse$4({ error: "invalid_json", message: "Invalid request body" }, 400);
  }
  const action = String(body?.action || "");
  if (action === "merge") {
    const clean2 = String(body?.clean || "");
    const sources = Array.isArray(body?.sources) ? body.sources : [];
    const mode = body?.mode || "word";
    const config = FilterConfig.fromDict(body?.filter_config || {});
    let result;
    if (sources.length === 1) {
      result = merge(clean2, String(sources[0][1] || ""), {
        config,
        progressCallback: null,
        stopFlag: null,
        mode
      });
    } else {
      result = mergeAllSources(clean2, sources, {
        config,
        progressCallback: null,
        stopFlag: null,
        mode
      });
    }
    result = {
      ...result,
      matchRatio: result.matchCount / Math.max(1, result.cleanWordCount)
    };
    return jsonResponse$4({ result });
  }
  if (action === "quality") {
    const text = String(body?.text || "");
    const issues = checkText(text);
    const summary = summarizeIssues(issues);
    return jsonResponse$4({ issues, summary });
  }
  return jsonResponse$4({ error: "unknown_action", message: "Unknown nikud merger action" }, 400);
}
class CharDiff {
  diff(oldStr, newStr) {
    const oldChars = String(oldStr || "").split("");
    const newChars = String(newStr || "").split("");
    const maxEditLength = oldChars.length + newChars.length;
    const bestPath = [{ newPos: -1, components: [] }];
    let oldPos = this.extractCommon(bestPath[0], newChars, oldChars, 0);
    if (bestPath[0].newPos + 1 >= newChars.length && oldPos + 1 >= oldChars.length) {
      return [{ value: newChars.join("") }];
    }
    for (let editLength = 1; editLength <= maxEditLength; editLength++) {
      for (let diagonal = -editLength; diagonal <= editLength; diagonal += 2) {
        let basePath;
        const addPath = bestPath[diagonal - 1];
        const removePath = bestPath[diagonal + 1];
        const oldPosFromRemove = (removePath ? removePath.newPos : 0) - diagonal;
        if (addPath) bestPath[diagonal - 1] = void 0;
        const canAdd = addPath && addPath.newPos + 1 < newChars.length;
        const canRemove = removePath && oldPosFromRemove >= 0 && oldPosFromRemove < oldChars.length;
        if (!canAdd && !canRemove) {
          bestPath[diagonal] = void 0;
          continue;
        }
        if (!canAdd || canRemove && addPath.newPos < removePath.newPos) {
          basePath = {
            newPos: removePath.newPos,
            components: removePath.components.slice(0)
          };
          this.pushComponent(basePath.components, false, true);
        } else {
          basePath = addPath;
          basePath.newPos++;
          this.pushComponent(basePath.components, true, false);
        }
        oldPos = this.extractCommon(basePath, newChars, oldChars, diagonal);
        if (basePath.newPos + 1 >= newChars.length && oldPos + 1 >= oldChars.length) {
          return this.buildValues(basePath.components, newChars, oldChars);
        }
        bestPath[diagonal] = basePath;
      }
    }
    return [{ value: newStr }];
  }
  pushComponent(components, added, removed) {
    const last = components[components.length - 1];
    if (last && last.added === added && last.removed === removed) {
      last.count++;
    } else {
      components.push({ count: 1, added, removed });
    }
  }
  extractCommon(basePath, newChars, oldChars, diagonal) {
    const newLen = newChars.length;
    const oldLen = oldChars.length;
    let newPos = basePath.newPos;
    let oldPos = newPos - diagonal;
    let commonCount = 0;
    while (newPos + 1 < newLen && oldPos + 1 < oldLen && newChars[newPos + 1] === oldChars[oldPos + 1]) {
      newPos++;
      oldPos++;
      commonCount++;
    }
    if (commonCount) basePath.components.push({ count: commonCount });
    basePath.newPos = newPos;
    return oldPos;
  }
  buildValues(components, newChars, oldChars) {
    let newPos = 0;
    let oldPos = 0;
    const result = components.map((component) => {
      const out = { ...component };
      if (component.removed) {
        out.value = oldChars.slice(oldPos, oldPos + component.count).join("");
        oldPos += component.count;
      } else {
        out.value = newChars.slice(newPos, newPos + component.count).join("");
        newPos += component.count;
        if (!component.added) oldPos += component.count;
      }
      delete out.count;
      if (!out.added) delete out.added;
      if (!out.removed) delete out.removed;
      return out;
    });
    const last = result[result.length - 1];
    if (result.length > 1 && last && typeof last.value === "string" && (last.added || last.removed) && last.value === "") {
      result[result.length - 2].value += last.value;
      result.pop();
    }
    return result;
  }
}
const charDiff = new CharDiff();
function diffChars(oldStr, newStr) {
  return charDiff.diff(oldStr, newStr);
}
const window$1 = { Diff: { diffChars } };
function escapeHtml$1(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[c]);
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function getBlocks(text) {
  return String(text || "").split("\n").map((s) => s.trim()).filter((s) => s.length);
}
const NIKUD_RE = /[֑-ׇ‎‏]/g;
function normalizeForMatch(str, opts, ignoreItems) {
  opts = opts || {};
  if (!str) return "";
  if (opts.useIgnoreList && ignoreItems && ignoreItems.length) {
    ignoreItems.forEach((item) => {
      str = str.replace(new RegExp(escapeRegex(item), "g"), "");
    });
  }
  if (opts.ignoreNikud) str = str.replace(NIKUD_RE, "");
  return str.replace(/\s+/g, "");
}
function hasConsecChars(s1, s2, limit) {
  if (!limit || limit <= 0) return false;
  if (s1.length < limit || s2.length < limit) return false;
  for (let i = 0; i <= s1.length - limit; i++) {
    if (s2.indexOf(s1.substring(i, i + limit)) !== -1) return true;
  }
  return false;
}
function generateDiffHTML(a, b) {
  if (typeof window$1.Diff === "undefined") return escapeHtml$1(a) + " / " + escapeHtml$1(b);
  const parts = window$1.Diff.diffChars(a, b);
  return parts.map((p) => {
    const t = escapeHtml$1(p.value);
    if (p.added) return `<ins class="tcp-diff-added">${t}</ins>`;
    if (p.removed) return `<del class="tcp-diff-removed">${t}</del>`;
    return `<span class="tcp-diff-unchanged">${t}</span>`;
  }).join("");
}
function computeSmartCompare(text1, text2, opts) {
  opts = opts || {};
  const simThreshold = typeof opts.simThreshold === "number" ? opts.simThreshold / 100 : 0.6;
  const consecLimit = opts.consecLimit | 0;
  const normOpts = {
    ignoreNikud: !!opts.ignoreNikud,
    useIgnoreList: !!opts.useIgnoreList
  };
  const ignoreItems = opts.ignoreItems || [];
  const map1 = getBlocks(text1).map((b) => ({
    original: b,
    norm: normalizeForMatch(b, normOpts, ignoreItems)
  }));
  const map2 = getBlocks(text2).map((b) => ({
    original: b,
    norm: normalizeForMatch(b, normOpts, ignoreItems)
  }));
  let u1 = [];
  let u2 = [];
  const used2 = /* @__PURE__ */ new Set();
  let identicalCount = 0;
  map1.forEach((item1) => {
    const idx = map2.findIndex(
      (it, i) => !used2.has(i) && it.norm === item1.norm
    );
    if (idx !== -1) {
      used2.add(idx);
      identicalCount++;
    } else {
      u1.push(item1);
    }
  });
  map2.forEach((it, i) => {
    if (!used2.has(i)) u2.push(it);
  });
  let consecMatched = 0;
  if (consecLimit > 0) {
    const usedConsec = /* @__PURE__ */ new Set();
    const remain = [];
    u1.forEach((item1) => {
      const idx = u2.findIndex(
        (it, i) => !usedConsec.has(i) && hasConsecChars(item1.norm, it.norm, consecLimit)
      );
      if (idx !== -1) {
        usedConsec.add(idx);
        consecMatched++;
      } else {
        remain.push(item1);
      }
    });
    u1 = remain;
    u2 = u2.filter((_, i) => !usedConsec.has(i));
  }
  const similarPairs = [];
  const finalU1 = [];
  const usedSim = /* @__PURE__ */ new Set();
  u1.forEach((item1) => {
    let bestScore = -1;
    let bestIdx = -1;
    const len1 = item1.norm.length;
    u2.forEach((item2, idx) => {
      if (usedSim.has(idx)) return;
      const len2 = item2.norm.length;
      if (len2 < len1 * simThreshold || len2 > len1 / simThreshold) return;
      const diff = window$1.Diff ? window$1.Diff.diffChars(item1.norm, item2.norm) : [];
      let matchLen = 0;
      diff.forEach((p) => {
        if (!p.added && !p.removed) matchLen += p.value.length;
      });
      const maxLen = Math.max(len1, len2);
      const score = maxLen > 0 ? matchLen / maxLen : 1;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });
    if (bestScore >= simThreshold && bestIdx !== -1) {
      usedSim.add(bestIdx);
      similarPairs.push({ item1, item2: u2[bestIdx], score: bestScore });
    } else {
      finalU1.push(item1);
    }
  });
  const finalU2 = u2.filter((_, i) => !usedSim.has(i));
  return {
    identicalCount,
    consecMatched,
    similar: similarPairs,
    onlyIn1: finalU1,
    onlyIn2: finalU2,
    totalIn1: map1.length,
    totalIn2: map2.length,
    simThreshold: Math.round(simThreshold * 100),
    consecLimit
  };
}
function renderSmartReport(r) {
  let html = "";
  html += '<div class="tcp-summary-counts">';
  html += `<div class="tcp-count-card pass"><div class="num">${r.identicalCount}</div><div class="label">קטעים זהים</div></div>`;
  if (r.consecLimit > 0)
    html += `<div class="tcp-count-card pass"><div class="num">${r.consecMatched}</div><div class="label">סוננו ברצף תווים</div></div>`;
  html += `<div class="tcp-count-card warn"><div class="num">${r.similar.length}</div><div class="label">קטעים דומים (≥${r.simThreshold}%)</div></div>`;
  html += `<div class="tcp-count-card fail"><div class="num">${r.onlyIn1.length}</div><div class="label">חסרים במסמך 2</div></div>`;
  html += `<div class="tcp-count-card fail"><div class="num">${r.onlyIn2.length}</div><div class="label">נוספו במסמך 2</div></div>`;
  html += "</div>";
  if (r.similar.length === 0 && r.onlyIn1.length === 0 && r.onlyIn2.length === 0) {
    html += '<div class="tcp-result-box pass"><h3>✅ מעולה — שני המסמכים זהים בכל הקטעים.</h3>';
    html += '<div class="muted">כל הקטעים תואמים או סוננו לפי ההגדרות שלך.</div></div>';
    return html;
  }
  if (r.similar.length) {
    html += '<div class="tcp-result-box warn">';
    html += `<h3>⚠ ${r.similar.length} קטעים דומים</h3>`;
    html += '<div class="muted">אדום עם קו = הוסר ממסמך 1 · ירוק = נוסף במסמך 2</div>';
    r.similar.forEach((p) => {
      html += '<div class="tcp-diff-container">';
      html += `<span class="tcp-score-pill">דמיון ${Math.round(p.score * 100)}%</span>`;
      html += generateDiffHTML(p.item1.original, p.item2.original);
      html += "</div>";
    });
    html += "</div>";
  }
  if (r.onlyIn1.length) {
    html += '<div class="tcp-result-box fail">';
    html += `<h3>❌ ${r.onlyIn1.length} קטעים חסרים במסמך 2</h3>`;
    html += '<div class="muted">קטעים שקיימים במסמך 1 אך לא נמצאו במסמך 2.</div>';
    r.onlyIn1.forEach((it) => {
      html += `<div class="tcp-missing-item">${escapeHtml$1(it.original)}</div>`;
    });
    html += "</div>";
  }
  if (r.onlyIn2.length) {
    html += '<div class="tcp-result-box fail">';
    html += `<h3>❌ ${r.onlyIn2.length} קטעים נוספו במסמך 2</h3>`;
    html += '<div class="muted">קטעים שקיימים במסמך 2 אך לא היו במסמך 1.</div>';
    r.onlyIn2.forEach((it) => {
      html += `<div class="tcp-added-item">${escapeHtml$1(it.original)}</div>`;
    });
    html += "</div>";
  }
  return html;
}
function computeIntegrity(base, insert, merged, opts) {
  opts = opts || {};
  const normOpts = {
    ignoreNikud: !!opts.ignoreNikud,
    useIgnoreList: !!opts.useIgnoreList
  };
  const ignoreItems = opts.ignoreItems || [];
  const mergedNoBrackets = merged.replace(/\{[\s\S]*?\}/g, "");
  const matches = merged.match(/\{([\s\S]*?)\}/g) || [];
  const extracted = matches.map((s) => s.slice(1, -1)).join("");
  const cleanBase = normalizeForMatch(base, normOpts, ignoreItems);
  const cleanMergedNoBr = normalizeForMatch(mergedNoBrackets, normOpts, ignoreItems);
  const cleanInsert = normalizeForMatch(insert, normOpts, ignoreItems);
  const cleanExtracted = normalizeForMatch(extracted, normOpts, ignoreItems);
  const basePass = cleanBase === cleanMergedNoBr;
  const insertPass = cleanInsert === cleanExtracted;
  return {
    basePass,
    insertPass,
    baseDiff: basePass ? null : generateDiffHTML(cleanBase, cleanMergedNoBr),
    insertDiff: insertPass ? null : generateDiffHTML(cleanInsert, cleanExtracted),
    braceCount: matches.length,
    baseLen: base.length,
    insertLen: insert.length,
    mergedLen: merged.length
  };
}
function renderIntegrityReport(r) {
  let html = "";
  html += '<div class="tcp-summary-counts">';
  html += `<div class="tcp-count-card ${r.basePass ? "pass" : "fail"}"><div class="num">${r.basePass ? "✓" : "✗"}</div><div class="label">טקסט ראשי</div></div>`;
  html += `<div class="tcp-count-card ${r.insertPass ? "pass" : "fail"}"><div class="num">${r.insertPass ? "✓" : "✗"}</div><div class="label">טקסט משני</div></div>`;
  html += `<div class="tcp-count-card"><div class="num">${r.braceCount}</div><div class="label">בלוקי {} שזוהו</div></div>`;
  html += "</div>";
  if (r.basePass) {
    html += '<div class="tcp-result-box pass"><h3>✅ בדיקת טקסט ראשי</h3>';
    html += '<div class="muted">הטקסט הראשי נמצא במלואו בטקסט המשולב מחוץ לסוגריים.</div></div>';
  } else {
    html += '<div class="tcp-result-box fail"><h3>❌ שגיאה בטקסט ראשי</h3>';
    html += '<div class="muted">הטקסט הראשי אינו זהה לטקסט המשולב לאחר הסרת הסוגריים.</div>';
    html += `<div class="tcp-diff-container">${r.baseDiff}</div></div>`;
  }
  if (r.insertPass) {
    html += '<div class="tcp-result-box pass"><h3>✅ בדיקת סוגריים {}</h3>';
    html += '<div class="muted">תוכן הסוגריים בטקסט המשולב תואם בדיוק לטקסט המשני.</div></div>';
  } else {
    html += '<div class="tcp-result-box fail"><h3>❌ שגיאה בטקסט משני</h3>';
    html += '<div class="muted">תוכן הסוגריים בטקסט המשולב אינו תואם לטקסט המשני שהוזן.</div>';
    html += `<div class="tcp-diff-container">${r.insertDiff}</div></div>`;
  }
  return html;
}
function jsonResponse$3(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
async function handleTextComparePro(request) {
  if (request.method !== "POST") {
    return jsonResponse$3({ error: "method_not_allowed", message: "Use POST" }, 405);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse$3({ error: "invalid_json", message: "Invalid request body" }, 400);
  }
  const action = String(body?.action || "");
  const opts = body?.opts || {};
  if (action === "smart") {
    const report = computeSmartCompare(
      String(body?.text1 || ""),
      String(body?.text2 || ""),
      opts
    );
    report.html = renderSmartReport(report);
    return jsonResponse$3({ report });
  }
  if (action === "integrity") {
    const report = computeIntegrity(
      String(body?.base || ""),
      String(body?.insert || ""),
      String(body?.merged || ""),
      opts
    );
    report.html = renderIntegrityReport(report);
    return jsonResponse$3({ report });
  }
  return jsonResponse$3({ error: "unknown_action", message: "Unknown text compare action" }, 400);
}
const SEFARIA_BASE = "https://www.sefaria.org/api";
const ALLOWED_PREFIXES = [
  "/index",
  "/shape/",
  "/v3/texts/",
  "/links/",
  "/calendars",
  "/texts/versions/",
  "/texts/"
];
function jsonResponse$2(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
function isAllowedPath(path) {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}
async function handleSefariaProxy(request, url) {
  if (request.method !== "GET") {
    return jsonResponse$2({ error: "method_not_allowed", message: "Use GET" }, 405);
  }
  const suffix = url.pathname.slice("/api/sefaria".length) || "/";
  if (!isAllowedPath(suffix)) {
    return jsonResponse$2({ error: "forbidden_path", message: "Unsupported Sefaria path" }, 403);
  }
  const target = new URL(SEFARIA_BASE + suffix);
  target.search = url.search;
  const upstream = await fetch(target.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "TorahTypesetter/11.50"
    }
  });
  const headers = new Headers(upstream.headers);
  headers.set("cache-control", "no-store");
  headers.delete("access-control-allow-origin");
  headers.delete("content-security-policy");
  headers.delete("content-length");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}
const SEPARATOR = "\n— —\n";
function jsonResponse$1(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" }
  });
}
function escapeForRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
const PALETTE = [
  { bg: "#FEE2E2", fg: "#7F1D1D" },
  { bg: "#DBEAFE", fg: "#1E3A8A" },
  { bg: "#DCFCE7", fg: "#14532D" },
  { bg: "#FEF3C7", fg: "#78350F" },
  { bg: "#F3E8FF", fg: "#581C87" },
  { bg: "#CFFAFE", fg: "#164E63" },
  { bg: "#FCE7F3", fg: "#831843" },
  { bg: "#E5E7EB", fg: "#1F2937" }
];
function colorFor(code) {
  const n = parseInt(code, 10);
  if (Number.isFinite(n) && n >= 1) return PALETTE[(n - 1) % PALETTE.length];
  return PALETTE[0];
}
function splitTextByMarkers(rawText) {
  const matches = [];
  const rx = /@(\d{1,3})/g;
  let m;
  while ((m = rx.exec(rawText)) !== null) {
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      symbol: m[0],
      code: String(parseInt(m[1], 10)).padStart(2, "0")
    });
  }
  const streams = {};
  if (matches.length === 0) {
    return { mainText: rawText, streams, intro: rawText };
  }
  const intro = rawText.slice(0, matches[0].start);
  let mainText = intro;
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const contentEnd = next ? next.start : rawText.length;
    const content = rawText.slice(cur.end, contentEnd).trim();
    mainText += mainText.endsWith(" ") || mainText === "" ? cur.symbol : " " + cur.symbol;
    if (content) {
      if (!streams[cur.code]) streams[cur.code] = [];
      streams[cur.code].push(content);
    }
  }
  return { mainText, streams, intro };
}
function buildMainHTML(rawText) {
  const { mainText } = splitTextByMarkers(rawText);
  const html = escapeHtml(mainText).replace(
    /@(\d{1,3})/g,
    (m, n) => {
      const code = String(parseInt(n, 10)).padStart(2, "0");
      const c = colorFor(code);
      return `<span class="stream-marker stream-${code}" data-stream="${code}" data-uid="split-${code}-${Math.random().toString(36).slice(2, 8)}" style="background-color:${c.bg};color:${c.fg};border-radius:3px;padding:0 3px;font-weight:600;">@${n}</span>`;
    }
  );
  const paragraphs = html.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  return paragraphs.length ? paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n") : `<p>${html.replace(/\n/g, "<br>")}</p>`;
}
function buildStreamHTML(code, notes) {
  if (!notes || !notes.length) return `<p>—</p>`;
  const symbol = `@${code}`;
  const flat = notes.map((n, idx) => `${symbol} [${idx + 1}] ${n.trim()}`).join(SEPARATOR);
  const escaped = escapeHtml(flat).replace(/\n/g, " ");
  return `<p>${escaped}</p>`;
}
function splitStreamNotesByMarkers(streamText) {
  const matches = [...String(streamText || "").matchAll(/@\d{1,3}/g)];
  if (matches.length === 0) return [];
  const notes = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : streamText.length;
    notes.push(streamText.slice(start, end).trim().replace(/^\[\d+\]\s*/, ""));
  }
  return notes;
}
function mergeBackToText(mainText, streamsObj) {
  const cursors = {};
  return String(mainText || "").replace(/@(\d{1,3})/g, (m, n) => {
    const code = String(parseInt(n, 10)).padStart(2, "0");
    cursors[code] = cursors[code] || 0;
    const notes = streamsObj[code] || [];
    const note = notes[cursors[code]];
    cursors[code]++;
    return note ? `${m} ${note}` : m;
  });
}
function inlineMerge(mainText, panes) {
  let out = String(mainText || "");
  for (const p of panes) {
    const sym = String(p?.symbol || "").trim();
    if (!sym) continue;
    const noteText = String(p?.text || "").trim();
    if (!noteText) continue;
    let parts = noteText.split(sym);
    if (parts.length > 0 && parts[0].trim() === "") parts.shift();
    let counter = 0;
    const regex = new RegExp(escapeForRegex(sym), "g");
    out = out.replace(regex, (match) => {
      if (counter < parts.length) {
        const note = parts[counter].trim();
        counter++;
        return `[[${sym} ${note}]]`;
      }
      return match;
    });
  }
  return out;
}
function inlineSplit(mainText, panes) {
  let out = String(mainText || "");
  const streamTexts = {};
  for (const p of panes) {
    const code = String(p?.streamCode || "");
    const sym = String(p?.symbol || "").trim();
    if (!code || !sym) continue;
    const extracted = [];
    const regex = new RegExp(`\\[\\[${escapeForRegex(sym)}([\\s\\S]*?)\\]\\]`, "g");
    out = out.replace(regex, (_match, content) => {
      extracted.push(content.trim());
      return sym;
    });
    if (extracted.length > 0) {
      streamTexts[code] = extracted.map((n) => `${sym} ${n}`).join("\n");
    }
  }
  return { mainText: out, streamTexts };
}
async function handleMainTextTools(request) {
  if (request.method !== "POST") {
    return jsonResponse$1({ error: "method_not_allowed", message: "Use POST" }, 405);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse$1({ error: "invalid_json", message: "Invalid request body" }, 400);
  }
  const action = String(body?.action || "");
  if (action === "split_markers") {
    const rawText = String(body?.rawText || "");
    const { mainText, streams } = splitTextByMarkers(rawText);
    const streamHtml = {};
    for (const code of Object.keys(streams)) {
      streamHtml[code] = buildStreamHTML(code, streams[code]);
    }
    return jsonResponse$1({
      mainText,
      mainHtml: buildMainHTML(rawText),
      streams,
      streamHtml
    });
  }
  if (action === "merge_back") {
    const streams = {};
    const rawStreams = body?.streams && typeof body.streams === "object" ? body.streams : {};
    for (const [code, text] of Object.entries(rawStreams)) {
      streams[code] = splitStreamNotesByMarkers(String(text || ""));
    }
    return jsonResponse$1({
      merged: mergeBackToText(String(body?.mainText || ""), streams),
      streamCount: Object.keys(streams).length
    });
  }
  if (action === "inline_merge") {
    const panes = Array.isArray(body?.panes) ? body.panes : [];
    return jsonResponse$1({
      mainText: inlineMerge(String(body?.mainText || ""), panes)
    });
  }
  if (action === "inline_split") {
    const panes = Array.isArray(body?.panes) ? body.panes : [];
    return jsonResponse$1(inlineSplit(String(body?.mainText || ""), panes));
  }
  return jsonResponse$1({ error: "unknown_action", message: "Unknown main text action" }, 400);
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
function commonjsRequire(path) {
  throw new Error('Could not dynamically require "' + path + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var jszip_min = { exports: {} };
/*!

JSZip v3.10.1 - A JavaScript class for generating and reading zip files
<http://stuartk.com/jszip>

(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.

JSZip uses the library pako released under the MIT license :
https://github.com/nodeca/pako/blob/main/LICENSE
*/
(function(module, exports) {
  !function(e) {
    module.exports = e();
  }(function() {
    return function s(a, o, h) {
      function u(r, e2) {
        if (!o[r]) {
          if (!a[r]) {
            var t = "function" == typeof commonjsRequire && commonjsRequire;
            if (!e2 && t) return t(r, true);
            if (l) return l(r, true);
            var n = new Error("Cannot find module '" + r + "'");
            throw n.code = "MODULE_NOT_FOUND", n;
          }
          var i = o[r] = { exports: {} };
          a[r][0].call(i.exports, function(e3) {
            var t2 = a[r][1][e3];
            return u(t2 || e3);
          }, i, i.exports, s, a, o, h);
        }
        return o[r].exports;
      }
      for (var l = "function" == typeof commonjsRequire && commonjsRequire, e = 0; e < h.length; e++) u(h[e]);
      return u;
    }({ 1: [function(e, t, r) {
      var d = e("./utils"), c = e("./support"), p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
      r.encode = function(e2) {
        for (var t2, r2, n, i, s, a, o, h = [], u = 0, l = e2.length, f = l, c2 = "string" !== d.getTypeOf(e2); u < e2.length; ) f = l - u, n = c2 ? (t2 = e2[u++], r2 = u < l ? e2[u++] : 0, u < l ? e2[u++] : 0) : (t2 = e2.charCodeAt(u++), r2 = u < l ? e2.charCodeAt(u++) : 0, u < l ? e2.charCodeAt(u++) : 0), i = t2 >> 2, s = (3 & t2) << 4 | r2 >> 4, a = 1 < f ? (15 & r2) << 2 | n >> 6 : 64, o = 2 < f ? 63 & n : 64, h.push(p.charAt(i) + p.charAt(s) + p.charAt(a) + p.charAt(o));
        return h.join("");
      }, r.decode = function(e2) {
        var t2, r2, n, i, s, a, o = 0, h = 0, u = "data:";
        if (e2.substr(0, u.length) === u) throw new Error("Invalid base64 input, it looks like a data url.");
        var l, f = 3 * (e2 = e2.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
        if (e2.charAt(e2.length - 1) === p.charAt(64) && f--, e2.charAt(e2.length - 2) === p.charAt(64) && f--, f % 1 != 0) throw new Error("Invalid base64 input, bad content length.");
        for (l = c.uint8array ? new Uint8Array(0 | f) : new Array(0 | f); o < e2.length; ) t2 = p.indexOf(e2.charAt(o++)) << 2 | (i = p.indexOf(e2.charAt(o++))) >> 4, r2 = (15 & i) << 4 | (s = p.indexOf(e2.charAt(o++))) >> 2, n = (3 & s) << 6 | (a = p.indexOf(e2.charAt(o++))), l[h++] = t2, 64 !== s && (l[h++] = r2), 64 !== a && (l[h++] = n);
        return l;
      };
    }, { "./support": 30, "./utils": 32 }], 2: [function(e, t, r) {
      var n = e("./external"), i = e("./stream/DataWorker"), s = e("./stream/Crc32Probe"), a = e("./stream/DataLengthProbe");
      function o(e2, t2, r2, n2, i2) {
        this.compressedSize = e2, this.uncompressedSize = t2, this.crc32 = r2, this.compression = n2, this.compressedContent = i2;
      }
      o.prototype = { getContentWorker: function() {
        var e2 = new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")), t2 = this;
        return e2.on("end", function() {
          if (this.streamInfo.data_length !== t2.uncompressedSize) throw new Error("Bug : uncompressed data size mismatch");
        }), e2;
      }, getCompressedWorker: function() {
        return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
      } }, o.createWorkerFrom = function(e2, t2, r2) {
        return e2.pipe(new s()).pipe(new a("uncompressedSize")).pipe(t2.compressWorker(r2)).pipe(new a("compressedSize")).withStreamInfo("compression", t2);
      }, t.exports = o;
    }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(e, t, r) {
      var n = e("./stream/GenericWorker");
      r.STORE = { magic: "\0\0", compressWorker: function() {
        return new n("STORE compression");
      }, uncompressWorker: function() {
        return new n("STORE decompression");
      } }, r.DEFLATE = e("./flate");
    }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(e, t, r) {
      var n = e("./utils");
      var o = function() {
        for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
          e2 = r2;
          for (var n2 = 0; n2 < 8; n2++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
          t2[r2] = e2;
        }
        return t2;
      }();
      t.exports = function(e2, t2) {
        return void 0 !== e2 && e2.length ? "string" !== n.getTypeOf(e2) ? function(e3, t3, r2, n2) {
          var i = o, s = n2 + r2;
          e3 ^= -1;
          for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3[a])];
          return -1 ^ e3;
        }(0 | t2, e2, e2.length, 0) : function(e3, t3, r2, n2) {
          var i = o, s = n2 + r2;
          e3 ^= -1;
          for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3.charCodeAt(a))];
          return -1 ^ e3;
        }(0 | t2, e2, e2.length, 0) : 0;
      };
    }, { "./utils": 32 }], 5: [function(e, t, r) {
      r.base64 = false, r.binary = false, r.dir = false, r.createFolders = true, r.date = null, r.compression = null, r.compressionOptions = null, r.comment = null, r.unixPermissions = null, r.dosPermissions = null;
    }, {}], 6: [function(e, t, r) {
      var n = null;
      n = "undefined" != typeof Promise ? Promise : e("lie"), t.exports = { Promise: n };
    }, { lie: 37 }], 7: [function(e, t, r) {
      var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Uint32Array, i = e("pako"), s = e("./utils"), a = e("./stream/GenericWorker"), o = n ? "uint8array" : "array";
      function h(e2, t2) {
        a.call(this, "FlateWorker/" + e2), this._pako = null, this._pakoAction = e2, this._pakoOptions = t2, this.meta = {};
      }
      r.magic = "\b\0", s.inherits(h, a), h.prototype.processChunk = function(e2) {
        this.meta = e2.meta, null === this._pako && this._createPako(), this._pako.push(s.transformTo(o, e2.data), false);
      }, h.prototype.flush = function() {
        a.prototype.flush.call(this), null === this._pako && this._createPako(), this._pako.push([], true);
      }, h.prototype.cleanUp = function() {
        a.prototype.cleanUp.call(this), this._pako = null;
      }, h.prototype._createPako = function() {
        this._pako = new i[this._pakoAction]({ raw: true, level: this._pakoOptions.level || -1 });
        var t2 = this;
        this._pako.onData = function(e2) {
          t2.push({ data: e2, meta: t2.meta });
        };
      }, r.compressWorker = function(e2) {
        return new h("Deflate", e2);
      }, r.uncompressWorker = function() {
        return new h("Inflate", {});
      };
    }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(e, t, r) {
      function A(e2, t2) {
        var r2, n2 = "";
        for (r2 = 0; r2 < t2; r2++) n2 += String.fromCharCode(255 & e2), e2 >>>= 8;
        return n2;
      }
      function n(e2, t2, r2, n2, i2, s2) {
        var a, o, h = e2.file, u = e2.compression, l = s2 !== O.utf8encode, f = I.transformTo("string", s2(h.name)), c = I.transformTo("string", O.utf8encode(h.name)), d = h.comment, p = I.transformTo("string", s2(d)), m = I.transformTo("string", O.utf8encode(d)), _ = c.length !== h.name.length, g = m.length !== d.length, b = "", v = "", y = "", w = h.dir, k = h.date, x = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
        t2 && !r2 || (x.crc32 = e2.crc32, x.compressedSize = e2.compressedSize, x.uncompressedSize = e2.uncompressedSize);
        var S = 0;
        t2 && (S |= 8), l || !_ && !g || (S |= 2048);
        var z = 0, C = 0;
        w && (z |= 16), "UNIX" === i2 ? (C = 798, z |= function(e3, t3) {
          var r3 = e3;
          return e3 || (r3 = t3 ? 16893 : 33204), (65535 & r3) << 16;
        }(h.unixPermissions, w)) : (C = 20, z |= function(e3) {
          return 63 & (e3 || 0);
        }(h.dosPermissions)), a = k.getUTCHours(), a <<= 6, a |= k.getUTCMinutes(), a <<= 5, a |= k.getUTCSeconds() / 2, o = k.getUTCFullYear() - 1980, o <<= 4, o |= k.getUTCMonth() + 1, o <<= 5, o |= k.getUTCDate(), _ && (v = A(1, 1) + A(B(f), 4) + c, b += "up" + A(v.length, 2) + v), g && (y = A(1, 1) + A(B(p), 4) + m, b += "uc" + A(y.length, 2) + y);
        var E = "";
        return E += "\n\0", E += A(S, 2), E += u.magic, E += A(a, 2), E += A(o, 2), E += A(x.crc32, 4), E += A(x.compressedSize, 4), E += A(x.uncompressedSize, 4), E += A(f.length, 2), E += A(b.length, 2), { fileRecord: R.LOCAL_FILE_HEADER + E + f + b, dirRecord: R.CENTRAL_FILE_HEADER + A(C, 2) + E + A(p.length, 2) + "\0\0\0\0" + A(z, 4) + A(n2, 4) + f + b + p };
      }
      var I = e("../utils"), i = e("../stream/GenericWorker"), O = e("../utf8"), B = e("../crc32"), R = e("../signature");
      function s(e2, t2, r2, n2) {
        i.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t2, this.zipPlatform = r2, this.encodeFileName = n2, this.streamFiles = e2, this.accumulate = false, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
      }
      I.inherits(s, i), s.prototype.push = function(e2) {
        var t2 = e2.meta.percent || 0, r2 = this.entriesCount, n2 = this._sources.length;
        this.accumulate ? this.contentBuffer.push(e2) : (this.bytesWritten += e2.data.length, i.prototype.push.call(this, { data: e2.data, meta: { currentFile: this.currentFile, percent: r2 ? (t2 + 100 * (r2 - n2 - 1)) / r2 : 100 } }));
      }, s.prototype.openedSource = function(e2) {
        this.currentSourceOffset = this.bytesWritten, this.currentFile = e2.file.name;
        var t2 = this.streamFiles && !e2.file.dir;
        if (t2) {
          var r2 = n(e2, t2, false, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
          this.push({ data: r2.fileRecord, meta: { percent: 0 } });
        } else this.accumulate = true;
      }, s.prototype.closedSource = function(e2) {
        this.accumulate = false;
        var t2 = this.streamFiles && !e2.file.dir, r2 = n(e2, t2, true, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
        if (this.dirRecords.push(r2.dirRecord), t2) this.push({ data: function(e3) {
          return R.DATA_DESCRIPTOR + A(e3.crc32, 4) + A(e3.compressedSize, 4) + A(e3.uncompressedSize, 4);
        }(e2), meta: { percent: 100 } });
        else for (this.push({ data: r2.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; ) this.push(this.contentBuffer.shift());
        this.currentFile = null;
      }, s.prototype.flush = function() {
        for (var e2 = this.bytesWritten, t2 = 0; t2 < this.dirRecords.length; t2++) this.push({ data: this.dirRecords[t2], meta: { percent: 100 } });
        var r2 = this.bytesWritten - e2, n2 = function(e3, t3, r3, n3, i2) {
          var s2 = I.transformTo("string", i2(n3));
          return R.CENTRAL_DIRECTORY_END + "\0\0\0\0" + A(e3, 2) + A(e3, 2) + A(t3, 4) + A(r3, 4) + A(s2.length, 2) + s2;
        }(this.dirRecords.length, r2, e2, this.zipComment, this.encodeFileName);
        this.push({ data: n2, meta: { percent: 100 } });
      }, s.prototype.prepareNextSource = function() {
        this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
      }, s.prototype.registerPrevious = function(e2) {
        this._sources.push(e2);
        var t2 = this;
        return e2.on("data", function(e3) {
          t2.processChunk(e3);
        }), e2.on("end", function() {
          t2.closedSource(t2.previous.streamInfo), t2._sources.length ? t2.prepareNextSource() : t2.end();
        }), e2.on("error", function(e3) {
          t2.error(e3);
        }), this;
      }, s.prototype.resume = function() {
        return !!i.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), true) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), true));
      }, s.prototype.error = function(e2) {
        var t2 = this._sources;
        if (!i.prototype.error.call(this, e2)) return false;
        for (var r2 = 0; r2 < t2.length; r2++) try {
          t2[r2].error(e2);
        } catch (e3) {
        }
        return true;
      }, s.prototype.lock = function() {
        i.prototype.lock.call(this);
        for (var e2 = this._sources, t2 = 0; t2 < e2.length; t2++) e2[t2].lock();
      }, t.exports = s;
    }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(e, t, r) {
      var u = e("../compressions"), n = e("./ZipFileWorker");
      r.generateWorker = function(e2, a, t2) {
        var o = new n(a.streamFiles, t2, a.platform, a.encodeFileName), h = 0;
        try {
          e2.forEach(function(e3, t3) {
            h++;
            var r2 = function(e4, t4) {
              var r3 = e4 || t4, n3 = u[r3];
              if (!n3) throw new Error(r3 + " is not a valid compression method !");
              return n3;
            }(t3.options.compression, a.compression), n2 = t3.options.compressionOptions || a.compressionOptions || {}, i = t3.dir, s = t3.date;
            t3._compressWorker(r2, n2).withStreamInfo("file", { name: e3, dir: i, date: s, comment: t3.comment || "", unixPermissions: t3.unixPermissions, dosPermissions: t3.dosPermissions }).pipe(o);
          }), o.entriesCount = h;
        } catch (e3) {
          o.error(e3);
        }
        return o;
      };
    }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(e, t, r) {
      function n() {
        if (!(this instanceof n)) return new n();
        if (arguments.length) throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
        this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
          var e2 = new n();
          for (var t2 in this) "function" != typeof this[t2] && (e2[t2] = this[t2]);
          return e2;
        };
      }
      (n.prototype = e("./object")).loadAsync = e("./load"), n.support = e("./support"), n.defaults = e("./defaults"), n.version = "3.10.1", n.loadAsync = function(e2, t2) {
        return new n().loadAsync(e2, t2);
      }, n.external = e("./external"), t.exports = n;
    }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(e, t, r) {
      var u = e("./utils"), i = e("./external"), n = e("./utf8"), s = e("./zipEntries"), a = e("./stream/Crc32Probe"), l = e("./nodejsUtils");
      function f(n2) {
        return new i.Promise(function(e2, t2) {
          var r2 = n2.decompressed.getContentWorker().pipe(new a());
          r2.on("error", function(e3) {
            t2(e3);
          }).on("end", function() {
            r2.streamInfo.crc32 !== n2.decompressed.crc32 ? t2(new Error("Corrupted zip : CRC32 mismatch")) : e2();
          }).resume();
        });
      }
      t.exports = function(e2, o) {
        var h = this;
        return o = u.extend(o || {}, { base64: false, checkCRC32: false, optimizedBinaryString: false, createFolders: false, decodeFileName: n.utf8decode }), l.isNode && l.isStream(e2) ? i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : u.prepareContent("the loaded zip file", e2, true, o.optimizedBinaryString, o.base64).then(function(e3) {
          var t2 = new s(o);
          return t2.load(e3), t2;
        }).then(function(e3) {
          var t2 = [i.Promise.resolve(e3)], r2 = e3.files;
          if (o.checkCRC32) for (var n2 = 0; n2 < r2.length; n2++) t2.push(f(r2[n2]));
          return i.Promise.all(t2);
        }).then(function(e3) {
          for (var t2 = e3.shift(), r2 = t2.files, n2 = 0; n2 < r2.length; n2++) {
            var i2 = r2[n2], s2 = i2.fileNameStr, a2 = u.resolve(i2.fileNameStr);
            h.file(a2, i2.decompressed, { binary: true, optimizedBinaryString: true, date: i2.date, dir: i2.dir, comment: i2.fileCommentStr.length ? i2.fileCommentStr : null, unixPermissions: i2.unixPermissions, dosPermissions: i2.dosPermissions, createFolders: o.createFolders }), i2.dir || (h.file(a2).unsafeOriginalName = s2);
          }
          return t2.zipComment.length && (h.comment = t2.zipComment), h;
        });
      };
    }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(e, t, r) {
      var n = e("../utils"), i = e("../stream/GenericWorker");
      function s(e2, t2) {
        i.call(this, "Nodejs stream input adapter for " + e2), this._upstreamEnded = false, this._bindStream(t2);
      }
      n.inherits(s, i), s.prototype._bindStream = function(e2) {
        var t2 = this;
        (this._stream = e2).pause(), e2.on("data", function(e3) {
          t2.push({ data: e3, meta: { percent: 0 } });
        }).on("error", function(e3) {
          t2.isPaused ? this.generatedError = e3 : t2.error(e3);
        }).on("end", function() {
          t2.isPaused ? t2._upstreamEnded = true : t2.end();
        });
      }, s.prototype.pause = function() {
        return !!i.prototype.pause.call(this) && (this._stream.pause(), true);
      }, s.prototype.resume = function() {
        return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), true);
      }, t.exports = s;
    }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(e, t, r) {
      var i = e("readable-stream").Readable;
      function n(e2, t2, r2) {
        i.call(this, t2), this._helper = e2;
        var n2 = this;
        e2.on("data", function(e3, t3) {
          n2.push(e3) || n2._helper.pause(), r2 && r2(t3);
        }).on("error", function(e3) {
          n2.emit("error", e3);
        }).on("end", function() {
          n2.push(null);
        });
      }
      e("../utils").inherits(n, i), n.prototype._read = function() {
        this._helper.resume();
      }, t.exports = n;
    }, { "../utils": 32, "readable-stream": 16 }], 14: [function(e, t, r) {
      t.exports = { isNode: "undefined" != typeof Buffer, newBufferFrom: function(e2, t2) {
        if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e2, t2);
        if ("number" == typeof e2) throw new Error('The "data" argument must not be a number');
        return new Buffer(e2, t2);
      }, allocBuffer: function(e2) {
        if (Buffer.alloc) return Buffer.alloc(e2);
        var t2 = new Buffer(e2);
        return t2.fill(0), t2;
      }, isBuffer: function(e2) {
        return Buffer.isBuffer(e2);
      }, isStream: function(e2) {
        return e2 && "function" == typeof e2.on && "function" == typeof e2.pause && "function" == typeof e2.resume;
      } };
    }, {}], 15: [function(e, t, r) {
      function s(e2, t2, r2) {
        var n2, i2 = u.getTypeOf(t2), s2 = u.extend(r2 || {}, f);
        s2.date = s2.date || /* @__PURE__ */ new Date(), null !== s2.compression && (s2.compression = s2.compression.toUpperCase()), "string" == typeof s2.unixPermissions && (s2.unixPermissions = parseInt(s2.unixPermissions, 8)), s2.unixPermissions && 16384 & s2.unixPermissions && (s2.dir = true), s2.dosPermissions && 16 & s2.dosPermissions && (s2.dir = true), s2.dir && (e2 = g(e2)), s2.createFolders && (n2 = _(e2)) && b.call(this, n2, true);
        var a2 = "string" === i2 && false === s2.binary && false === s2.base64;
        r2 && void 0 !== r2.binary || (s2.binary = !a2), (t2 instanceof c && 0 === t2.uncompressedSize || s2.dir || !t2 || 0 === t2.length) && (s2.base64 = false, s2.binary = true, t2 = "", s2.compression = "STORE", i2 = "string");
        var o2 = null;
        o2 = t2 instanceof c || t2 instanceof l ? t2 : p.isNode && p.isStream(t2) ? new m(e2, t2) : u.prepareContent(e2, t2, s2.binary, s2.optimizedBinaryString, s2.base64);
        var h2 = new d(e2, o2, s2);
        this.files[e2] = h2;
      }
      var i = e("./utf8"), u = e("./utils"), l = e("./stream/GenericWorker"), a = e("./stream/StreamHelper"), f = e("./defaults"), c = e("./compressedObject"), d = e("./zipObject"), o = e("./generate"), p = e("./nodejsUtils"), m = e("./nodejs/NodejsStreamInputAdapter"), _ = function(e2) {
        "/" === e2.slice(-1) && (e2 = e2.substring(0, e2.length - 1));
        var t2 = e2.lastIndexOf("/");
        return 0 < t2 ? e2.substring(0, t2) : "";
      }, g = function(e2) {
        return "/" !== e2.slice(-1) && (e2 += "/"), e2;
      }, b = function(e2, t2) {
        return t2 = void 0 !== t2 ? t2 : f.createFolders, e2 = g(e2), this.files[e2] || s.call(this, e2, null, { dir: true, createFolders: t2 }), this.files[e2];
      };
      function h(e2) {
        return "[object RegExp]" === Object.prototype.toString.call(e2);
      }
      var n = { load: function() {
        throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
      }, forEach: function(e2) {
        var t2, r2, n2;
        for (t2 in this.files) n2 = this.files[t2], (r2 = t2.slice(this.root.length, t2.length)) && t2.slice(0, this.root.length) === this.root && e2(r2, n2);
      }, filter: function(r2) {
        var n2 = [];
        return this.forEach(function(e2, t2) {
          r2(e2, t2) && n2.push(t2);
        }), n2;
      }, file: function(e2, t2, r2) {
        if (1 !== arguments.length) return e2 = this.root + e2, s.call(this, e2, t2, r2), this;
        if (h(e2)) {
          var n2 = e2;
          return this.filter(function(e3, t3) {
            return !t3.dir && n2.test(e3);
          });
        }
        var i2 = this.files[this.root + e2];
        return i2 && !i2.dir ? i2 : null;
      }, folder: function(r2) {
        if (!r2) return this;
        if (h(r2)) return this.filter(function(e3, t3) {
          return t3.dir && r2.test(e3);
        });
        var e2 = this.root + r2, t2 = b.call(this, e2), n2 = this.clone();
        return n2.root = t2.name, n2;
      }, remove: function(r2) {
        r2 = this.root + r2;
        var e2 = this.files[r2];
        if (e2 || ("/" !== r2.slice(-1) && (r2 += "/"), e2 = this.files[r2]), e2 && !e2.dir) delete this.files[r2];
        else for (var t2 = this.filter(function(e3, t3) {
          return t3.name.slice(0, r2.length) === r2;
        }), n2 = 0; n2 < t2.length; n2++) delete this.files[t2[n2].name];
        return this;
      }, generate: function() {
        throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
      }, generateInternalStream: function(e2) {
        var t2, r2 = {};
        try {
          if ((r2 = u.extend(e2 || {}, { streamFiles: false, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: i.utf8encode })).type = r2.type.toLowerCase(), r2.compression = r2.compression.toUpperCase(), "binarystring" === r2.type && (r2.type = "string"), !r2.type) throw new Error("No output type specified.");
          u.checkSupport(r2.type), "darwin" !== r2.platform && "freebsd" !== r2.platform && "linux" !== r2.platform && "sunos" !== r2.platform || (r2.platform = "UNIX"), "win32" === r2.platform && (r2.platform = "DOS");
          var n2 = r2.comment || this.comment || "";
          t2 = o.generateWorker(this, r2, n2);
        } catch (e3) {
          (t2 = new l("error")).error(e3);
        }
        return new a(t2, r2.type || "string", r2.mimeType);
      }, generateAsync: function(e2, t2) {
        return this.generateInternalStream(e2).accumulate(t2);
      }, generateNodeStream: function(e2, t2) {
        return (e2 = e2 || {}).type || (e2.type = "nodebuffer"), this.generateInternalStream(e2).toNodejsStream(t2);
      } };
      t.exports = n;
    }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(e, t, r) {
      t.exports = e("stream");
    }, { stream: void 0 }], 17: [function(e, t, r) {
      var n = e("./DataReader");
      function i(e2) {
        n.call(this, e2);
        for (var t2 = 0; t2 < this.data.length; t2++) e2[t2] = 255 & e2[t2];
      }
      e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
        return this.data[this.zero + e2];
      }, i.prototype.lastIndexOfSignature = function(e2) {
        for (var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.length - 4; 0 <= s; --s) if (this.data[s] === t2 && this.data[s + 1] === r2 && this.data[s + 2] === n2 && this.data[s + 3] === i2) return s - this.zero;
        return -1;
      }, i.prototype.readAndCheckSignature = function(e2) {
        var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.readData(4);
        return t2 === s[0] && r2 === s[1] && n2 === s[2] && i2 === s[3];
      }, i.prototype.readData = function(e2) {
        if (this.checkOffset(e2), 0 === e2) return [];
        var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
        return this.index += e2, t2;
      }, t.exports = i;
    }, { "../utils": 32, "./DataReader": 18 }], 18: [function(e, t, r) {
      var n = e("../utils");
      function i(e2) {
        this.data = e2, this.length = e2.length, this.index = 0, this.zero = 0;
      }
      i.prototype = { checkOffset: function(e2) {
        this.checkIndex(this.index + e2);
      }, checkIndex: function(e2) {
        if (this.length < this.zero + e2 || e2 < 0) throw new Error("End of data reached (data length = " + this.length + ", asked index = " + e2 + "). Corrupted zip ?");
      }, setIndex: function(e2) {
        this.checkIndex(e2), this.index = e2;
      }, skip: function(e2) {
        this.setIndex(this.index + e2);
      }, byteAt: function() {
      }, readInt: function(e2) {
        var t2, r2 = 0;
        for (this.checkOffset(e2), t2 = this.index + e2 - 1; t2 >= this.index; t2--) r2 = (r2 << 8) + this.byteAt(t2);
        return this.index += e2, r2;
      }, readString: function(e2) {
        return n.transformTo("string", this.readData(e2));
      }, readData: function() {
      }, lastIndexOfSignature: function() {
      }, readAndCheckSignature: function() {
      }, readDate: function() {
        var e2 = this.readInt(4);
        return new Date(Date.UTC(1980 + (e2 >> 25 & 127), (e2 >> 21 & 15) - 1, e2 >> 16 & 31, e2 >> 11 & 31, e2 >> 5 & 63, (31 & e2) << 1));
      } }, t.exports = i;
    }, { "../utils": 32 }], 19: [function(e, t, r) {
      var n = e("./Uint8ArrayReader");
      function i(e2) {
        n.call(this, e2);
      }
      e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
        this.checkOffset(e2);
        var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
        return this.index += e2, t2;
      }, t.exports = i;
    }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(e, t, r) {
      var n = e("./DataReader");
      function i(e2) {
        n.call(this, e2);
      }
      e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
        return this.data.charCodeAt(this.zero + e2);
      }, i.prototype.lastIndexOfSignature = function(e2) {
        return this.data.lastIndexOf(e2) - this.zero;
      }, i.prototype.readAndCheckSignature = function(e2) {
        return e2 === this.readData(4);
      }, i.prototype.readData = function(e2) {
        this.checkOffset(e2);
        var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
        return this.index += e2, t2;
      }, t.exports = i;
    }, { "../utils": 32, "./DataReader": 18 }], 21: [function(e, t, r) {
      var n = e("./ArrayReader");
      function i(e2) {
        n.call(this, e2);
      }
      e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
        if (this.checkOffset(e2), 0 === e2) return new Uint8Array(0);
        var t2 = this.data.subarray(this.zero + this.index, this.zero + this.index + e2);
        return this.index += e2, t2;
      }, t.exports = i;
    }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(e, t, r) {
      var n = e("../utils"), i = e("../support"), s = e("./ArrayReader"), a = e("./StringReader"), o = e("./NodeBufferReader"), h = e("./Uint8ArrayReader");
      t.exports = function(e2) {
        var t2 = n.getTypeOf(e2);
        return n.checkSupport(t2), "string" !== t2 || i.uint8array ? "nodebuffer" === t2 ? new o(e2) : i.uint8array ? new h(n.transformTo("uint8array", e2)) : new s(n.transformTo("array", e2)) : new a(e2);
      };
    }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(e, t, r) {
      r.LOCAL_FILE_HEADER = "PK", r.CENTRAL_FILE_HEADER = "PK", r.CENTRAL_DIRECTORY_END = "PK", r.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", r.ZIP64_CENTRAL_DIRECTORY_END = "PK", r.DATA_DESCRIPTOR = "PK\x07\b";
    }, {}], 24: [function(e, t, r) {
      var n = e("./GenericWorker"), i = e("../utils");
      function s(e2) {
        n.call(this, "ConvertWorker to " + e2), this.destType = e2;
      }
      i.inherits(s, n), s.prototype.processChunk = function(e2) {
        this.push({ data: i.transformTo(this.destType, e2.data), meta: e2.meta });
      }, t.exports = s;
    }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(e, t, r) {
      var n = e("./GenericWorker"), i = e("../crc32");
      function s() {
        n.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
      }
      e("../utils").inherits(s, n), s.prototype.processChunk = function(e2) {
        this.streamInfo.crc32 = i(e2.data, this.streamInfo.crc32 || 0), this.push(e2);
      }, t.exports = s;
    }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(e, t, r) {
      var n = e("../utils"), i = e("./GenericWorker");
      function s(e2) {
        i.call(this, "DataLengthProbe for " + e2), this.propName = e2, this.withStreamInfo(e2, 0);
      }
      n.inherits(s, i), s.prototype.processChunk = function(e2) {
        if (e2) {
          var t2 = this.streamInfo[this.propName] || 0;
          this.streamInfo[this.propName] = t2 + e2.data.length;
        }
        i.prototype.processChunk.call(this, e2);
      }, t.exports = s;
    }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(e, t, r) {
      var n = e("../utils"), i = e("./GenericWorker");
      function s(e2) {
        i.call(this, "DataWorker");
        var t2 = this;
        this.dataIsReady = false, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = false, e2.then(function(e3) {
          t2.dataIsReady = true, t2.data = e3, t2.max = e3 && e3.length || 0, t2.type = n.getTypeOf(e3), t2.isPaused || t2._tickAndRepeat();
        }, function(e3) {
          t2.error(e3);
        });
      }
      n.inherits(s, i), s.prototype.cleanUp = function() {
        i.prototype.cleanUp.call(this), this.data = null;
      }, s.prototype.resume = function() {
        return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = true, n.delay(this._tickAndRepeat, [], this)), true);
      }, s.prototype._tickAndRepeat = function() {
        this._tickScheduled = false, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (n.delay(this._tickAndRepeat, [], this), this._tickScheduled = true));
      }, s.prototype._tick = function() {
        if (this.isPaused || this.isFinished) return false;
        var e2 = null, t2 = Math.min(this.max, this.index + 16384);
        if (this.index >= this.max) return this.end();
        switch (this.type) {
          case "string":
            e2 = this.data.substring(this.index, t2);
            break;
          case "uint8array":
            e2 = this.data.subarray(this.index, t2);
            break;
          case "array":
          case "nodebuffer":
            e2 = this.data.slice(this.index, t2);
        }
        return this.index = t2, this.push({ data: e2, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
      }, t.exports = s;
    }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(e, t, r) {
      function n(e2) {
        this.name = e2 || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = true, this.isFinished = false, this.isLocked = false, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
      }
      n.prototype = { push: function(e2) {
        this.emit("data", e2);
      }, end: function() {
        if (this.isFinished) return false;
        this.flush();
        try {
          this.emit("end"), this.cleanUp(), this.isFinished = true;
        } catch (e2) {
          this.emit("error", e2);
        }
        return true;
      }, error: function(e2) {
        return !this.isFinished && (this.isPaused ? this.generatedError = e2 : (this.isFinished = true, this.emit("error", e2), this.previous && this.previous.error(e2), this.cleanUp()), true);
      }, on: function(e2, t2) {
        return this._listeners[e2].push(t2), this;
      }, cleanUp: function() {
        this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
      }, emit: function(e2, t2) {
        if (this._listeners[e2]) for (var r2 = 0; r2 < this._listeners[e2].length; r2++) this._listeners[e2][r2].call(this, t2);
      }, pipe: function(e2) {
        return e2.registerPrevious(this);
      }, registerPrevious: function(e2) {
        if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
        this.streamInfo = e2.streamInfo, this.mergeStreamInfo(), this.previous = e2;
        var t2 = this;
        return e2.on("data", function(e3) {
          t2.processChunk(e3);
        }), e2.on("end", function() {
          t2.end();
        }), e2.on("error", function(e3) {
          t2.error(e3);
        }), this;
      }, pause: function() {
        return !this.isPaused && !this.isFinished && (this.isPaused = true, this.previous && this.previous.pause(), true);
      }, resume: function() {
        if (!this.isPaused || this.isFinished) return false;
        var e2 = this.isPaused = false;
        return this.generatedError && (this.error(this.generatedError), e2 = true), this.previous && this.previous.resume(), !e2;
      }, flush: function() {
      }, processChunk: function(e2) {
        this.push(e2);
      }, withStreamInfo: function(e2, t2) {
        return this.extraStreamInfo[e2] = t2, this.mergeStreamInfo(), this;
      }, mergeStreamInfo: function() {
        for (var e2 in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e2) && (this.streamInfo[e2] = this.extraStreamInfo[e2]);
      }, lock: function() {
        if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
        this.isLocked = true, this.previous && this.previous.lock();
      }, toString: function() {
        var e2 = "Worker " + this.name;
        return this.previous ? this.previous + " -> " + e2 : e2;
      } }, t.exports = n;
    }, {}], 29: [function(e, t, r) {
      var h = e("../utils"), i = e("./ConvertWorker"), s = e("./GenericWorker"), u = e("../base64"), n = e("../support"), a = e("../external"), o = null;
      if (n.nodestream) try {
        o = e("../nodejs/NodejsStreamOutputAdapter");
      } catch (e2) {
      }
      function l(e2, o2) {
        return new a.Promise(function(t2, r2) {
          var n2 = [], i2 = e2._internalType, s2 = e2._outputType, a2 = e2._mimeType;
          e2.on("data", function(e3, t3) {
            n2.push(e3), o2 && o2(t3);
          }).on("error", function(e3) {
            n2 = [], r2(e3);
          }).on("end", function() {
            try {
              var e3 = function(e4, t3, r3) {
                switch (e4) {
                  case "blob":
                    return h.newBlob(h.transformTo("arraybuffer", t3), r3);
                  case "base64":
                    return u.encode(t3);
                  default:
                    return h.transformTo(e4, t3);
                }
              }(s2, function(e4, t3) {
                var r3, n3 = 0, i3 = null, s3 = 0;
                for (r3 = 0; r3 < t3.length; r3++) s3 += t3[r3].length;
                switch (e4) {
                  case "string":
                    return t3.join("");
                  case "array":
                    return Array.prototype.concat.apply([], t3);
                  case "uint8array":
                    for (i3 = new Uint8Array(s3), r3 = 0; r3 < t3.length; r3++) i3.set(t3[r3], n3), n3 += t3[r3].length;
                    return i3;
                  case "nodebuffer":
                    return Buffer.concat(t3);
                  default:
                    throw new Error("concat : unsupported type '" + e4 + "'");
                }
              }(i2, n2), a2);
              t2(e3);
            } catch (e4) {
              r2(e4);
            }
            n2 = [];
          }).resume();
        });
      }
      function f(e2, t2, r2) {
        var n2 = t2;
        switch (t2) {
          case "blob":
          case "arraybuffer":
            n2 = "uint8array";
            break;
          case "base64":
            n2 = "string";
        }
        try {
          this._internalType = n2, this._outputType = t2, this._mimeType = r2, h.checkSupport(n2), this._worker = e2.pipe(new i(n2)), e2.lock();
        } catch (e3) {
          this._worker = new s("error"), this._worker.error(e3);
        }
      }
      f.prototype = { accumulate: function(e2) {
        return l(this, e2);
      }, on: function(e2, t2) {
        var r2 = this;
        return "data" === e2 ? this._worker.on(e2, function(e3) {
          t2.call(r2, e3.data, e3.meta);
        }) : this._worker.on(e2, function() {
          h.delay(t2, arguments, r2);
        }), this;
      }, resume: function() {
        return h.delay(this._worker.resume, [], this._worker), this;
      }, pause: function() {
        return this._worker.pause(), this;
      }, toNodejsStream: function(e2) {
        if (h.checkSupport("nodestream"), "nodebuffer" !== this._outputType) throw new Error(this._outputType + " is not supported by this method");
        return new o(this, { objectMode: "nodebuffer" !== this._outputType }, e2);
      } }, t.exports = f;
    }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(e, t, r) {
      if (r.base64 = true, r.array = true, r.string = true, r.arraybuffer = "undefined" != typeof ArrayBuffer && "undefined" != typeof Uint8Array, r.nodebuffer = "undefined" != typeof Buffer, r.uint8array = "undefined" != typeof Uint8Array, "undefined" == typeof ArrayBuffer) r.blob = false;
      else {
        var n = new ArrayBuffer(0);
        try {
          r.blob = 0 === new Blob([n], { type: "application/zip" }).size;
        } catch (e2) {
          try {
            var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
            i.append(n), r.blob = 0 === i.getBlob("application/zip").size;
          } catch (e3) {
            r.blob = false;
          }
        }
      }
      try {
        r.nodestream = !!e("readable-stream").Readable;
      } catch (e2) {
        r.nodestream = false;
      }
    }, { "readable-stream": 16 }], 31: [function(e, t, s) {
      for (var o = e("./utils"), h = e("./support"), r = e("./nodejsUtils"), n = e("./stream/GenericWorker"), u = new Array(256), i = 0; i < 256; i++) u[i] = 252 <= i ? 6 : 248 <= i ? 5 : 240 <= i ? 4 : 224 <= i ? 3 : 192 <= i ? 2 : 1;
      u[254] = u[254] = 1;
      function a() {
        n.call(this, "utf-8 decode"), this.leftOver = null;
      }
      function l() {
        n.call(this, "utf-8 encode");
      }
      s.utf8encode = function(e2) {
        return h.nodebuffer ? r.newBufferFrom(e2, "utf-8") : function(e3) {
          var t2, r2, n2, i2, s2, a2 = e3.length, o2 = 0;
          for (i2 = 0; i2 < a2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o2 += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
          for (t2 = h.uint8array ? new Uint8Array(o2) : new Array(o2), i2 = s2 = 0; s2 < o2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
          return t2;
        }(e2);
      }, s.utf8decode = function(e2) {
        return h.nodebuffer ? o.transformTo("nodebuffer", e2).toString("utf-8") : function(e3) {
          var t2, r2, n2, i2, s2 = e3.length, a2 = new Array(2 * s2);
          for (t2 = r2 = 0; t2 < s2; ) if ((n2 = e3[t2++]) < 128) a2[r2++] = n2;
          else if (4 < (i2 = u[n2])) a2[r2++] = 65533, t2 += i2 - 1;
          else {
            for (n2 &= 2 === i2 ? 31 : 3 === i2 ? 15 : 7; 1 < i2 && t2 < s2; ) n2 = n2 << 6 | 63 & e3[t2++], i2--;
            1 < i2 ? a2[r2++] = 65533 : n2 < 65536 ? a2[r2++] = n2 : (n2 -= 65536, a2[r2++] = 55296 | n2 >> 10 & 1023, a2[r2++] = 56320 | 1023 & n2);
          }
          return a2.length !== r2 && (a2.subarray ? a2 = a2.subarray(0, r2) : a2.length = r2), o.applyFromCharCode(a2);
        }(e2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2));
      }, o.inherits(a, n), a.prototype.processChunk = function(e2) {
        var t2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2.data);
        if (this.leftOver && this.leftOver.length) {
          if (h.uint8array) {
            var r2 = t2;
            (t2 = new Uint8Array(r2.length + this.leftOver.length)).set(this.leftOver, 0), t2.set(r2, this.leftOver.length);
          } else t2 = this.leftOver.concat(t2);
          this.leftOver = null;
        }
        var n2 = function(e3, t3) {
          var r3;
          for ((t3 = t3 || e3.length) > e3.length && (t3 = e3.length), r3 = t3 - 1; 0 <= r3 && 128 == (192 & e3[r3]); ) r3--;
          return r3 < 0 ? t3 : 0 === r3 ? t3 : r3 + u[e3[r3]] > t3 ? r3 : t3;
        }(t2), i2 = t2;
        n2 !== t2.length && (h.uint8array ? (i2 = t2.subarray(0, n2), this.leftOver = t2.subarray(n2, t2.length)) : (i2 = t2.slice(0, n2), this.leftOver = t2.slice(n2, t2.length))), this.push({ data: s.utf8decode(i2), meta: e2.meta });
      }, a.prototype.flush = function() {
        this.leftOver && this.leftOver.length && (this.push({ data: s.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
      }, s.Utf8DecodeWorker = a, o.inherits(l, n), l.prototype.processChunk = function(e2) {
        this.push({ data: s.utf8encode(e2.data), meta: e2.meta });
      }, s.Utf8EncodeWorker = l;
    }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(e, t, a) {
      var o = e("./support"), h = e("./base64"), r = e("./nodejsUtils"), u = e("./external");
      function n(e2) {
        return e2;
      }
      function l(e2, t2) {
        for (var r2 = 0; r2 < e2.length; ++r2) t2[r2] = 255 & e2.charCodeAt(r2);
        return t2;
      }
      e("setimmediate"), a.newBlob = function(t2, r2) {
        a.checkSupport("blob");
        try {
          return new Blob([t2], { type: r2 });
        } catch (e2) {
          try {
            var n2 = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
            return n2.append(t2), n2.getBlob(r2);
          } catch (e3) {
            throw new Error("Bug : can't construct the Blob.");
          }
        }
      };
      var i = { stringifyByChunk: function(e2, t2, r2) {
        var n2 = [], i2 = 0, s2 = e2.length;
        if (s2 <= r2) return String.fromCharCode.apply(null, e2);
        for (; i2 < s2; ) "array" === t2 || "nodebuffer" === t2 ? n2.push(String.fromCharCode.apply(null, e2.slice(i2, Math.min(i2 + r2, s2)))) : n2.push(String.fromCharCode.apply(null, e2.subarray(i2, Math.min(i2 + r2, s2)))), i2 += r2;
        return n2.join("");
      }, stringifyByChar: function(e2) {
        for (var t2 = "", r2 = 0; r2 < e2.length; r2++) t2 += String.fromCharCode(e2[r2]);
        return t2;
      }, applyCanBeUsed: { uint8array: function() {
        try {
          return o.uint8array && 1 === String.fromCharCode.apply(null, new Uint8Array(1)).length;
        } catch (e2) {
          return false;
        }
      }(), nodebuffer: function() {
        try {
          return o.nodebuffer && 1 === String.fromCharCode.apply(null, r.allocBuffer(1)).length;
        } catch (e2) {
          return false;
        }
      }() } };
      function s(e2) {
        var t2 = 65536, r2 = a.getTypeOf(e2), n2 = true;
        if ("uint8array" === r2 ? n2 = i.applyCanBeUsed.uint8array : "nodebuffer" === r2 && (n2 = i.applyCanBeUsed.nodebuffer), n2) for (; 1 < t2; ) try {
          return i.stringifyByChunk(e2, r2, t2);
        } catch (e3) {
          t2 = Math.floor(t2 / 2);
        }
        return i.stringifyByChar(e2);
      }
      function f(e2, t2) {
        for (var r2 = 0; r2 < e2.length; r2++) t2[r2] = e2[r2];
        return t2;
      }
      a.applyFromCharCode = s;
      var c = {};
      c.string = { string: n, array: function(e2) {
        return l(e2, new Array(e2.length));
      }, arraybuffer: function(e2) {
        return c.string.uint8array(e2).buffer;
      }, uint8array: function(e2) {
        return l(e2, new Uint8Array(e2.length));
      }, nodebuffer: function(e2) {
        return l(e2, r.allocBuffer(e2.length));
      } }, c.array = { string: s, array: n, arraybuffer: function(e2) {
        return new Uint8Array(e2).buffer;
      }, uint8array: function(e2) {
        return new Uint8Array(e2);
      }, nodebuffer: function(e2) {
        return r.newBufferFrom(e2);
      } }, c.arraybuffer = { string: function(e2) {
        return s(new Uint8Array(e2));
      }, array: function(e2) {
        return f(new Uint8Array(e2), new Array(e2.byteLength));
      }, arraybuffer: n, uint8array: function(e2) {
        return new Uint8Array(e2);
      }, nodebuffer: function(e2) {
        return r.newBufferFrom(new Uint8Array(e2));
      } }, c.uint8array = { string: s, array: function(e2) {
        return f(e2, new Array(e2.length));
      }, arraybuffer: function(e2) {
        return e2.buffer;
      }, uint8array: n, nodebuffer: function(e2) {
        return r.newBufferFrom(e2);
      } }, c.nodebuffer = { string: s, array: function(e2) {
        return f(e2, new Array(e2.length));
      }, arraybuffer: function(e2) {
        return c.nodebuffer.uint8array(e2).buffer;
      }, uint8array: function(e2) {
        return f(e2, new Uint8Array(e2.length));
      }, nodebuffer: n }, a.transformTo = function(e2, t2) {
        if (t2 = t2 || "", !e2) return t2;
        a.checkSupport(e2);
        var r2 = a.getTypeOf(t2);
        return c[r2][e2](t2);
      }, a.resolve = function(e2) {
        for (var t2 = e2.split("/"), r2 = [], n2 = 0; n2 < t2.length; n2++) {
          var i2 = t2[n2];
          "." === i2 || "" === i2 && 0 !== n2 && n2 !== t2.length - 1 || (".." === i2 ? r2.pop() : r2.push(i2));
        }
        return r2.join("/");
      }, a.getTypeOf = function(e2) {
        return "string" == typeof e2 ? "string" : "[object Array]" === Object.prototype.toString.call(e2) ? "array" : o.nodebuffer && r.isBuffer(e2) ? "nodebuffer" : o.uint8array && e2 instanceof Uint8Array ? "uint8array" : o.arraybuffer && e2 instanceof ArrayBuffer ? "arraybuffer" : void 0;
      }, a.checkSupport = function(e2) {
        if (!o[e2.toLowerCase()]) throw new Error(e2 + " is not supported by this platform");
      }, a.MAX_VALUE_16BITS = 65535, a.MAX_VALUE_32BITS = -1, a.pretty = function(e2) {
        var t2, r2, n2 = "";
        for (r2 = 0; r2 < (e2 || "").length; r2++) n2 += "\\x" + ((t2 = e2.charCodeAt(r2)) < 16 ? "0" : "") + t2.toString(16).toUpperCase();
        return n2;
      }, a.delay = function(e2, t2, r2) {
        setImmediate(function() {
          e2.apply(r2 || null, t2 || []);
        });
      }, a.inherits = function(e2, t2) {
        function r2() {
        }
        r2.prototype = t2.prototype, e2.prototype = new r2();
      }, a.extend = function() {
        var e2, t2, r2 = {};
        for (e2 = 0; e2 < arguments.length; e2++) for (t2 in arguments[e2]) Object.prototype.hasOwnProperty.call(arguments[e2], t2) && void 0 === r2[t2] && (r2[t2] = arguments[e2][t2]);
        return r2;
      }, a.prepareContent = function(r2, e2, n2, i2, s2) {
        return u.Promise.resolve(e2).then(function(n3) {
          return o.blob && (n3 instanceof Blob || -1 !== ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(n3))) && "undefined" != typeof FileReader ? new u.Promise(function(t2, r3) {
            var e3 = new FileReader();
            e3.onload = function(e4) {
              t2(e4.target.result);
            }, e3.onerror = function(e4) {
              r3(e4.target.error);
            }, e3.readAsArrayBuffer(n3);
          }) : n3;
        }).then(function(e3) {
          var t2 = a.getTypeOf(e3);
          return t2 ? ("arraybuffer" === t2 ? e3 = a.transformTo("uint8array", e3) : "string" === t2 && (s2 ? e3 = h.decode(e3) : n2 && true !== i2 && (e3 = function(e4) {
            return l(e4, o.uint8array ? new Uint8Array(e4.length) : new Array(e4.length));
          }(e3))), e3) : u.Promise.reject(new Error("Can't read the data of '" + r2 + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
        });
      };
    }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(e, t, r) {
      var n = e("./reader/readerFor"), i = e("./utils"), s = e("./signature"), a = e("./zipEntry"), o = e("./support");
      function h(e2) {
        this.files = [], this.loadOptions = e2;
      }
      h.prototype = { checkSignature: function(e2) {
        if (!this.reader.readAndCheckSignature(e2)) {
          this.reader.index -= 4;
          var t2 = this.reader.readString(4);
          throw new Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t2) + ", expected " + i.pretty(e2) + ")");
        }
      }, isSignature: function(e2, t2) {
        var r2 = this.reader.index;
        this.reader.setIndex(e2);
        var n2 = this.reader.readString(4) === t2;
        return this.reader.setIndex(r2), n2;
      }, readBlockEndOfCentral: function() {
        this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
        var e2 = this.reader.readData(this.zipCommentLength), t2 = o.uint8array ? "uint8array" : "array", r2 = i.transformTo(t2, e2);
        this.zipComment = this.loadOptions.decodeFileName(r2);
      }, readBlockZip64EndOfCentral: function() {
        this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
        for (var e2, t2, r2, n2 = this.zip64EndOfCentralSize - 44; 0 < n2; ) e2 = this.reader.readInt(2), t2 = this.reader.readInt(4), r2 = this.reader.readData(t2), this.zip64ExtensibleData[e2] = { id: e2, length: t2, value: r2 };
      }, readBlockZip64EndOfCentralLocator: function() {
        if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw new Error("Multi-volumes zip are not supported");
      }, readLocalFiles: function() {
        var e2, t2;
        for (e2 = 0; e2 < this.files.length; e2++) t2 = this.files[e2], this.reader.setIndex(t2.localHeaderOffset), this.checkSignature(s.LOCAL_FILE_HEADER), t2.readLocalPart(this.reader), t2.handleUTF8(), t2.processAttributes();
      }, readCentralDir: function() {
        var e2;
        for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER); ) (e2 = new a({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e2);
        if (this.centralDirRecords !== this.files.length && 0 !== this.centralDirRecords && 0 === this.files.length) throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
      }, readEndOfCentral: function() {
        var e2 = this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);
        if (e2 < 0) throw !this.isSignature(0, s.LOCAL_FILE_HEADER) ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
        this.reader.setIndex(e2);
        var t2 = e2;
        if (this.checkSignature(s.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
          if (this.zip64 = true, (e2 = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
          if (this.reader.setIndex(e2), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, s.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
          this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
        }
        var r2 = this.centralDirOffset + this.centralDirSize;
        this.zip64 && (r2 += 20, r2 += 12 + this.zip64EndOfCentralSize);
        var n2 = t2 - r2;
        if (0 < n2) this.isSignature(t2, s.CENTRAL_FILE_HEADER) || (this.reader.zero = n2);
        else if (n2 < 0) throw new Error("Corrupted zip: missing " + Math.abs(n2) + " bytes.");
      }, prepareReader: function(e2) {
        this.reader = n(e2);
      }, load: function(e2) {
        this.prepareReader(e2), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
      } }, t.exports = h;
    }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(e, t, r) {
      var n = e("./reader/readerFor"), s = e("./utils"), i = e("./compressedObject"), a = e("./crc32"), o = e("./utf8"), h = e("./compressions"), u = e("./support");
      function l(e2, t2) {
        this.options = e2, this.loadOptions = t2;
      }
      l.prototype = { isEncrypted: function() {
        return 1 == (1 & this.bitFlag);
      }, useUTF8: function() {
        return 2048 == (2048 & this.bitFlag);
      }, readLocalPart: function(e2) {
        var t2, r2;
        if (e2.skip(22), this.fileNameLength = e2.readInt(2), r2 = e2.readInt(2), this.fileName = e2.readData(this.fileNameLength), e2.skip(r2), -1 === this.compressedSize || -1 === this.uncompressedSize) throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
        if (null === (t2 = function(e3) {
          for (var t3 in h) if (Object.prototype.hasOwnProperty.call(h, t3) && h[t3].magic === e3) return h[t3];
          return null;
        }(this.compressionMethod))) throw new Error("Corrupted zip : compression " + s.pretty(this.compressionMethod) + " unknown (inner file : " + s.transformTo("string", this.fileName) + ")");
        this.decompressed = new i(this.compressedSize, this.uncompressedSize, this.crc32, t2, e2.readData(this.compressedSize));
      }, readCentralPart: function(e2) {
        this.versionMadeBy = e2.readInt(2), e2.skip(2), this.bitFlag = e2.readInt(2), this.compressionMethod = e2.readString(2), this.date = e2.readDate(), this.crc32 = e2.readInt(4), this.compressedSize = e2.readInt(4), this.uncompressedSize = e2.readInt(4);
        var t2 = e2.readInt(2);
        if (this.extraFieldsLength = e2.readInt(2), this.fileCommentLength = e2.readInt(2), this.diskNumberStart = e2.readInt(2), this.internalFileAttributes = e2.readInt(2), this.externalFileAttributes = e2.readInt(4), this.localHeaderOffset = e2.readInt(4), this.isEncrypted()) throw new Error("Encrypted zip are not supported");
        e2.skip(t2), this.readExtraFields(e2), this.parseZIP64ExtraField(e2), this.fileComment = e2.readData(this.fileCommentLength);
      }, processAttributes: function() {
        this.unixPermissions = null, this.dosPermissions = null;
        var e2 = this.versionMadeBy >> 8;
        this.dir = !!(16 & this.externalFileAttributes), 0 == e2 && (this.dosPermissions = 63 & this.externalFileAttributes), 3 == e2 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || "/" !== this.fileNameStr.slice(-1) || (this.dir = true);
      }, parseZIP64ExtraField: function() {
        if (this.extraFields[1]) {
          var e2 = n(this.extraFields[1].value);
          this.uncompressedSize === s.MAX_VALUE_32BITS && (this.uncompressedSize = e2.readInt(8)), this.compressedSize === s.MAX_VALUE_32BITS && (this.compressedSize = e2.readInt(8)), this.localHeaderOffset === s.MAX_VALUE_32BITS && (this.localHeaderOffset = e2.readInt(8)), this.diskNumberStart === s.MAX_VALUE_32BITS && (this.diskNumberStart = e2.readInt(4));
        }
      }, readExtraFields: function(e2) {
        var t2, r2, n2, i2 = e2.index + this.extraFieldsLength;
        for (this.extraFields || (this.extraFields = {}); e2.index + 4 < i2; ) t2 = e2.readInt(2), r2 = e2.readInt(2), n2 = e2.readData(r2), this.extraFields[t2] = { id: t2, length: r2, value: n2 };
        e2.setIndex(i2);
      }, handleUTF8: function() {
        var e2 = u.uint8array ? "uint8array" : "array";
        if (this.useUTF8()) this.fileNameStr = o.utf8decode(this.fileName), this.fileCommentStr = o.utf8decode(this.fileComment);
        else {
          var t2 = this.findExtraFieldUnicodePath();
          if (null !== t2) this.fileNameStr = t2;
          else {
            var r2 = s.transformTo(e2, this.fileName);
            this.fileNameStr = this.loadOptions.decodeFileName(r2);
          }
          var n2 = this.findExtraFieldUnicodeComment();
          if (null !== n2) this.fileCommentStr = n2;
          else {
            var i2 = s.transformTo(e2, this.fileComment);
            this.fileCommentStr = this.loadOptions.decodeFileName(i2);
          }
        }
      }, findExtraFieldUnicodePath: function() {
        var e2 = this.extraFields[28789];
        if (e2) {
          var t2 = n(e2.value);
          return 1 !== t2.readInt(1) ? null : a(this.fileName) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
        }
        return null;
      }, findExtraFieldUnicodeComment: function() {
        var e2 = this.extraFields[25461];
        if (e2) {
          var t2 = n(e2.value);
          return 1 !== t2.readInt(1) ? null : a(this.fileComment) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
        }
        return null;
      } }, t.exports = l;
    }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(e, t, r) {
      function n(e2, t2, r2) {
        this.name = e2, this.dir = r2.dir, this.date = r2.date, this.comment = r2.comment, this.unixPermissions = r2.unixPermissions, this.dosPermissions = r2.dosPermissions, this._data = t2, this._dataBinary = r2.binary, this.options = { compression: r2.compression, compressionOptions: r2.compressionOptions };
      }
      var s = e("./stream/StreamHelper"), i = e("./stream/DataWorker"), a = e("./utf8"), o = e("./compressedObject"), h = e("./stream/GenericWorker");
      n.prototype = { internalStream: function(e2) {
        var t2 = null, r2 = "string";
        try {
          if (!e2) throw new Error("No output type specified.");
          var n2 = "string" === (r2 = e2.toLowerCase()) || "text" === r2;
          "binarystring" !== r2 && "text" !== r2 || (r2 = "string"), t2 = this._decompressWorker();
          var i2 = !this._dataBinary;
          i2 && !n2 && (t2 = t2.pipe(new a.Utf8EncodeWorker())), !i2 && n2 && (t2 = t2.pipe(new a.Utf8DecodeWorker()));
        } catch (e3) {
          (t2 = new h("error")).error(e3);
        }
        return new s(t2, r2, "");
      }, async: function(e2, t2) {
        return this.internalStream(e2).accumulate(t2);
      }, nodeStream: function(e2, t2) {
        return this.internalStream(e2 || "nodebuffer").toNodejsStream(t2);
      }, _compressWorker: function(e2, t2) {
        if (this._data instanceof o && this._data.compression.magic === e2.magic) return this._data.getCompressedWorker();
        var r2 = this._decompressWorker();
        return this._dataBinary || (r2 = r2.pipe(new a.Utf8EncodeWorker())), o.createWorkerFrom(r2, e2, t2);
      }, _decompressWorker: function() {
        return this._data instanceof o ? this._data.getContentWorker() : this._data instanceof h ? this._data : new i(this._data);
      } };
      for (var u = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], l = function() {
        throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
      }, f = 0; f < u.length; f++) n.prototype[u[f]] = l;
      t.exports = n;
    }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(e, l, t) {
      (function(t2) {
        var r, n, e2 = t2.MutationObserver || t2.WebKitMutationObserver;
        if (e2) {
          var i = 0, s = new e2(u), a = t2.document.createTextNode("");
          s.observe(a, { characterData: true }), r = function() {
            a.data = i = ++i % 2;
          };
        } else if (t2.setImmediate || void 0 === t2.MessageChannel) r = "document" in t2 && "onreadystatechange" in t2.document.createElement("script") ? function() {
          var e3 = t2.document.createElement("script");
          e3.onreadystatechange = function() {
            u(), e3.onreadystatechange = null, e3.parentNode.removeChild(e3), e3 = null;
          }, t2.document.documentElement.appendChild(e3);
        } : function() {
          setTimeout(u, 0);
        };
        else {
          var o = new t2.MessageChannel();
          o.port1.onmessage = u, r = function() {
            o.port2.postMessage(0);
          };
        }
        var h = [];
        function u() {
          var e3, t3;
          n = true;
          for (var r2 = h.length; r2; ) {
            for (t3 = h, h = [], e3 = -1; ++e3 < r2; ) t3[e3]();
            r2 = h.length;
          }
          n = false;
        }
        l.exports = function(e3) {
          1 !== h.push(e3) || n || r();
        };
      }).call(this, "undefined" != typeof commonjsGlobal ? commonjsGlobal : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
    }, {}], 37: [function(e, t, r) {
      var i = e("immediate");
      function u() {
      }
      var l = {}, s = ["REJECTED"], a = ["FULFILLED"], n = ["PENDING"];
      function o(e2) {
        if ("function" != typeof e2) throw new TypeError("resolver must be a function");
        this.state = n, this.queue = [], this.outcome = void 0, e2 !== u && d(this, e2);
      }
      function h(e2, t2, r2) {
        this.promise = e2, "function" == typeof t2 && (this.onFulfilled = t2, this.callFulfilled = this.otherCallFulfilled), "function" == typeof r2 && (this.onRejected = r2, this.callRejected = this.otherCallRejected);
      }
      function f(t2, r2, n2) {
        i(function() {
          var e2;
          try {
            e2 = r2(n2);
          } catch (e3) {
            return l.reject(t2, e3);
          }
          e2 === t2 ? l.reject(t2, new TypeError("Cannot resolve promise with itself")) : l.resolve(t2, e2);
        });
      }
      function c(e2) {
        var t2 = e2 && e2.then;
        if (e2 && ("object" == typeof e2 || "function" == typeof e2) && "function" == typeof t2) return function() {
          t2.apply(e2, arguments);
        };
      }
      function d(t2, e2) {
        var r2 = false;
        function n2(e3) {
          r2 || (r2 = true, l.reject(t2, e3));
        }
        function i2(e3) {
          r2 || (r2 = true, l.resolve(t2, e3));
        }
        var s2 = p(function() {
          e2(i2, n2);
        });
        "error" === s2.status && n2(s2.value);
      }
      function p(e2, t2) {
        var r2 = {};
        try {
          r2.value = e2(t2), r2.status = "success";
        } catch (e3) {
          r2.status = "error", r2.value = e3;
        }
        return r2;
      }
      (t.exports = o).prototype.finally = function(t2) {
        if ("function" != typeof t2) return this;
        var r2 = this.constructor;
        return this.then(function(e2) {
          return r2.resolve(t2()).then(function() {
            return e2;
          });
        }, function(e2) {
          return r2.resolve(t2()).then(function() {
            throw e2;
          });
        });
      }, o.prototype.catch = function(e2) {
        return this.then(null, e2);
      }, o.prototype.then = function(e2, t2) {
        if ("function" != typeof e2 && this.state === a || "function" != typeof t2 && this.state === s) return this;
        var r2 = new this.constructor(u);
        this.state !== n ? f(r2, this.state === a ? e2 : t2, this.outcome) : this.queue.push(new h(r2, e2, t2));
        return r2;
      }, h.prototype.callFulfilled = function(e2) {
        l.resolve(this.promise, e2);
      }, h.prototype.otherCallFulfilled = function(e2) {
        f(this.promise, this.onFulfilled, e2);
      }, h.prototype.callRejected = function(e2) {
        l.reject(this.promise, e2);
      }, h.prototype.otherCallRejected = function(e2) {
        f(this.promise, this.onRejected, e2);
      }, l.resolve = function(e2, t2) {
        var r2 = p(c, t2);
        if ("error" === r2.status) return l.reject(e2, r2.value);
        var n2 = r2.value;
        if (n2) d(e2, n2);
        else {
          e2.state = a, e2.outcome = t2;
          for (var i2 = -1, s2 = e2.queue.length; ++i2 < s2; ) e2.queue[i2].callFulfilled(t2);
        }
        return e2;
      }, l.reject = function(e2, t2) {
        e2.state = s, e2.outcome = t2;
        for (var r2 = -1, n2 = e2.queue.length; ++r2 < n2; ) e2.queue[r2].callRejected(t2);
        return e2;
      }, o.resolve = function(e2) {
        if (e2 instanceof this) return e2;
        return l.resolve(new this(u), e2);
      }, o.reject = function(e2) {
        var t2 = new this(u);
        return l.reject(t2, e2);
      }, o.all = function(e2) {
        var r2 = this;
        if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
        var n2 = e2.length, i2 = false;
        if (!n2) return this.resolve([]);
        var s2 = new Array(n2), a2 = 0, t2 = -1, o2 = new this(u);
        for (; ++t2 < n2; ) h2(e2[t2], t2);
        return o2;
        function h2(e3, t3) {
          r2.resolve(e3).then(function(e4) {
            s2[t3] = e4, ++a2 !== n2 || i2 || (i2 = true, l.resolve(o2, s2));
          }, function(e4) {
            i2 || (i2 = true, l.reject(o2, e4));
          });
        }
      }, o.race = function(e2) {
        var t2 = this;
        if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
        var r2 = e2.length, n2 = false;
        if (!r2) return this.resolve([]);
        var i2 = -1, s2 = new this(u);
        for (; ++i2 < r2; ) a2 = e2[i2], t2.resolve(a2).then(function(e3) {
          n2 || (n2 = true, l.resolve(s2, e3));
        }, function(e3) {
          n2 || (n2 = true, l.reject(s2, e3));
        });
        var a2;
        return s2;
      };
    }, { immediate: 36 }], 38: [function(e, t, r) {
      var n = {};
      (0, e("./lib/utils/common").assign)(n, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = n;
    }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(e, t, r) {
      var a = e("./zlib/deflate"), o = e("./utils/common"), h = e("./utils/strings"), i = e("./zlib/messages"), s = e("./zlib/zstream"), u = Object.prototype.toString, l = 0, f = -1, c = 0, d = 8;
      function p(e2) {
        if (!(this instanceof p)) return new p(e2);
        this.options = o.assign({ level: f, method: d, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: c, to: "" }, e2 || {});
        var t2 = this.options;
        t2.raw && 0 < t2.windowBits ? t2.windowBits = -t2.windowBits : t2.gzip && 0 < t2.windowBits && t2.windowBits < 16 && (t2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new s(), this.strm.avail_out = 0;
        var r2 = a.deflateInit2(this.strm, t2.level, t2.method, t2.windowBits, t2.memLevel, t2.strategy);
        if (r2 !== l) throw new Error(i[r2]);
        if (t2.header && a.deflateSetHeader(this.strm, t2.header), t2.dictionary) {
          var n2;
          if (n2 = "string" == typeof t2.dictionary ? h.string2buf(t2.dictionary) : "[object ArrayBuffer]" === u.call(t2.dictionary) ? new Uint8Array(t2.dictionary) : t2.dictionary, (r2 = a.deflateSetDictionary(this.strm, n2)) !== l) throw new Error(i[r2]);
          this._dict_set = true;
        }
      }
      function n(e2, t2) {
        var r2 = new p(t2);
        if (r2.push(e2, true), r2.err) throw r2.msg || i[r2.err];
        return r2.result;
      }
      p.prototype.push = function(e2, t2) {
        var r2, n2, i2 = this.strm, s2 = this.options.chunkSize;
        if (this.ended) return false;
        n2 = t2 === ~~t2 ? t2 : true === t2 ? 4 : 0, "string" == typeof e2 ? i2.input = h.string2buf(e2) : "[object ArrayBuffer]" === u.call(e2) ? i2.input = new Uint8Array(e2) : i2.input = e2, i2.next_in = 0, i2.avail_in = i2.input.length;
        do {
          if (0 === i2.avail_out && (i2.output = new o.Buf8(s2), i2.next_out = 0, i2.avail_out = s2), 1 !== (r2 = a.deflate(i2, n2)) && r2 !== l) return this.onEnd(r2), !(this.ended = true);
          0 !== i2.avail_out && (0 !== i2.avail_in || 4 !== n2 && 2 !== n2) || ("string" === this.options.to ? this.onData(h.buf2binstring(o.shrinkBuf(i2.output, i2.next_out))) : this.onData(o.shrinkBuf(i2.output, i2.next_out)));
        } while ((0 < i2.avail_in || 0 === i2.avail_out) && 1 !== r2);
        return 4 === n2 ? (r2 = a.deflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === l) : 2 !== n2 || (this.onEnd(l), !(i2.avail_out = 0));
      }, p.prototype.onData = function(e2) {
        this.chunks.push(e2);
      }, p.prototype.onEnd = function(e2) {
        e2 === l && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = o.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
      }, r.Deflate = p, r.deflate = n, r.deflateRaw = function(e2, t2) {
        return (t2 = t2 || {}).raw = true, n(e2, t2);
      }, r.gzip = function(e2, t2) {
        return (t2 = t2 || {}).gzip = true, n(e2, t2);
      };
    }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(e, t, r) {
      var c = e("./zlib/inflate"), d = e("./utils/common"), p = e("./utils/strings"), m = e("./zlib/constants"), n = e("./zlib/messages"), i = e("./zlib/zstream"), s = e("./zlib/gzheader"), _ = Object.prototype.toString;
      function a(e2) {
        if (!(this instanceof a)) return new a(e2);
        this.options = d.assign({ chunkSize: 16384, windowBits: 0, to: "" }, e2 || {});
        var t2 = this.options;
        t2.raw && 0 <= t2.windowBits && t2.windowBits < 16 && (t2.windowBits = -t2.windowBits, 0 === t2.windowBits && (t2.windowBits = -15)), !(0 <= t2.windowBits && t2.windowBits < 16) || e2 && e2.windowBits || (t2.windowBits += 32), 15 < t2.windowBits && t2.windowBits < 48 && 0 == (15 & t2.windowBits) && (t2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new i(), this.strm.avail_out = 0;
        var r2 = c.inflateInit2(this.strm, t2.windowBits);
        if (r2 !== m.Z_OK) throw new Error(n[r2]);
        this.header = new s(), c.inflateGetHeader(this.strm, this.header);
      }
      function o(e2, t2) {
        var r2 = new a(t2);
        if (r2.push(e2, true), r2.err) throw r2.msg || n[r2.err];
        return r2.result;
      }
      a.prototype.push = function(e2, t2) {
        var r2, n2, i2, s2, a2, o2, h = this.strm, u = this.options.chunkSize, l = this.options.dictionary, f = false;
        if (this.ended) return false;
        n2 = t2 === ~~t2 ? t2 : true === t2 ? m.Z_FINISH : m.Z_NO_FLUSH, "string" == typeof e2 ? h.input = p.binstring2buf(e2) : "[object ArrayBuffer]" === _.call(e2) ? h.input = new Uint8Array(e2) : h.input = e2, h.next_in = 0, h.avail_in = h.input.length;
        do {
          if (0 === h.avail_out && (h.output = new d.Buf8(u), h.next_out = 0, h.avail_out = u), (r2 = c.inflate(h, m.Z_NO_FLUSH)) === m.Z_NEED_DICT && l && (o2 = "string" == typeof l ? p.string2buf(l) : "[object ArrayBuffer]" === _.call(l) ? new Uint8Array(l) : l, r2 = c.inflateSetDictionary(this.strm, o2)), r2 === m.Z_BUF_ERROR && true === f && (r2 = m.Z_OK, f = false), r2 !== m.Z_STREAM_END && r2 !== m.Z_OK) return this.onEnd(r2), !(this.ended = true);
          h.next_out && (0 !== h.avail_out && r2 !== m.Z_STREAM_END && (0 !== h.avail_in || n2 !== m.Z_FINISH && n2 !== m.Z_SYNC_FLUSH) || ("string" === this.options.to ? (i2 = p.utf8border(h.output, h.next_out), s2 = h.next_out - i2, a2 = p.buf2string(h.output, i2), h.next_out = s2, h.avail_out = u - s2, s2 && d.arraySet(h.output, h.output, i2, s2, 0), this.onData(a2)) : this.onData(d.shrinkBuf(h.output, h.next_out)))), 0 === h.avail_in && 0 === h.avail_out && (f = true);
        } while ((0 < h.avail_in || 0 === h.avail_out) && r2 !== m.Z_STREAM_END);
        return r2 === m.Z_STREAM_END && (n2 = m.Z_FINISH), n2 === m.Z_FINISH ? (r2 = c.inflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === m.Z_OK) : n2 !== m.Z_SYNC_FLUSH || (this.onEnd(m.Z_OK), !(h.avail_out = 0));
      }, a.prototype.onData = function(e2) {
        this.chunks.push(e2);
      }, a.prototype.onEnd = function(e2) {
        e2 === m.Z_OK && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = d.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
      }, r.Inflate = a, r.inflate = o, r.inflateRaw = function(e2, t2) {
        return (t2 = t2 || {}).raw = true, o(e2, t2);
      }, r.ungzip = o;
    }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(e, t, r) {
      var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
      r.assign = function(e2) {
        for (var t2 = Array.prototype.slice.call(arguments, 1); t2.length; ) {
          var r2 = t2.shift();
          if (r2) {
            if ("object" != typeof r2) throw new TypeError(r2 + "must be non-object");
            for (var n2 in r2) r2.hasOwnProperty(n2) && (e2[n2] = r2[n2]);
          }
        }
        return e2;
      }, r.shrinkBuf = function(e2, t2) {
        return e2.length === t2 ? e2 : e2.subarray ? e2.subarray(0, t2) : (e2.length = t2, e2);
      };
      var i = { arraySet: function(e2, t2, r2, n2, i2) {
        if (t2.subarray && e2.subarray) e2.set(t2.subarray(r2, r2 + n2), i2);
        else for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
      }, flattenChunks: function(e2) {
        var t2, r2, n2, i2, s2, a;
        for (t2 = n2 = 0, r2 = e2.length; t2 < r2; t2++) n2 += e2[t2].length;
        for (a = new Uint8Array(n2), t2 = i2 = 0, r2 = e2.length; t2 < r2; t2++) s2 = e2[t2], a.set(s2, i2), i2 += s2.length;
        return a;
      } }, s = { arraySet: function(e2, t2, r2, n2, i2) {
        for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
      }, flattenChunks: function(e2) {
        return [].concat.apply([], e2);
      } };
      r.setTyped = function(e2) {
        e2 ? (r.Buf8 = Uint8Array, r.Buf16 = Uint16Array, r.Buf32 = Int32Array, r.assign(r, i)) : (r.Buf8 = Array, r.Buf16 = Array, r.Buf32 = Array, r.assign(r, s));
      }, r.setTyped(n);
    }, {}], 42: [function(e, t, r) {
      var h = e("./common"), i = true, s = true;
      try {
        String.fromCharCode.apply(null, [0]);
      } catch (e2) {
        i = false;
      }
      try {
        String.fromCharCode.apply(null, new Uint8Array(1));
      } catch (e2) {
        s = false;
      }
      for (var u = new h.Buf8(256), n = 0; n < 256; n++) u[n] = 252 <= n ? 6 : 248 <= n ? 5 : 240 <= n ? 4 : 224 <= n ? 3 : 192 <= n ? 2 : 1;
      function l(e2, t2) {
        if (t2 < 65537 && (e2.subarray && s || !e2.subarray && i)) return String.fromCharCode.apply(null, h.shrinkBuf(e2, t2));
        for (var r2 = "", n2 = 0; n2 < t2; n2++) r2 += String.fromCharCode(e2[n2]);
        return r2;
      }
      u[254] = u[254] = 1, r.string2buf = function(e2) {
        var t2, r2, n2, i2, s2, a = e2.length, o = 0;
        for (i2 = 0; i2 < a; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
        for (t2 = new h.Buf8(o), i2 = s2 = 0; s2 < o; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
        return t2;
      }, r.buf2binstring = function(e2) {
        return l(e2, e2.length);
      }, r.binstring2buf = function(e2) {
        for (var t2 = new h.Buf8(e2.length), r2 = 0, n2 = t2.length; r2 < n2; r2++) t2[r2] = e2.charCodeAt(r2);
        return t2;
      }, r.buf2string = function(e2, t2) {
        var r2, n2, i2, s2, a = t2 || e2.length, o = new Array(2 * a);
        for (r2 = n2 = 0; r2 < a; ) if ((i2 = e2[r2++]) < 128) o[n2++] = i2;
        else if (4 < (s2 = u[i2])) o[n2++] = 65533, r2 += s2 - 1;
        else {
          for (i2 &= 2 === s2 ? 31 : 3 === s2 ? 15 : 7; 1 < s2 && r2 < a; ) i2 = i2 << 6 | 63 & e2[r2++], s2--;
          1 < s2 ? o[n2++] = 65533 : i2 < 65536 ? o[n2++] = i2 : (i2 -= 65536, o[n2++] = 55296 | i2 >> 10 & 1023, o[n2++] = 56320 | 1023 & i2);
        }
        return l(o, n2);
      }, r.utf8border = function(e2, t2) {
        var r2;
        for ((t2 = t2 || e2.length) > e2.length && (t2 = e2.length), r2 = t2 - 1; 0 <= r2 && 128 == (192 & e2[r2]); ) r2--;
        return r2 < 0 ? t2 : 0 === r2 ? t2 : r2 + u[e2[r2]] > t2 ? r2 : t2;
      };
    }, { "./common": 41 }], 43: [function(e, t, r) {
      t.exports = function(e2, t2, r2, n) {
        for (var i = 65535 & e2 | 0, s = e2 >>> 16 & 65535 | 0, a = 0; 0 !== r2; ) {
          for (r2 -= a = 2e3 < r2 ? 2e3 : r2; s = s + (i = i + t2[n++] | 0) | 0, --a; ) ;
          i %= 65521, s %= 65521;
        }
        return i | s << 16 | 0;
      };
    }, {}], 44: [function(e, t, r) {
      t.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
    }, {}], 45: [function(e, t, r) {
      var o = function() {
        for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
          e2 = r2;
          for (var n = 0; n < 8; n++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
          t2[r2] = e2;
        }
        return t2;
      }();
      t.exports = function(e2, t2, r2, n) {
        var i = o, s = n + r2;
        e2 ^= -1;
        for (var a = n; a < s; a++) e2 = e2 >>> 8 ^ i[255 & (e2 ^ t2[a])];
        return -1 ^ e2;
      };
    }, {}], 46: [function(e, t, r) {
      var h, c = e("../utils/common"), u = e("./trees"), d = e("./adler32"), p = e("./crc32"), n = e("./messages"), l = 0, f = 4, m = 0, _ = -2, g = -1, b = 4, i = 2, v = 8, y = 9, s = 286, a = 30, o = 19, w = 2 * s + 1, k = 15, x = 3, S = 258, z = S + x + 1, C = 42, E = 113, A = 1, I = 2, O = 3, B = 4;
      function R(e2, t2) {
        return e2.msg = n[t2], t2;
      }
      function T(e2) {
        return (e2 << 1) - (4 < e2 ? 9 : 0);
      }
      function D(e2) {
        for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
      }
      function F(e2) {
        var t2 = e2.state, r2 = t2.pending;
        r2 > e2.avail_out && (r2 = e2.avail_out), 0 !== r2 && (c.arraySet(e2.output, t2.pending_buf, t2.pending_out, r2, e2.next_out), e2.next_out += r2, t2.pending_out += r2, e2.total_out += r2, e2.avail_out -= r2, t2.pending -= r2, 0 === t2.pending && (t2.pending_out = 0));
      }
      function N(e2, t2) {
        u._tr_flush_block(e2, 0 <= e2.block_start ? e2.block_start : -1, e2.strstart - e2.block_start, t2), e2.block_start = e2.strstart, F(e2.strm);
      }
      function U(e2, t2) {
        e2.pending_buf[e2.pending++] = t2;
      }
      function P(e2, t2) {
        e2.pending_buf[e2.pending++] = t2 >>> 8 & 255, e2.pending_buf[e2.pending++] = 255 & t2;
      }
      function L(e2, t2) {
        var r2, n2, i2 = e2.max_chain_length, s2 = e2.strstart, a2 = e2.prev_length, o2 = e2.nice_match, h2 = e2.strstart > e2.w_size - z ? e2.strstart - (e2.w_size - z) : 0, u2 = e2.window, l2 = e2.w_mask, f2 = e2.prev, c2 = e2.strstart + S, d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
        e2.prev_length >= e2.good_match && (i2 >>= 2), o2 > e2.lookahead && (o2 = e2.lookahead);
        do {
          if (u2[(r2 = t2) + a2] === p2 && u2[r2 + a2 - 1] === d2 && u2[r2] === u2[s2] && u2[++r2] === u2[s2 + 1]) {
            s2 += 2, r2++;
            do {
            } while (u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && s2 < c2);
            if (n2 = S - (c2 - s2), s2 = c2 - S, a2 < n2) {
              if (e2.match_start = t2, o2 <= (a2 = n2)) break;
              d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
            }
          }
        } while ((t2 = f2[t2 & l2]) > h2 && 0 != --i2);
        return a2 <= e2.lookahead ? a2 : e2.lookahead;
      }
      function j(e2) {
        var t2, r2, n2, i2, s2, a2, o2, h2, u2, l2, f2 = e2.w_size;
        do {
          if (i2 = e2.window_size - e2.lookahead - e2.strstart, e2.strstart >= f2 + (f2 - z)) {
            for (c.arraySet(e2.window, e2.window, f2, f2, 0), e2.match_start -= f2, e2.strstart -= f2, e2.block_start -= f2, t2 = r2 = e2.hash_size; n2 = e2.head[--t2], e2.head[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
            for (t2 = r2 = f2; n2 = e2.prev[--t2], e2.prev[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
            i2 += f2;
          }
          if (0 === e2.strm.avail_in) break;
          if (a2 = e2.strm, o2 = e2.window, h2 = e2.strstart + e2.lookahead, u2 = i2, l2 = void 0, l2 = a2.avail_in, u2 < l2 && (l2 = u2), r2 = 0 === l2 ? 0 : (a2.avail_in -= l2, c.arraySet(o2, a2.input, a2.next_in, l2, h2), 1 === a2.state.wrap ? a2.adler = d(a2.adler, o2, l2, h2) : 2 === a2.state.wrap && (a2.adler = p(a2.adler, o2, l2, h2)), a2.next_in += l2, a2.total_in += l2, l2), e2.lookahead += r2, e2.lookahead + e2.insert >= x) for (s2 = e2.strstart - e2.insert, e2.ins_h = e2.window[s2], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + 1]) & e2.hash_mask; e2.insert && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + x - 1]) & e2.hash_mask, e2.prev[s2 & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = s2, s2++, e2.insert--, !(e2.lookahead + e2.insert < x)); ) ;
        } while (e2.lookahead < z && 0 !== e2.strm.avail_in);
      }
      function Z(e2, t2) {
        for (var r2, n2; ; ) {
          if (e2.lookahead < z) {
            if (j(e2), e2.lookahead < z && t2 === l) return A;
            if (0 === e2.lookahead) break;
          }
          if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 !== r2 && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2)), e2.match_length >= x) if (n2 = u._tr_tally(e2, e2.strstart - e2.match_start, e2.match_length - x), e2.lookahead -= e2.match_length, e2.match_length <= e2.max_lazy_match && e2.lookahead >= x) {
            for (e2.match_length--; e2.strstart++, e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart, 0 != --e2.match_length; ) ;
            e2.strstart++;
          } else e2.strstart += e2.match_length, e2.match_length = 0, e2.ins_h = e2.window[e2.strstart], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + 1]) & e2.hash_mask;
          else n2 = u._tr_tally(e2, 0, e2.window[e2.strstart]), e2.lookahead--, e2.strstart++;
          if (n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
        }
        return e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
      }
      function W(e2, t2) {
        for (var r2, n2, i2; ; ) {
          if (e2.lookahead < z) {
            if (j(e2), e2.lookahead < z && t2 === l) return A;
            if (0 === e2.lookahead) break;
          }
          if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), e2.prev_length = e2.match_length, e2.prev_match = e2.match_start, e2.match_length = x - 1, 0 !== r2 && e2.prev_length < e2.max_lazy_match && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2), e2.match_length <= 5 && (1 === e2.strategy || e2.match_length === x && 4096 < e2.strstart - e2.match_start) && (e2.match_length = x - 1)), e2.prev_length >= x && e2.match_length <= e2.prev_length) {
            for (i2 = e2.strstart + e2.lookahead - x, n2 = u._tr_tally(e2, e2.strstart - 1 - e2.prev_match, e2.prev_length - x), e2.lookahead -= e2.prev_length - 1, e2.prev_length -= 2; ++e2.strstart <= i2 && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 != --e2.prev_length; ) ;
            if (e2.match_available = 0, e2.match_length = x - 1, e2.strstart++, n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
          } else if (e2.match_available) {
            if ((n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1])) && N(e2, false), e2.strstart++, e2.lookahead--, 0 === e2.strm.avail_out) return A;
          } else e2.match_available = 1, e2.strstart++, e2.lookahead--;
        }
        return e2.match_available && (n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1]), e2.match_available = 0), e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
      }
      function M(e2, t2, r2, n2, i2) {
        this.good_length = e2, this.max_lazy = t2, this.nice_length = r2, this.max_chain = n2, this.func = i2;
      }
      function H() {
        this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = v, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new c.Buf16(2 * w), this.dyn_dtree = new c.Buf16(2 * (2 * a + 1)), this.bl_tree = new c.Buf16(2 * (2 * o + 1)), D(this.dyn_ltree), D(this.dyn_dtree), D(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new c.Buf16(k + 1), this.heap = new c.Buf16(2 * s + 1), D(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new c.Buf16(2 * s + 1), D(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
      }
      function G(e2) {
        var t2;
        return e2 && e2.state ? (e2.total_in = e2.total_out = 0, e2.data_type = i, (t2 = e2.state).pending = 0, t2.pending_out = 0, t2.wrap < 0 && (t2.wrap = -t2.wrap), t2.status = t2.wrap ? C : E, e2.adler = 2 === t2.wrap ? 0 : 1, t2.last_flush = l, u._tr_init(t2), m) : R(e2, _);
      }
      function K(e2) {
        var t2 = G(e2);
        return t2 === m && function(e3) {
          e3.window_size = 2 * e3.w_size, D(e3.head), e3.max_lazy_match = h[e3.level].max_lazy, e3.good_match = h[e3.level].good_length, e3.nice_match = h[e3.level].nice_length, e3.max_chain_length = h[e3.level].max_chain, e3.strstart = 0, e3.block_start = 0, e3.lookahead = 0, e3.insert = 0, e3.match_length = e3.prev_length = x - 1, e3.match_available = 0, e3.ins_h = 0;
        }(e2.state), t2;
      }
      function Y(e2, t2, r2, n2, i2, s2) {
        if (!e2) return _;
        var a2 = 1;
        if (t2 === g && (t2 = 6), n2 < 0 ? (a2 = 0, n2 = -n2) : 15 < n2 && (a2 = 2, n2 -= 16), i2 < 1 || y < i2 || r2 !== v || n2 < 8 || 15 < n2 || t2 < 0 || 9 < t2 || s2 < 0 || b < s2) return R(e2, _);
        8 === n2 && (n2 = 9);
        var o2 = new H();
        return (e2.state = o2).strm = e2, o2.wrap = a2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + x - 1) / x), o2.window = new c.Buf8(2 * o2.w_size), o2.head = new c.Buf16(o2.hash_size), o2.prev = new c.Buf16(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new c.Buf8(o2.pending_buf_size), o2.d_buf = 1 * o2.lit_bufsize, o2.l_buf = 3 * o2.lit_bufsize, o2.level = t2, o2.strategy = s2, o2.method = r2, K(e2);
      }
      h = [new M(0, 0, 0, 0, function(e2, t2) {
        var r2 = 65535;
        for (r2 > e2.pending_buf_size - 5 && (r2 = e2.pending_buf_size - 5); ; ) {
          if (e2.lookahead <= 1) {
            if (j(e2), 0 === e2.lookahead && t2 === l) return A;
            if (0 === e2.lookahead) break;
          }
          e2.strstart += e2.lookahead, e2.lookahead = 0;
          var n2 = e2.block_start + r2;
          if ((0 === e2.strstart || e2.strstart >= n2) && (e2.lookahead = e2.strstart - n2, e2.strstart = n2, N(e2, false), 0 === e2.strm.avail_out)) return A;
          if (e2.strstart - e2.block_start >= e2.w_size - z && (N(e2, false), 0 === e2.strm.avail_out)) return A;
        }
        return e2.insert = 0, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : (e2.strstart > e2.block_start && (N(e2, false), e2.strm.avail_out), A);
      }), new M(4, 4, 8, 4, Z), new M(4, 5, 16, 8, Z), new M(4, 6, 32, 32, Z), new M(4, 4, 16, 16, W), new M(8, 16, 32, 32, W), new M(8, 16, 128, 128, W), new M(8, 32, 128, 256, W), new M(32, 128, 258, 1024, W), new M(32, 258, 258, 4096, W)], r.deflateInit = function(e2, t2) {
        return Y(e2, t2, v, 15, 8, 0);
      }, r.deflateInit2 = Y, r.deflateReset = K, r.deflateResetKeep = G, r.deflateSetHeader = function(e2, t2) {
        return e2 && e2.state ? 2 !== e2.state.wrap ? _ : (e2.state.gzhead = t2, m) : _;
      }, r.deflate = function(e2, t2) {
        var r2, n2, i2, s2;
        if (!e2 || !e2.state || 5 < t2 || t2 < 0) return e2 ? R(e2, _) : _;
        if (n2 = e2.state, !e2.output || !e2.input && 0 !== e2.avail_in || 666 === n2.status && t2 !== f) return R(e2, 0 === e2.avail_out ? -5 : _);
        if (n2.strm = e2, r2 = n2.last_flush, n2.last_flush = t2, n2.status === C) if (2 === n2.wrap) e2.adler = 0, U(n2, 31), U(n2, 139), U(n2, 8), n2.gzhead ? (U(n2, (n2.gzhead.text ? 1 : 0) + (n2.gzhead.hcrc ? 2 : 0) + (n2.gzhead.extra ? 4 : 0) + (n2.gzhead.name ? 8 : 0) + (n2.gzhead.comment ? 16 : 0)), U(n2, 255 & n2.gzhead.time), U(n2, n2.gzhead.time >> 8 & 255), U(n2, n2.gzhead.time >> 16 & 255), U(n2, n2.gzhead.time >> 24 & 255), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 255 & n2.gzhead.os), n2.gzhead.extra && n2.gzhead.extra.length && (U(n2, 255 & n2.gzhead.extra.length), U(n2, n2.gzhead.extra.length >> 8 & 255)), n2.gzhead.hcrc && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending, 0)), n2.gzindex = 0, n2.status = 69) : (U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 3), n2.status = E);
        else {
          var a2 = v + (n2.w_bits - 8 << 4) << 8;
          a2 |= (2 <= n2.strategy || n2.level < 2 ? 0 : n2.level < 6 ? 1 : 6 === n2.level ? 2 : 3) << 6, 0 !== n2.strstart && (a2 |= 32), a2 += 31 - a2 % 31, n2.status = E, P(n2, a2), 0 !== n2.strstart && (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), e2.adler = 1;
        }
        if (69 === n2.status) if (n2.gzhead.extra) {
          for (i2 = n2.pending; n2.gzindex < (65535 & n2.gzhead.extra.length) && (n2.pending !== n2.pending_buf_size || (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending !== n2.pending_buf_size)); ) U(n2, 255 & n2.gzhead.extra[n2.gzindex]), n2.gzindex++;
          n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), n2.gzindex === n2.gzhead.extra.length && (n2.gzindex = 0, n2.status = 73);
        } else n2.status = 73;
        if (73 === n2.status) if (n2.gzhead.name) {
          i2 = n2.pending;
          do {
            if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
              s2 = 1;
              break;
            }
            s2 = n2.gzindex < n2.gzhead.name.length ? 255 & n2.gzhead.name.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
          } while (0 !== s2);
          n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.gzindex = 0, n2.status = 91);
        } else n2.status = 91;
        if (91 === n2.status) if (n2.gzhead.comment) {
          i2 = n2.pending;
          do {
            if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
              s2 = 1;
              break;
            }
            s2 = n2.gzindex < n2.gzhead.comment.length ? 255 & n2.gzhead.comment.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
          } while (0 !== s2);
          n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.status = 103);
        } else n2.status = 103;
        if (103 === n2.status && (n2.gzhead.hcrc ? (n2.pending + 2 > n2.pending_buf_size && F(e2), n2.pending + 2 <= n2.pending_buf_size && (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), e2.adler = 0, n2.status = E)) : n2.status = E), 0 !== n2.pending) {
          if (F(e2), 0 === e2.avail_out) return n2.last_flush = -1, m;
        } else if (0 === e2.avail_in && T(t2) <= T(r2) && t2 !== f) return R(e2, -5);
        if (666 === n2.status && 0 !== e2.avail_in) return R(e2, -5);
        if (0 !== e2.avail_in || 0 !== n2.lookahead || t2 !== l && 666 !== n2.status) {
          var o2 = 2 === n2.strategy ? function(e3, t3) {
            for (var r3; ; ) {
              if (0 === e3.lookahead && (j(e3), 0 === e3.lookahead)) {
                if (t3 === l) return A;
                break;
              }
              if (e3.match_length = 0, r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++, r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
            }
            return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
          }(n2, t2) : 3 === n2.strategy ? function(e3, t3) {
            for (var r3, n3, i3, s3, a3 = e3.window; ; ) {
              if (e3.lookahead <= S) {
                if (j(e3), e3.lookahead <= S && t3 === l) return A;
                if (0 === e3.lookahead) break;
              }
              if (e3.match_length = 0, e3.lookahead >= x && 0 < e3.strstart && (n3 = a3[i3 = e3.strstart - 1]) === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3]) {
                s3 = e3.strstart + S;
                do {
                } while (n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && i3 < s3);
                e3.match_length = S - (s3 - i3), e3.match_length > e3.lookahead && (e3.match_length = e3.lookahead);
              }
              if (e3.match_length >= x ? (r3 = u._tr_tally(e3, 1, e3.match_length - x), e3.lookahead -= e3.match_length, e3.strstart += e3.match_length, e3.match_length = 0) : (r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++), r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
            }
            return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
          }(n2, t2) : h[n2.level].func(n2, t2);
          if (o2 !== O && o2 !== B || (n2.status = 666), o2 === A || o2 === O) return 0 === e2.avail_out && (n2.last_flush = -1), m;
          if (o2 === I && (1 === t2 ? u._tr_align(n2) : 5 !== t2 && (u._tr_stored_block(n2, 0, 0, false), 3 === t2 && (D(n2.head), 0 === n2.lookahead && (n2.strstart = 0, n2.block_start = 0, n2.insert = 0))), F(e2), 0 === e2.avail_out)) return n2.last_flush = -1, m;
        }
        return t2 !== f ? m : n2.wrap <= 0 ? 1 : (2 === n2.wrap ? (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), U(n2, e2.adler >> 16 & 255), U(n2, e2.adler >> 24 & 255), U(n2, 255 & e2.total_in), U(n2, e2.total_in >> 8 & 255), U(n2, e2.total_in >> 16 & 255), U(n2, e2.total_in >> 24 & 255)) : (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), F(e2), 0 < n2.wrap && (n2.wrap = -n2.wrap), 0 !== n2.pending ? m : 1);
      }, r.deflateEnd = function(e2) {
        var t2;
        return e2 && e2.state ? (t2 = e2.state.status) !== C && 69 !== t2 && 73 !== t2 && 91 !== t2 && 103 !== t2 && t2 !== E && 666 !== t2 ? R(e2, _) : (e2.state = null, t2 === E ? R(e2, -3) : m) : _;
      }, r.deflateSetDictionary = function(e2, t2) {
        var r2, n2, i2, s2, a2, o2, h2, u2, l2 = t2.length;
        if (!e2 || !e2.state) return _;
        if (2 === (s2 = (r2 = e2.state).wrap) || 1 === s2 && r2.status !== C || r2.lookahead) return _;
        for (1 === s2 && (e2.adler = d(e2.adler, t2, l2, 0)), r2.wrap = 0, l2 >= r2.w_size && (0 === s2 && (D(r2.head), r2.strstart = 0, r2.block_start = 0, r2.insert = 0), u2 = new c.Buf8(r2.w_size), c.arraySet(u2, t2, l2 - r2.w_size, r2.w_size, 0), t2 = u2, l2 = r2.w_size), a2 = e2.avail_in, o2 = e2.next_in, h2 = e2.input, e2.avail_in = l2, e2.next_in = 0, e2.input = t2, j(r2); r2.lookahead >= x; ) {
          for (n2 = r2.strstart, i2 = r2.lookahead - (x - 1); r2.ins_h = (r2.ins_h << r2.hash_shift ^ r2.window[n2 + x - 1]) & r2.hash_mask, r2.prev[n2 & r2.w_mask] = r2.head[r2.ins_h], r2.head[r2.ins_h] = n2, n2++, --i2; ) ;
          r2.strstart = n2, r2.lookahead = x - 1, j(r2);
        }
        return r2.strstart += r2.lookahead, r2.block_start = r2.strstart, r2.insert = r2.lookahead, r2.lookahead = 0, r2.match_length = r2.prev_length = x - 1, r2.match_available = 0, e2.next_in = o2, e2.input = h2, e2.avail_in = a2, r2.wrap = s2, m;
      }, r.deflateInfo = "pako deflate (from Nodeca project)";
    }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(e, t, r) {
      t.exports = function() {
        this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
      };
    }, {}], 48: [function(e, t, r) {
      t.exports = function(e2, t2) {
        var r2, n, i, s, a, o, h, u, l, f, c, d, p, m, _, g, b, v, y, w, k, x, S, z, C;
        r2 = e2.state, n = e2.next_in, z = e2.input, i = n + (e2.avail_in - 5), s = e2.next_out, C = e2.output, a = s - (t2 - e2.avail_out), o = s + (e2.avail_out - 257), h = r2.dmax, u = r2.wsize, l = r2.whave, f = r2.wnext, c = r2.window, d = r2.hold, p = r2.bits, m = r2.lencode, _ = r2.distcode, g = (1 << r2.lenbits) - 1, b = (1 << r2.distbits) - 1;
        e: do {
          p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = m[d & g];
          t: for (; ; ) {
            if (d >>>= y = v >>> 24, p -= y, 0 === (y = v >>> 16 & 255)) C[s++] = 65535 & v;
            else {
              if (!(16 & y)) {
                if (0 == (64 & y)) {
                  v = m[(65535 & v) + (d & (1 << y) - 1)];
                  continue t;
                }
                if (32 & y) {
                  r2.mode = 12;
                  break e;
                }
                e2.msg = "invalid literal/length code", r2.mode = 30;
                break e;
              }
              w = 65535 & v, (y &= 15) && (p < y && (d += z[n++] << p, p += 8), w += d & (1 << y) - 1, d >>>= y, p -= y), p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = _[d & b];
              r: for (; ; ) {
                if (d >>>= y = v >>> 24, p -= y, !(16 & (y = v >>> 16 & 255))) {
                  if (0 == (64 & y)) {
                    v = _[(65535 & v) + (d & (1 << y) - 1)];
                    continue r;
                  }
                  e2.msg = "invalid distance code", r2.mode = 30;
                  break e;
                }
                if (k = 65535 & v, p < (y &= 15) && (d += z[n++] << p, (p += 8) < y && (d += z[n++] << p, p += 8)), h < (k += d & (1 << y) - 1)) {
                  e2.msg = "invalid distance too far back", r2.mode = 30;
                  break e;
                }
                if (d >>>= y, p -= y, (y = s - a) < k) {
                  if (l < (y = k - y) && r2.sane) {
                    e2.msg = "invalid distance too far back", r2.mode = 30;
                    break e;
                  }
                  if (S = c, (x = 0) === f) {
                    if (x += u - y, y < w) {
                      for (w -= y; C[s++] = c[x++], --y; ) ;
                      x = s - k, S = C;
                    }
                  } else if (f < y) {
                    if (x += u + f - y, (y -= f) < w) {
                      for (w -= y; C[s++] = c[x++], --y; ) ;
                      if (x = 0, f < w) {
                        for (w -= y = f; C[s++] = c[x++], --y; ) ;
                        x = s - k, S = C;
                      }
                    }
                  } else if (x += f - y, y < w) {
                    for (w -= y; C[s++] = c[x++], --y; ) ;
                    x = s - k, S = C;
                  }
                  for (; 2 < w; ) C[s++] = S[x++], C[s++] = S[x++], C[s++] = S[x++], w -= 3;
                  w && (C[s++] = S[x++], 1 < w && (C[s++] = S[x++]));
                } else {
                  for (x = s - k; C[s++] = C[x++], C[s++] = C[x++], C[s++] = C[x++], 2 < (w -= 3); ) ;
                  w && (C[s++] = C[x++], 1 < w && (C[s++] = C[x++]));
                }
                break;
              }
            }
            break;
          }
        } while (n < i && s < o);
        n -= w = p >> 3, d &= (1 << (p -= w << 3)) - 1, e2.next_in = n, e2.next_out = s, e2.avail_in = n < i ? i - n + 5 : 5 - (n - i), e2.avail_out = s < o ? o - s + 257 : 257 - (s - o), r2.hold = d, r2.bits = p;
      };
    }, {}], 49: [function(e, t, r) {
      var I = e("../utils/common"), O = e("./adler32"), B = e("./crc32"), R = e("./inffast"), T = e("./inftrees"), D = 1, F = 2, N = 0, U = -2, P = 1, n = 852, i = 592;
      function L(e2) {
        return (e2 >>> 24 & 255) + (e2 >>> 8 & 65280) + ((65280 & e2) << 8) + ((255 & e2) << 24);
      }
      function s() {
        this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new I.Buf16(320), this.work = new I.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
      }
      function a(e2) {
        var t2;
        return e2 && e2.state ? (t2 = e2.state, e2.total_in = e2.total_out = t2.total = 0, e2.msg = "", t2.wrap && (e2.adler = 1 & t2.wrap), t2.mode = P, t2.last = 0, t2.havedict = 0, t2.dmax = 32768, t2.head = null, t2.hold = 0, t2.bits = 0, t2.lencode = t2.lendyn = new I.Buf32(n), t2.distcode = t2.distdyn = new I.Buf32(i), t2.sane = 1, t2.back = -1, N) : U;
      }
      function o(e2) {
        var t2;
        return e2 && e2.state ? ((t2 = e2.state).wsize = 0, t2.whave = 0, t2.wnext = 0, a(e2)) : U;
      }
      function h(e2, t2) {
        var r2, n2;
        return e2 && e2.state ? (n2 = e2.state, t2 < 0 ? (r2 = 0, t2 = -t2) : (r2 = 1 + (t2 >> 4), t2 < 48 && (t2 &= 15)), t2 && (t2 < 8 || 15 < t2) ? U : (null !== n2.window && n2.wbits !== t2 && (n2.window = null), n2.wrap = r2, n2.wbits = t2, o(e2))) : U;
      }
      function u(e2, t2) {
        var r2, n2;
        return e2 ? (n2 = new s(), (e2.state = n2).window = null, (r2 = h(e2, t2)) !== N && (e2.state = null), r2) : U;
      }
      var l, f, c = true;
      function j(e2) {
        if (c) {
          var t2;
          for (l = new I.Buf32(512), f = new I.Buf32(32), t2 = 0; t2 < 144; ) e2.lens[t2++] = 8;
          for (; t2 < 256; ) e2.lens[t2++] = 9;
          for (; t2 < 280; ) e2.lens[t2++] = 7;
          for (; t2 < 288; ) e2.lens[t2++] = 8;
          for (T(D, e2.lens, 0, 288, l, 0, e2.work, { bits: 9 }), t2 = 0; t2 < 32; ) e2.lens[t2++] = 5;
          T(F, e2.lens, 0, 32, f, 0, e2.work, { bits: 5 }), c = false;
        }
        e2.lencode = l, e2.lenbits = 9, e2.distcode = f, e2.distbits = 5;
      }
      function Z(e2, t2, r2, n2) {
        var i2, s2 = e2.state;
        return null === s2.window && (s2.wsize = 1 << s2.wbits, s2.wnext = 0, s2.whave = 0, s2.window = new I.Buf8(s2.wsize)), n2 >= s2.wsize ? (I.arraySet(s2.window, t2, r2 - s2.wsize, s2.wsize, 0), s2.wnext = 0, s2.whave = s2.wsize) : (n2 < (i2 = s2.wsize - s2.wnext) && (i2 = n2), I.arraySet(s2.window, t2, r2 - n2, i2, s2.wnext), (n2 -= i2) ? (I.arraySet(s2.window, t2, r2 - n2, n2, 0), s2.wnext = n2, s2.whave = s2.wsize) : (s2.wnext += i2, s2.wnext === s2.wsize && (s2.wnext = 0), s2.whave < s2.wsize && (s2.whave += i2))), 0;
      }
      r.inflateReset = o, r.inflateReset2 = h, r.inflateResetKeep = a, r.inflateInit = function(e2) {
        return u(e2, 15);
      }, r.inflateInit2 = u, r.inflate = function(e2, t2) {
        var r2, n2, i2, s2, a2, o2, h2, u2, l2, f2, c2, d, p, m, _, g, b, v, y, w, k, x, S, z, C = 0, E = new I.Buf8(4), A = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
        if (!e2 || !e2.state || !e2.output || !e2.input && 0 !== e2.avail_in) return U;
        12 === (r2 = e2.state).mode && (r2.mode = 13), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, f2 = o2, c2 = h2, x = N;
        e: for (; ; ) switch (r2.mode) {
          case P:
            if (0 === r2.wrap) {
              r2.mode = 13;
              break;
            }
            for (; l2 < 16; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            if (2 & r2.wrap && 35615 === u2) {
              E[r2.check = 0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0), l2 = u2 = 0, r2.mode = 2;
              break;
            }
            if (r2.flags = 0, r2.head && (r2.head.done = false), !(1 & r2.wrap) || (((255 & u2) << 8) + (u2 >> 8)) % 31) {
              e2.msg = "incorrect header check", r2.mode = 30;
              break;
            }
            if (8 != (15 & u2)) {
              e2.msg = "unknown compression method", r2.mode = 30;
              break;
            }
            if (l2 -= 4, k = 8 + (15 & (u2 >>>= 4)), 0 === r2.wbits) r2.wbits = k;
            else if (k > r2.wbits) {
              e2.msg = "invalid window size", r2.mode = 30;
              break;
            }
            r2.dmax = 1 << k, e2.adler = r2.check = 1, r2.mode = 512 & u2 ? 10 : 12, l2 = u2 = 0;
            break;
          case 2:
            for (; l2 < 16; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            if (r2.flags = u2, 8 != (255 & r2.flags)) {
              e2.msg = "unknown compression method", r2.mode = 30;
              break;
            }
            if (57344 & r2.flags) {
              e2.msg = "unknown header flags set", r2.mode = 30;
              break;
            }
            r2.head && (r2.head.text = u2 >> 8 & 1), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 3;
          case 3:
            for (; l2 < 32; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            r2.head && (r2.head.time = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, E[2] = u2 >>> 16 & 255, E[3] = u2 >>> 24 & 255, r2.check = B(r2.check, E, 4, 0)), l2 = u2 = 0, r2.mode = 4;
          case 4:
            for (; l2 < 16; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            r2.head && (r2.head.xflags = 255 & u2, r2.head.os = u2 >> 8), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 5;
          case 5:
            if (1024 & r2.flags) {
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              r2.length = u2, r2.head && (r2.head.extra_len = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0;
            } else r2.head && (r2.head.extra = null);
            r2.mode = 6;
          case 6:
            if (1024 & r2.flags && (o2 < (d = r2.length) && (d = o2), d && (r2.head && (k = r2.head.extra_len - r2.length, r2.head.extra || (r2.head.extra = new Array(r2.head.extra_len)), I.arraySet(r2.head.extra, n2, s2, d, k)), 512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, r2.length -= d), r2.length)) break e;
            r2.length = 0, r2.mode = 7;
          case 7:
            if (2048 & r2.flags) {
              if (0 === o2) break e;
              for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.name += String.fromCharCode(k)), k && d < o2; ) ;
              if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
            } else r2.head && (r2.head.name = null);
            r2.length = 0, r2.mode = 8;
          case 8:
            if (4096 & r2.flags) {
              if (0 === o2) break e;
              for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.comment += String.fromCharCode(k)), k && d < o2; ) ;
              if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
            } else r2.head && (r2.head.comment = null);
            r2.mode = 9;
          case 9:
            if (512 & r2.flags) {
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (u2 !== (65535 & r2.check)) {
                e2.msg = "header crc mismatch", r2.mode = 30;
                break;
              }
              l2 = u2 = 0;
            }
            r2.head && (r2.head.hcrc = r2.flags >> 9 & 1, r2.head.done = true), e2.adler = r2.check = 0, r2.mode = 12;
            break;
          case 10:
            for (; l2 < 32; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            e2.adler = r2.check = L(u2), l2 = u2 = 0, r2.mode = 11;
          case 11:
            if (0 === r2.havedict) return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, 2;
            e2.adler = r2.check = 1, r2.mode = 12;
          case 12:
            if (5 === t2 || 6 === t2) break e;
          case 13:
            if (r2.last) {
              u2 >>>= 7 & l2, l2 -= 7 & l2, r2.mode = 27;
              break;
            }
            for (; l2 < 3; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            switch (r2.last = 1 & u2, l2 -= 1, 3 & (u2 >>>= 1)) {
              case 0:
                r2.mode = 14;
                break;
              case 1:
                if (j(r2), r2.mode = 20, 6 !== t2) break;
                u2 >>>= 2, l2 -= 2;
                break e;
              case 2:
                r2.mode = 17;
                break;
              case 3:
                e2.msg = "invalid block type", r2.mode = 30;
            }
            u2 >>>= 2, l2 -= 2;
            break;
          case 14:
            for (u2 >>>= 7 & l2, l2 -= 7 & l2; l2 < 32; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            if ((65535 & u2) != (u2 >>> 16 ^ 65535)) {
              e2.msg = "invalid stored block lengths", r2.mode = 30;
              break;
            }
            if (r2.length = 65535 & u2, l2 = u2 = 0, r2.mode = 15, 6 === t2) break e;
          case 15:
            r2.mode = 16;
          case 16:
            if (d = r2.length) {
              if (o2 < d && (d = o2), h2 < d && (d = h2), 0 === d) break e;
              I.arraySet(i2, n2, s2, d, a2), o2 -= d, s2 += d, h2 -= d, a2 += d, r2.length -= d;
              break;
            }
            r2.mode = 12;
            break;
          case 17:
            for (; l2 < 14; ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            if (r2.nlen = 257 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ndist = 1 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ncode = 4 + (15 & u2), u2 >>>= 4, l2 -= 4, 286 < r2.nlen || 30 < r2.ndist) {
              e2.msg = "too many length or distance symbols", r2.mode = 30;
              break;
            }
            r2.have = 0, r2.mode = 18;
          case 18:
            for (; r2.have < r2.ncode; ) {
              for (; l2 < 3; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              r2.lens[A[r2.have++]] = 7 & u2, u2 >>>= 3, l2 -= 3;
            }
            for (; r2.have < 19; ) r2.lens[A[r2.have++]] = 0;
            if (r2.lencode = r2.lendyn, r2.lenbits = 7, S = { bits: r2.lenbits }, x = T(0, r2.lens, 0, 19, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
              e2.msg = "invalid code lengths set", r2.mode = 30;
              break;
            }
            r2.have = 0, r2.mode = 19;
          case 19:
            for (; r2.have < r2.nlen + r2.ndist; ) {
              for (; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (b < 16) u2 >>>= _, l2 -= _, r2.lens[r2.have++] = b;
              else {
                if (16 === b) {
                  for (z = _ + 2; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  if (u2 >>>= _, l2 -= _, 0 === r2.have) {
                    e2.msg = "invalid bit length repeat", r2.mode = 30;
                    break;
                  }
                  k = r2.lens[r2.have - 1], d = 3 + (3 & u2), u2 >>>= 2, l2 -= 2;
                } else if (17 === b) {
                  for (z = _ + 3; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  l2 -= _, k = 0, d = 3 + (7 & (u2 >>>= _)), u2 >>>= 3, l2 -= 3;
                } else {
                  for (z = _ + 7; l2 < z; ) {
                    if (0 === o2) break e;
                    o2--, u2 += n2[s2++] << l2, l2 += 8;
                  }
                  l2 -= _, k = 0, d = 11 + (127 & (u2 >>>= _)), u2 >>>= 7, l2 -= 7;
                }
                if (r2.have + d > r2.nlen + r2.ndist) {
                  e2.msg = "invalid bit length repeat", r2.mode = 30;
                  break;
                }
                for (; d--; ) r2.lens[r2.have++] = k;
              }
            }
            if (30 === r2.mode) break;
            if (0 === r2.lens[256]) {
              e2.msg = "invalid code -- missing end-of-block", r2.mode = 30;
              break;
            }
            if (r2.lenbits = 9, S = { bits: r2.lenbits }, x = T(D, r2.lens, 0, r2.nlen, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
              e2.msg = "invalid literal/lengths set", r2.mode = 30;
              break;
            }
            if (r2.distbits = 6, r2.distcode = r2.distdyn, S = { bits: r2.distbits }, x = T(F, r2.lens, r2.nlen, r2.ndist, r2.distcode, 0, r2.work, S), r2.distbits = S.bits, x) {
              e2.msg = "invalid distances set", r2.mode = 30;
              break;
            }
            if (r2.mode = 20, 6 === t2) break e;
          case 20:
            r2.mode = 21;
          case 21:
            if (6 <= o2 && 258 <= h2) {
              e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, R(e2, c2), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, 12 === r2.mode && (r2.back = -1);
              break;
            }
            for (r2.back = 0; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            if (g && 0 == (240 & g)) {
              for (v = _, y = g, w = b; g = (C = r2.lencode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              u2 >>>= v, l2 -= v, r2.back += v;
            }
            if (u2 >>>= _, l2 -= _, r2.back += _, r2.length = b, 0 === g) {
              r2.mode = 26;
              break;
            }
            if (32 & g) {
              r2.back = -1, r2.mode = 12;
              break;
            }
            if (64 & g) {
              e2.msg = "invalid literal/length code", r2.mode = 30;
              break;
            }
            r2.extra = 15 & g, r2.mode = 22;
          case 22:
            if (r2.extra) {
              for (z = r2.extra; l2 < z; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              r2.length += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
            }
            r2.was = r2.length, r2.mode = 23;
          case 23:
            for (; g = (C = r2.distcode[u2 & (1 << r2.distbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
              if (0 === o2) break e;
              o2--, u2 += n2[s2++] << l2, l2 += 8;
            }
            if (0 == (240 & g)) {
              for (v = _, y = g, w = b; g = (C = r2.distcode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              u2 >>>= v, l2 -= v, r2.back += v;
            }
            if (u2 >>>= _, l2 -= _, r2.back += _, 64 & g) {
              e2.msg = "invalid distance code", r2.mode = 30;
              break;
            }
            r2.offset = b, r2.extra = 15 & g, r2.mode = 24;
          case 24:
            if (r2.extra) {
              for (z = r2.extra; l2 < z; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              r2.offset += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
            }
            if (r2.offset > r2.dmax) {
              e2.msg = "invalid distance too far back", r2.mode = 30;
              break;
            }
            r2.mode = 25;
          case 25:
            if (0 === h2) break e;
            if (d = c2 - h2, r2.offset > d) {
              if ((d = r2.offset - d) > r2.whave && r2.sane) {
                e2.msg = "invalid distance too far back", r2.mode = 30;
                break;
              }
              p = d > r2.wnext ? (d -= r2.wnext, r2.wsize - d) : r2.wnext - d, d > r2.length && (d = r2.length), m = r2.window;
            } else m = i2, p = a2 - r2.offset, d = r2.length;
            for (h2 < d && (d = h2), h2 -= d, r2.length -= d; i2[a2++] = m[p++], --d; ) ;
            0 === r2.length && (r2.mode = 21);
            break;
          case 26:
            if (0 === h2) break e;
            i2[a2++] = r2.length, h2--, r2.mode = 21;
            break;
          case 27:
            if (r2.wrap) {
              for (; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 |= n2[s2++] << l2, l2 += 8;
              }
              if (c2 -= h2, e2.total_out += c2, r2.total += c2, c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, a2 - c2) : O(r2.check, i2, c2, a2 - c2)), c2 = h2, (r2.flags ? u2 : L(u2)) !== r2.check) {
                e2.msg = "incorrect data check", r2.mode = 30;
                break;
              }
              l2 = u2 = 0;
            }
            r2.mode = 28;
          case 28:
            if (r2.wrap && r2.flags) {
              for (; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (u2 !== (4294967295 & r2.total)) {
                e2.msg = "incorrect length check", r2.mode = 30;
                break;
              }
              l2 = u2 = 0;
            }
            r2.mode = 29;
          case 29:
            x = 1;
            break e;
          case 30:
            x = -3;
            break e;
          case 31:
            return -4;
          case 32:
          default:
            return U;
        }
        return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, (r2.wsize || c2 !== e2.avail_out && r2.mode < 30 && (r2.mode < 27 || 4 !== t2)) && Z(e2, e2.output, e2.next_out, c2 - e2.avail_out) ? (r2.mode = 31, -4) : (f2 -= e2.avail_in, c2 -= e2.avail_out, e2.total_in += f2, e2.total_out += c2, r2.total += c2, r2.wrap && c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, e2.next_out - c2) : O(r2.check, i2, c2, e2.next_out - c2)), e2.data_type = r2.bits + (r2.last ? 64 : 0) + (12 === r2.mode ? 128 : 0) + (20 === r2.mode || 15 === r2.mode ? 256 : 0), (0 == f2 && 0 === c2 || 4 === t2) && x === N && (x = -5), x);
      }, r.inflateEnd = function(e2) {
        if (!e2 || !e2.state) return U;
        var t2 = e2.state;
        return t2.window && (t2.window = null), e2.state = null, N;
      }, r.inflateGetHeader = function(e2, t2) {
        var r2;
        return e2 && e2.state ? 0 == (2 & (r2 = e2.state).wrap) ? U : ((r2.head = t2).done = false, N) : U;
      }, r.inflateSetDictionary = function(e2, t2) {
        var r2, n2 = t2.length;
        return e2 && e2.state ? 0 !== (r2 = e2.state).wrap && 11 !== r2.mode ? U : 11 === r2.mode && O(1, t2, n2, 0) !== r2.check ? -3 : Z(e2, t2, n2, n2) ? (r2.mode = 31, -4) : (r2.havedict = 1, N) : U;
      }, r.inflateInfo = "pako inflate (from Nodeca project)";
    }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(e, t, r) {
      var D = e("../utils/common"), F = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], N = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], U = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], P = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
      t.exports = function(e2, t2, r2, n, i, s, a, o) {
        var h, u, l, f, c, d, p, m, _, g = o.bits, b = 0, v = 0, y = 0, w = 0, k = 0, x = 0, S = 0, z = 0, C = 0, E = 0, A = null, I = 0, O = new D.Buf16(16), B = new D.Buf16(16), R = null, T = 0;
        for (b = 0; b <= 15; b++) O[b] = 0;
        for (v = 0; v < n; v++) O[t2[r2 + v]]++;
        for (k = g, w = 15; 1 <= w && 0 === O[w]; w--) ;
        if (w < k && (k = w), 0 === w) return i[s++] = 20971520, i[s++] = 20971520, o.bits = 1, 0;
        for (y = 1; y < w && 0 === O[y]; y++) ;
        for (k < y && (k = y), b = z = 1; b <= 15; b++) if (z <<= 1, (z -= O[b]) < 0) return -1;
        if (0 < z && (0 === e2 || 1 !== w)) return -1;
        for (B[1] = 0, b = 1; b < 15; b++) B[b + 1] = B[b] + O[b];
        for (v = 0; v < n; v++) 0 !== t2[r2 + v] && (a[B[t2[r2 + v]]++] = v);
        if (d = 0 === e2 ? (A = R = a, 19) : 1 === e2 ? (A = F, I -= 257, R = N, T -= 257, 256) : (A = U, R = P, -1), b = y, c = s, S = v = E = 0, l = -1, f = (C = 1 << (x = k)) - 1, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
        for (; ; ) {
          for (p = b - S, _ = a[v] < d ? (m = 0, a[v]) : a[v] > d ? (m = R[T + a[v]], A[I + a[v]]) : (m = 96, 0), h = 1 << b - S, y = u = 1 << x; i[c + (E >> S) + (u -= h)] = p << 24 | m << 16 | _ | 0, 0 !== u; ) ;
          for (h = 1 << b - 1; E & h; ) h >>= 1;
          if (0 !== h ? (E &= h - 1, E += h) : E = 0, v++, 0 == --O[b]) {
            if (b === w) break;
            b = t2[r2 + a[v]];
          }
          if (k < b && (E & f) !== l) {
            for (0 === S && (S = k), c += y, z = 1 << (x = b - S); x + S < w && !((z -= O[x + S]) <= 0); ) x++, z <<= 1;
            if (C += 1 << x, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
            i[l = E & f] = k << 24 | x << 16 | c - s | 0;
          }
        }
        return 0 !== E && (i[c + E] = b - S << 24 | 64 << 16 | 0), o.bits = k, 0;
      };
    }, { "../utils/common": 41 }], 51: [function(e, t, r) {
      t.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
    }, {}], 52: [function(e, t, r) {
      var i = e("../utils/common"), o = 0, h = 1;
      function n(e2) {
        for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
      }
      var s = 0, a = 29, u = 256, l = u + 1 + a, f = 30, c = 19, _ = 2 * l + 1, g = 15, d = 16, p = 7, m = 256, b = 16, v = 17, y = 18, w = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], k = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], S = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], z = new Array(2 * (l + 2));
      n(z);
      var C = new Array(2 * f);
      n(C);
      var E = new Array(512);
      n(E);
      var A = new Array(256);
      n(A);
      var I = new Array(a);
      n(I);
      var O, B, R, T = new Array(f);
      function D(e2, t2, r2, n2, i2) {
        this.static_tree = e2, this.extra_bits = t2, this.extra_base = r2, this.elems = n2, this.max_length = i2, this.has_stree = e2 && e2.length;
      }
      function F(e2, t2) {
        this.dyn_tree = e2, this.max_code = 0, this.stat_desc = t2;
      }
      function N(e2) {
        return e2 < 256 ? E[e2] : E[256 + (e2 >>> 7)];
      }
      function U(e2, t2) {
        e2.pending_buf[e2.pending++] = 255 & t2, e2.pending_buf[e2.pending++] = t2 >>> 8 & 255;
      }
      function P(e2, t2, r2) {
        e2.bi_valid > d - r2 ? (e2.bi_buf |= t2 << e2.bi_valid & 65535, U(e2, e2.bi_buf), e2.bi_buf = t2 >> d - e2.bi_valid, e2.bi_valid += r2 - d) : (e2.bi_buf |= t2 << e2.bi_valid & 65535, e2.bi_valid += r2);
      }
      function L(e2, t2, r2) {
        P(e2, r2[2 * t2], r2[2 * t2 + 1]);
      }
      function j(e2, t2) {
        for (var r2 = 0; r2 |= 1 & e2, e2 >>>= 1, r2 <<= 1, 0 < --t2; ) ;
        return r2 >>> 1;
      }
      function Z(e2, t2, r2) {
        var n2, i2, s2 = new Array(g + 1), a2 = 0;
        for (n2 = 1; n2 <= g; n2++) s2[n2] = a2 = a2 + r2[n2 - 1] << 1;
        for (i2 = 0; i2 <= t2; i2++) {
          var o2 = e2[2 * i2 + 1];
          0 !== o2 && (e2[2 * i2] = j(s2[o2]++, o2));
        }
      }
      function W(e2) {
        var t2;
        for (t2 = 0; t2 < l; t2++) e2.dyn_ltree[2 * t2] = 0;
        for (t2 = 0; t2 < f; t2++) e2.dyn_dtree[2 * t2] = 0;
        for (t2 = 0; t2 < c; t2++) e2.bl_tree[2 * t2] = 0;
        e2.dyn_ltree[2 * m] = 1, e2.opt_len = e2.static_len = 0, e2.last_lit = e2.matches = 0;
      }
      function M(e2) {
        8 < e2.bi_valid ? U(e2, e2.bi_buf) : 0 < e2.bi_valid && (e2.pending_buf[e2.pending++] = e2.bi_buf), e2.bi_buf = 0, e2.bi_valid = 0;
      }
      function H(e2, t2, r2, n2) {
        var i2 = 2 * t2, s2 = 2 * r2;
        return e2[i2] < e2[s2] || e2[i2] === e2[s2] && n2[t2] <= n2[r2];
      }
      function G(e2, t2, r2) {
        for (var n2 = e2.heap[r2], i2 = r2 << 1; i2 <= e2.heap_len && (i2 < e2.heap_len && H(t2, e2.heap[i2 + 1], e2.heap[i2], e2.depth) && i2++, !H(t2, n2, e2.heap[i2], e2.depth)); ) e2.heap[r2] = e2.heap[i2], r2 = i2, i2 <<= 1;
        e2.heap[r2] = n2;
      }
      function K(e2, t2, r2) {
        var n2, i2, s2, a2, o2 = 0;
        if (0 !== e2.last_lit) for (; n2 = e2.pending_buf[e2.d_buf + 2 * o2] << 8 | e2.pending_buf[e2.d_buf + 2 * o2 + 1], i2 = e2.pending_buf[e2.l_buf + o2], o2++, 0 === n2 ? L(e2, i2, t2) : (L(e2, (s2 = A[i2]) + u + 1, t2), 0 !== (a2 = w[s2]) && P(e2, i2 -= I[s2], a2), L(e2, s2 = N(--n2), r2), 0 !== (a2 = k[s2]) && P(e2, n2 -= T[s2], a2)), o2 < e2.last_lit; ) ;
        L(e2, m, t2);
      }
      function Y(e2, t2) {
        var r2, n2, i2, s2 = t2.dyn_tree, a2 = t2.stat_desc.static_tree, o2 = t2.stat_desc.has_stree, h2 = t2.stat_desc.elems, u2 = -1;
        for (e2.heap_len = 0, e2.heap_max = _, r2 = 0; r2 < h2; r2++) 0 !== s2[2 * r2] ? (e2.heap[++e2.heap_len] = u2 = r2, e2.depth[r2] = 0) : s2[2 * r2 + 1] = 0;
        for (; e2.heap_len < 2; ) s2[2 * (i2 = e2.heap[++e2.heap_len] = u2 < 2 ? ++u2 : 0)] = 1, e2.depth[i2] = 0, e2.opt_len--, o2 && (e2.static_len -= a2[2 * i2 + 1]);
        for (t2.max_code = u2, r2 = e2.heap_len >> 1; 1 <= r2; r2--) G(e2, s2, r2);
        for (i2 = h2; r2 = e2.heap[1], e2.heap[1] = e2.heap[e2.heap_len--], G(e2, s2, 1), n2 = e2.heap[1], e2.heap[--e2.heap_max] = r2, e2.heap[--e2.heap_max] = n2, s2[2 * i2] = s2[2 * r2] + s2[2 * n2], e2.depth[i2] = (e2.depth[r2] >= e2.depth[n2] ? e2.depth[r2] : e2.depth[n2]) + 1, s2[2 * r2 + 1] = s2[2 * n2 + 1] = i2, e2.heap[1] = i2++, G(e2, s2, 1), 2 <= e2.heap_len; ) ;
        e2.heap[--e2.heap_max] = e2.heap[1], function(e3, t3) {
          var r3, n3, i3, s3, a3, o3, h3 = t3.dyn_tree, u3 = t3.max_code, l2 = t3.stat_desc.static_tree, f2 = t3.stat_desc.has_stree, c2 = t3.stat_desc.extra_bits, d2 = t3.stat_desc.extra_base, p2 = t3.stat_desc.max_length, m2 = 0;
          for (s3 = 0; s3 <= g; s3++) e3.bl_count[s3] = 0;
          for (h3[2 * e3.heap[e3.heap_max] + 1] = 0, r3 = e3.heap_max + 1; r3 < _; r3++) p2 < (s3 = h3[2 * h3[2 * (n3 = e3.heap[r3]) + 1] + 1] + 1) && (s3 = p2, m2++), h3[2 * n3 + 1] = s3, u3 < n3 || (e3.bl_count[s3]++, a3 = 0, d2 <= n3 && (a3 = c2[n3 - d2]), o3 = h3[2 * n3], e3.opt_len += o3 * (s3 + a3), f2 && (e3.static_len += o3 * (l2[2 * n3 + 1] + a3)));
          if (0 !== m2) {
            do {
              for (s3 = p2 - 1; 0 === e3.bl_count[s3]; ) s3--;
              e3.bl_count[s3]--, e3.bl_count[s3 + 1] += 2, e3.bl_count[p2]--, m2 -= 2;
            } while (0 < m2);
            for (s3 = p2; 0 !== s3; s3--) for (n3 = e3.bl_count[s3]; 0 !== n3; ) u3 < (i3 = e3.heap[--r3]) || (h3[2 * i3 + 1] !== s3 && (e3.opt_len += (s3 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s3), n3--);
          }
        }(e2, t2), Z(s2, u2, e2.bl_count);
      }
      function X(e2, t2, r2) {
        var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
        for (0 === a2 && (h2 = 138, u2 = 3), t2[2 * (r2 + 1) + 1] = 65535, n2 = 0; n2 <= r2; n2++) i2 = a2, a2 = t2[2 * (n2 + 1) + 1], ++o2 < h2 && i2 === a2 || (o2 < u2 ? e2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== s2 && e2.bl_tree[2 * i2]++, e2.bl_tree[2 * b]++) : o2 <= 10 ? e2.bl_tree[2 * v]++ : e2.bl_tree[2 * y]++, s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4));
      }
      function V(e2, t2, r2) {
        var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
        for (0 === a2 && (h2 = 138, u2 = 3), n2 = 0; n2 <= r2; n2++) if (i2 = a2, a2 = t2[2 * (n2 + 1) + 1], !(++o2 < h2 && i2 === a2)) {
          if (o2 < u2) for (; L(e2, i2, e2.bl_tree), 0 != --o2; ) ;
          else 0 !== i2 ? (i2 !== s2 && (L(e2, i2, e2.bl_tree), o2--), L(e2, b, e2.bl_tree), P(e2, o2 - 3, 2)) : o2 <= 10 ? (L(e2, v, e2.bl_tree), P(e2, o2 - 3, 3)) : (L(e2, y, e2.bl_tree), P(e2, o2 - 11, 7));
          s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4);
        }
      }
      n(T);
      var q = false;
      function J(e2, t2, r2, n2) {
        P(e2, (s << 1) + (n2 ? 1 : 0), 3), function(e3, t3, r3, n3) {
          M(e3), U(e3, r3), U(e3, ~r3), i.arraySet(e3.pending_buf, e3.window, t3, r3, e3.pending), e3.pending += r3;
        }(e2, t2, r2);
      }
      r._tr_init = function(e2) {
        q || (function() {
          var e3, t2, r2, n2, i2, s2 = new Array(g + 1);
          for (n2 = r2 = 0; n2 < a - 1; n2++) for (I[n2] = r2, e3 = 0; e3 < 1 << w[n2]; e3++) A[r2++] = n2;
          for (A[r2 - 1] = n2, n2 = i2 = 0; n2 < 16; n2++) for (T[n2] = i2, e3 = 0; e3 < 1 << k[n2]; e3++) E[i2++] = n2;
          for (i2 >>= 7; n2 < f; n2++) for (T[n2] = i2 << 7, e3 = 0; e3 < 1 << k[n2] - 7; e3++) E[256 + i2++] = n2;
          for (t2 = 0; t2 <= g; t2++) s2[t2] = 0;
          for (e3 = 0; e3 <= 143; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
          for (; e3 <= 255; ) z[2 * e3 + 1] = 9, e3++, s2[9]++;
          for (; e3 <= 279; ) z[2 * e3 + 1] = 7, e3++, s2[7]++;
          for (; e3 <= 287; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
          for (Z(z, l + 1, s2), e3 = 0; e3 < f; e3++) C[2 * e3 + 1] = 5, C[2 * e3] = j(e3, 5);
          O = new D(z, w, u + 1, l, g), B = new D(C, k, 0, f, g), R = new D(new Array(0), x, 0, c, p);
        }(), q = true), e2.l_desc = new F(e2.dyn_ltree, O), e2.d_desc = new F(e2.dyn_dtree, B), e2.bl_desc = new F(e2.bl_tree, R), e2.bi_buf = 0, e2.bi_valid = 0, W(e2);
      }, r._tr_stored_block = J, r._tr_flush_block = function(e2, t2, r2, n2) {
        var i2, s2, a2 = 0;
        0 < e2.level ? (2 === e2.strm.data_type && (e2.strm.data_type = function(e3) {
          var t3, r3 = 4093624447;
          for (t3 = 0; t3 <= 31; t3++, r3 >>>= 1) if (1 & r3 && 0 !== e3.dyn_ltree[2 * t3]) return o;
          if (0 !== e3.dyn_ltree[18] || 0 !== e3.dyn_ltree[20] || 0 !== e3.dyn_ltree[26]) return h;
          for (t3 = 32; t3 < u; t3++) if (0 !== e3.dyn_ltree[2 * t3]) return h;
          return o;
        }(e2)), Y(e2, e2.l_desc), Y(e2, e2.d_desc), a2 = function(e3) {
          var t3;
          for (X(e3, e3.dyn_ltree, e3.l_desc.max_code), X(e3, e3.dyn_dtree, e3.d_desc.max_code), Y(e3, e3.bl_desc), t3 = c - 1; 3 <= t3 && 0 === e3.bl_tree[2 * S[t3] + 1]; t3--) ;
          return e3.opt_len += 3 * (t3 + 1) + 5 + 5 + 4, t3;
        }(e2), i2 = e2.opt_len + 3 + 7 >>> 3, (s2 = e2.static_len + 3 + 7 >>> 3) <= i2 && (i2 = s2)) : i2 = s2 = r2 + 5, r2 + 4 <= i2 && -1 !== t2 ? J(e2, t2, r2, n2) : 4 === e2.strategy || s2 === i2 ? (P(e2, 2 + (n2 ? 1 : 0), 3), K(e2, z, C)) : (P(e2, 4 + (n2 ? 1 : 0), 3), function(e3, t3, r3, n3) {
          var i3;
          for (P(e3, t3 - 257, 5), P(e3, r3 - 1, 5), P(e3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) P(e3, e3.bl_tree[2 * S[i3] + 1], 3);
          V(e3, e3.dyn_ltree, t3 - 1), V(e3, e3.dyn_dtree, r3 - 1);
        }(e2, e2.l_desc.max_code + 1, e2.d_desc.max_code + 1, a2 + 1), K(e2, e2.dyn_ltree, e2.dyn_dtree)), W(e2), n2 && M(e2);
      }, r._tr_tally = function(e2, t2, r2) {
        return e2.pending_buf[e2.d_buf + 2 * e2.last_lit] = t2 >>> 8 & 255, e2.pending_buf[e2.d_buf + 2 * e2.last_lit + 1] = 255 & t2, e2.pending_buf[e2.l_buf + e2.last_lit] = 255 & r2, e2.last_lit++, 0 === t2 ? e2.dyn_ltree[2 * r2]++ : (e2.matches++, t2--, e2.dyn_ltree[2 * (A[r2] + u + 1)]++, e2.dyn_dtree[2 * N(t2)]++), e2.last_lit === e2.lit_bufsize - 1;
      }, r._tr_align = function(e2) {
        P(e2, 2, 3), L(e2, m, z), function(e3) {
          16 === e3.bi_valid ? (U(e3, e3.bi_buf), e3.bi_buf = 0, e3.bi_valid = 0) : 8 <= e3.bi_valid && (e3.pending_buf[e3.pending++] = 255 & e3.bi_buf, e3.bi_buf >>= 8, e3.bi_valid -= 8);
        }(e2);
      };
    }, { "../utils/common": 41 }], 53: [function(e, t, r) {
      t.exports = function() {
        this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
      };
    }, {}], 54: [function(e, t, r) {
      (function(e2) {
        !function(r2, n) {
          if (!r2.setImmediate) {
            var i, s, t2, a, o = 1, h = {}, u = false, l = r2.document, e3 = Object.getPrototypeOf && Object.getPrototypeOf(r2);
            e3 = e3 && e3.setTimeout ? e3 : r2, i = "[object process]" === {}.toString.call(r2.process) ? function(e4) {
              process.nextTick(function() {
                c(e4);
              });
            } : function() {
              if (r2.postMessage && !r2.importScripts) {
                var e4 = true, t3 = r2.onmessage;
                return r2.onmessage = function() {
                  e4 = false;
                }, r2.postMessage("", "*"), r2.onmessage = t3, e4;
              }
            }() ? (a = "setImmediate$" + Math.random() + "$", r2.addEventListener ? r2.addEventListener("message", d, false) : r2.attachEvent("onmessage", d), function(e4) {
              r2.postMessage(a + e4, "*");
            }) : r2.MessageChannel ? ((t2 = new MessageChannel()).port1.onmessage = function(e4) {
              c(e4.data);
            }, function(e4) {
              t2.port2.postMessage(e4);
            }) : l && "onreadystatechange" in l.createElement("script") ? (s = l.documentElement, function(e4) {
              var t3 = l.createElement("script");
              t3.onreadystatechange = function() {
                c(e4), t3.onreadystatechange = null, s.removeChild(t3), t3 = null;
              }, s.appendChild(t3);
            }) : function(e4) {
              setTimeout(c, 0, e4);
            }, e3.setImmediate = function(e4) {
              "function" != typeof e4 && (e4 = new Function("" + e4));
              for (var t3 = new Array(arguments.length - 1), r3 = 0; r3 < t3.length; r3++) t3[r3] = arguments[r3 + 1];
              var n2 = { callback: e4, args: t3 };
              return h[o] = n2, i(o), o++;
            }, e3.clearImmediate = f;
          }
          function f(e4) {
            delete h[e4];
          }
          function c(e4) {
            if (u) setTimeout(c, 0, e4);
            else {
              var t3 = h[e4];
              if (t3) {
                u = true;
                try {
                  !function(e5) {
                    var t4 = e5.callback, r3 = e5.args;
                    switch (r3.length) {
                      case 0:
                        t4();
                        break;
                      case 1:
                        t4(r3[0]);
                        break;
                      case 2:
                        t4(r3[0], r3[1]);
                        break;
                      case 3:
                        t4(r3[0], r3[1], r3[2]);
                        break;
                      default:
                        t4.apply(n, r3);
                    }
                  }(t3);
                } finally {
                  f(e4), u = false;
                }
              }
            }
          }
          function d(e4) {
            e4.source === r2 && "string" == typeof e4.data && 0 === e4.data.indexOf(a) && c(+e4.data.slice(a.length));
          }
        }("undefined" == typeof self ? void 0 === e2 ? this : e2 : self);
      }).call(this, "undefined" != typeof commonjsGlobal ? commonjsGlobal : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
    }, {}] }, {}, [10])(10);
  });
})(jszip_min);
var jszip_minExports = jszip_min.exports;
const JSZip = /* @__PURE__ */ getDefaultExportFromCjs(jszip_minExports);
const SERVICE = "ravtext-cloudflare-docx-advanced-worker";
const VERSION = "2026-05-26-server-extract";
const MAX_DOCX_BYTES = 100 * 1024 * 1024;
function requestId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch {
  }
  return `cf-docx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function log(level, event, data = {}) {
  try {
    const payload = JSON.stringify({ service: SERVICE, version: VERSION, event, ...data });
    const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    fn(payload);
  } catch {
  }
}
function corsHeaders(id = "") {
  const headers = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-file-name, x-docx-request-id",
    "access-control-expose-headers": "x-docx-api, x-docx-version, x-docx-request-id",
    "access-control-max-age": "86400",
    "x-docx-api": SERVICE,
    "x-docx-version": VERSION
  };
  if (id) headers["x-docx-request-id"] = id;
  return headers;
}
function jsonResponse(body, status = 200, id = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(id),
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}
function optionsResponse(id = "") {
  return new Response(null, { status: 204, headers: corsHeaders(id) });
}
const HEBREW_MARKS_RE = /[֑-ׇ]/g;
function xmlDecode(value) {
  return String(value || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function norm(value) {
  return String(value || "").normalize("NFD").replace(HEBREW_MARKS_RE, "").trim().toLowerCase();
}
function attr(xml, name) {
  const match = String(xml || "").match(new RegExp(`(?:\\bw:|\\b)${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : "";
}
function firstTag(xml, localName) {
  const match = String(xml || "").match(new RegExp(`<w:${localName}\\b[\\s\\S]*?(?:</w:${localName}>|/>)`));
  return match ? match[0] : "";
}
function parseStyles(stylesXml) {
  const styles = {};
  const blocks = String(stylesXml || "").match(/<w:style\b[\s\S]*?<\/w:style>/g) || [];
  for (const block of blocks) {
    const id = attr(block, "styleId");
    if (!id) continue;
    styles[id] = {
      name: attr(firstTag(block, "name"), "val"),
      outline: attr(firstTag(block, "outlineLvl"), "val")
    };
  }
  return styles;
}
function paragraphText(pXml) {
  const out = [];
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;
  while (match = re.exec(String(pXml || ""))) {
    out.push(xmlDecode(match[1]));
  }
  return out.join("");
}
function levelOfParagraph(pXml, styles) {
  const pPr = firstTag(pXml, "pPr");
  const outline = attr(firstTag(pPr, "outlineLvl"), "val");
  if (outline !== "" && Number.isFinite(+outline)) return +outline + 1;
  const styleId = attr(firstTag(pPr, "pStyle"), "val");
  const style = styles[styleId] || {};
  if (style.outline !== "" && style.outline != null && Number.isFinite(+style.outline)) return +style.outline + 1;
  const marker = `${norm(styleId)} ${norm(style.name)}`;
  for (let i = 1; i <= 6; i += 1) {
    if (norm(styleId) === String(i) || marker.includes(`heading ${i}`) || marker.includes(`heading${i}`) || marker.includes(`כותרת ${i}`) || marker.includes(`כותרת${i}`)) {
      return i;
    }
  }
  return 0;
}
function documentBodyXml(xml) {
  const open = String(xml || "").match(/<w:body\b[^>]*>/);
  const close = String(xml || "").lastIndexOf("</w:body>");
  if (!open || close < 0) throw new Error("לא נמצא גוף מסמך Word תקין.");
  return String(xml).slice(open.index + open[0].length, close);
}
function bodyParts(bodyXml, styles) {
  const parts = [];
  const allText = [];
  const xml = String(bodyXml || "");
  let pos = 0;
  while (pos < xml.length) {
    let start = -1;
    let sp = pos;
    while (sp < xml.length) {
      const idx = xml.indexOf("<w:p", sp);
      if (idx < 0) {
        sp = xml.length;
        break;
      }
      const ch = xml.charCodeAt(idx + 4);
      if (ch === 32 || ch === 62) {
        start = idx;
        break;
      }
      sp = idx + 4;
    }
    if (start < 0) break;
    const end = xml.indexOf("</w:p>", start);
    if (end < 0) break;
    const pXml = xml.slice(start, end + 6);
    const text = paragraphText(pXml);
    const level = levelOfParagraph(pXml, styles);
    if (text) allText.push(text);
    parts.push({ text, level });
    pos = end + 6;
  }
  return { parts, partsMeta: parts, allText };
}
async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer.slice(0));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function importDocx(arrayBuffer, id) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const error = new Error(`DOCX גדול מדי לעיבוד. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    error.status = 413;
    throw error;
  }
  const started = Date.now();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");
  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve("")
  ]);
  const styles = parseStyles(stylesXml || "");
  const bodyXml = documentBodyXml(docXml);
  const h = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  const heads = { 1: [], 2: [] };
  let pos = 0;
  let partIndex = 0;
  while (pos < bodyXml.length) {
    let start = -1, sp = pos;
    while (sp < bodyXml.length) {
      const idx = bodyXml.indexOf("<w:p", sp);
      if (idx < 0) {
        sp = bodyXml.length;
        break;
      }
      const ch = bodyXml.charCodeAt(idx + 4);
      if (ch === 32 || ch === 62) {
        start = idx;
        break;
      }
      sp = idx + 4;
    }
    if (start < 0) break;
    const end = bodyXml.indexOf("</w:p>", start);
    if (end < 0) break;
    const hasStyle = bodyXml.indexOf("<w:pStyle", start) >= start && bodyXml.indexOf("<w:pStyle", start) < end;
    const hasOutline = bodyXml.indexOf("<w:outlineLvl", start) >= start && bodyXml.indexOf("<w:outlineLvl", start) < end;
    if (hasStyle || hasOutline) {
      const pXml = bodyXml.slice(start, end + 6);
      const level = levelOfParagraph(pXml, styles);
      if (level >= 1 && level <= 6) {
        h[level] = (h[level] || 0) + 1;
        if (level === 1 || level === 2) {
          const text = paragraphText(pXml);
          if (text.trim()) heads[level].push({ title: text.trim(), start: partIndex });
        }
      }
    }
    partIndex++;
    pos = end + 6;
  }
  let chars = 0;
  const textRe = /<w:t\b[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while (m = textRe.exec(bodyXml)) chars += xmlDecode(m[1]).length;
  const fileHash = await sha256Hex(arrayBuffer);
  const elapsedMs = Date.now() - started;
  log("log", "docx_import_success", {
    requestId: id,
    bytes: arrayBuffer.byteLength,
    heads1: heads[1].length,
    heads2: heads[2].length,
    chars,
    elapsedMs
  });
  return {
    ok: true,
    serverSide: true,
    requestId: id,
    serverDocumentId: fileHash,
    fileHash,
    h,
    heads,
    total: Object.values(h).reduce((a, b) => a + b, 0),
    chars,
    words: Math.round(chars / 5),
    diagnostics: { service: SERVICE, version: VERSION, bytes: arrayBuffer.byteLength, elapsedMs }
  };
}
function escHtml(text) {
  return String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function extractChapterContent(arrayBuffer, level, index2, id) {
  level = Number(level) || 1;
  index2 = Number(index2) || 0;
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const err = new Error(`DOCX גדול מדי. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    err.status = 413;
    throw err;
  }
  const started = Date.now();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("לא נמצא word/document.xml.");
  const [docXml, stylesXml] = await Promise.all([
    docFile.async("string"),
    zip.file("word/styles.xml")?.async("string") || Promise.resolve("")
  ]);
  const styles = parseStyles(stylesXml || "");
  const bodyXml = documentBodyXml(docXml);
  const { partsMeta } = bodyParts(bodyXml, styles);
  const levelHeads = [];
  for (let i = 0; i < partsMeta.length; i++) {
    const part = partsMeta[i];
    if (part.text?.trim() && part.level === level) {
      levelHeads.push({ title: part.text.trim(), start: i });
    }
  }
  if (index2 < 0 || index2 >= levelHeads.length) {
    const err = new Error(`לא נמצא פרק מספר ${index2 + 1} ברמה ${level}. סה"כ פרקים: ${levelHeads.length}.`);
    err.status = 404;
    throw err;
  }
  const head = levelHeads[index2];
  const nextHead = levelHeads[index2 + 1];
  const end = nextHead ? nextHead.start : partsMeta.length;
  const chapterParts = partsMeta.slice(head.start, end);
  const mainHtml = chapterParts.map((p) => {
    const text = String(p.text || "").trim();
    if (!text) return "";
    if (p.level >= 1 && p.level <= 6) return `<h${p.level}>${escHtml(text)}</h${p.level}>`;
    return `<p>${escHtml(text)}</p>`;
  }).filter(Boolean).join("\n");
  log("log", "chapter_extract_success", { requestId: id, level, index: index2, title: head.title, parts: chapterParts.length, elapsedMs: Date.now() - started });
  return {
    ok: true,
    serverSide: true,
    requestId: id,
    title: head.title,
    result: {
      mainHtml: mainHtml || "<p></p>",
      streams: [],
      streamsHtml: []
    }
  };
}
const INIT_TABLE_SQL = `CREATE TABLE IF NOT EXISTS worker_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  data TEXT
)`;
let _dbReady = false;
async function dbLog(env, ctx, level, event, data) {
  if (!env?.DB) return;
  const run = async () => {
    try {
      if (!_dbReady) {
        await env.DB.prepare(INIT_TABLE_SQL).run();
        _dbReady = true;
      }
      const payload = JSON.stringify(data || {});
      await env.DB.prepare(
        "INSERT INTO worker_logs (ts, level, event, data) VALUES (?, ?, ?, ?)"
      ).bind(Date.now(), level, event, payload).run();
    } catch {
      _dbReady = false;
    }
  };
  if (ctx?.waitUntil) ctx.waitUntil(run());
  else run().catch(() => {
  });
}
const ICON_MAP = {
  footnote: "📝 שוליים",
  endnote: "📋 סיום",
  comment: "💬 בלון"
};
async function scanNoteSources(arrayBuffer, id) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("לא התקבל קובץ DOCX.");
  if (arrayBuffer.byteLength > MAX_DOCX_BYTES) {
    const err = new Error(`DOCX גדול מדי. מגבלה: ${MAX_DOCX_BYTES} bytes.`);
    err.status = 413;
    throw err;
  }
  const started = Date.now();
  const zip = await JSZip.loadAsync(arrayBuffer);
  const sources = [];
  function noteText(innerXml) {
    const out = [];
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
    let m;
    while (m = re.exec(String(innerXml || ""))) out.push(xmlDecode(m[1]));
    return out.join("");
  }
  async function scanNoteFile(xmlFileName, noteTag, srcType, heb, positiveOnly) {
    const local = [];
    try {
      const zf = zip.file(xmlFileName);
      if (!zf) return local;
      const xml = await zf.async("string");
      const markers = {};
      let unmarked = 0;
      const noteRe = new RegExp(`<w:${noteTag}\\b([^>]*)>([\\s\\S]*?)<\\/w:${noteTag}>`, "g");
      let match;
      while ((match = noteRe.exec(xml)) !== null) {
        const attrs = match[1];
        const inner = match[2];
        const idM = attrs.match(/\bw:id="([^"]*)"/);
        if (!idM) continue;
        const idVal = parseInt(idM[1], 10);
        if (Number.isNaN(idVal)) continue;
        if (positiveOnly ? idVal <= 0 : idVal < 0) continue;
        if (/\bw:type="(?:separator|continuationSeparator)"/.test(attrs)) continue;
        const text = noteText(inner);
        const m2 = text.match(/@(\d+)/);
        if (m2) markers[m2[1]] = (markers[m2[1]] || 0) + 1;
        else unmarked++;
      }
      for (const m of Object.keys(markers).sort((a, b) => +a - +b)) {
        local.push({ id: `${srcType}_@${m}`, source_type: srcType, marker: m, has_at: true, label: `${heb} @${m}`, count: markers[m], icon: ICON_MAP[srcType] || "" });
      }
      if (unmarked > 0) {
        local.push({ id: `${srcType}_none`, source_type: srcType, marker: null, has_at: false, label: `${heb} ללא סימון (${unmarked})`, count: unmarked, icon: ICON_MAP[srcType] || "" });
      }
    } catch (e) {
    }
    return local;
  }
  const [fnSrc, enSrc, cmSrc] = await Promise.all([
    scanNoteFile("word/footnotes.xml", "footnote", "footnote", "שוליים", true),
    scanNoteFile("word/endnotes.xml", "endnote", "endnote", "סיום", true),
    scanNoteFile("word/comments.xml", "comment", "comment", "בלון", false)
  ]);
  sources.push(...fnSrc, ...enSrc, ...cmSrc);
  try {
    const docFile = zip.file("word/document.xml");
    if (docFile) {
      const docXml = await docFile.async("string");
      const docMarkers = /* @__PURE__ */ new Set();
      const reAll = /@(\d+)/g;
      let mm;
      while ((mm = reAll.exec(docXml)) !== null) docMarkers.add(mm[1]);
      const exist = new Set(sources.filter((s) => s.marker).map((s) => s.marker));
      for (const m of Array.from(docMarkers).filter((x) => !exist.has(x)).sort((a, b) => +a - +b)) {
        const c = (docXml.match(new RegExp("@" + m, "g")) || []).length;
        sources.push({ id: `inline_@${m}`, source_type: "footnote", marker: m, has_at: true, label: `inline @${m}`, count: c, icon: ICON_MAP.footnote });
      }
    }
  } catch (e) {
  }
  log("log", "streams_scan_success", { requestId: id, bytes: arrayBuffer.byteLength, sources: sources.length, elapsedMs: Date.now() - started });
  return { ok: true, serverSide: true, requestId: id, sources };
}
function isStreamsScanPath(path) {
  return path === "/api/word-streams-scan";
}
async function handleStreamsScan(request, env, ctx) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405, id);
  try {
    let arrayBuffer;
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const json2 = await request.json();
      if (!json2?.docx) throw Object.assign(new Error("JSON body missing 'docx' field."), { status: 400 });
      const raw = atob(json2.docx);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      arrayBuffer = await request.arrayBuffer();
    }
    log("log", "streams_scan_body_loaded", { requestId: id, bytes: arrayBuffer.byteLength });
    dbLog(env, ctx, "info", "streams_scan_start", { requestId: id, bytes: arrayBuffer.byteLength });
    const result = await scanNoteSources(arrayBuffer, id);
    dbLog(env, ctx, "info", "streams_scan_success", { requestId: id, sources: result.sources?.length ?? 0 });
    return jsonResponse({ ...result, scannedAt: Date.now() }, 200, id);
  } catch (error) {
    log("error", "streams_scan_failed", { requestId: id, error: error?.message || String(error) });
    dbLog(env, ctx, "error", "streams_scan_failed", { requestId: id, error: error?.message || String(error) });
    return jsonResponse({ ok: false, serverSide: true, requestId: id, error: error?.message || String(error || "Server error") }, error?.status || 500, id);
  }
}
function isDocxImportPath(path) {
  return path === "/api/ravtext-docx-import" || path === "/api/word-chapters-import" || path === "/api/word-chapters/import" || path === "/api/word-chapters-scan" || path === "/api/word-chapters/scan";
}
function isDocxExtractPath(path) {
  return path === "/api/word-chapters-extract" || path === "/api/word-chapters/extract";
}
function isClientLogPath(path) {
  return path === "/api/client-log";
}
async function handleClientLog(request, env, ctx) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405, id);
  }
  try {
    const body = await request.json().catch(() => ({}));
    const payload = { source: "browser", requestId: id, ...body };
    log("log", "client_log", payload);
    dbLog(env, ctx, "info", body.event || "client_log", payload);
  } catch {
  }
  return jsonResponse({ ok: true }, 200, id);
}
async function handleDocxApi(request, env, ctx) {
  const id = request.headers.get("x-docx-request-id") || requestId();
  const url = new URL(request.url);
  log("log", "request_received", {
    requestId: id,
    method: request.method,
    path: url.pathname,
    contentLength: request.headers.get("content-length") || "",
    contentType: request.headers.get("content-type") || ""
  });
  if (request.method === "OPTIONS") return optionsResponse(id);
  if (request.method === "GET") {
    return jsonResponse({
      ok: true,
      serverSide: true,
      service: SERVICE,
      version: VERSION,
      requestId: id,
      path: url.pathname,
      message: "Cloudflare advanced _worker.js is handling this DOCX API route."
    }, 200, id);
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, serverSide: true, requestId: id, error: "Method not allowed" }, 405, id);
  }
  try {
    let arrayBuffer;
    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      const json2 = await request.json();
      if (!json2?.docx) throw Object.assign(new Error("JSON body missing 'docx' field."), { status: 400 });
      const raw = atob(json2.docx);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      arrayBuffer = await request.arrayBuffer();
    }
    log("log", "request_body_loaded", { requestId: id, path: url.pathname, bytes: arrayBuffer.byteLength });
    dbLog(env, ctx, "info", "docx_request_start", { requestId: id, path: url.pathname, bytes: arrayBuffer.byteLength });
    if (isDocxExtractPath(url.pathname)) {
      const level = url.searchParams.get("level");
      const index2 = url.searchParams.get("index");
      const extracted = await extractChapterContent(arrayBuffer, level, index2, id);
      dbLog(env, ctx, "info", "docx_extract_success", { requestId: id, title: extracted?.title });
      return jsonResponse({ ...extracted, extractedAt: Date.now() }, 200, id);
    }
    const imported = await importDocx(arrayBuffer, id);
    dbLog(env, ctx, "info", "docx_import_success", { requestId: id, heads1: imported?.heads?.[1]?.length, heads2: imported?.heads?.[2]?.length, chars: imported?.chars });
    return jsonResponse({ ...imported, importedAt: Date.now() }, 200, id);
  } catch (error) {
    log("error", "request_failed", {
      requestId: id,
      path: url.pathname,
      error: error?.message || String(error),
      stack: error?.stack || ""
    });
    dbLog(env, ctx, "error", "docx_request_failed", { requestId: id, path: url.pathname, error: error?.message || String(error) });
    return jsonResponse({
      ok: false,
      serverSide: true,
      requestId: id,
      error: error?.message || String(error || "Server error")
    }, error?.status || 500, id);
  }
}
async function serveAdminPage(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) {
    return new Response("Not logged in", { status: 401, headers: { "cache-control": "no-store" } });
  }
  if (!user.is_admin) {
    return new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const adminUrl = new URL(request.url);
  adminUrl.pathname = "/admin.html";
  const adminReq = new Request(adminUrl.toString(), request);
  const assetResponse = await env.ASSETS.fetch(adminReq);
  const contentType = assetResponse.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && assetResponse.status >= 400) return assetResponse;
  const html = await assetResponse.text();
  const script = '<script src="/admin_troubleshooting_tab.js?v=20260518a" defer><\/script>';
  const injected = html.includes("</body>") ? html.replace("</body>", `${script}</body>`) : html + script;
  const headers = new Headers(assetResponse.headers);
  headers.delete("content-length");
  headers.set("cache-control", "no-store");
  return new Response(injected, { status: assetResponse.status, headers });
}
const index = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isBadBot(request) && url.pathname !== "/robots.txt") {
      return new Response("Forbidden", { status: 403 });
    }
    if (isEngineApi(url.pathname)) {
      const blocked = checkOrigin(request);
      if (blocked) return blocked;
    }
    const limited = await checkRateLimit(request, url);
    if (limited) return limited;
    let response;
    let isHtml = false;
    if (url.pathname.startsWith("/api/auth/")) {
      response = await handleAuth(request, env, url);
    } else if (url.pathname === "/api/me") {
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
          expiresAt: user?.expires_at ? user.expires_at * 1e3 : null,
          balanceSeconds: user?.balance_seconds || 0,
          consoleGuardEnabled
        },
        { headers: { "cache-control": "no-store" } }
      );
    } else if (url.pathname === "/api/admin/bug-reports" || url.pathname.startsWith("/api/admin/bug-reports/") || url.pathname === "/api/admin/contact-messages" || url.pathname.startsWith("/api/admin/contact-messages/") || url.pathname === "/api/admin/usage" || /^\/api\/admin\/users\/\d+\/contact-messages$/.test(url.pathname)) {
      response = await handleAdminInbox(request, env, url);
    } else if (url.pathname === "/api/admin/payment-config" || url.pathname === "/api/admin/test-packages" || url.pathname.startsWith("/api/admin/test-packages/")) {
      response = await handlePaymentAdmin(request, env, url);
    } else if (url.pathname === "/api/admin/caricature-settings") {
      response = await handleCaricatureAdmin(request, env, url);
    } else if (url.pathname === "/api/admin/video-gallery/playlist") {
      response = await handleAdminVideoGallery(request, env);
    } else if (url.pathname.startsWith("/api/admin/")) {
      response = await handleAdmin(request, env, url);
    } else if (url.pathname === "/api/bug-reports" || url.pathname === "/api/bug-reports/public" || url.pathname === "/api/contact" || url.pathname === "/api/contact/mine" || url.pathname === "/api/usage/track") {
      response = await handlePublicInbox(request, env, url);
    } else if (url.pathname === "/api/video-gallery/playlist") {
      response = await handleVideoGallery(request, env);
    } else if (url.pathname.startsWith("/api/payments/package/")) {
      response = await handlePackageLookup(request, env, url);
    } else if (url.pathname.startsWith("/api/payments/")) {
      response = await handlePayments(request, env, url);
    } else if (url.pathname.startsWith("/api/account/")) {
      response = await handleAccount(request, env, url);
    } else if (url.pathname.startsWith("/api/documents") || url.pathname === "/api/settings") {
      response = await handleStorage(request, env, url);
    } else if (url.pathname === "/api/caricature") {
      response = await handleCaricature(request, env);
    } else if (url.pathname === "/api/ai-tools/gas") {
      response = await handleAiTools(request, env);
    } else if (url.pathname === "/api/ai-tools/chat") {
      response = await handleAiChat(request);
    } else if (url.pathname === "/api/tools/preflight") {
      response = await handleToolPreflight(request, env);
    } else if (url.pathname === "/api/nikud-merger") {
      response = await handleNikudMerger(request);
    } else if (url.pathname === "/api/text-compare-pro") {
      response = await handleTextComparePro(request);
    } else if (url.pathname.startsWith("/api/sefaria/")) {
      response = await handleSefariaProxy(request, url);
    } else if (url.pathname === "/api/main-text-tools") {
      response = await handleMainTextTools(request);
    } else if (isClientLogPath(url.pathname)) {
      response = await handleClientLog(request, env, ctx);
    } else if (isStreamsScanPath(url.pathname)) {
      response = await handleStreamsScan(request, env, ctx);
    } else if (isDocxImportPath(url.pathname) || isDocxExtractPath(url.pathname)) {
      response = await handleDocxApi(request, env, ctx);
    } else if (url.pathname === "/api/admin/worker-logs") {
      const user = await getUserFromRequest(request, env);
      if (!user?.is_admin) {
        response = new Response("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
      } else {
        try {
          const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 1e3);
          const since = url.searchParams.get("since") ? parseInt(url.searchParams.get("since"), 10) : 0;
          const result = await env.DB.prepare(
            "SELECT id, ts, level, event, data FROM worker_logs WHERE ts > ? ORDER BY ts DESC LIMIT ?"
          ).bind(since, limit).all();
          response = Response.json({ ok: true, logs: result.results }, { headers: { "cache-control": "no-store" } });
        } catch (e) {
          response = Response.json({ ok: false, error: e?.message || String(e) }, { status: 500, headers: { "cache-control": "no-store" } });
        }
      }
    } else if (url.pathname === "/admin" || url.pathname === "/admin/" || url.pathname === "/admin.html") {
      response = await serveAdminPage(request, env);
      isHtml = response.headers.get("content-type")?.includes("text/html") || response.status < 400;
    } else if (url.pathname === "/api/render/preflight" && request.method === "POST") {
      response = await handlePreflight(request, env);
    } else if (url.pathname === "/api/talmud/decide" && request.method === "POST") {
      const nonceFail = await checkNonce(request, env);
      response = nonceFail || await handleTalmudDecide(request, env);
    } else if (url.pathname === "/api/balance/decide" && request.method === "POST") {
      const nonceFail = await checkNonce(request, env);
      response = nonceFail || await handleBalanceDecide(request);
    } else if (url.pathname === "/api/mishna/decide" && request.method === "POST") {
      const nonceFail = await checkNonce(request, env);
      response = nonceFail || await handleMishnaDecide(request);
    } else if (url.pathname === "/api/streams/parse" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        response = new Response("Invalid JSON", { status: 400 });
      }
      if (!response) {
        const text = String(body?.text || "");
        if (text.length > 2e5) {
          response = new Response("Text too large (max 200000 chars)", { status: 413 });
        } else {
          const result = parseStreamsToHtml(text);
          response = Response.json(result, {
            headers: { "cache-control": "no-store" }
          });
        }
      }
    } else {
      const assetResponse = await env.ASSETS.fetch(request);
      const contentType = assetResponse.headers.get("content-type") || "";
      isHtml = contentType.includes("text/html");
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
          expiresAt: user?.expires_at ? user.expires_at * 1e3 : null,
          balanceSeconds: user?.balance_seconds || 0,
          consoleGuardEnabled,
          googleClientId: env.GOOGLE_CLIENT_ID || null
        };
        const flagLines = user && user.paid ? 'window.__RAVTEXT_DEMO_MODE__ = false; try{localStorage.setItem("ravtext.demoMode","0");}catch(e){}' : 'try{localStorage.removeItem("ravtext.demoMode");}catch(e){}delete window.__RAVTEXT_DEMO_MODE__;';
        const injection = `<script>window.__RAVTEXT_AUTH__ = ${JSON.stringify(authState)};${flagLines}<\/script>`;
        const injected = html.includes("</head>") ? html.replace("</head>", `${injection}</head>`) : injection + html;
        const newHeaders = new Headers(assetResponse.headers);
        newHeaders.delete("content-length");
        newHeaders.set("cache-control", "no-store");
        response = new Response(injected, {
          status: assetResponse.status,
          headers: newHeaders
        });
      }
    }
    return applySecurityHeaders(response, isHtml);
  },
  // משה 2026-05-10: cron יומי — חיוב חוזר אוטומטי. רץ כל בוקר ב-04:00 UTC.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runRecurringBilling(env).catch(() => null));
  }
};
export {
  index as default
};
