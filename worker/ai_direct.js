// עיבוד AI ישירות בשרת האתר (Cloudflare Worker) — בלי Google Apps Script.
//
// ⚠️ ההנחיות (SERVER_PROMPTS) אינן בקוד ואינן ב-git. הן מגיעות מסוד Cloudflare
//    בשם SERVER_PROMPTS (מחרוזת JSON, אותו תוכן שהיה ב-Apps Script). להזין פעם אחת:
//        wrangler secret put SERVER_PROMPTS
//    ההנחיות נשארות בצד-שרת בלבד ולעולם לא נשלחות לדפדפן — אותה הגנה כמו קודם.
//
// המסלול הזה מטפל רק בבקשות עם מפתח אישי של המשתמש (api_key) וללא access_code.
// בקשות פרמיום (access_code) ובקשות שאין להן הנחיה כאן (nikud/elevenlabs) —
// ממשיכות דרך ה-GAS כרגיל (ראה ai_tools.js), כדי לא לשבור שום זרימה קיימת.
//
// פורט נאמן של ai_clients.js (callAI / buildPromptByType / callGemini / callClaude).

async function getServerPrompts(env) {
  // מקור ההנחיות, לפי סדר עדיפות:
  //   1. מסד הנתונים של האתר (app_settings.SERVER_PROMPTS_JSON) — נשמר דרך פאנל
  //      הניהול של האתר. כך ההנחיות חיות באתר עצמו, בלי Cloudflare-dashboard ובלי GAS.
  //   2. סוד env.SERVER_PROMPTS (אם הוגדר).
  //   3. אין → מחזיר null (הבקשה תיפול חזרה ל-GAS).
  let raw = null;
  try {
    if (env && env.DB) {
      const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
        .bind('SERVER_PROMPTS_JSON').first();
      if (row && row.value) raw = row.value;
    }
  } catch (_) { /* אין טבלה/גישה — ממשיכים למקור הבא */ }
  if (!raw && env && env.SERVER_PROMPTS) raw = env.SERVER_PROMPTS;
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

function detectMimeType(fileType, fileName) {
  const ext = String(fileName || '').toLowerCase().split('.').pop();
  if (fileType === 'audio') return 'audio/' + (ext === 'mp3' ? 'mpeg' : ext);
  if (fileType === 'video') return 'video/' + ext;
  if (fileType === 'image') return ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
  if (fileType === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

// בניית ההנחיה הסופית לפי סוג. מחזיר null אם הסוג לא מטופל כאן (→ יפול ל-GAS).
function buildPromptByType(promptType, body, P) {
  if (promptType === 'audio_torah') {
    let prompt = P['audio_torah'];
    if (body.ashkenazi && P['ashkenazi_patch']) {
      prompt = P['ashkenazi_patch'] + '\n\n' + prompt;
    }
    return prompt || null;
  }
  if (promptType === 'audio_regular') return P['audio_regular'] || null;
  if (promptType === 'ocr_handwriting') {
    let prompt = P['ocr_handwriting'];
    if (body.has_examples && P['ocr_examples_addition']) {
      prompt += '\n\n' + P['ocr_examples_addition'];
    }
    return prompt || null;
  }
  if (promptType === 'printed') return P['printed'] || null;

  if (promptType === 'claude_edition') {
    let basePrompt = P['claude_edition'];
    if (!basePrompt) return null;
    const enginesUsed = (body.engines_used && body.engines_used.length) ? body.engines_used : [];
    const preferred = body.preferred_engine || '';

    if (enginesUsed.indexOf('elevenlabs') >= 0) {
      basePrompt += '\n\n=== כלל סגנון: עדי ElevenLabs ===\n' +
        'בריצה הזו יש עדי נוסח שהופקו על ידי ElevenLabs (השירות מסומן ' +
        'בכותרת של כל עד). שירות זה אינו מקבל הנחיות פורמט תורניות, ולכן ' +
        'הוא לפעמים כותב את אותו דבר בצורה לא־תורנית. כשעד מ-ElevenLabs ' +
        'נבדל מעד אחר רק בסגנון/פורמט — אין לתת לזה שום משקל בהכרעה ולא ' +
        'להזכיר זאת בהערות שוליים. דוגמאות להבדלי סגנון שיש להתעלם מהם:\n' +
        '* ראשי תיבות תורניים שנכתבו במלואם (תוספות במקום תוס\', עמוד א ' +
        'במקום ע"א, צריך עיון במקום צ"ע, כמו שכתוב במקום כמש"כ, וכולי ' +
        'במקום וכו\', וכיוצא בו).\n' +
        '* מספרים שנכתבו בספרות במקום במילים (100 במקום מאה).\n' +
        '* כתיב מלא/חסר ושינויי א\'/ה\' בסיומות (סברה/סברא, דוגמה/דוגמא).\n' +
        '* פיסוק שנכתב במילים במקום בסימנים ("נקודה" במקום ".").\n' +
        'רק כשעד מ-ElevenLabs נבדל בנוסחה ממש (מילה אחרת, סדר אחר, ' +
        'תוכן אחר) — להתייחס אליו כעד שווה לעדים מגמיני, ולכלול אותו ' +
        'בהכרעת הרוב או בהערת השוליים.\n' +
        '=== סוף כלל סגנון ElevenLabs ===\n';
    }

    if (enginesUsed.length >= 2 && preferred) {
      const preferredLabel = preferred === 'elevenlabs' ? 'ElevenLabs' :
        (preferred === 'gemini' ? 'Gemini' : preferred);
      const inEngines = enginesUsed.indexOf(preferred) >= 0;
      if (inEngines) {
        basePrompt += '\n\n=== כלל מיוחד: מודל מועדף ===\n' +
          'בריצה הזו נוצרו עדי נוסח משני סוגי מנועים שונים, והמשתמש סימן ' +
          'שאחד המנועים נחשב חשוב יותר עבורו. לכן יש לו קול מכריע במקרים ' +
          'מסוימים בלבד:\n' +
          '* המודל החשוב הוא: ' + preferredLabel + '\n' +
          '* כלל "רוב מנצח" נשאר בתוקף.\n' +
          '* רק כשאין רוב (תיקו / פיצול שווה) — הצד שאליו תרם המודל ' +
          'החשוב הוא הזוכה, ללא הערת שוליים על הצד השני.\n' +
          '* אם המודל החשוב לא נמצא בקבוצה השוויונית — חזור להערת ' +
          'שוליים על המחלוקת.\n' +
          '* בשום מקרה אל תיתן למודל החשוב יותר מקול אחד. הוא לא ' +
          '"קול וחצי" ולא "כפול". רק משובר־שוויון.\n' +
          '=== סוף כלל המודל החשוב ===\n';
      } else {
        basePrompt += '\n\n=== הערה: מודל חשוב לא נמצא ===\n' +
          'המשתמש בחר את ' + preferredLabel + ' כמודל החשוב, אך לא ' +
          'נמצאו עדים מהמנוע הזה בריצה הנוכחית. ההכרעה מתבצעת לפי ' +
          'רוב סטטיסטי בלבד.\n=== סוף הערה ===\n';
      }
    }
    return basePrompt;
  }

  if (promptType === 'torah_style_ancient') return P['torah_style_ancient'] || null;
  if (promptType === 'torah_style_modern') {
    if (!P['torah_style_ancient'] || !P['torah_style_modern_patch']) return null;
    return P['torah_style_ancient'] + '\n\n' + P['torah_style_modern_patch'];
  }
  if (promptType === 'torah_style_combined') {
    if (!P['torah_style_ancient'] || !P['torah_style_combined_patch']) return null;
    return P['torah_style_ancient'] + '\n\n' + P['torah_style_combined_patch'];
  }

  return null; // nikud_* / elevenlabs_transcribe / לא ידוע → יפול ל-GAS
}

async function callGemini(modelName, apiKey, promptText, body) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    modelName + ':generateContent?key=' + encodeURIComponent(apiKey);

  const parts = [{ text: promptText }];

  if (body.ocr_examples && body.ocr_examples.length) {
    parts.push({ text:
      '\n\n=== דוגמאות הדגמה ===\n' +
      'הזוגות הבאים הם דוגמאות בלבד (Few-Shot). אל תתמלל אותן. ' +
      'למד מהן את סגנון הכתב והמיפוי לטקסט מודפס, ' +
      'ואז יישם את אותו המיפוי על התמונה לתמלול שתישלח אחרי הדוגמאות.'
    });
    body.ocr_examples.forEach((ex, i) => {
      const num = i + 1;
      parts.push({ text: '— דוגמה ' + num + ': תמונת כתב יד —' });
      parts.push({ inline_data: { mime_type: ex.handwriting_mime || 'image/jpeg', data: ex.handwriting_base64 } });
      parts.push({ text: '— דוגמה ' + num + ': תוצאת ההקלדה הנכונה —' });
      parts.push({ inline_data: { mime_type: ex.typed_mime || 'image/jpeg', data: ex.typed_base64 } });
    });
    parts.push({ text: '\n=== סוף הדוגמאות ===\n' });
  }

  if (body.files && body.files.length) {
    if (body.ocr_examples && body.ocr_examples.length) {
      parts.push({ text: '\n=== התמונה לתמלול (יישם עליה את מה שלמדת מהדוגמאות) ===' });
    }
    body.files.forEach((f) => {
      parts.push({ inline_data: { mime_type: detectMimeType(f.type, f.name), data: f.content_base64 } });
    });
  }

  if (body.text) parts.push({ text: body.text });

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();

  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: responseText };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText };
    return { error: 'server_error', message: 'Gemini error ' + response.status + ': ' + responseText };
  }

  let data;
  try { data = JSON.parse(responseText); } catch (_) { return { error: 'server_error', message: 'תשובה לא תקינה מ-Gemini' }; }
  let resultText = '';
  if (data.candidates && data.candidates[0] && data.candidates[0].content) {
    const partsResp = data.candidates[0].content.parts || [];
    for (const p of partsResp) { if (p.text) resultText += p.text; }
  }
  const usage = data.usageMetadata || {};
  return {
    result: resultText,
    input_tokens: usage.promptTokenCount || 0,
    output_tokens: usage.candidatesTokenCount || 0,
  };
}

async function callClaude(modelName, apiKey, promptText, body) {
  const url = 'https://api.anthropic.com/v1/messages';
  const userContent = [];

  if (body.text) userContent.push({ type: 'text', text: body.text });

  if (body.files) {
    body.files.forEach((f) => {
      if (f.type === 'image') {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: detectMimeType(f.type, f.name), data: f.content_base64 } });
      } else if (f.type === 'pdf') {
        userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.content_base64 } });
      }
    });
  }

  if (userContent.length === 0) userContent.push({ type: 'text', text: '(no input)' });

  const payload = {
    model: modelName,
    max_tokens: 8192,
    system: promptText,
    messages: [{ role: 'user', content: userContent }],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();

  if (response.status !== 200) {
    if (response.status === 401) return { error: 'invalid_api_key', message: responseText };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText };
    return { error: 'server_error', message: 'Claude error ' + response.status + ': ' + responseText };
  }

  let data;
  try { data = JSON.parse(responseText); } catch (_) { return { error: 'server_error', message: 'תשובה לא תקינה מ-Claude' }; }
  let resultText = '';
  if (data.content && data.content.length) {
    for (const c of data.content) { if (c.type === 'text' && c.text) resultText += c.text; }
  }
  const usage = data.usage || {};
  return { result: resultText, input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 };
}

// ===== מנוע הניקוד — נפרד לגמרי ממנוע התמלול (אין לערבב). מפתח D1 נפרד. =====
async function getNikudPrompts(env) {
  let raw = null;
  try {
    if (env && env.DB) {
      const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?')
        .bind('NIKUD_PROMPTS_JSON').first();
      if (row && row.value) raw = row.value;
    }
  } catch (_) {}
  if (!raw && env && env.NIKUD_PROMPTS) raw = env.NIKUD_PROMPTS;
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return null; }
}

// פורט נאמן של nikud.gs/buildNikudPrompt.
function buildNikudPrompt(promptType, body, N) {
  let base;
  if (promptType === 'nikud_judge_torah') base = N['nikud_judge_torah'];
  else if (promptType === 'nikud_judge_regular') base = N['nikud_judge_regular'];
  else if (promptType === 'nikud_torah') base = N['nikud_torah'];
  else base = N['nikud_regular'];
  if (!base) return null;
  if (body && body.preserve_spelling && N['preserve_spelling_block']) {
    base = base + N['preserve_spelling_block'];
  }
  return base;
}

// ===== מנוע ElevenLabs — תמלול אודיו/וידאו ישירות (בלי הנחיות, מפתח אישי בלבד). =====
function base64ToBlob(b64, mime) {
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'application/octet-stream' });
}

async function callElevenLabs(apiKey, body) {
  const file = body.files && body.files[0];
  if (!file || !file.content_base64) {
    return { error: 'server_error', message: 'לא נשלח קובץ אודיו לתמלול' };
  }
  const modelId = (body.model && body.model.indexOf('elevenlabs-') === 0)
    ? body.model.substring('elevenlabs-'.length) : 'scribe_v1';
  const languageCode = body.language_code || 'heb';
  const form = new FormData();
  form.append('model_id', modelId);
  form.append('language_code', languageCode);
  form.append('file', base64ToBlob(file.content_base64, detectMimeType(file.type, file.name)), file.name || 'audio');

  let response;
  try {
    response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
  } catch (err) {
    return { error: 'server_error', message: 'ElevenLabs רשת: ' + (err && err.message ? err.message : String(err)) };
  }
  const text = await response.text();
  if (response.status !== 200) {
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: text };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: 'ElevenLabs rate limit' };
    return { error: 'server_error', message: 'ElevenLabs error ' + response.status + ': ' + text };
  }
  let data;
  try { data = JSON.parse(text); } catch (_) { return { error: 'server_error', message: 'תשובה לא תקינה מ-ElevenLabs' }; }
  const transcribed = data.text || '';
  if (!transcribed) return { error: 'server_error', message: 'ElevenLabs לא החזיר טקסט' };
  return { result: transcribed };
}

/**
 * מנסה לבצע את בקשת ה-AI ישירות בשרת (בלי GAS).
 * ניתוב לפי מנוע (אין לערבב): elevenlabs / nikud / תמלול-והכרעה.
 * מחזיר { handled:false } אם אין הנחיות/מפתח → יפול ל-GAS.
 * מחזיר { handled:true, data } עם התוצאה או שגיאה בפורמט GAS ({result} / {error,message}).
 */
export async function callAiDirect(body, env) {
  const promptType = String(body.prompt_type || '');
  const modelName = String(body.model || '');
  const apiKey = body.api_key;
  if (!apiKey) return { handled: false };

  // מנוע ElevenLabs — תמלול ישיר, בלי הנחיות.
  if (promptType === 'elevenlabs_transcribe') {
    return { handled: true, data: await callElevenLabs(apiKey, body) };
  }

  // בחירת מקור ההנחיות לפי מנוע.
  let promptText;
  if (promptType.indexOf('nikud') === 0) {
    const N = await getNikudPrompts(env);
    if (!N) return { handled: false };
    promptText = buildNikudPrompt(promptType, body, N);
  } else {
    const P = await getServerPrompts(env);
    if (!P) return { handled: false };
    promptText = buildPromptByType(promptType, body, P);
  }
  if (!promptText) return { handled: false };

  if (body.custom_prompt && String(body.custom_prompt).length) {
    promptText =
      '=== הנחיות בעדיפות גבוהה (מאת המשתמש) ===\n' +
      String(body.custom_prompt).trim() +
      '\n=== סוף הנחיות בעדיפות גבוהה ===\n\n' +
      '=== הנחיות מערכת בסיסיות (כפופות להוראות בעדיפות הגבוהה למעלה) ===\n' +
      promptText;
  }

  let aiOut;
  try {
    if (modelName.indexOf('gemini') === 0) {
      aiOut = await callGemini(modelName, apiKey, promptText, body);
    } else if (modelName.indexOf('claude') === 0) {
      aiOut = await callClaude(modelName, apiKey, promptText, body);
    } else {
      aiOut = { error: 'server_error', message: 'מודל לא נתמך: ' + modelName };
    }
  } catch (err) {
    const errStr = err && err.message ? err.message : String(err);
    if (errStr.indexOf('401') >= 0 || errStr.toLowerCase().indexOf('invalid') >= 0) {
      aiOut = { error: 'invalid_api_key', message: errStr };
    } else if (errStr.indexOf('429') >= 0 || errStr.toLowerCase().indexOf('quota') >= 0) {
      aiOut = { error: 'ai_quota_exceeded', message: errStr };
    } else {
      aiOut = { error: 'server_error', message: errStr };
    }
  }
  return { handled: true, data: aiOut };
}
