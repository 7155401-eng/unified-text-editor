const SEFARIA_BASE = 'https://www.sefaria.org/api';

const ALLOWED_PREFIXES = [
  '/index',
  '/shape/',
  '/v3/texts/',
  '/links/',
  '/calendars',
  '/texts/versions/',
  '/texts/',
];

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function isAllowedPath(path) {
  return ALLOWED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

export async function handleSefariaProxy(request, url) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed', message: 'Use GET' }, 405);
  }

  const suffix = url.pathname.slice('/api/sefaria'.length) || '/';
  if (!isAllowedPath(suffix)) {
    return jsonResponse({ error: 'forbidden_path', message: 'Unsupported Sefaria path' }, 403);
  }

  const target = new URL(SEFARIA_BASE + suffix);
  target.search = url.search;

  const upstream = await fetch(target.toString(), {
    headers: {
      accept: 'application/json',
      'user-agent': 'TorahTypesetter/11.50',
    },
  });

  const headers = new Headers(upstream.headers);
  headers.set('cache-control', 'no-store');
  headers.delete('access-control-allow-origin');
  headers.delete('content-security-policy');
  headers.delete('content-length');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
