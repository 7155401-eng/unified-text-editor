import { getUserFromRequest } from './session.js';

const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw/exec';
const DEFAULT_IMAGE_MODEL = 'gemini-3-pro-image-preview';
const MAX_DETAIL = 1800;
const MAX_PREVIEW = 220;
const MAX_SCENE_TEXT = 8000;
const MAX_COUNT = 4;

const DEFAULT_SYSTEM_PROMPT = [
  'You are a server-side image generator for a Hebrew/English caricature tool.',
  'Create a clean, family-friendly editorial caricature illustration from the user scene.',
  'Do not include signatures, artist names, watermarks, logos, copyright marks, or hidden corner text.',
  'Return image output, not a text-only answer.'
].join('\n');

const DEFAULT_HARD_RULES = [
  'No signature. No watermark. No artist name. No logo. No copyright mark.',
  'No unrelated text unless the user explicitly requested visible text as part of the scene.',
  'Keep the output safe, non-explicit, and family-friendly.'
].join('\n');

function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
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

function normalizeText(value, max = MAX_SCENE_TEXT) {
  return clip(String(value || '')
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim(), max);
}

async function getAppSetting(env, key) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first();
    return row && row.value != null ? String(row.value) : null;
  } catch {
    return null;
  }
}

async function getSetting(env, key, fallback = '') {
  const fromEnv = env && env[key] != null ? String(env[key]).trim() : '';
  if (fromEnv) return fromEnv;
  const fromDb = String(await getAppSetting(env, key) || '').trim();
  return fromDb || fallback;
}

async function getBoolSetting(env, key, fallback = false) {
  const v = String(await getSetting(env, key, fallback ? '1' : '0')).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(v);
}

async function getCaricatureGasUrl(env) {
  return await getSetting(env, 'CARICATURE_GAS_URL', DEFAULT_GAS_URL);
}

async function getCaricatureConfig(env) {
  return {
    apiKey: await getSetting(env, 'GEMINI_API_KEY', ''),
    imageModel: await getSetting(env, 'CARICATURE_IMAGE_MODEL', DEFAULT_IMAGE_MODEL),
    systemPrompt: await getSetting(env, 'CARICATURE_SYSTEM_PROMPT', DEFAULT_SYSTEM_PROMPT),
    hardRules: await getSetting(env, 'CARICATURE_HARD_RULES', DEFAULT_HARD_RULES),
    negativeDefault: await getSetting(env, 'CARICATURE_NEGATIVE_DEFAULT', ''),
    referenceImageB64: await getSetting(env, 'CARICATURE_REFERENCE_IMAGE_B64', ''),
    referenceImageMime: await getSetting(env, 'CARICATURE_REFERENCE_IMAGE_MIME', 'image/jpeg'),
    useGasFallback: await getBoolSetting(env, 'CARICATURE_USE_GAS_FALLBACK', true),
    debug: await getBoolSetting(env, 'CARICATURE_DEBUG', false),
  };
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

function summarizeResult(responseJson, statusCode, durationMs) {
  const images = Array.isArray(responseJson?.images) ? responseJson.images : [];
  const errorCode = responseJson?.error || (statusCode >= 400 ? `http_${statusCode}` : null);
  return {
    upstream_status: statusCode,
    status: statusCode >= 200 && statusCode < 300 && images.length > 0 && !responseJson?.error ? 'success' : 'error',
    image_count: images.length,
    error_code: errorCode ? clip(errorCode, 120) : null,
    error_message: errorCode ? clip(responseJson?.message || errorCode, 700) : null,
    duration_ms: durationMs,
  };
}

async function logCaricatureUsage(env, request, requestBodyJson, summary, startedMs) {
  if (!env.DB) return;
  let user = null;
  try { user = await getUserFromRequest(request, env); } catch { user = null; }

  const detail = clip(JSON.stringify({
    tool: 'haredi-caricature',
    action: 'generate',
    ...summarizeRequestBody(requestBodyJson || {}),
    ...(summary || { status: 'error', error_code: 'unknown', duration_ms: Date.now() - startedMs }),
  }), MAX_DETAIL);

  try {
    await env.DB.prepare(
      `INSERT INTO usage_events (user_id, user_email, event, detail, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(user?.id || null, user?.email || null, 'haredi_caricature_generate', detail, nowSec()).run();
  } catch {
    // Logging must never break generation.
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
  return out.join('\n').trim();
}

function makePrompt(cfg, bodyJson) {
  const sceneText = normalizeText(bodyJson.scene_text);
  const styleKey = normalizeText(bodyJson.style_key || 'איור מצחיק/הומוריסטי/משעשע', 240);
  const aspect = normalizeText(bodyJson.aspect || '1:1', 30);
  const negative = [cfg.negativeDefault, bodyJson.negative]
    .map((x) => normalizeText(x, 1200))
    .filter(Boolean)
    .join('\n');

  return [
    cfg.systemPrompt,
    '',
    'Hard rules:',
    cfg.hardRules,
    '',
    `Visual style key: ${styleKey}`,
    `Aspect ratio: ${aspect}`,
    negative ? `Negative constraints:\n${negative}` : '',
    '',
    'User scene to illustrate:',
    sceneText,
  ].filter(Boolean).join('\n');
}

function makeImageParts(prompt, cfg) {
  const parts = [];
  if (cfg.referenceImageB64) {
    parts.push({
      inlineData: {
        mimeType: cfg.referenceImageMime || 'image/jpeg',
        data: cfg.referenceImageB64,
      },
    });
  }
  parts.push({ text: prompt });
  return parts;
}

async function callGeminiImage({ apiKey, model, prompt, cfg }) {
  const response = await fetch(geminiUrl(model, apiKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: makeImageParts(prompt, cfg) }],
      generationConfig: {
        temperature: 0.85,
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  const text = await response.text();
  const data = safeJsonParse(text);
  if (!response.ok) {
    return {
      images: [],
      text: extractGeminiText(data),
      error: `${model}: HTTP ${response.status}: ${clip(text, 900)}`,
      httpStatus: response.status,
    };
  }

  return {
    images: extractGeminiImages(data),
    text: extractGeminiText(data),
    httpStatus: response.status,
  };
}

async function handleDirectGemini(request, env, cfg, bodyJson, startedMs) {
  const sceneText = normalizeText(bodyJson?.scene_text);
  if (!sceneText) {
    const out = { error: 'empty_scene_text', message: 'לא התקבל טקסט הוראה בשדה scene_text' };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out, 400, Date.now() - startedMs), startedMs);
    return jsonResponse(out, 400);
  }

  if (!cfg.apiKey) {
    const out = { error: 'server_api_key_missing', message: 'GEMINI_API_KEY לא מוגדר בשרת' };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out, 500, Date.now() - startedMs), startedMs);
    return jsonResponse(out, 500);
  }

  const count = Math.max(1, Math.min(Number(bodyJson.count) || 1, MAX_COUNT));
  const basePrompt = makePrompt(cfg, { ...bodyJson, scene_text: sceneText });
  const images = [];
  const noImageTexts = [];
  let lastError = '';
  let lastHttpStatus = 200;

  for (let i = 0; i < count; i++) {
    const prompt = count > 1
      ? `${basePrompt}\n\nVariation ${i + 1} of ${count}: keep the same scene but vary composition and gestures.`
      : basePrompt;
    const r = await callGeminiImage({ apiKey: cfg.apiKey, model: cfg.imageModel, prompt, cfg });
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
    const out = {
      error: 'no_images',
      message: lastError || `${cfg.imageModel}: no images`,
      gemini_text: clip(noImageTexts.join('\n'), cfg.debug ? 1400 : 500),
    };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out, lastHttpStatus >= 400 ? 502 : 200, Date.now() - startedMs), startedMs);
    return jsonResponse(out, 200);
  }

  const out = {
    images,
    model: cfg.imageModel,
    count: images.length,
    ...(cfg.debug ? { prompt_preview: clip(basePrompt, 1200) } : {}),
  };
  await logCaricatureUsage(env, request, bodyJson, summarizeResult(out, 200, Date.now() - startedMs), startedMs);
  return jsonResponse(out, 200);
}

async function handleGasFallback(request, env, body, bodyJson, startedMs) {
  const gasUrl = (await getCaricatureGasUrl(env)).trim();
  if (!gasUrl) {
    const out = { error: 'server_error', message: 'Caricature GAS URL is not configured' };
    await logCaricatureUsage(env, request, bodyJson, summarizeResult(out, 500, Date.now() - startedMs), startedMs);
    return jsonResponse(out, 500);
  }

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body,
    });
    const text = await upstream.text();
    const responseJson = safeJsonParse(text);
    await logCaricatureUsage(env, request, bodyJson, summarizeUpstream(upstream.status, responseJson, text, Date.now() - startedMs), startedMs);
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
      error_message: error?.message || String(error),
      duration_ms: Date.now() - startedMs,
    };
    await logCaricatureUsage(env, request, bodyJson, summary, startedMs);
    return jsonResponse({ error: 'proxy_fetch_failed', message: summary.error_message }, 502);
  }
}

export async function handleCaricature(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);

  const startedMs = Date.now();
  let body = '';
  let bodyJson = null;

  try {
    body = await request.text();
    bodyJson = safeJsonParse(body);
    if (!bodyJson || typeof bodyJson !== 'object') {
      const out = { error: 'bad_json', message: 'Request body must be JSON' };
      await logCaricatureUsage(env, request, null, summarizeResult(out, 400, Date.now() - startedMs), startedMs);
      return jsonResponse(out, 400);
    }
  } catch (error) {
    await logCaricatureUsage(env, request, null, {
      status: 'error',
      image_count: 0,
      error_code: 'bad_request_body',
      error_message: error?.message || String(error),
      duration_ms: Date.now() - startedMs,
    }, startedMs);
    return jsonResponse({ error: 'bad_request_body', message: 'Could not read request body' }, 400);
  }

  const cfg = await getCaricatureConfig(env);

  // Preferred route: direct Cloudflare Worker -> Gemini. Temporary fallback keeps production alive until GEMINI_API_KEY is configured.
  if (cfg.apiKey || !cfg.useGasFallback) {
    return handleDirectGemini(request, env, cfg, bodyJson, startedMs);
  }

  return handleGasFallback(request, env, body, bodyJson, startedMs);
}
