(async () => {
  const VERSION = '20260726-03';
  const CFG_KEY = 'ravtext.torah_transcription.config';

  function parseJson(value) {
    try { return JSON.parse(value || '{}') || {}; } catch (_) { return {}; }
  }

  function cleanSecret(value) {
    return String(value == null ? '' : value)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .replace(/\s+/g, '');
  }

  const cfg = parseJson(localStorage.getItem(CFG_KEY));
  const apiKey = cleanSecret(cfg.gemini_api_key || '');
  const model = String(cfg.model || 'gemini-3.1-pro-preview');

  const body = {
    diagnostic: true,
    diagnostic_name: '03-gas-minimal',
    prompt_type: 'printed',
    model,
    api_key: apiKey,
    text: 'Diagnostic ping. Return only: OK',
    custom_prompt: 'Return only the word OK. Do not add anything else.',
  };

  const started = performance.now();
  console.group('RavText diagnostic 03: /api/ai-tools/gas minimal text path');
  console.log({ version: VERSION, model, has_api_key: !!apiKey, api_key_chars: apiKey.length, prompt_type: body.prompt_type });

  let result;
  try {
    const res = await fetch('/api/ai-tools/gas', {
      method: 'POST',
      headers: { 'content-type': 'text/plain;charset=utf-8' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    result = await res.json().catch(async () => ({ error: 'non_json_response', raw: await res.text() }));
    result.http_status = res.status;
    result.response_debug_id_header = res.headers.get('x-ravtext-debug-id');
  } catch (error) {
    result = { error: 'fetch_failed', message: error && error.message ? error.message : String(error) };
  }

  result.diagnostic = '03-gas-minimal';
  result.version = VERSION;
  result.duration_ms = Math.round(performance.now() - started);

  console.log(result);
  console.groupEnd();
  window.RavTextDiag03 = result;

  const ok = !result.error && !result.original_error && result.http_status >= 200 && result.http_status < 300;
  alert([
    'בדיקה 03 הסתיימה.',
    'minimal_gas_ok=' + ok,
    'http_status=' + result.http_status,
    'error=' + (result.error || result.original_error || 'none'),
    'debug_id=' + (result.debug_id || result.response_debug_id_header || 'none'),
    '',
    'התוצאה המלאה נמצאת ב-console בשם RavTextDiag03'
  ].join('\n'));
})();
