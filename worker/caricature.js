const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbyvt7yUPa2jNiTtTzKli8R8GmNI_plIeOwwFuTgu733es5mFfhEKcTcInP3yzFnlQQCvw/exec';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
};

function jsonResponse(body, status) {
  return Response.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'cache-control': 'no-store',
    },
  });
}

export async function handleCaricature(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({
      error: 'method_not_allowed',
      message: 'Use POST',
    }, 405);
  }

  const gasUrl = (env.CARICATURE_GAS_URL || DEFAULT_GAS_URL).trim();
  if (!gasUrl) {
    return jsonResponse({
      error: 'server_error',
      message: 'Caricature GAS URL is not configured',
    }, 500);
  }

  try {
    const body = await request.text();
    const upstream = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      body,
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
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
