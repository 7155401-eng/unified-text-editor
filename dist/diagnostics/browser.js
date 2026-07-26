(() => {
  const VERSION = '20260726-ui02';
  const state = { version: VERSION, started_at: new Date().toISOString(), results: {} };
  const scripts = {
    '01': '/diagnostics/01-client-config.js',
    '02': '/diagnostics/02-gemini-key-isolated.js',
    '03': '/diagnostics/03-gas-minimal.js',
    '04': '/diagnostics/04-file-flow.js',
  };
  const globals = {
    '01': 'RavTextDiag01',
    '02': 'RavTextDiag02',
    '03': 'RavTextDiag03',
    '04': 'RavTextDiag04',
  };
  const $ = (id) => document.getElementById(id);

  function redactString(text) {
    return String(text == null ? '' : text)
      .replace(/key=([^&\s"'<>]+)/gi, 'key=[redacted]')
      .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted-google-key]')
      .replace(/sk-ant-[0-9A-Za-z_\-]{20,}/g, '[redacted-anthropic-key]')
      .replace(/sk_[0-9A-Za-z_\-]{20,}/g, '[redacted-elevenlabs-key]')
      .replace(/Bearer\s+[0-9A-Za-z._\-]{20,}/gi, 'Bearer [redacted]');
  }

  function sanitize(value, depth = 0) {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return redactString(value);
    if (depth > 6) return '[deep]';
    if (Array.isArray(value)) return value.slice(0, 80).map((v) => sanitize(v, depth + 1));
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[_-]?key|access[_-]?code|token|secret|password|authorization/i.test(key)) {
        out[key] = item ? `[redacted ${String(item).length} chars]` : '';
      } else if (/content[_-]?base64|base64|blob/i.test(key)) {
        out[key] = item ? `[omitted ${String(item).length} chars]` : '';
      } else {
        out[key] = sanitize(item, depth + 1);
      }
    }
    return out;
  }

  function statusText(id, result) {
    if (!result) return ['muted', 'טרם הורץ'];
    if (result.error || result.original_error || (result.http_status && (result.http_status < 200 || result.http_status >= 300))) {
      return ['bad', `נכשל: ${result.possible_cause || result.error || result.original_error || result.http_status}`];
    }
    if (id === '01') {
      return result.config_summary?.gemini?.has_key ? ['ok', 'נמצא מפתח בדפדפן'] : ['bad', 'לא נמצא מפתח Gemini'];
    }
    if (id === '02') {
      if (result.key_valid === true && (result.tiny_generation_ok === true || result.model_available === true || result.model_available == null)) return ['ok', 'המפתח עבר בדיקה'];
      if (result.key_valid === false) return ['bad', `המפתח נדחה: ${result.possible_cause || 'unknown'}`];
      return ['bad', `בדיקה לא תקינה: ${result.possible_cause || 'unknown'}`];
    }
    if (id === '03') return ['ok', 'מסלול שרת בלי קובץ עבר'];
    if (id === '04') return ['ok', 'מסלול קובץ עבר'];
    return ['ok', 'עבר'];
  }

  function render() {
    for (const id of ['01','02','03','04']) {
      const el = $(`status${id}`);
      const [cls, text] = statusText(id, state.results[id]);
      el.className = cls;
      el.textContent = text;
    }
    $('out').textContent = JSON.stringify(sanitize({
      page: location.href,
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent,
      ...state,
    }), null, 2);
  }

  function setBusy(id, busy) {
    for (const btn of document.querySelectorAll(`button[data-diag="${id}"]`)) btn.disabled = busy;
    $('runAll').disabled = busy || $('runAll').dataset.busy === '1';
  }

  async function runDiag(id) {
    setBusy(id, true);
    const status = $(`status${id}`);
    status.className = 'muted';
    status.textContent = 'מריץ בדיקה...';
    try {
      const name = globals[id];
      try { delete window[name]; } catch (_) { window[name] = undefined; }
      await import(`${scripts[id]}?v=20260726-ui02&t=${Date.now()}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      state.results[id] = window[name] || { error: 'no_result_object', message: `הסקריפט הסתיים אבל ${name} לא נוצר` };
    } catch (error) {
      state.results[id] = { error: 'client_run_failed', message: error?.message || String(error) };
    } finally {
      setBusy(id, false);
      render();
    }
  }

  async function runAll() {
    $('runAll').dataset.busy = '1';
    $('runAll').disabled = true;
    await runDiag('01');
    await runDiag('02');
    await runDiag('03');
    $('runAll').dataset.busy = '0';
    $('runAll').disabled = false;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText($('out').textContent);
      alert('התוצאות הועתקו.');
    } catch (_) {
      alert('לא הצלחתי להעתיק אוטומטית. אפשר לסמן ולהעתיק מהתיבה.');
    }
  }

  function download() {
    const blob = new Blob([$('out').textContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ravtext-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-diag]');
    if (btn) runDiag(btn.dataset.diag);
  });
  $('runAll').addEventListener('click', runAll);
  $('copy').addEventListener('click', copy);
  $('download').addEventListener('click', download);
  render();
})();
