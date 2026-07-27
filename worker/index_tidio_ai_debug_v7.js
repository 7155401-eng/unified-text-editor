import app from './index_tidio_ai_debug_v5.js';

const GAS_PATH = '/api/ai-tools/gas';
const DIAGNOSE_PATH = '/api/ai-tools/diagnose-key';

function cleanSecret(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, '');
}

function readGeminiKey(body) {
  if (!body || typeof body !== 'object') return '';
  return cleanSecret(body.api_key || body.gemini_api_key || body.key || '');
}

function isGeminiRequest(body) {
  if (!body || typeof body !== 'object') return false;
  const provider = String(body.provider || body.engine || '').toLowerCase();
  const model = String(body.model || body.model_name || '').toLowerCase();
  return provider === 'gemini' || model.startsWith('gemini') || model.startsWith('models/gemini');
}

function geminiFormatHint(key) {
  return cleanSecret(key) ? 'gemini_key_present_format_not_validated' : 'missing';
}

function patchText(value, hint) {
  return String(value)
    .replaceAll('gemini_key_should_start_with_A...', hint)
    .replaceAll('gemini_key_should_start_with_AIza', hint)
    .replaceAll('gemini_prefix_unexpected', hint)
    .replaceAll('gemini_api_key_format_looks_wrong_or_key_was_rejected', 'gemini_api_key_rejected_by_provider_or_not_enabled')
    .replaceAll('api_key_format_hint=gemini_key_should_start_with_A...', `api_key_format_hint=${hint}`)
    .replaceAll('api_key_format_hint=gemini_prefix_unexpected', `api_key_format_hint=${hint}`);
}

function patchPayload(value, hint, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return patchText(value, hint);
  if (depth > 12) return value;
  if (Array.isArray(value)) return value.map((item) => patchPayload(item, hint, depth + 1));

  if (typeof value === 'object') {
    const out = { ...value };
    for (const key of Object.keys(out)) out[key] = patchPayload(out[key], hint, depth + 1);

    if ('api_key_format_hint' in out) out.api_key_format_hint = hint;
    if (out.request && typeof out.request === 'object' && 'api_key_format_hint' in out.request) {
      out.request = { ...out.request, api_key_format_hint: hint };
    }

    if (out.possible_cause === 'gemini_api_key_format_looks_wrong_or_key_was_rejected') {
      out.possible_cause = 'gemini_api_key_rejected_by_provider_or_not_enabled';
    }

    return out;
  }

  return value;
}

async function readJsonBody(request) {
  if (request.method !== 'POST') return {};
  try {
    const text = await request.clone().text();
    return JSON.parse(text || '{}') || {};
  } catch (_) {
    return {};
  }
}

function cloneHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return headers;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isAiToolPath = url.pathname === GAS_PATH || url.pathname === DIAGNOSE_PATH;
    if (!isAiToolPath || request.method !== 'POST') {
      return app.fetch(request, env, ctx);
    }

    const body = await readJsonBody(request);
    const key = readGeminiKey(body);
    const shouldPatch = isGeminiRequest(body) && !!key;
    if (!shouldPatch) return app.fetch(request, env, ctx);

    const hint = geminiFormatHint(key);
    const response = await app.fetch(request, env, ctx);
    const headers = cloneHeaders(response);
    const text = await response.text();

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return new Response(patchText(text, hint), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const patched = patchPayload(data, hint);
    if (patched && typeof patched === 'object') patched.api_key_format_hint = patched.api_key_format_hint || hint;
    if (!headers.get('content-type')?.includes('application/json')) {
      headers.set('content-type', 'application/json; charset=utf-8');
    }

    return Response.json(patched, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
