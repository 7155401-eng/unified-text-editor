import fs from 'node:fs';

const MARKER = 'RAVTEXT_LARGE_ELEVENLABS_MULTIPART_PATCH';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function writeIfChanged(path, before, after) {
  if (after === before) {
    console.log(`[large-audio-upload] no changes needed for ${path}`);
    return;
  }
  fs.writeFileSync(path, after);
  console.log(`[large-audio-upload] patched ${path}`);
}

function patchAiTools() {
  const path = 'worker/ai_tools.js';
  const before = read(path);
  if (before.includes(MARKER)) {
    writeIfChanged(path, before, before);
    return;
  }

  const helper = `
// ${MARKER}: accept large ElevenLabs uploads as multipart instead of base64 JSON.
function ravtextTrimUpstream(value, max = 2000) {
  const text = String(value || '');
  return text.length <= max ? text : text.slice(0, max) + '…';
}

function ravtextElevenLabsError(status, text) {
  const detail = ravtextTrimUpstream(text || '');
  if (status === 401 || status === 403) {
    return jsonResponse({ error: 'invalid_api_key', message: detail || 'ElevenLabs: מפתח לא תקין' }, 401);
  }
  if (status === 429) {
    return jsonResponse({ error: 'ai_quota_exceeded', message: detail || 'ElevenLabs: חריגה ממכסה' }, 429);
  }
  if (status === 413) {
    return jsonResponse({
      error: 'file_too_large',
      message: detail || 'הקובץ גדול מדי להעברה דרך השרת. נסה להעלות MP3/M4A דחוס או לפצל את הקובץ.',
    }, 413);
  }
  return jsonResponse({ error: 'server_error', message: 'ElevenLabs error ' + status + ': ' + detail }, status || 502);
}

async function handleElevenLabsMultipartUpload(request) {
  let formIn;
  try {
    formIn = await request.formData();
  } catch {
    return jsonResponse({ error: 'invalid_form', message: 'Invalid multipart request body' }, 400);
  }

  const promptType = String(formIn.get('prompt_type') || '');
  if (promptType !== 'elevenlabs_transcribe') {
    return jsonResponse({ error: 'forbidden_prompt_type', message: 'Unsupported multipart tool request' }, 400);
  }

  const apiKey = String(formIn.get('api_key') || '').trim();
  const upload = formIn.get('file');
  if (!apiKey) return jsonResponse({ error: 'bad_request', message: 'Missing API key' }, 400);
  if (!upload || typeof upload.arrayBuffer !== 'function') {
    return jsonResponse({ error: 'bad_request', message: 'Missing audio file' }, 400);
  }

  const rawModel = String(formIn.get('model') || '');
  const modelId = rawModel.indexOf('elevenlabs-') === 0
    ? rawModel.slice('elevenlabs-'.length)
    : String(formIn.get('model_id') || 'scribe_v1');
  const languageCode = String(formIn.get('language_code') || 'heb');
  const fileName = upload.name || String(formIn.get('file_name') || 'audio');

  const upstreamForm = new FormData();
  upstreamForm.append('model_id', modelId || 'scribe_v1');
  upstreamForm.append('language_code', languageCode || 'heb');
  upstreamForm.append('file', upload, fileName);

  let upstream;
  try {
    upstream = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: upstreamForm,
    });
  } catch (err) {
    return jsonResponse({
      error: 'server_error',
      message: 'ElevenLabs רשת: ' + (err && err.message ? err.message : String(err)),
    }, 502);
  }

  const text = await upstream.text();
  if (!upstream.ok) return ravtextElevenLabsError(upstream.status, text);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'server_error', message: 'תשובה לא תקינה מ-ElevenLabs' }, 502);
  }

  const transcribed = data.text || data.transcript || data.transcription || '';
  if (!transcribed) {
    return jsonResponse({ error: 'server_error', message: 'ElevenLabs לא החזיר טקסט' }, 502);
  }
  return jsonResponse({ result: transcribed });
}
`;

  let after = before.replace('export async function handleAiTools', `${helper}\nexport async function handleAiTools`);
  if (after === before) {
    throw new Error('[large-audio-upload] handleAiTools anchor not found');
  }

  const anchor = "\n  let bodyText = '';";
  const multipartGate = `
  const ravtextContentType = request.headers.get('content-type') || '';
  if (ravtextContentType.toLowerCase().includes('multipart/form-data')) {
    return handleElevenLabsMultipartUpload(request);
  }
`;
  if (!after.includes(anchor)) {
    throw new Error('[large-audio-upload] request body anchor not found');
  }
  after = after.replace(anchor, `${multipartGate}${anchor}`);
  writeIfChanged(path, before, after);
}

function patchMinuteAccess() {
  const path = 'worker/minute_access.js';
  const before = read(path);
  if (before.includes('__ravtextElevenLabsLargeUploadPatch')) {
    writeIfChanged(path, before, before);
    return;
  }

  const clientPatch = `const RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH = \`;(function(){
  if (window.__ravtextElevenLabsLargeUploadPatch) return;
  window.__ravtextElevenLabsLargeUploadPatch = true;
  var nativeFetch = window.fetch;
  if (typeof nativeFetch !== "function" || typeof FormData === "undefined" || typeof Blob === "undefined") return;

  function isAiToolsRequest(input) {
    var raw = "";
    try {
      raw = typeof input === "string" ? input : (input && input.url) || "";
      var url = new URL(raw, location.href);
      return url.origin === location.origin && url.pathname === "/api/ai-tools/gas";
    } catch (_) {
      return String(raw || "").indexOf("/api/ai-tools/gas") >= 0;
    }
  }

  function base64ToBlob(base64, mime) {
    var clean = String(base64 || "");
    var comma = clean.indexOf(",");
    if (comma >= 0) clean = clean.slice(comma + 1);
    var binary = atob(clean);
    var size = binary.length;
    var chunkSize = 32768;
    var parts = [];
    for (var offset = 0; offset < size; offset += chunkSize) {
      var slice = binary.slice(offset, offset + chunkSize);
      var bytes = new Uint8Array(slice.length);
      for (var i = 0; i < slice.length; i += 1) bytes[i] = slice.charCodeAt(i);
      parts.push(bytes);
    }
    return new Blob(parts, { type: mime || "application/octet-stream" });
  }

  window.fetch = function(input, init) {
    try {
      var opts = init || {};
      if (!isAiToolsRequest(input) || !opts || typeof opts.body !== "string") return nativeFetch.apply(this, arguments);
      var data = JSON.parse(opts.body);
      var file = data && data.files && data.files[0];
      if (!data || data.prompt_type !== "elevenlabs_transcribe" || !data.api_key || !file || !file.content_base64) {
        return nativeFetch.apply(this, arguments);
      }

      var form = new FormData();
      form.append("prompt_type", "elevenlabs_transcribe");
      form.append("api_key", data.api_key);
      if (data.model) form.append("model", data.model);
      if (data.language_code) form.append("language_code", data.language_code);
      if (data.model_id) form.append("model_id", data.model_id);

      var fileName = file.name || data.file_name || "audio";
      var fileType = file.mime || file.mime_type || file.content_type || file.type || "application/octet-stream";
      form.append("file_name", fileName);
      form.append("file", base64ToBlob(file.content_base64, fileType), fileName);

      var headers = new Headers(opts.headers || {});
      headers.delete("content-type");
      headers.delete("Content-Type");

      var nextInit = {};
      for (var key in opts) nextInit[key] = opts[key];
      nextInit.headers = headers;
      nextInit.body = form;
      return nativeFetch.call(this, input, nextInit);
    } catch (_) {
      return nativeFetch.apply(this, arguments);
    }
  };
})();\`;
`;

  const pattern = /export\s+function\s+buildMinuteUsageClientScript\s*\(\)\s*\{\s*return\s*`/;
  if (!pattern.test(before)) {
    throw new Error('[large-audio-upload] buildMinuteUsageClientScript anchor not found');
  }

  const after = before.replace(
    pattern,
    `${clientPatch}export function buildMinuteUsageClientScript(){return RAVTEXT_LARGE_ELEVENLABS_CLIENT_PATCH+\``
  );

  writeIfChanged(path, before, after);
}

patchAiTools();
patchMinuteAccess();
