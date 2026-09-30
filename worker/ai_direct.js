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

// הנחיה הסופית לפי סוג
// RAVTEXT_GOOGLE_DRIVE_UPLOAD_PATCH_DIRECT

// RAVTEXT_GOOGLE_DRIVE_LINK_NORMALIZATION_PATCH
function driveFileId(url) {
  const raw = String(url || "").trim();
  const find = (text) => {
    const query = String(text || "").match(/[?&](?:id|file_id)=([^&#/]+)/i);
    if (query) return decodeURIComponent(query[1]);
    const match = String(text || "").match(/\/(?:file|document|spreadsheets|presentation|drawings)(?:\/u\/\d+)?\/d\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  };
  try {
    const u = new URL(raw);
    return u.searchParams.get("id") || u.searchParams.get("file_id") || find(u.pathname) || "";
  } catch (_) { return find(raw); }
}
function driveLinkKind(url) {
  const text = String(url || "").toLowerCase();
  if (/\/drive\/(?:u\/\d+\/)?folders\//.test(text)) return "folder";
  if (/forms\.google\.com\//.test(text)) return "form";
  if (/docs\.google\.com\/document\//.test(text)) return "document";
  if (/docs\.google\.com\/spreadsheets\//.test(text)) return "spreadsheet";
  if (/docs\.google\.com\/presentation\//.test(text)) return "presentation";
  if (/docs\.google\.com\/drawings\//.test(text)) return "drawing";
  return "file";
}
function driveDownloadUrl(url) {
  const raw = String(url || "").trim();
  const id = driveFileId(raw);
  if (!id) return raw;
  const kind = driveLinkKind(raw);
  if (kind === "document") return "https://docs.google.com/document/d/" + encodeURIComponent(id) + "/export?format=docx";
  if (kind === "spreadsheet") return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(id) + "/export?format=xlsx";
  if (kind === "presentation") return "https://docs.google.com/presentation/d/" + encodeURIComponent(id) + "/export/pptx";
  if (kind === "drawing") return "https://docs.google.com/drawings/d/" + encodeURIComponent(id) + "/export/png";
  return "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(id);
}
function remoteName(body) { return String(body.drive_file_name || body.file_name || "google-drive-file").trim(); }
function remoteType(name) {
  const ext = String(name || "").toLowerCase().split("?")[0].split("#")[0].split(".").pop();
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "audio";
}

// RAVTEXT_GOOGLE_DRIVE_UPLOAD_HARDENING_PATCH
function driveContentTypeFor(name, fallback) {
  return fallback || detectMimeType(remoteType(name), name);
}
function driveConfirmFromHtml(html) {
  const text = String(html || "");
  const href = text.match(/href="([^"]*uc\?export=download[^"]+)"/i);
  if (href && href[1]) return { href: href[1].replace(/&amp;/g, "&") };
  const confirm = text.match(/[?&]confirm=([0-9A-Za-z_-]+)/);
  const uuid = text.match(/[?&]uuid=([0-9A-Za-z_-]+)/);
  return { confirm: confirm ? confirm[1] : "", uuid: uuid ? uuid[1] : "" };
}
// RAVTEXT_COMPLETE_COPYABLE_DRIVE_ERROR_LOGS
function driveLinkFailure(body, stage, message, extra = {}) {
  const details = typeof _driveErrDetails === "function"
    ? _driveErrDetails(body, { stage, ...extra })
    : { stage, provider: "google_drive", has_drive_url: !!(body && body.drive_url), ...extra };
  return { error: "bad_request", message, details };
}

async function fetchDriveBlob(body) {
  const original = String(body.drive_url || "").trim();
  const linkKind = driveLinkKind(original);
  if (linkKind === "folder") return driveLinkFailure(body, "drive_link_folder", "קישור לתיקיית Google Drive אינו קישור לקובץ. יש להדביק קישור לקובץ בודד.", { link_kind: linkKind });
  if (linkKind === "form") return driveLinkFailure(body, "drive_link_form", "קישור ל-Google Form אינו קישור לקובץ שניתן להוריד.", { link_kind: linkKind });
  if (!/^https?:\/\//i.test(original)) {
    return driveLinkFailure(body, "drive_link_invalid", "קישור Google Drive אינו תקין", { link_kind: linkKind });
  }
  let first;
  try {
    first = await fetch(driveDownloadUrl(original), { redirect: "follow" });
  } catch (e) {
    return { error: "server_error", message: "לא הצלחתי להוריד מדרייב: " + (e && e.message ? e.message : String(e)), details: typeof _driveErrDetails === "function" ? _driveErrDetails(body, { stage: "drive_download_fetch", link_kind: linkKind, exception_message: e && e.message ? e.message : String(e) }) : { stage: "drive_download_fetch", link_kind: linkKind } };
  }

  const firstType = first.headers.get("content-type") || "";
  if (first.ok && !/text\/html/i.test(firstType)) {
    const name = remoteName(body);
    return { blob: await first.blob(), name, mime: driveContentTypeFor(name, firstType) };
  }
  const html = await first.text().catch(() => "");
  const confirm = driveConfirmFromHtml(html);
  if (confirm && (confirm.href || confirm.confirm)) {
    const nextUrl = confirm.href
      ? new URL(confirm.href, "https://drive.google.com").toString()
      : driveDownloadUrl(original) + "&confirm=" + encodeURIComponent(confirm.confirm) + (confirm.uuid ? "&uuid=" + encodeURIComponent(confirm.uuid) : "");
    const cookie = first.headers.get("set-cookie");
    const second = await fetch(nextUrl, { redirect: "follow", headers: cookie ? { cookie } : {} });
    const secondType = second.headers.get("content-type") || "";
    if (second.ok && !/text\/html/i.test(secondType)) {
      const name = remoteName(body);
      return { blob: await second.blob(), name, mime: driveContentTypeFor(name, secondType) };
    }
    return { error: "server_error", message: "Google Drive החזיר שגיאה " + second.status };
  }
  if (!first.ok) return { error: "server_error", message: "Google Drive החזיר שגיאה " + first.status, details: typeof _driveErrDetails === "function" ? _driveErrDetails(body, { stage: "drive_download_http", link_kind: linkKind, http_status: first.status, content_type: firstType }) : { stage: "drive_download_http", http_status: first.status } };
  return {
    error: "bad_request",
    message: "Google Drive returned HTML instead of a downloadable file",
    details: {
      stage: "drive_download_not_file",
      http_status: first.status,
      content_type: firstType,
      response_body: html.slice(0, 3500),
      has_confirm: !!(confirm && (confirm.href || confirm.confirm)),
    },
  };
}

async function uploadDriveToGemini(apiKey, body) {
  const remote = await fetchDriveBlob(body);
  if (remote.error) return remote;
  const mime = driveContentTypeFor(remote.name, remote.mime);
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(remote.blob.size),
      "X-Goog-Upload-Header-Content-Type": mime,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: remote.name } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) {
    const responseText = await start.text().catch(() => "");
    return _driveErr(
      start.status === 401 || start.status === 403 ? "invalid_api_key" : "server_error",
      "Gemini Files upload start failed " + start.status + ": " + responseText,
      body,
      {
        stage: "gemini_files_start",
        http_status: start.status,
        upload_url_present: !!uploadUrl,
        file_name: remote.name,
        file_size: remote.blob.size,
        mime_type: mime,
        response_body: _clipDriveErr(responseText),
      }
    );
  }
  const finish = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Type": mime,
      "Content-Length": String(remote.blob.size),
    },
    body: remote.blob,
  });
  const text = await finish.text();
  if (!finish.ok) {
    return _driveErr(
      finish.status === 401 || finish.status === 403 ? "invalid_api_key" : "server_error",
      "Gemini Files upload failed " + finish.status + ": " + text,
      body,
      {
        stage: "gemini_files_upload_finalize",
        http_status: finish.status,
        file_name: remote.name,
        file_size: remote.blob.size,
        mime_type: mime,
        response_body: _clipDriveErr(text),
      }
    );
  }
  let data = {};
  try { data = JSON.parse(text); }
  catch (e) {
    return _driveErr("server_error", "Gemini Files returned invalid JSON", body, {
      stage: "gemini_files_parse",
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_body: _clipDriveErr(text),
      exception_message: e && e.message ? e.message : String(e),
    });
  }
  const file = data.file || data;
  if (!file.uri) {
    return _driveErr("server_error", "Gemini Files upload did not return file uri", body, {
      stage: "gemini_files_missing_uri",
      file_name: remote.name,
      file_size: remote.blob.size,
      mime_type: mime,
      response_json: data,
    });
  }
  return { uri: file.uri, mimeType: file.mimeType || mime };
}
// RAVTEXT_ERROR_DETAILS_FOR_GEMINI_DRIVE_DIRECT
function _clipDriveErr(value, max = 3500) {
  return String(value || "").slice(0, max);
}
function _driveErrDetails(body, extra = {}) {
  const url = String((body && body.drive_url) || "").trim();
  let id = "";
  try { id = driveFileId(url); } catch (_) {}
  return {
    provider: "gemini",
    stage: extra.stage || "",
    flow: "google_drive_to_gemini_files",
    has_drive_url: !!url,
    drive_file_id: id,
    drive_file_name: String((body && (body.drive_file_name || body.file_name)) || ""),
    prompt_type: String((body && body.prompt_type) || ""),
    model: String((body && body.model) || ""),
    ...extra,
  };
}
function _driveErr(code, message, body, extra = {}) {
  return {
    error: code || "server_error",
    message: message || code || "server_error",
    details: _driveErrDetails(body, extra),
  };
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

  if (body.drive_url) {
    const uploadedDriveFile = await uploadDriveToGemini(apiKey, body);
    if (uploadedDriveFile.error) return { ...uploadedDriveFile, details: uploadedDriveFile.details || _driveErrDetails(body, { stage: "gemini_files_upload" }) };
    parts.push({ file_data: { mime_type: uploadedDriveFile.mimeType, file_uri: uploadedDriveFile.uri } });
  }
  if (body.text) parts.push({ text: body.text });

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 8192 },
  };

  // RAVTEXT_GEMINI_503_RETRY_PATCH: retry transient provider overloads before exposing an error.
  let response;
  let responseText = "";
  const retryDelaysMs = [0, 1200, 3000];
  for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
    if (retryDelaysMs[attempt]) await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    responseText = await response.text();
    if (response.status !== 503) break;
  }

  if (response.status !== 200) {
    const details = _driveErrDetails(body, {
      stage: "gemini_generate_content",
      http_status: response.status,
      used_drive_url: !!body.drive_url,
      response_body: _clipDriveErr(responseText),
      file_data_parts: parts.filter((part) => !!part.file_data).length,
      inline_file_parts: parts.filter((part) => !!part.inline_data).length,
    });
    if (response.status === 401 || response.status === 403) return { error: 'invalid_api_key', message: responseText, details };
    if (response.status === 429) return { error: 'ai_quota_exceeded', message: responseText, details };
    return { error: 'server_error', message: 'Gemini error ' + response.status + ': ' + responseText, details };
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
