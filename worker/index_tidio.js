import app from './index.js';

const PEIMOT_TIDIO_SCRIPT_SRC = '//code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js';
const PEIMOT_TIDIO_SCRIPT_KEY = 'code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js';
const PEIMOT_TIDIO_SCRIPT_TAG =
  `<script src="${PEIMOT_TIDIO_SCRIPT_SRC}" async data-ravtext-peimot-tidio="1" data-widget-purpose="peimot-phone-capture"></script>`;

function appendCspToken(directives, name, token) {
  const current = directives.get(name) || [];
  if (!current.includes(token)) current.push(token);
  directives.set(name, current);
}

function mergeTidioCsp(existingCsp) {
  const directives = new Map();

  for (const rawPart of String(existingCsp || '').split(';')) {
    const part = rawPart.trim();
    if (!part) continue;

    const [name, ...tokens] = part.split(/\s+/);
    if (!name) continue;
    directives.set(name, tokens);
  }

  appendCspToken(directives, 'script-src', 'https://code.tidio.co');

  appendCspToken(directives, 'connect-src', 'https://sentry-new.tidio.co');
  appendCspToken(directives, 'connect-src', 'https://socket.tidio.co');
  appendCspToken(directives, 'connect-src', 'wss://socket.tidio.co');
  appendCspToken(directives, 'connect-src', 'https://uploads.tidio.com');

  appendCspToken(directives, 'img-src', 'https://cdnjs.cloudflare.com');
  appendCspToken(directives, 'img-src', 'https://unpkg.com');
  appendCspToken(directives, 'img-src', 'https://code.tidio.co');
  appendCspToken(directives, 'img-src', 'https://avatars.tidiochat.com');
  appendCspToken(directives, 'img-src', 'https://tidio-images-messenger.s3.us-east-1.amazonaws.com');

  appendCspToken(directives, 'media-src', 'https://code.tidio.co');

  appendCspToken(directives, 'font-src', 'data:');
  appendCspToken(directives, 'font-src', 'https://code.tidio.co');

  appendCspToken(directives, 'frame-src', 'https://code.tidio.co');
  appendCspToken(directives, 'frame-src', 'https://*.tidio.co');
  appendCspToken(directives, 'frame-src', 'https://*.tidiochat.com');

  return Array.from(directives.entries())
    .map(([name, tokens]) => [name, ...tokens].join(' '))
    .join('; ');
}

function injectTidio(html) {
  if (html.includes(PEIMOT_TIDIO_SCRIPT_KEY) || html.includes('data-ravtext-peimot-tidio')) {
    return html;
  }

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${PEIMOT_TIDIO_SCRIPT_TAG}\n</head>`);
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${PEIMOT_TIDIO_SCRIPT_TAG}\n</body>`);
  }

  return `${html}\n${PEIMOT_TIDIO_SCRIPT_TAG}\n`;
}

async function injectTidioIntoHtmlResponse(response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('text/html') || response.status >= 400) {
    return response;
  }

  const html = await response.text();
  const injectedHtml = injectTidio(html);

  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  headers.set('content-security-policy', mergeTidioCsp(headers.get('content-security-policy')));

  return new Response(injectedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await app.fetch(request, env, ctx);
    return injectTidioIntoHtmlResponse(response);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') {
      return app.scheduled(event, env, ctx);
    }
  },
};
