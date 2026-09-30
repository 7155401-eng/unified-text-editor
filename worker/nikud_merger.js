import {
  FilterConfig,
  merge,
  mergeAllSources,
  checkText,
  summarizeIssues,
} from './nikud_merger_engine.js';
import { getUserFromRequest } from './session.js';
import { checkToolQuota, consumeToolQuota } from './tool_quota_policy.js';

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleNikudMerger(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use POST' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'Invalid request body' }, 400);
  }

  const action = String(body?.action || '');
  if (action === 'merge') {
    const user = await getUserFromRequest(request, env);
    if (!user) {
      return jsonResponse({ error: 'login_required', message: 'Login required' }, 401);
    }
    const allowance = await checkToolQuota({
      env,
      user,
      toolName: 'nikud-merger',
      amount: 1,
    });
    if (!allowance?.ok) {
      return jsonResponse({
        error: 'quota_exceeded',
        message: allowance?.message || 'Free merge quota exhausted',
        quota: allowance?.quota || null,
      }, 429);
    }

    const clean = String(body?.clean || '');
    const sources = Array.isArray(body?.sources) ? body.sources : [];
    const mode = body?.mode || 'word';
    const config = FilterConfig.fromDict(body?.filter_config || {});

    let result;
    if (sources.length === 1) {
      result = merge(clean, String(sources[0][1] || ''), {
        config,
        progressCallback: null,
        stopFlag: null,
        mode,
      });
    } else {
      result = mergeAllSources(clean, sources, {
        config,
        progressCallback: null,
        stopFlag: null,
        mode,
      });
    }
    result = {
      ...result,
      matchRatio: result.matchCount / Math.max(1, result.cleanWordCount),
    };

    const quota = await consumeToolQuota({
      env,
      user,
      toolName: 'nikud-merger',
      amount: 1,
      idempotencyKey: body?.quota_idempotency_key || '',
    });
    if (!quota?.ok) {
      return jsonResponse({
        error: 'quota_exceeded',
        message: quota?.message || 'Free merge quota exhausted',
        quota: quota?.quota || null,
      }, 429);
    }

    return jsonResponse({ result, quota: quota?.quota || null });
  }

  if (action === 'quality') {
    const text = String(body?.text || '');
    const issues = checkText(text);
    const summary = summarizeIssues(issues);
    return jsonResponse({ issues, summary });
  }

  return jsonResponse({ error: 'unknown_action', message: 'Unknown nikud merger action' }, 400);
}
