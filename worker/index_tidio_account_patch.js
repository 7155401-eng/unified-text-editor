import app from './index_tidio.js';

const ACCOUNT_AI_PATCH_SRC = '/account-ai-license-patch.js?v=20260726b';
const ACCOUNT_AI_PATCH_MARKER = 'data-ravtext-account-ai-license-patch';

const ACCOUNT_AI_PATCH_CODE = String.raw`
(() => {
  const SENTINEL = 'ravtext-account-license-server-key';
  const CONFIG_KEY = 'ravtext.torah_transcription.config';
  const GAS_PATH = '/api/ai-tools/gas';

  function isPaidAccount() {
    try {
      const auth = window.__RAVTEXT_AUTH__ || {};
      return !!auth.paid || Number(auth.balanceSeconds || auth.balance_seconds || 0) > 0;
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

  function forceAccountConfig() {
    if (!isPaidAccount()) return;
    try {
      const cfg = readConfig();
      cfg.use_premium = false;
      cfg.access_code = '';
      cfg.gemini_api_key = SENTINEL;
      cfg.claude_api_key = SENTINEL;
      cfg.elevenlabs_api_key = SENTINEL;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch (_) {}
  }

  function setInput(input, value) {
    if (!input) return;
    try {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (_) {
      try { input.value = value; } catch (_) {}
    }
  }

  function patchModal() {
    if (!isPaidAccount()) return;
    forceAccountConfig();

    const root = document.querySelector('.tt-modal, .tt-modal-overlay') || document;
    const premiumRadio = root.querySelector && root.querySelector('input[name="tt-usage"][value="premium"]');
    const personalRadio = root.querySelector && root.querySelector('input[name="tt-usage"][value="personal"]');

    if (premiumRadio) {
      try {
        premiumRadio.disabled = false;
        premiumRadio.checked = true;
        premiumRadio.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    }
    if (personalRadio) {
      try { personalRadio.checked = false; } catch (_) {}
    }

    const passInputs = root.querySelectorAll ? root.querySelectorAll('input[type="password"]') : [];
    for (const input of passInputs) {
      const placeholder = String(input.getAttribute('placeholder') || '').toLowerCase();
      const labelText = String(input.closest('label')?.textContent || input.parentElement?.textContent || '').toLowerCase();
      if (
        placeholder.includes('aiza') ||
        placeholder.includes('sk-ant') ||
        placeholder.includes('sk_') ||
        labelText.includes('gemini') ||
        labelText.includes('claude') ||
        labelText.includes('elevenlabs')
      ) {
        setInput(input, SENTINEL);
      }
    }
  }

  function patchBody(bodyText) {
    if (!isPaidAccount()) return bodyText;
    try {
      const body = JSON.parse(String(bodyText || '{}'));
      body.account_license = true;
      body.use_account_license = true;
      body.api_key = SENTINEL;
      body.access_code = '';
      body.use_premium = false;
      return JSON.stringify(body);
    } catch (_) {
      return bodyText;
    }
  }

  function sameGasUrl(url) {
    try {
      return new URL(url, location.href).pathname === GAS_PATH;
    } catch (_) {
      return String(url || '').includes(GAS_PATH);
    }
  }

  function installFetchPatch() {
    if (window.__ravtextAccountAiFetchPatchInstalled) return;
    window.__ravtextAccountAiFetchPatchInstalled = true;

    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(input, init) {
      try {
        const requestUrl = typeof input === 'string' ? input : (input && input.url);
        if (sameGasUrl(requestUrl) && isPaidAccount()) {
          let nextInput = input;
          let nextInit = init ? { ...init } : {};
          let bodyText = nextInit.body;

          if (bodyText == null && typeof Request !== 'undefined' && input instanceof Request) {
            const cloned = input.clone();
            bodyText = await cloned.text();
            nextInput = input.url;
            nextInit = {
              method: input.method,
              headers: new Headers(input.headers),
              credentials: input.credentials,
              mode: input.mode,
              cache: input.cache,
              redirect: input.redirect,
              referrer: input.referrer,
              referrerPolicy: input.referrerPolicy,
              integrity: input.integrity,
              keepalive: input.keepalive,
              signal: input.signal,
            };
          }

          if (typeof bodyText === 'string') {
            nextInit.body = patchBody(bodyText);
            const headers = new Headers(nextInit.headers || {});
            headers.set('content-type', 'text/plain;charset=utf-8');
            nextInit.headers = headers;
            return originalFetch.call(this, nextInput, nextInit);
          }
        }
      } catch (_) {}
      return originalFetch.call(this, input, init);
    };
  }

  function start() {
    forceAccountConfig();
    patchModal();
    installFetchPatch();
    setInterval(patchModal, 500);
    if (window.MutationObserver) {
      new MutationObserver(() => patchModal())
        .observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
`;

function injectPatchTag(html) {
  if (html.includes(ACCOUNT_AI_PATCH_MARKER) || html.includes('/account-ai-license-patch.js')) {
    return html;
  }

  const tag = `<script src="${ACCOUNT_AI_PATCH_SRC}" defer ${ACCOUNT_AI_PATCH_MARKER}="1"></script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tag}\n</head>`);
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}\n</body>`);
  return `${html}\n${tag}\n`;
}

function mergeSelfScriptCsp(existingCsp) {
  const text = String(existingCsp || '');
  if (!text) return text;

  const directives = new Map();
  for (const part of text.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...tokens] = trimmed.split(/\s+/);
    directives.set(name, tokens);
  }

  const current = directives.get('script-src') || [];
  if (!current.includes("'self'")) current.push("'self'");
  directives.set('script-src', current);

  return Array.from(directives.entries())
    .map(([name, tokens]) => [name, ...tokens].join(' '))
    .join('; ');
}

async function injectPatchIntoHtmlResponse(response) {
  const headers = new Headers(response.headers);
  const contentType = headers.get('content-type') || '';

  if (!contentType.toLowerCase().includes('text/html') || response.status >= 400) {
    return response;
  }

  const html = await response.text();
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  const csp = mergeSelfScriptCsp(headers.get('content-security-policy'));
  if (csp) headers.set('content-security-policy', csp);

  return new Response(injectPatchTag(html), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/account-ai-license-patch.js') {
      return new Response(ACCOUNT_AI_PATCH_CODE, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    const response = await app.fetch(request, env, ctx);
    return injectPatchIntoHtmlResponse(response);
  },

  async scheduled(event, env, ctx) {
    if (typeof app.scheduled === 'function') {
      return app.scheduled(event, env, ctx);
    }
  },
};
