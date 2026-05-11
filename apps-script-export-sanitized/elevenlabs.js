/**
 * elevenlabs.gs
 * =============
 * תמלול אודיו/וידאו דרך ElevenLabs Speech-to-Text (scribe_v1).
 *
 * חשוב: scribe_v1 לא מקבל פרומפט / הנחיות מותאמות. הפרמטרים היחידים
 * שמשפיעים על התמלול הם language_code (לבחירת השפה — heb לעברית)
 * ו-keyterms (מערך מילים/ביטויים להטיית המודל לזהותם נכון). אין דרך
 * לשלוח את ההנחיה התורנית הארוכה כפי ששולחים ל-Gemini.
 *
 * המפתח: כל משתמש מספק את המפתח האישי שלו דרך body.api_key. השרת
 * לא מחזיק מפתח ElevenLabs ולא משלם על השימוש — אין מסלול פרמיום.
 *
 * תשובה ללקוח: {result: <transcribed text>}
 * שגיאה:        {error: <code>, message: <details>}
 */


function handleElevenLabsTranscribe(body) {
  // המפתח של המשתמש בלבד — לא Script Properties, לא פרמיום.
  var apiKey = (body && body.api_key) ? String(body.api_key).trim() : '';
  if (!apiKey) {
    return {
      error: 'invalid_api_key',
      message: 'נא להזין את מפתח ElevenLabs שלך בשלב 1 לפני השימוש בשירות.'
    };
  }

  if (!body.files || !body.files.length) {
    return {error: 'server_error', message: 'לא נשלח קובץ אודיו לתמלול'};
  }
  var file = body.files[0];
  var fileName = file.name || 'audio.bin';
  var mime = file.mime || 'application/octet-stream';
  var dataBytes = Utilities.base64Decode(file.content_base64 || '');
  if (!dataBytes || dataBytes.length === 0) {
    return {error: 'server_error', message: 'קובץ ריק'};
  }

  var modelId = (body.model && body.model.indexOf('elevenlabs-') === 0)
                ? body.model.substring('elevenlabs-'.length)
                : 'scribe_v1';
  // תרגום: elevenlabs-scribe-v1 → scribe_v1
  modelId = modelId.replace(/-/g, '_');
  var languageCode = body.language_code || 'heb';

  var boundary = '----TorahTranscriptionEL' + Utilities.getUuid().replace(/-/g, '');
  var crlf = '\r\n';

  function _fieldPart(name, value) {
    return '--' + boundary + crlf +
           'Content-Disposition: form-data; name="' + name + '"' + crlf + crlf +
           value + crlf;
  }

  var preamble = _fieldPart('model_id', modelId) +
                 _fieldPart('language_code', languageCode) +
                 '--' + boundary + crlf +
                 'Content-Disposition: form-data; name="file"; filename="' + fileName + '"' + crlf +
                 'Content-Type: ' + mime + crlf + crlf;
  var trailer = crlf + '--' + boundary + '--' + crlf;

  var preambleBytes = Utilities.newBlob(preamble).getBytes();
  var trailerBytes = Utilities.newBlob(trailer).getBytes();
  var bodyBytes = [].concat(preambleBytes, dataBytes, trailerBytes);
  var bodyBlob = Utilities.newBlob(bodyBytes).getBytes();

  var options = {
    method: 'post',
    contentType: 'multipart/form-data; boundary=' + boundary,
    headers: {
      'xi-api-key': apiKey,
      'Accept': 'application/json',
    },
    payload: bodyBlob,
    muteHttpExceptions: true,
    followRedirects: true,
  };

  var response;
  try {
    response = UrlFetchApp.fetch('https://api.elevenlabs.io/v1/speech-to-text', options);
  } catch (err) {
    return {error: 'server_error', message: 'ElevenLabs רשת: ' + err.toString()};
  }
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code === 401 || code === 403) {
    return {
      error: 'invalid_api_key',
      message: 'מפתח ElevenLabs שלך לא תקף או נחסם (' + code + ')'
    };
  }
  if (code === 429) {
    return {error: 'ai_quota_exceeded', message: 'ElevenLabs rate limit'};
  }
  if (code < 200 || code >= 300) {
    return {
      error: 'server_error',
      message: 'ElevenLabs HTTP ' + code + ': ' + text.substring(0, 500)
    };
  }

  var data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return {
      error: 'server_error',
      message: 'ElevenLabs תשובה לא JSON: ' + text.substring(0, 500)
    };
  }

  var transcribed = data.text || '';
  if (!transcribed) {
    return {error: 'server_error', message: 'ElevenLabs לא החזיר טקסט'};
  }

  return {
    result: transcribed,
    input_tokens: 0,
    output_tokens: 0,
    prompt_full: 'ElevenLabs ' + modelId + ' lang=' + languageCode,
  };
}
