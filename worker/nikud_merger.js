import {
  FilterConfig,
  merge,
  mergeAllSources,
  checkText,
  summarizeIssues,
} from './nikud_merger_engine.js';

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleNikudMerger(request) {
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

    let result;
    if (sources.length === 1) {
      result = merge(clean, String(sources[0][1] || ''), {
        config,
        progressCallback: null,
        stopFlag: null,
        mode,
      });
      result.matchRatio = result.matchCount / Math.max(1, result.cleanWordCount);
    } else {
      result = mergeAllSources(clean, sources, {
        config,
        progressCallback: null,
        stopFlag: null,
        mode,
      });
    }

    return jsonResponse({ result });
  }

  if (action === 'quality') {
    const text = String(body?.text || '');
    const issues = checkText(text);
    const summary = summarizeIssues(issues);
    return jsonResponse({ issues, summary });
  }

  return jsonResponse({ error: 'unknown_action', message: 'Unknown nikud merger action' }, 400);
}
