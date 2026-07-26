
import app from './index_tidio_ai_debug_v2.js';

const GAS = '/api/ai-tools/gas';

function cleanSecret(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, '');
}

function providerOf(body) {
  const prompt = String(body?.prompt_type || '');
  const model = String(body?.model || '').toLowerCase();
  if (prompt === 'elevenlabs_transcribe' || model.startsWith('elevenlabs')) return 'elevenlabs';
  if (model.startsWith('gemini')) return 'gemini';
  if (model.startsWith('claude')) return 'claude';
  return model ? model.split('-')[0] : 'unknown';
}

function keyHint(provider, key) {
  const k = String(key || '');
  if (!k) return 'missing';
  if (provider === 'gemini') return k.startsWith('AIza') ? 'gemini_prefix_ok' : 'gemini_key_should_start_with_A...';
  if (provider === 'claude') return k.startsWith('sk-ant-') ? 'claude_prefix_ok' : 'claude_key_should_start_with_sk-ant-';
  if (provider === 'elevenlabs') return k.startsWith('sk_') ? 'elevenlabs_prefix_ok' : 'elevenlabs_key_should_start_with_sk_';
  return 'unknown_provider';
}

function looksLikeInvalidKey(data) {
  const text = `${data?.error || ''} ${data?.message || ''} ${JSON.stringify(data || {})}`.toLowerCase();
  return (
    text.includes('api key not valid') ||
    text.includes('invalid api key') ||
    text.includes('invalid_api_key') ||
    text.includes('api_key_invalid') ||
    text.includes('api key invalid') ||
    text.includes('key is invalid') ||
    (text.includes('invalid_argument') && text.includes('api key')) ||
    (text.includes('code') && text.includes('400') && text.includes('api key'))
  );
}

function rewriteInvalidKeyPayload(data, provider, key, sanitizeInfo) {
  const out = data && typeof data === 'object' ? { ...data } : {};
  const d = out.error_details && typeof out.error_details === 'object' ? { ...out.error_details } : {};
  d.http_status = 401;
  d.possible_cause = provider === 'gemini' && keyHint(provider, key) !== 'gemini_prefix_ok'
    ? 'gemini_api_key_format_looks_wrong_or_key_was_rejected'
    : 'provider_rejected_user_api_key_or_wrong_provider';
  d.request = { ...(d.request || {}) };
  d.request.provider = d.request.provider || provider;
  d.request.api_key_format_hint = keyHint(provider, key);
  d.request.api_key_sanitized = !!sanitizeInfo.api_key_sanitized;
  d.request.api_key_removed_chars = sanitizeInfo.api_key_removed_chars || 0;
  out.error = 'ai_tool_detailed_error';
  out.original_error = out.original_error || 'invalid_api_key';
  out.debug_id = out.debug_id || d.debug_id;
  out.error_details = d;
  const suffix = [
    '',
    'פירוש קצר: המפתח האישי נשלח ל-Gemini, אבל Gemini דחה אותו.',
    'בדוק שזה מפתח Google AI Studio/Gemini תקין, בלי רווחים או שורות, ושהוא לא מפתח של ספק אחר.',
    `api_key_format_hint=${d.request.api_key_format_hint}`,
    `api_key_sanitized=${d.request.api_key_sanitized}`,
    `api_key_removed_chars=${d.request.api_key_removed_chars}`,
  ].join('\n');
  out.message = String(out.message || 'שגיאת מפתח API') + suffix;
  return out;
}

async function normalizeRequest(request) {
  if (request.method !== 'POST') {
    return { request, body: {}, sanitizeInfo: { api_key_sanitized: false, api_key_removed_chars: 0 } };
  }

  let raw = '';
  try {
    raw = await request.clone().text();
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object') throw new Error('body_not_object');

    let changed = false;
    let apiRemoved = 0;
    let accessRemoved = 0;
    const next = { ...body };

    if (next.api_key != null) {
      const before = String(next.api_key);
      const after = cleanSecret(before);
      apiRemoved = before.length - after.length;
      if (before !== after) {
        next.api_key = after;
        changed = true;
      }
    }

    if (next.access_code != null) {
      const before = String(next.access_code);
      const after = cleanSecret(before);
      accessRemoved = before.length - after.length;
      if (before !== after) {
        next.access_code = after;
        changed = true;
      }
    }

    if (!changed) {
      return { request, body: next, sanitizeInfo: { api_key_sanitized: false, api_key_removed_chars: 0, access_code_sanitized: false, access_code_removed_chars: 0 } };
    }

    const headers = new Headers(request.headers);
    headers.set('content-type', 'text/plain;charset=utf-8');
    return {
      request: new Request(request, { body: JSON.stringify(next), headers }),
      body: next,
      sanitizeInfo: {
        api_key_sanitized: apiRemoved > 0,
        api_key_removed_chars: apiRemoved,
        access_code_sanitized: accessRemoved > 0,
        access_code_removed_chars: accessRemoved,
      },
    };
  } catch (_) {
    return { request, body: {}, sanitizeInfo: { api_key_sanitized: false, api_key_removed_chars: 0 } };
  }
}

function headersFrom(response) {
  const h = new Headers(response.headers);
  h.delete('content-length');
  h.set('cache-control', 'no-store');
  return h;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== GAS) return app.fetch(request, env, ctx);

    const normalized = await normalizeRequest(request);
    const provider = providerOf(normalized.body);
    const apiKey = normalized.body?.api_key ? String(normalized.body.api_key) : '';

    const response = await app.fetch(normalized.request, env, ctx);
    const text = await response.text();
    const headers = headersFrom(response);

    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (data && looksLikeInvalidKey(data)) {
      const payload = rewriteInvalidKeyPayload(data, provider, apiKey, normalized.sanitizeInfo);
      return Response.json(payload, { status: 401, headers });
    }

    if (data?.error_details?.request && normalized.sanitizeInfo.api_key_sanitized) {
      data.error_details.request.api_key_sanitized = true;
      data.error_details.request.api_key_removed_chars = normalized.sanitizeInfo.api_key_removed_chars;
      data.message = String(data.message || '') +
        `\napi_key_sanitized=true\napi_key_removed_chars=${normalized.sanitizeInfo.api_key_removed_chars}`;
      return Response.json(data, { status: response.status, headers });
    }

    return new Response(text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
