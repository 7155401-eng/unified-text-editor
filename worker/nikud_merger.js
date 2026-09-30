import {
  FilterConfig,
  merge,
  mergeAllSources,
  checkText,
  summarizeIssues,
} from './nikud_merger_engine.js';
import { getUserFromRequest } from './session.js';
import { checkToolQuotaAvailability, consumeSuccessfulToolUse } from './tool_quota.js';

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

  const user = await getUserFromRequest(request, env);
  if (!user) {
    return jsonResponse({ error: 'login_required', message: 'Login is required' }, 401);
  }

  if (action === 'merge') {
    const clean = String(body?.clean || '');
    const sources = Array.isArray(body?.sources) ? body.sources : [];
    const mode = body?.mode || 'word';
    const config = FilterConfig.fromDict(body?.filter_config || {});
    const nonEmptySources = sources.filter(item =>
      Array.isArray(item) && String(item[1] || '').trim()
    );
    if (!clean.trim() || nonEmptySources.length === 0) {
      return jsonResponse({ error: 'invalid_merge_input', message: 'Clean text and at least one source are required' }, 400);
    }

    if (!user.paid && !user.is_admin) {
      let availability;
      try {
        availability = await checkToolQuotaAvailability(user, 'nikud-merger', env);
      } catch (_) {
        return jsonResponse({ error: 'quota_unavailable', message: 'Quota service is temporarily unavailable' }, 503);
      }
      if (!availability.ok) {
        return jsonResponse({
          error: 'quota_exceeded',
          message: 'Free nikud merge quota is exhausted',
          resetAt: availability.resetAt ?? null,
          remaining: availability.remaining ?? 0,
          limit: availability.limit ?? 1,
        }, 429);
      }
    }

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

    let quota = { ok: true, unlimited: !!(user.paid || user.is_admin) };
    if (!user.paid && !user.is_admin) {
      try {
        quota = await consumeSuccessfulToolUse(user, 'nikud-merger', env, {
          units: 1,
          idempotencyKey: body?.idempotency_key,
        });
      } catch (_) {
        return jsonResponse({ error: 'quota_unavailable', message: 'Quota service is temporarily unavailable' }, 503);
      }
      if (!quota.ok) {
        return jsonResponse({
          error: 'quota_exceeded',
          message: 'Free nikud merge quota is exhausted',
          resetAt: quota.resetAt ?? null,
          remaining: quota.remaining ?? 0,
          limit: quota.limit ?? 1,
        }, 429);
      }
    }

    return jsonResponse({ result, quota: {
      unlimited: !!quota.unlimited,
      idempotent: !!quota.idempotent,
      remaining: quota.remaining ?? null,
      resetAt: quota.resetAt ?? null,
    } });
  }

  if (action === 'quality') {
    const text = String(body?.text || '');
    const issues = checkText(text);
    const summary = summarizeIssues(issues);
    return jsonResponse({ issues, summary });
  }

  return jsonResponse({ error: 'unknown_action', message: 'Unknown nikud merger action' }, 400);
}
