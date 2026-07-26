import app from './index.js';
import { handleAiToolsWithAccountLicense } from './ai_tools_account.js';

const PEIMOT_TIDIO_SCRIPT_SRC = '//code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js';
const PEIMOT_TIDIO_SCRIPT_KEY = 'code.tidio.co/om1yquztujdibhi5ypvtcvo2vfrcd4am.js';
const PEIMOT_TIDIO_SCRIPT_TAG =
  `<script src="${PEIMOT_TIDIO_SCRIPT_SRC}" async data-ravtext-peimot-tidio="1" data-widget-purpose="peimot-phone-capture"></script>`;

const ACCOUNT_AI_FALLBACK_MARKER = 'ravtext-account-ai-key-fallback';
const ACCOUNT_AI_FALLBACK_SCRIPT = `
<script id="${ACCOUNT_AI_FALLBACK_MARKER}">
(() => {
  const SENTINEL = 'ravtext-account-license-server-key';
  const CONFIG_KEY = 'ravtext.torah_transcription.config';

  function isPaidAccount() {
    try {
      const auth = window.__RAVTEXT_AUTH__ || {};
      return !!auth.paid || Number(auth.balanceSeconds || 0) > 0;
    } catch (_) {
      return false;
    }
  }

  function readConfig() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeConfigPatch() {
    if (!isPaidAccount()) return;
    try {
      const cfg = readConfig();
      let changed = false;
      if (!String(cfg.gemini_api_key || '').trim()) {
        cfg.gemini_api_key = SENTINEL;
        changed = true;
      }
      if (!String(cfg.claude_api_key || '').trim()) {
        cfg.claude_api_key = SENTINEL;
        changed = true;
      }
      if (!String(cfg.elevenlabs_api_key || '').trim()) {
        cfg.elevenlabs_api_key = SENTINEL;
        changed = true;
      }
      if (changed) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function setInput(input, value) {
    if (!input || String(input.value || '').trim()) return;
    try {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      try { input.value = value; } catch (_) {}
    }
  }

  function patchTranscriptionModal() {
    if (!isPaidAccount()) return;
    writeConfigPatch();

    const root = document.querySelector('.tt-modal, .tt-modal-overlay') || document;
    const passwordInputs = root.querySelectorAll ? root.querySelectorAll('input[type="password"]') : [];
    for (const input of passwordInputs) {
      const placeholder = String(input.getAttribute('placeholder') || '').toLowerCase();
      if (placeholder.includes('aiza') || placeholder.includes('sk-ant') || placeholder.includes('sk_')) {
        setInput(input, SENTINEL);
      }
    }

    const geminiOnly = root.querySelector && root.querySelector('input[name="tt-judge"][value="gemini_only"]');
    if (geminiOnly && !geminiOnly.checked) {
      try {
        geminiOnly.checked = true;
        geminiOnly.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    }
  }

  function start() {
    writeConfigPatch();
    patchTranscriptionModal();
    setInterval(patchTranscriptionModal, 700);
    if (window.MutationObserver) {
      new MutationObserver(() => patchTranscriptionModal())
        .observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
</script>`;

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

function injectBeforeClose(html, snippet) {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}

function injectTidio(html) {
  if (html.includes(PEIMOT_TIDIO_SCRIPT_KEY) || html.includes('data-ravtext-peimot-tidio')) {
    return html;
  }
  return injectBeforeClose(html, PEIMOT_TIDIO_SCRIPT_TAG);
}

function injectAccountAiFallback(html) {
  if (html.includes(ACCOUNT_AI_FALLBACK_MARKER)) {
    return html;
  }
  return injectBeforeClose(html, ACCOUNT_AI_FALLBACK_SCRIPT);
}

function injectEnhancements(html) {
  return injectAccountAiFallback(injectTidio(html));
}

async function injectEnhancementsIntoHtmlResponse(response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('text/html') || response.status >= 400) {
    return response;
  }

  const html = await response.text();
  const injectedHtml = injectEnhancements(html);

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
    const url = new URL(request.url);
    if (url.pathname === '/api/ai-tools/gas') {
      return handleAiToolsWithAccountLicense(request, env);
    }

    const response = await app.fetch(request, env, ctx);
    return injectEnhancementsIntoHtmlResponse(response);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') {
      return app.scheduled(event, env, ctx);
    }
  },
};
