(async () => {
  const VERSION = '20260726-04';
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

  function fileKind(file) {
    const type = String(file.type || '').toLowerCase();
    const name = String(file.name || '').toLowerCase();
    if (type.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm|flac)$/i.test(name)) return 'audio';
    if (type.startsWith('image/') || /\.(png|jpg|jpeg|webp)$/i.test(name)) return 'image';
    if (type === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
    return 'unknown';
  }

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
      reader.onload = () => {
        const dataUrl = String(reader.result || '');
        resolve(dataUrl.split(',')[1] || '');
      };
      reader.readAsDataURL(file);
    });
  }

  function chooseFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*,image/*,.pdf';
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        input.remove();
        resolve(file);
      }, { once: true });
      input.click();
    });
  }

  const cfg = parseJson(localStorage.getItem(CFG_KEY));
  const apiKey = cleanSecret(cfg.gemini_api_key || '');
  const model = String(cfg.model || 'gemini-3.1-pro-preview');

  alert('בדיקה 04 תפתח בחירת קובץ קטן לבדיקה. מומלץ לבחור קובץ קצר מאוד.');
  const file = await chooseFile();
  if (!file) {
    alert('בדיקה 04 בוטלה: לא נבחר קובץ.');
    return;
  }

  const kind = fileKind(file);
  const base64 = await readAsBase64(file);
  const promptType = kind === 'audio' ? 'audio_regular' : 'printed';

  const body = {
    diagnostic: true,
    diagnostic_name: '04-file-flow',
    prompt_type: promptType,
    model,
    api_key: apiKey,
    files: [{
      name: file.name,
      type: kind,
      mime: file.type || 'application/octet-stream',
      content_base64: base64,
    }],
    text: kind === 'audio' ? '' : 'Diagnostic file flow. Return a short technical confirmation.',
    custom_prompt: 'Return a short technical confirmation that the file was received and processed.',
  };

  const started = performance.now();
  console.group('RavText diagnostic 04: file flow through /api/ai-tools/gas');
  console.log({
    version: VERSION,
    model,
    prompt_type: promptType,
    has_api_key: !!apiKey,
    api_key_chars: apiKey.length,
    file_name: file.name,
    file_type: file.type,
    file_size: file.size,
    detected_kind: kind,
    base64_chars: base64.length,
  });

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

  result.diagnostic = '04-file-flow';
  result.version = VERSION;
  result.duration_ms = Math.round(performance.now() - started);

  console.log(result);
  console.groupEnd();
  window.RavTextDiag04 = result;

  const ok = !result.error && !result.original_error && result.http_status >= 200 && result.http_status < 300;
  alert([
    'בדיקה 04 הסתיימה.',
    'file_flow_ok=' + ok,
    'http_status=' + result.http_status,
    'error=' + (result.error || result.original_error || 'none'),
    'debug_id=' + (result.debug_id || result.response_debug_id_header || 'none'),
    '',
    'התוצאה המלאה נמצאת ב-console בשם RavTextDiag04'
  ].join('\n'));
})();
