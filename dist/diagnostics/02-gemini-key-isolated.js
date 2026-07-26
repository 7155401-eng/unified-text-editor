(async () => {
  const VERSION = '20260726-02';
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

  const started = performance.now();
  const payload = { provider: 'gemini', model, api_key: apiKey };

  console.group('RavText diagnostic 02: isolated Gemini key check');
  console.log({ version: VERSION, model, has_api_key: !!apiKey, api_key_chars: apiKey.length });

  let result;
  try {
    const res = await fetch('/api/ai-tools/diagnose-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    result = await res.json().catch(async () => ({ error: 'non_json_response', raw: await res.text() }));
    result.http_status = res.status;
    result.response_debug_id_header = res.headers.get('x-ravtext-debug-id');
  } catch (error) {
    result = { error: 'fetch_failed', message: error && error.message ? error.message : String(error) };
  }

  result.diagnostic = '02-gemini-key-isolated';
  result.version = VERSION;
  result.duration_ms = Math.round(performance.now() - started);

  console.log(result);
  console.groupEnd();
  window.RavTextDiag02 = result;

  const lines = [
    'בדיקה 02 הסתיימה.',
    'key_valid=' + result.key_valid,
    'model_available=' + result.model_available,
    'tiny_generation_ok=' + result.tiny_generation_ok,
    'possible_cause=' + (result.possible_cause || result.error || 'none'),
    'debug_id=' + (result.debug_id || result.response_debug_id_header || 'none'),
    '',
    'התוצאה המלאה נמצאת ב-console בשם RavTextDiag02',
  ];
  alert(lines.join('\n'));
})();
