import {
  FilterConfig,
  merge,
  mergeAllSources,
  checkText,
  summarizeIssues,
} from './nikud_merger_engine.js';
import { getUserFromRequest } from './session.js';
import { consumeToolQuota, getToolQuotaStatus } from './tool_quota_store.js';

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
    const clean = String(body?.clean || '');
    const sources = Array.isArray(body?.sources) ? body.sources : [];
    const mode = body?.mode || 'word';
    const config = FilterConfig.fromDict(body?.filter_config || {});

    if (!clean.trim() || sources.length === 0 || !sources.some(s => String(s?.[1] || '').trim())) {
      return jsonResponse({ error: 'missing_text', message: 'Clean text and at least one source are required.' }, 400);
    }

    const user = await getUserFromRequest(request, env);
    if (!user) {
      return jsonResponse({ error: 'login_required', message: 'Login is required.' }, 401);
    }

    // Desktop parity: one SUCCESSFUL merge per rolling 7-day window for Free.
    // Opening the tool and quality checks do not consume the allowance.
    const before = await getToolQuotaStatus(env, user, 'nikud-merger');
    if (!before.allowed) {
      return jsonResponse({
        error: 'quota_exceeded',
        message: 'Free accounts can complete one nikud merge every 7 days.',
        quota: before,
      }, 429);
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

    const eventKey = String(
      body?.event_key ||
      request.headers.get('x-ravtext-idempotency-key') ||
      ''
    ).trim();
    const quota = await consumeToolQuota(env, user, 'nikud-merger', {
      units: 1,
      eventKey,
    });
    if (!quota.allowed) {
      // A concurrent successful request may have consumed the final allowance
      // while this merge was computing. Never leak the computed result in that
      // race; return the authoritative quota response instead.
      return jsonResponse({
        error: quota.reason || 'quota_exceeded',
        message: quota.reason === 'idempotency_key_required'
          ? 'Missing idempotency key.'
          : 'Free accounts can complete one nikud merge every 7 days.',
        quota,
      }, quota.reason === 'idempotency_key_required' ? 400 : 429);
    }

    return jsonResponse({ result, quota });
  }

  if (action === 'quality') {
    const text = String(body?.text || '');
    const issues = checkText(text);
    const summary = summarizeIssues(issues);
    return jsonResponse({ issues, summary });
  }

  return jsonResponse({ error: 'unknown_action', message: 'Unknown nikud merger action' }, 400);
}
