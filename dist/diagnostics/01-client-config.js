(() => {
  const VERSION = '20260726-01';
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

  function keyInfo(label, value, expectedPrefix) {
    const raw = String(value == null ? '' : value);
    const cleaned = cleanSecret(raw);
    return {
      label,
      has_key: cleaned.length > 0,
      raw_chars: raw.length,
      cleaned_chars: cleaned.length,
      removed_chars: raw.length - cleaned.length,
      sanitized_needed: raw !== cleaned,
      prefix_hint: !cleaned
        ? 'missing'
        : (expectedPrefix && cleaned.startsWith(expectedPrefix) ? `${label}_prefix_ok` : `${label}_prefix_unexpected`),
    };
  }

  const cfg = parseJson(localStorage.getItem(CFG_KEY));
  const storageKeys = Object.keys(localStorage)
    .filter((k) => /ravtext|torah|transcription|gemini|claude|eleven|ai/i.test(k))
    .sort();

  const auth = window.__RAVTEXT_AUTH__ || {};
  const result = {
    diagnostic: '01-client-config',
    version: VERSION,
    timestamp: new Date().toISOString(),
    location: location.href,
    config_key: CFG_KEY,
    config_found: !!localStorage.getItem(CFG_KEY),
    relevant_localStorage_keys: storageKeys,
    auth_summary: {
      has_auth_object: !!window.__RAVTEXT_AUTH__,
      paid: !!auth.paid,
      balance_seconds: Number(auth.balanceSeconds || auth.balance_seconds || 0),
    },
    config_summary: {
      model: cfg.model || null,
      use_premium: cfg.use_premium === true,
      has_access_code: !!cfg.access_code,
      access_code_chars: cfg.access_code ? String(cfg.access_code).length : 0,
      gemini: keyInfo('gemini', cfg.gemini_api_key, 'AIza'),
      claude: keyInfo('claude', cfg.claude_api_key, 'sk-ant-'),
      elevenlabs: keyInfo('elevenlabs', cfg.elevenlabs_api_key, 'sk_'),
    },
    note: 'No full API key or access code is printed by this diagnostic.',
  };

  console.group('RavText diagnostic 01: browser config and stored key presence');
  console.table(result.config_summary);
  console.log(result);
  console.groupEnd();

  window.RavTextDiag01 = result;
  alert(
    'בדיקה 01 הסתיימה.\n' +
    'Gemini key: ' + (result.config_summary.gemini.has_key ? 'נמצא' : 'חסר') + '\n' +
    'תווים במפתח: ' + result.config_summary.gemini.cleaned_chars + '\n' +
    'הוסר ניקוי: ' + result.config_summary.gemini.removed_chars + ' תווים\n' +
    'התוצאה המלאה נמצאת ב-console בשם RavTextDiag01'
  );
})();
