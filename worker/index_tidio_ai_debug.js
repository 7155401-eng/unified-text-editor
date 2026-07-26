import app from './index_tidio.js';

const AI_GAS_PATH = '/api/ai-tools/gas';

function id() {
  try { return crypto.randomUUID(); } catch (_) {}
  return `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cut(v, n = 1200) {
  const s = v == null ? '' : String(v);
  return s.length > n ? `${s.slice(0, n)}...[truncated ${s.length - n}]` : s;
}

function provider(body) {
  const pt = String(body?.prompt_type || '');
  const m = String(body?.model || '').toLowerCase();
  if (pt === 'elevenlabs_transcribe' || m.startsWith('elevenlabs')) return 'elevenlabs';
  if (m.startsWith('gemini')) return 'gemini';
  if (m.startsWith('claude')) return 'claude';
  return m ? (m.split('-')[0] || 'unknown') : 'unknown';
}

function filesSummary(files) {
  if (!Array.isArray(files)) return [];
  return files.slice(0, 8).map((f, i) => ({
    i,
    name: cut(f?.name || '', 120),
    type: f?.type || null,
    mime: f?.mime || null,
    base64_chars: f?.content_base64 ? String(f.content_base64).length : 0,
  }));
}

function reqSummary(body) {
  return {
    prompt_type: body?.prompt_type || null,
    provider: provider(body),
    model: body?.model || null,
    use_premium: body?.use_premium === true,
    has_api_key: !!body?.api_key,
    api_key_chars: body?.api_key ? String(body.api_key).length : 0,
    has_access_code: !!body?.access_code,
    access_code_chars: body?.access_code ? String(body.access_code).length : 0,
    files_count: Array.isArray(body?.files) ? body.files.length : 0,
    files: filesSummary(body?.files),
    ocr_examples_count: Array.isArray(body?.ocr_examples) ? body.ocr_examples.length : 0,
    text_chars: body?.text ? String(body.text).length : 0,
    custom_prompt_chars: body?.custom_prompt ? String(body.custom_prompt).length : 0,
    engines_used: Array.isArray(body?.engines_used) ? body.engines_used : undefined,
    preferred_engine: body?.preferred_engine || undefined,
    language_code: body?.language_code || undefined,
  };
}

function redact(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  const out = {};
  for (const [k, val] of Object.entries(v)) {
    if (/api[_-]?key|access[_-]?code|token|secret|password|authorization/i.test(k)) {
      out[k] = val ? `[redacted ${String(val).length} chars]` : '';
    } else if (k === 'files' || k === 'ocr_examples' || k === 'text' || k === 'content_base64') {
      out[k] = Array.isArray(val) ? `[omitted array ${val.length}]` : `[omitted ${String(val || '').length} chars]`;
    } else out[k] = redact(val);
  }
  return out;
}

function parse(text) {
  try { return { ok: true, data: JSON.parse(text || '{}') }; }
  catch (e) { return { ok: false, error: e?.message || String(e) }; }
}

function cause(status, data, summary) {
  const s = `${data?.error || ''} ${data?.message || ''}`.toLowerCase();
  if (s.includes('invalid_api_key') || s.includes('invalid api key') || status === 401 || status === 403) return 'provider_rejected_user_api_key_or_key_does_not_match_selected_provider';
  if (s.includes('quota') || s.includes('rate limit') || status === 429) return 'provider_quota_or_rate_limit';
  if (s.includes('timeout') || status === 504) return 'timeout';
  if (status === 413) return 'request_too_large';
  if (!summary.has_api_key && !summary.has_access_code) return 'missing_user_api_key_or_access_code';
  if (status >= 500) return 'server_or_proxy_error';
  return 'unclassified_ai_tool_error';
}

function detailText(d) {
  return [
    'Detailed AI error log',
    `debug_id=${d.debug_id}`,
    `time=${d.time}`,
    `stage=${d.stage}`,
    `http_status=${d.http_status}`,
    `duration_ms=${d.duration_ms}`,
    `provider=${d.request.provider}`,
    `model=${d.request.model || 'none'}`,
    `prompt_type=${d.request.prompt_type || 'none'}`,
    `has_api_key=${d.request.has_api_key}`,
    `api_key_chars=${d.request.api_key_chars}`,
    `has_access_code=${d.request.has_access_code}`,
    `files_count=${d.request.files_count}`,
    `text_chars=${d.request.text_chars}`,
    `possible_cause=${d.possible_cause}`,
    d.upstream_error ? `upstream_error=${d.upstream_error}` : '',
    d.upstream_message ? `upstream_message=${cut(d.upstream_message, 900)}` : '',
    d.response_preview ? `response_preview=${d.response_preview}` : '',
  ].filter(Boolean).join('\n');
}

function errLog(d, warn = false) {
  try {
    const line = `[ai-debug] ${JSON.stringify(redact(d))}`;
    warn ? console.warn(line) : console.error(line);
  } catch (e) {
    try { console.error('[ai-debug] log_failed', e?.message || e); } catch (_) {}
  }
}

async function bodyInfo(request) {
  try {
    const text = await request.clone().text();
    const p = parse(text);
    return { text, json: p.ok ? p.data : {}, parse_error: p.ok ? null : p.error };
  } catch (e) {
    return { text: '', json: {}, parse_error: e?.message || String(e) };
  }
}

function headersFrom(response, debugId) {
  const h = new Headers(response.headers);
  h.delete('content-length');
  h.set('cache-control', 'no-store');
  h.set('x-ravtext-debug-id', debugId);
  return h;
}

async function aiGas(request, env, ctx, url) {
  const debugId = id();
  const started = Date.now();
  const info = await bodyInfo(request);
  const summary = reqSummary(info.json);
  const base = { debug_id: debugId, time: new Date().toISOString(), method: request.method, path: url.pathname, request: summary, request_parse_error: info.parse_error || undefined };

  try { console.log(`[ai-debug] start ${JSON.stringify(redact(base))}`); } catch (_) {}

  let response;
  try {
    response = await app.fetch(request, env, ctx);
  } catch (e) {
    const d = { ...base, stage: 'worker_exception', http_status: 500, duration_ms: Date.now() - started, exception: e?.name || 'Error', exception_message: e?.message || String(e), stack: cut(e?.stack || '', 1600), possible_cause: 'unhandled_worker_exception' };
    errLog(d);
    return Response.json({ error: 'ai_tool_detailed_error', message: detailText(d), debug_id: debugId, error_details: d }, { status: 500, headers: { 'cache-control': 'no-store', 'x-ravtext-debug-id': debugId } });
  }

  const text = await response.text();
  const p = parse(text);
  const h = headersFrom(response, debugId);

  if (response.ok && p.ok && !p.data?.error) {
    try { console.log(`[ai-debug] ok ${JSON.stringify({ debug_id: debugId, status: response.status, duration_ms: Date.now() - started, provider: summary.provider, model: summary.model, prompt_type: summary.prompt_type })}`); } catch (_) {}
    return new Response(text, { status: response.status, statusText: response.statusText, headers: h });
  }

  const d = {
    ...base,
    stage: p.ok ? 'worker_or_provider_error' : 'non_json_error',
    http_status: response.status,
    duration_ms: Date.now() - started,
    upstream_error: p.ok ? (p.data?.error || null) : 'non_json_response',
    upstream_message: p.ok ? (p.data?.message || null) : null,
    response_chars: text.length,
    response_preview: p.ok ? cut(JSON.stringify(redact(p.data)), 1600) : cut(text, 1600),
    possible_cause: cause(response.status, p.ok ? p.data : null, summary),
  };
  errLog(d, response.status === 429);

  const payload = p.ok && p.data && typeof p.data === 'object' ? { ...p.data } : { original_error: 'non_json_response' };
  payload.original_error = payload.error || payload.original_error || undefined;
  payload.error = 'ai_tool_detailed_error';
  payload.message = detailText(d);
  payload.debug_id = debugId;
  payload.error_details = d;

  return Response.json(payload, { status: response.status || 500, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === AI_GAS_PATH) return aiGas(request, env, ctx, url);
    return app.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') return app.scheduled(event, env, ctx);
  },
};
