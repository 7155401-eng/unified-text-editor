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
  "תוצר ניסיוני — רב טקסט AI",
];

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const DEMO_BLOCK_MS = 5 * 60 * 1000;

function randomToken() {
  try {
    const bytes = new Uint8Array(8);
    globalThis.crypto?.getRandomValues?.(bytes);
    return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  } catch (_) {
    return Math.random().toString(36).slice(2, 14);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requestTriesToDisableWatermark(payload) {
  const checks = [
    payload?.removeWatermark === true,
    payload?.hideWatermark === true,
    payload?.watermark === false,
    payload?.forceWatermark === false,
    payload?.demoWatermark === false,
    payload?.watermarkOpacity === 0,
    payload?.watermarkOpacity === "0",
  ];
  return checks.some(Boolean);
}

async function resolveUserFromExistingAuth(request, env, options) {
  const resolver = options?.getUserFromRequest;
  if (typeof resolver !== "function") return null;
  try {
    return await resolver(request, env);
  } catch (err) {
    console.warn("[secure-export] user resolution failed", err);
    return null;
  }
}

function watermarkStyle(className) {
  return `<style data-ravtext-server-watermark="1">
.${className}{display:inline!important;color:#991b1b!important;background:rgba(254,226,226,.92)!important;border:1px solid rgba(153,27,27,.45)!important;padding:0 .18em!important;margin:0 .1em!important;font-weight:700!important;white-space:normal!important;opacity:1!important;visibility:visible!important;pointer-events:none!important;user-select:none!important}
</style>`;
}

function makeMark(className, index) {
  const text = WATERMARK_TEXTS[index % WATERMARK_TEXTS.length];
  return ` <span class="${className}" data-ravtext-server-watermark="1">${escapeHtml(text)}</span> `;
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

export function addServerWatermarksToHtml(html) {
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

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function handleSecureExportHtmlRequest(request, env = {}, options = {}) {
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  const raw = await request.text();
  if (raw.length > MAX_HTML_BYTES) return jsonResponse({ error: "payload_too_large" }, 413);

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch (_) {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const user = await resolveUserFromExistingAuth(request, env, options);
  const paid = !!user?.paid;

  if (!paid && requestTriesToDisableWatermark(payload)) {
    return jsonResponse({ error: "watermark_tampering", blocked: true }, 403, {
      "set-cookie": `ravtext_demo_blocked_until=${Date.now() + DEMO_BLOCK_MS}; Path=/; SameSite=Lax`,
    });
  }

  const html = String(payload.html || "");
  if (!html.trim()) return jsonResponse({ error: "empty_html" }, 400);

  const finalHtml = paid ? html : addServerWatermarksToHtml(html);
  return new Response(finalHtml, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-ravtext-auth-source": options?.getUserFromRequest ? "ravtext_session" : "none",
      "x-ravtext-user-paid": paid ? "1" : "0",
      "x-ravtext-watermark-forced": paid ? "0" : "1",
    },
  });
}
