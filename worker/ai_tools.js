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

const CHAT_DIRECT_PROMPT_LIMIT = 32000;
const CHAT_CHUNK_SIZE = 12000;
const CHAT_CHUNK_OVERLAP = 500;
const CHAT_SUMMARY_CHAR_LIMIT = 1600;

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
    return jsonResponse({ error: 'method_not_alowed', message: 'Use POST' }, 405);
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

function chatBody(provider, prompt, model, maxTokens = 2000) {
  if (provider === 'anthropic') {
    return {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    };
  }
  if (provider === 'google') {
    return {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    };
  }
  return {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
}

function normalizePositiveInt(value, fallback, min = 1, max) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  const normalized = Math.max(min, n);
  return Number.isFinite(max) ? Math.min(max, normalized) : normalized;
}

function splitLargePrompt(prompt, chunkSize = CHAT_CHUNK_SIZE, overlap = CHAT_CHUNK_OVERLAP) {
  const text = String(prompt || '');
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + chunkSize);

    if (end < text.length) {
      const windowStart = Math.max(start + Math.floor(chunkSize * 0.65), start);
      const slice = text.slice(windowStart, end);
      const breakCandidates = [
        slice.lastIndexOf('\n\n'),
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '),
        slice.lastIndexOf('⁤ '),
        slice.lastIndexOf('׃ '),
      ].filter((idx) => idx >= 0);

      if (breakCandidates.length) {
        end = windowStart + Math.max(...breakCandidates) + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function buildTaskExcerpt(prompt) {
  const text = String(prompt || '');
  if (text.length <= 4000) return text;
  const head = text.slice(0, 2800).trim();
  const tail = text.slice(-1200).trim();
  return `${head}\n\n[..-ץ��צר אמצט הושמט כי הקובץ גדול...]\n\n${tail}`;
}

function trimForReduce(text, maxChars = CHAT_SUMMARY_CHAR_LIMIT) {
  const normalized = String(text || '').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 80).trim()}\n[המשך תקציר החלק קוצר אוטומטית]`;
}

function buildChunkPrompt({ originalPrompt, chunk, index, total }) {
  const taskExcerpt = buildTaskExcerpt(originalPrompt);
  return `המשתמש שלח קובץ/פרומפט גדול מדי ולכן הוא מעובד בחלקים.

קטע קצר מתוך הבקשה המקורית, כדי להבין את המשימה:
---
${taskExcerpt}
---

כעת קיבלת חלק ${index + 1} מתוך ${total}.
נתח רק את החלק הזה.
החזר תקציר עובדתי קצר של נקודות, ממצאים, שמות, מספרים, החלטות או שורות חשובות שיכולים לעזור לענות לבקשה.
אל תמציא מידע.
אם אין בחלק הזה מידע רלוונטי, כתוב זאת במפורש.
שמור על עד ${CHAT_SUMMARY_CHAR_LIMIT} תווים.

החלק לעיבוד:
---
${chunk}
---`;
}

function buildFinalPrompt({ originalPrompt, summaries, truncated }) {
  const taskExcerpt = buildTaskExcerpt(originalPrompt);
  const joinedSummaries = summaries
    .map((summary, idx) => `חלק ${idx + 1}:\n${summary}`)
    .join('\n\n---\n\n');

  return `המשתמש שלח קובץ/פרומפט גדול ולכן הוא עובד קודם בחלקים.
ענה עכשיו לבקשה המקורית על סמך תקצירי החלקים בלבד.

קטע קצר מתוך הבקשה המקורית:
---
${taskExcerpt}
---

תקצירי החלקים:
---
${joinedSummaries}
---

${truncated ? 'שים לב: הקובץ היה גדול מאוד, ולכן עובדו רק החלקים הראשונים במסגרת מגבלת המערכת. ציין זאת בתשובה אם זה משפיע על הוודאות.' : ''}

תן תשובה אחת ברורה ושימושית.
אם אין מספיק מידע כדי לענות בוודאות, אמור זאת בגלוי.`;
}

async function callChatProvider({ provider, cfg, prompt, apiKey, maxTokens = 2000 }) {
  const model = cfg.model;
  const url = provider === 'google'
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    : cfg.url;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: chatHeaders(provider, apiKey),
    body: JSON.stringify(chatBody(provider, prompt, model, maxTokens)),
  });

  const upstreamText = await upstream.text();
  let data;
  try {
    data = JSON.parse(upstreamText);
  } catch {
    data = { raw: upstreamText };
  }

  const text = cfg.pick(data) || JSON.stringify(data);
  return {
    ok: upstream.ok,
    status: upstream.status,
    text,
    data,
  };
}

async function runChunkedChat({ provider, cfg, prompt, apiKey, maxChunks }) {
  const chunks = splitLargePrompt(prompt);
  const hasManualChunkLimit = Number.isInteger(maxChunks) && maxChunks > 0;
  const chunksToProcess = hasManualChunkLimit ? chunks.slice(0, maxChunks) : chunks;
  const truncated = chunksToProcess.length < chunks.length;
  const summaries = [];

  for (let i = 0; i < chunksToProcess.length; i += 1) {
    const chunkPrompt = buildChunkPrompt({
      originalPrompt: prompt,
      chunk: chunksToProcess[i],
      index: i,
      total: chunks.length,
    });

    const chunkResult = await callChatProvider({
      provider,
      cfg,
      prompt: chunkPrompt,
      apiKey,
      maxTokens: 900,
    });

    if (!chunkResult.ok) {
      const message = chunkResult.text || `Chunk ${i + 1} failed`
      const error = new Error(message);
      error.status = chunkResult.status;
      error.provider = provider;
      error.chunkIndex = i;
      throw error;
    }

    summaries.push(trimForReduce(chunkResult.text));
  }

  const finalPrompt = buildFinalPrompt({
    originalPrompt: prompt,
    summaries,
    truncated,
  });

  const finalResult = await callChatProvider({
    provider,
    cfg,
    prompt: finalPrompt,
    apiKey,
    maxTokens: 2200,
  });

  return {
    ...finalResult,
    chunked: true,
    chunks: chunks.length,
    processed_chunks: chunksToProcess.length,
    truncated,
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

  const maxChunks = body?.max_chunks == null || body?.max_chunks === ''
    ? undefined
    : normalizePositiveInt(body.max_chunks, undefined, 1);
  const shouldChunk = prompt.length > CHAT_DIRECT_PROMPT_LIMIT || body?.large_file === true || body?.chunked === true;

  try {
    console.log(`[ai-chat] provider=${provider} prompt_chars=${prompt.length} chunked=${shouldChunk} max_chunks=${maxChunks ?? 'unlimited'}`);
  } catch {}

  try {
    const result = shouldChunk
      ? await runChunkedChat({ provider, cfg, prompt, apiKey, maxChunks })
      : await callChatProvider({ provider, cfg, prompt, apiKey });

    return jsonResponse({
      text: result.text,
      provider,
      status: result.status,
      chunked: !!result.chunked,
      chunks: result.chunks || 1,
      processed_chunks: result.processed_chunks || 1,
      truncated: !!result.truncated,
    }, result.ok ? 200 : result.status);
  } catch (error) {
    return jsonResponse({
      error: 'proxy_fetch_failed',
      message: error && error.message ? error.message : String(error),
      provider: error?.provider || provider,
      chunk_index: Number.isInteger(error?.chunkIndex) ? error.chunkIndex : undefined,
    }, error?.status || 502);
  }
}
