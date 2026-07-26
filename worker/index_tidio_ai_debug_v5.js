
import app from './index_tidio_ai_debug_v4.js';
import { getUserFromRequest } from './session.js';

const DIAGNOSE_PATH = '/api/ai-tools/diagnose-key';

function debugId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (_) {}
  return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cleanSecret(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/\s+/g, '');
}

function cut(value, limit = 1400) {
  const text = value == null ? '' : String(value);
  return text.length > limit ? `${text.slice(0, limit)}...[truncated ${text.length - limit}]` : text;
}

function redact(value) {
  return cut(String(value || '')
    .replace(/key=([^&\s"'<>]+)/gi, 'key=[redacted]')
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted-google-key]')
    .replace(/sk-ant-[0-9A-Za-z_\-]{20,}/g, '[redacted-anthropic-key]')
    .replace(/sk_[0-9A-Za-z_\-]{20,}/g, '[redacted-elevenlabs-key]')
    .replace(/Bearer\s+[0-9A-Za-z._\-]{20,}/gi, 'Bearer [redacted]'));
}

function keyHint(provider, key) {
  if (!key) return 'missing';
  if (provider === 'gemini') return key.startsWith('AIza') ? 'gemini_prefix_ok' : 'gemini_key_should_start_with_A...';
  if (provider === 'claude') return key.startsWith('sk-ant-') ? 'claude_prefix_ok' : 'claude_key_should_start_with_sk-ant-';
  if (provider === 'elevenlabs') return key.startsWith('sk_') ? 'elevenlabs_prefix_ok' : 'elevenlabs_key_should_start_with_sk_';
  return 'unknown_provider';
}

function looksLikeInvalidKey(text) {
  const s = String(text || '').toLowerCase();
  return s.includes('api key not valid') ||
    s.includes('invalid api key') ||
    s.includes('invalid_api_key') ||
    s.includes('api_key_invalid') ||
    s.includes('key is invalid') ||
    (s.includes('invalid_argument') && s.includes('api key'));
}

function normalizeModelName(model) {
  const raw = String(model || '').trim();
  if (!raw) return '';
  return raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
}

async function readJson(request) {
  try {
    const text = await request.text();
    return JSON.parse(text || '{}');
  } catch (error) {
    return { __parse_error: error?.message || String(error) };
  }
}

function makeResult(debug_id, data, status = 200) {
  return Response.json({
    ok: status >= 200 && status < 300,
    debug_id,
    ...data,
  }, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-ravtext-debug-id': debug_id,
    },
  });
}

async function diagnoseGemini(debug_id, apiKey, model) {
  const key = cleanSecret(apiKey);
  const beforeLength = String(apiKey == null ? '' : apiKey).length;
  const removedChars = beforeLength - key.length;
  const modelName = normalizeModelName(model);

  const base = {
    provider: 'gemini',
    model: modelName || null,
    has_api_key: !!key,
    api_key_chars: key.length,
    api_key_sanitized: removedChars > 0,
    api_key_removed_chars: removedChars,
    api_key_format_hint: keyHint('gemini', key),
    checks: [],
  };

  if (!key) {
    return { status: 400, data: { ...base, key_valid: false, possible_cause: 'missing_user_api_key' } };
  }

  let modelsData = null;
  let modelsText = '';
  let listStatus = 0;
  try {
    const listResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
      method: 'GET',
      headers: { 'accept': 'application/json' },
    });
    listStatus = listResp.status;
    modelsText = await listResp.text();
    base.checks.push({
      name: 'gemini_models_list_key_check',
      http_status: listStatus,
      ok: listResp.ok,
      response_preview: redact(modelsText),
    });

    try { modelsData = JSON.parse(modelsText || '{}'); } catch (_) {}

    if (!listResp.ok) {
      const invalid = looksLikeInvalidKey(modelsText);
      return {
        status: invalid ? 401 : (listStatus || 502),
        data: {
          ...base,
          key_valid: false,
          model_available: null,
          upstream_http_status: listStatus,
          upstream_message: redact(modelsText),
          possible_cause: invalid ? 'gemini_rejected_user_api_key' : 'gemini_key_check_failed_before_transcription',
        },
      };
    }
  } catch (error) {
    return {
      status: 502,
      data: {
        ...base,
        key_valid: null,
        model_available: null,
        possible_cause: 'network_or_proxy_error_during_key_check',
        upstream_message: redact(error?.message || String(error)),
      },
    };
  }

  let modelAvailable = null;
  let listedModels = [];
  if (modelsData && Array.isArray(modelsData.models)) {
    listedModels = modelsData.models.map((m) => String(m.name || '').replace(/^models\//, '')).filter(Boolean);
    if (modelName) modelAvailable = listedModels.includes(modelName);
  }

  let generationCheck = null;
  if (modelName) {
    try {
      const genResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'ping' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 4 },
        }),
      });
      const genText = await genResp.text();
      generationCheck = {
        name: 'gemini_tiny_generation_check',
        http_status: genResp.status,
        ok: genResp.ok,
        response_preview: redact(genText),
      };
      base.checks.push(generationCheck);

      if (!genResp.ok) {
        const invalid = looksLikeInvalidKey(genText);
        return {
          status: invalid ? 401 : (genResp.status || 502),
          data: {
            ...base,
            key_valid: !invalid,
            model_available: modelAvailable,
            tiny_generation_ok: false,
            upstream_http_status: genResp.status,
            upstream_message: redact(genText),
            possible_cause: invalid ? 'gemini_rejected_user_api_key' : (modelAvailable === false ? 'model_not_available_for_this-key_or_region' : 'gemini_tiny_generation_failed'),
          },
        };
      }
    } catch (error) {
      return {
        status: 502,
        data: {
          ...base,
          key_valid: true,
          model_available: modelAvailable,
          tiny_generation_ok: null,
          possible_cause: 'network_or_proxy_error_during_generation_check',
          upstream_message: redact(error?.message || String(error)),
        },
      };
    }
  }

  return {
    status: 200,
    data: {
      ...base,
      key_valid: true,
      model_available: modelAvailable,
      tiny_generation_ok: modelName ? true : null,
      available_models_sample: listedModels.slice(0, 20),
      possible_cause: modelName && modelAvailable === false
        ? 'key_is_valid_but_selected_model_was_not_in_models_list'
        : 'key_valid_in_isolated_check',
    },
  };
}

async function diagnoseKey(request, env) {
  const debug_id = debugId();

  let user = null;
  try {
    user = await getUserFromRequest(request, env);
  } catch (_) {}

  if (!user) {
    return makeResult(debug_id, {
      error: 'not_logged_in',
      message: 'יש להתחבר לפני בדיקת מפתח.',
    }, 401);
  }

  const body = await readJson(request);
  if (body.__parse_error) {
    return makeResult(debug_id, {
      error: 'invalid_json',
      message: 'גוף הבקשה אינו �SON תקין.',
      detail: body.__parse_error,
    }, 400);
  }

  const provider = String(body.provider || body.engine || 'gemini').toLowerCase();
  const apiKey = body.api_key || body.gemini_api_key || body.key || '';
  const model = body.model || body.model_name || '';

  if (provider !== 'gemini') {
    const key = cleanSecret(apiKey);
    return makeResult(debug_id, {
      error: 'unsupported_provider_for_isolated_diagnosis',
      provider,
      message: 'בדיקת בידוד אוטומטית קיימת כרגע קיימת כרגע ל-Gemini בלבד.',
      api_key_format_hint: keyHint(provider, key),
      has_api_key: !!key,
      api_key_chars: key.length,
    }, 400);
  }

  const started = Date.now();
  const result = await diagnoseGemini(debug_id, apiKey, model);
  const payload = {
    ...result.data,
    duration_ms: Date.now() - started,
  };

  try {
    console.log('[ai-key-diagnose] ' + JSON.stringify({
      debug_id,
      user_id: user.id || user.user_id || null,
      provider: payload.provider,
      model: payload.model,
      key_valid: payload.key_valid,
      model_available: payload.model_available,
      tiny_generation_ok: payload.tiny_generation_ok,
      status: result.status,
      possible_cause: payload.possible_cause,
      api_key_chars: payload.api_key_chars,
      api_key_format_hint: payload.api_key_format_hint,
      api_key_sanitized: payload.api_key_sanitized,
      api_key_removed_chars: payload.api_key_removed_chars,
      duration_ms: payload.duration_ms,
    }));
  } catch (_) {}

  return makeResult(debug_id, payload, result.status);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === DIAGNOSE_PATH) {
      if (request.method !== 'POST') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { 'cache-control': 'no-store' } });
      }
      return diagnoseKey(request, env);
    }
    return app.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
