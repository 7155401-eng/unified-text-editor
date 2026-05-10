import {
  computeSmartCompare,
  renderSmartReport,
  computeIntegrity,
  renderIntegrityReport,
} from './text_compare_engine.js';

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function handleTextComparePro(request) {
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
  const opts = body?.opts || {};

  if (action === 'smart') {
    const report = computeSmartCompare(
      String(body?.text1 || ''),
      String(body?.text2 || ''),
      opts
    );
    report.html = renderSmartReport(report);
    return jsonResponse({ report });
  }

  if (action === 'integrity') {
    const report = computeIntegrity(
      String(body?.base || ''),
      String(body?.insert || ''),
      String(body?.merged || ''),
      opts
    );
    report.html = renderIntegrityReport(report);
    return jsonResponse({ report });
  }

  return jsonResponse({ error: 'unknown_action', message: 'Unknown text compare action' }, 400);
}
