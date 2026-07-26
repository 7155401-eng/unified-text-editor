import { handleAiTools } from './ai_tools.js';
import { getUserFromRequest } from './session.js';

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

async function readBodyJson(request) {
  const text = await request.text();
  if (!text) return { text: '', body: {} };
  try {
    return { text, body: JSON.parse(text) };
  } catch {
    return { text, body: null };
  }
}

function firstEnv(env, names) {
  for (const name of names) {
    const value = env && env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function chooseServerApiKey(body, env) {
  const promptType = String(body?.prompt_type || '');
  const model = String(body?.model || '').toLowerCase();

  if (promptType === 'elevenlabs_transcribe' || model.startsWith('elevenlabs')) {
    return firstEnv(env, [
      'ELEVENLABS_API_KEY',
      'RAVTEXT_ELEVENLABS_API_KEY',
      'AI_ELEVENLABS_API_KEY',
    ]);
  }

  if (model.startsWith('claude')) {
    return firstEnv(env, [
      'ANTHROPIC_API_KEY',
      'CLAUDE_API_KEY',
      'RAVTEXT_ANTHROPIC_API_KEY',
      'RAVTEXT_CLAUDE_API_KEY',
      'AI_CLAUDE_API_KEY',
    ]);
  }

  return firstEnv(env, [
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'GOOGLE_AI_API_KEY',
    'GOOGLE_GENERATIVE_AI_API_KEY',
    'RAVTEXT_GEMINI_API_KEY',
    'RAVTEXT_GOOGLE_API_KEY',
    'AI_GEMINI_API_KEY',
  ]);
}

function choosePremiumAccessCode(env) {
  return firstEnv(env, [
    'RAVTEXT_PREMIUM_ACCESS_CODE',
    'PREMIUM_ACCESS_CODE',
    'AI_TOOLS_ACCESS_CODE',
    'GAS_ACCESS_CODE',
    'ACCESS_CODE',
  ]);
}

function cloneHeadersForJson(request) {
  const headers = new Headers(request.headers);
  headers.set('content-type', 'text/plain;charset=utf-8');
  headers.delete('content-length');
  return headers;
}

function cloneAiToolsRequest(request, body) {
  return new Request(request.url, {
    method: request.method,
    headers: cloneHeadersForJson(request),
    body: JSON.stringify(body),
    redirect: request.redirect,
  });
}

export async function handleAiToolsWithAccountLicense(request, env) {
  if (request.method !== 'POST') {
    return handleAiTools(request, env);
  }

  const original = request.clone();
  const { body } = await readBodyJson(request.clone());
  if (!body || typeof body !== 'object') {
    return handleAiTools(original, env);
  }

  let user = null;
  try {
    user = await getUserFromRequest(original, env);
  } catch (error) {
    user = null;
  }

  if (!user?.paid) {
    return handleAiTools(original, env);
  }

  const serverApiKey = chooseServerApiKey(body, env);
  const premiumAccessCode = choosePremiumAccessCode(env);
  const patchedBody = {
    ...body,
    account_license: true,
    use_account_license: true,
    _account_user_id: user.id,
  };

  if (serverApiKey) {
    patchedBody.api_key = serverApiKey;
    delete patchedBody.access_code;
    patchedBody.use_premium = false;
    try {
      console.log(`[ai-tools-account] user=${user.id} prompt=${patchedBody.prompt_type || ''} provider_key=server`);
    } catch {}
    return handleAiTools(cloneAiToolsRequest(original, patchedBody), env);
  }

  if (premiumAccessCode) {
    patchedBody.access_code = premiumAccessCode;
    delete patchedBody.api_key;
    patchedBody.use_premium = true;
    try {
      console.log(`[ai-tools-account] user=${user.id} prompt=${patchedBody.prompt_type || ''} premium_code=server`);
    } catch {}
    return handleAiTools(cloneAiToolsRequest(original, patchedBody), env);
  }

  return jsonResponse({
    error: 'server_api_key_missing',
    message: 'חשבון הדקות תקין, אבל חסר מפתח שרת לכלי הזה. יש להגדיר GEMINI_API_KEY / ELEVENLABS_API_KEY / ANTHROPIC_API_KEY ב-Worker.',
  }, 500);
}
