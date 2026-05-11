import { getUserFromRequest } from './session.js';

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw/exec';
const MAX_DETAIL = 1800;
const MAX_PREVIEW = 220;

function jsonResponse(body, status) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  });
}

function clip(value, max) {
  const s = String(value == null ? '' : value);
  return s.length > max ? s.slice(0, max) : s;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function getAppSetting(env, key) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT value FROM app_settings WHERE key = ?'
    ).bind(key).first();
    return row && row.value != null ? String(row.value) : null;
  } catch {
    return null;
  }
}

async function getCaricatureGasUrl(env) {
  const fromEnv = String(env.CARICATURE_GAS_URL || '').trim();
  if (fromEnv) return fromEnv;

  const fromDb = String(await getAppSetting(env, 'CARICATURE_GAS_URL') || '').trim();
  if (fromDb) return fromDb;

  return DEFAULT_GAS_URL;
}

function summarizeRequestBody(bodyJson) {
  const sceneText = String(bodyJson?.scene_text || '').trim();
  return {
    prompt_type: clip(bodyJson?.prompt_type, 80),
    model: clip(bodyJson?.model || bodyJson?.image_model || '', 120),
    style_key: clip(bodyJson?.style_key, 180),
    aspect: clip(bodyJson?.aspect, 30),
    count: Math.max(0, Math.min(Number(bodyJson?.count) || 0, 20)),
    polish: !!bodyJson?.polish,
    negative_len: String(bodyJson?.negative || '').length,
    scene_text_len: sceneText.length,
    // Privacy: never store the full prompt/scene by default.
    scene_text_preview: clip(sceneText.replace(/\s+/g, ' '), MAX_PREVIEW),
  };
}

function summarizeUpstream(upstreamStatus, responseJson, responseText, durationMs) {
  const images = Array.isArray(responseJson?.images) ? responseJson.images : [];
  const errorCode = responseJson?.error || (!upstreamStatus || upstreamStatus >= 400 ? `http_${upstreamStatus}` : null);
  const message = responseJson?.message || responseJson?.error_message || (!responseJson ? clip(responseText, 500) : '');
  return {
    upstream_status: upstreamStatus,
    status: upstreamStatus >= 200 && upstreamStatus < 300 && images.length > 0 && !responseJson?.error ? 'success' : 'error',
    image_count: images.length,
    error_code: errorCode ? clip(errorCode, 120) : null,
    error_message: errorCode ? clip(message || errorCode, 700) : null,
    duration_ms: durationMs,
  };
}

async function logCaricatureUsage(env, request, requestBodyJson, upstreamSummary, startedMs) {
  if (!env.DB) return;

  let user = null;
  try { user = await getUserFromRequest(request, env); } catch { user = null; }

  const req = summarizeRequestBody(requestBodyJson || {});
  const summary = upstreamSummary || {
    status: 'error',
    image_count: 0,
    error_code: 'proxy_fetch_failed',
    error_message: 'Request failed before upstream response',
    duration_ms: Date.now() - startedMs,
  };

  const detail = clip(JSON.stringify({
    tool: 'haredi-caricature',
    action: 'generate',
    ...req,
    ...summary,
  }), MAX_DETAIL);

  try {
    await env.DB.prepare(
      `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      user?.id || null,
      user?.email || null,
      'haredi_caricature_generate',
      detail,
      nowSec()
    ).run();
  } catch {
    // Logging must never break image generation.
  }
}

export async function handleCaricature(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return jsonResponse({
      error: 'method_not_allowed',
      message: 'Use POST',
    }, 405);
  }

  const startedMs = Date.now();
  let body = '';
  let bodyJson = null;

  try {
    body = await request.text();
    bodyJson = safeJsonParse(body);
  } catch (error) {
    await logCaricatureUsage(env, request, null, {
      status: 'error',
      image_count: 0,
      error_code: 'bad_request_body',
      error_message: error && error.message ? error.message : String(error),
      duration_ms: Date.now() - startedMs,
    }, startedMs);
    return jsonResponse({ error: 'bad_request_body', message: 'Could not read request body' }, 400);
  }

  const gasUrl = (await getCaricatureGasUrl(env)).trim();
  if (!gasUrl) {
    await logCaricatureUsage(env, request, bodyJson, {
      status: 'error',
      image_count: 0,
      error_code: 'server_error',
      error_message: 'Caricature GAS URL is not configured',
      duration_ms: Date.now() - startedMs,
    }, startedMs);
    return jsonResponse({
      error: 'server_error',
      message: 'Caricature GAS URL is not configured',
    }, 500);
  }

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body,
    });

    const text = await upstream.text();
    const responseJson = safeJsonParse(text);
    const summary = summarizeUpstream(upstream.status, responseJson, text, Date.now() - startedMs);
    await logCaricatureUsage(env, request, bodyJson, summary, startedMs);

    return new Response(text, {
      status: upstream.status,
      headers: {
        'cache-control': 'no-store',
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    const summary = {
      status: 'error',
      image_count: 0,
      error_code: 'proxy_fetch_failed',
      error_message: error && error.message ? error.message : String(error),
      duration_ms: Date.now() - startedMs,
    };
    await logCaricatureUsage(env, request, bodyJson, summary, startedMs);
    return jsonResponse({
      error: 'proxy_fetch_failed',
      message: summary.error_message,
    }, 502);
  }
}
