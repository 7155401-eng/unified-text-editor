const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw/exec';

const TOOL_PROMPT_TYPES = new Set([
  'nikud_regular',
  'nikud_torah',
  'nikud_judge_regular',
  'nikud_judge_torah',
  'audio_regular',
  'audio_torah',
  'ocr_handwriting',
  'printed',
  'elevenlabs_transcribe',
  'claude_edition',
  'torah_style_ancient',
  'torah_style_modern',
  'torah_style_combined',
]);

const CHAT_PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-5',
    pick: (data) => data?.content?.[0]?.text,
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o',
    pick: (data) => data?.choices?.[0]?.message?.content,
  },
  google: {
    model: 'gemini-2.0-flash-exp',
    pick: (data) => data?.candidates?.[0]?.content?.parts?.[0]?.text,
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-large-latest',
    pick: (data) => data?.choices?.[0]?.message?.content,
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    pick: (data) => data?.choices?.[0]?.message?.content,
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    pick: (data) => data?.choices?.[0]?.message?.content,
  },
};

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function readSameOrigin(request) {
  try {
    const reqUrl = new URL(request.url);
    const origin = request.headers.get('origin');
    if (origin && origin === reqUrl.origin) return true;
    const referer = request.headers.get('referer');
    if (referer && new URL(referer).origin === reqUrl.origin) return true;
    return request.headers.get('sec-fetch-site') === 'same-origin';
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

export async function handleAiTools(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);
  }

  if (!readSameOrigin(request)) {
    return jsonResponse({ error: 'forbidden', message: 'Bad origin' }, 403);
  }

  let bodyText = '';
  let body;
  try {
    bodyText = await request.text();
    body = JSON.parse(bodyText || '{}');
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Invalid request body' }, 400);
  }

  const promptType = String(body?.prompt_type || '');
  if (!TOOL_PROMPT_TYPES.has(promptType)) {
    return jsonResponse({ error: 'forbidden_prompt_type', message: 'Unsupported tool request' }, 400);
  }

  try {
    console.log(`[ai-tools] ${JSON.stringify(scrubForLog(body))}`);
  } catch {}

  const gasUrl = (env.RAVTEXT_GAS_URL || env.AI_TOOLS_GAS_URL || DEFAULT_GAS_URL).trim();
  if (!gasUrl) {
    return jsonResponse({ error: 'server_error', message: 'AI tools server is not configured' }, 500);
  }

  try {
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body: bodyText,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'cache-control': 'no-store',
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      },
    });
  } catch (error) {
    return jsonResponse({
      error: 'proxy_fetch_failed',
      message: error && error.message ? error.message : String(error),
    }, 502);
  }
}

function chatHeaders(provider, apiKey) {
  if (provider === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

function chatBody(provider, prompt, model) {
  if (provider === 'anthropic') {
    return {
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    };
  }
  if (provider === 'google') {
    return {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2000 },
    };
  }
  return {
    model,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  };
}

export async function handleAiChat(request) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);
  }

  if (!readSameOrigin(request)) {
    return jsonResponse({ error: 'forbidden', message: 'Bad origin' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Invalid request body' }, 400);
  }

  const provider = String(body?.provider || '').toLowerCase();
  const cfg = CHAT_PROVIDERS[provider];
  const prompt = String(body?.prompt || '');
  const apiKey = String(body?.api_key || '');
  if (!cfg || !prompt || !apiKey) {
    return jsonResponse({ error: 'bad_request', message: 'Missing provider, prompt, or API key' }, 400);
  }

  const model = cfg.model;
  const url = provider === 'google'
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    : cfg.url;

  try {
    console.log(`[ai-chat] provider=${provider} prompt_chars=${prompt.length}`);
  } catch {}

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: chatHeaders(provider, apiKey),
      body: JSON.stringify(chatBody(provider, prompt, model)),
    });
    const upstreamText = await upstream.text();
    let data;
    try {
      data = JSON.parse(upstreamText);
    } catch {
      data = { raw: upstreamText };
    }
    const text = cfg.pick(data);
    return jsonResponse({
      text: text || JSON.stringify(data),
      provider,
      status: upstream.status,
    }, upstream.ok ? 200 : upstream.status);
  } catch (error) {
    return jsonResponse({
      error: 'proxy_fetch_failed',
      message: error && error.message ? error.message : String(error),
    }, 502);
  }
}
