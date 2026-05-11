/**
 * Code.gs
 * =======
 * נקודת הכניסה הראשית לשרת. מקבל POST מהפייתון, מנתב, ומחזיר תשובה.
 *
 * זרימה:
 *  1. ניתוח הבקשה
 *  2. אם use_premium = true:
 *     - זיהוי לקוח לפי access_code
 *     - בדיקת status פעיל
 *     - בדיקת מגבלת קצב גלובלית בשרת (10/דקה)
 *     - אומדן עלות מקסימלית
 *     - בדיקת יתרה
 *     - קריאה לבינה
 *     - חישוב עלות בפועל
 *     - חיוב והוספה ליומן
 *  3. אם use_premium = false:
 *     - שימוש במפתח של הלקוח
 *     - אין חיוב, אין יומן
 *  4. החזרת התשובה ללקוח
 */

// ===== כתובות גליונות (ממולאות אוטומטית ע"י setup_sheets) =====
var SPREADSHEET_ID = '1DlGMNRGYIGbOUx16hFbF9In1Fb_qtPRQFIb3Z_YNNBI';

// ===== שמות הגליונות =====
var SHEET_CUSTOMERS = 'לקוחות';
var SHEET_USAGE_LOG = 'יומן_שימוש';
var SHEET_EXCHANGE = 'שערי_מטבע';
var SHEET_PRICING = 'מחירוני_מודלים';
var SHEET_SETTINGS = 'הגדרות';

// ===== כתובות מייל מנהלים (לאדמין dashboard) =====
var ADMIN_EMAILS = ['yiddishebilder@gmail.com'];


/**
 * doPost - נקודת הכניסה הראשית.
 * נקרא מהפייתון בכל קריאה.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);  // המתנה עד 10 שניות לקבלת lock
  } catch (lockErr) {
    return _jsonResponse({error: 'server_error', message: 'מערכת תפוסה - נסה שוב'});
  }

  var startMs = new Date().getTime();
  var requestIp = '';
  try {
    // ניתוח הבקשה
    var body = JSON.parse(e.postData.contents);

    // === ניתוב בוט הקריקטורות — מתקיים לפני ה-callAI הרגיל ===
    // הקריקטורות לא משתמשות במודל טקסטואלי; ההנחיות יושבות ב-caricature.gs
    if (body.prompt_type === 'caricature') {
      return _jsonResponse(handleCaricature(body));
    }

    // === ניתוב תמלול ElevenLabs — אודיו/וידאו דרך scribe_v1 ===
    // השרת לא מחזיק מפתח ElevenLabs. כל משתמש מספק את המפתח האישי שלו
    // דרך body.api_key. אין מסלול פרמיום ל-ElevenLabs.
    if (body.prompt_type === 'elevenlabs_transcribe') {
      return _jsonResponse(handleElevenLabsTranscribe(body));
    }

    // ולידציה בסיסית
    if (!body.prompt_type || !body.model) {
      logUsage({
        customer_id: '', model: body.model || '', prompt_type: body.prompt_type || '',
        files_count: 0, examples_count: 0, has_examples: false,
        prompt_length_chars: 0, text_payload_length_chars: 0,
        custom_prompt_length_chars: 0, has_custom_prompt: false,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: 0,
        status: 'rejected', error_message: 'missing required fields',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: !!body.use_premium,
        access_code_provided: !!body.access_code,
        prompt_full: '', text_payload_full: body.text || '',
        custom_prompt_full: body.custom_prompt || '',
        files_summary: _summarizeFiles(body.files),
        response_full: '',
      });
      return _jsonResponse({error: 'server_error', message: 'בקשה חסרה שדות נדרשים'});
    }

    // === מטא-דאטה ללוג: מה נשלח (קבצי תמלול / דוגמאות / הנחיות מותאמות) ===
    var meta = {
      files_count: (body.files && body.files.length) || 0,
      examples_count: (body.ocr_examples && body.ocr_examples.length) || 0,
      has_examples: !!(body.ocr_examples && body.ocr_examples.length),
      text_payload_length_chars: (body.text || '').length,
      custom_prompt_length_chars: (body.custom_prompt || '').length,
      has_custom_prompt: !!(body.custom_prompt && body.custom_prompt.length),
      text_payload_full: body.text || '',
      custom_prompt_full: body.custom_prompt || '',
      files_summary: _summarizeFiles(body.files),
      use_premium: !!body.use_premium,
      access_code_provided: !!body.access_code,
    };

    // === מצב 1: שימוש במפתח אישי של הלקוח (use_premium = false) ===
    if (!body.use_premium) {
      if (!body.api_key) {
        logUsage({
          customer_id: '', model: body.model, prompt_type: body.prompt_type,
          files_count: meta.files_count, examples_count: meta.examples_count,
          has_examples: meta.has_examples,
          prompt_length_chars: 0,
          text_payload_length_chars: meta.text_payload_length_chars,
          custom_prompt_length_chars: meta.custom_prompt_length_chars,
          has_custom_prompt: meta.has_custom_prompt,
          input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
          cost_agorot_charged: 0, balance_after_agorot: 0,
          status: 'rejected', error_message: 'no api_key supplied',
          request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
          use_premium: false, access_code_provided: meta.access_code_provided,
          prompt_full: '', text_payload_full: meta.text_payload_full,
          custom_prompt_full: meta.custom_prompt_full,
          files_summary: meta.files_summary, response_full: '',
        });
        return _jsonResponse({error: 'invalid_api_key', message: 'מפתח לא סופק'});
      }
      // קוראים לבינה ישירות עם המפתח של הלקוח, ללא חיוב נקודות
      var aiResult = callAI(body.model, body.prompt_type, body.api_key, body);
      logUsage({
        customer_id: 'own_key', model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples,
        prompt_length_chars: aiResult.prompt_length_chars || 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: aiResult.input_tokens || 0,
        output_tokens: aiResult.output_tokens || 0,
        cost_usd_actual: 0, cost_agorot_charged: 0, balance_after_agorot: 0,
        status: aiResult.error ? 'failed_own_key' : 'success_own_key',
        error_message: aiResult.error ? (aiResult.error + ': ' + (aiResult.message || '')) : '',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: false, access_code_provided: meta.access_code_provided,
        prompt_full: aiResult.prompt_full || '',
        text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary,
        response_full: aiResult.result || '',
      });
      if (aiResult.error) {
        return _jsonResponse(aiResult);
      }
      return _jsonResponse({
        result: aiResult.result,
        // אין שדות balance/cost כי זה מצב מפתח אישי
      });
    }

    // === מצב 2: פרמיום (use_premium = true) ===
    if (!body.access_code) {
      logUsage({
        customer_id: '', model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples, prompt_length_chars: 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: 0,
        status: 'rejected', error_message: 'access_code not provided',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: true, access_code_provided: false,
        prompt_full: '', text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary, response_full: '',
      });
      return _jsonResponse({error: 'invalid_access_code', message: 'קוד גישה לא סופק'});
    }

    // זיהוי לקוח
    var customer = getCustomerByCode(body.access_code);
    if (!customer) {
      logUsage({
        customer_id: '', model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples, prompt_length_chars: 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: 0,
        status: 'rejected', error_message: 'invalid access_code',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: true, access_code_provided: true,
        prompt_full: '', text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary, response_full: '',
      });
      return _jsonResponse({error: 'invalid_access_code', message: 'קוד גישה לא תקין'});
    }
    if (customer.status !== 'active') {
      logUsage({
        customer_id: customer.customer_id, model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples, prompt_length_chars: 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: customer.balance_agorot,
        status: 'rejected', error_message: 'account blocked',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: true, access_code_provided: true,
        prompt_full: '', text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary, response_full: '',
      });
      return _jsonResponse({error: 'account_blocked', message: 'החשבון שלך חסום'});
    }

    // בדיקת קצב גלובלית - הגנה מפני גניבת תקציב
    var rateOk = checkGlobalRateLimit(customer.customer_id);
    if (!rateOk) {
      logUsage({
        customer_id: customer.customer_id, model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples, prompt_length_chars: 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: customer.balance_agorot,
        status: 'rejected', error_message: 'rate limit exceeded',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: true, access_code_provided: true,
        prompt_full: '', text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary, response_full: '',
      });
      return _jsonResponse({
        error: 'server_error',
        message: 'חרגת ממגבלת קצב גלובלית. נסה שוב בעוד דקה.'
      });
    }

    // אומדן עלות מקסימלית + מרווח ביטחון 20%
    var estimatedMaxCost = estimateMaxCost(body);
    if (customer.balance_agorot < estimatedMaxCost) {
      logUsage({
        customer_id: customer.customer_id, model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples, prompt_length_chars: 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: customer.balance_agorot,
        status: 'rejected', error_message: 'insufficient balance',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: true, access_code_provided: true,
        prompt_full: '', text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary, response_full: '',
      });
      return _jsonResponse({
        error: 'insufficient_balance',
        message: 'יתרת הנקודות שלך נמוכה מדי לקריאה זו',
        balance_agorot: customer.balance_agorot
      });
    }

    // קריאה לבינה - מפתח השרת מהגדרות
    var serverApiKey = getServerApiKeyForModel(body.model);
    if (!serverApiKey) {
      logUsage({
        customer_id: customer.customer_id, model: body.model, prompt_type: body.prompt_type,
        files_count: meta.files_count, examples_count: meta.examples_count,
        has_examples: meta.has_examples, prompt_length_chars: 0,
        text_payload_length_chars: meta.text_payload_length_chars,
        custom_prompt_length_chars: meta.custom_prompt_length_chars,
        has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0, output_tokens: 0, cost_usd_actual: 0,
        cost_agorot_charged: 0, balance_after_agorot: customer.balance_agorot,
        status: 'rejected', error_message: 'no server api key for model',
        request_ip: requestIp, duration_ms: new Date().getTime() - startMs,
        use_premium: true, access_code_provided: true,
        prompt_full: '', text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary, response_full: '',
      });
      return _jsonResponse({error: 'server_error', message: 'מפתח שרת לא הוגדר למודל זה'});
    }

    var aiResult = callAI(body.model, body.prompt_type, serverApiKey, body);

    if (aiResult.error) {
      // לא מחייבים על קריאה כושלת
      logUsage({
        customer_id: customer.customer_id,
        model: body.model,
        prompt_type: body.prompt_type,
        files_count: meta.files_count,
        examples_count: meta.examples_count,
        has_examples: meta.has_examples,
        prompt_length_chars: aiResult.prompt_length_chars || 0,
        text_payload_length_chars: meta.text_payload_length_chars,
      custom_prompt_length_chars: meta.custom_prompt_length_chars,
      has_custom_prompt: meta.has_custom_prompt,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd_actual: 0,
        cost_agorot_charged: 0,
        balance_after_agorot: customer.balance_agorot,
        status: 'failed',
        error_message: aiResult.error + ': ' + (aiResult.message || ''),
        duration_ms: new Date().getTime() - startMs,
        request_ip: requestIp,
        use_premium: true,
        access_code_provided: true,
        prompt_full: aiResult.prompt_full || '',
        text_payload_full: meta.text_payload_full,
        custom_prompt_full: meta.custom_prompt_full,
        files_summary: meta.files_summary,
        response_full: '',
      });
      return _jsonResponse(aiResult);
    }

    // חישוב עלות בפועל
    var costData = calculateCost(
      body.model,
      aiResult.input_tokens || 0,
      aiResult.output_tokens || 0
    );

    // הגנה: דחייה אוטומטית אם קריאה אחת מעל 5 שקלים
    if (costData.cost_agorot > 500) {
      return _jsonResponse({
        error: 'server_error',
        message: 'העלות לקריאה זו חורגת מהמותר. פנה לתמיכה.'
      });
    }

    // חיוב הלקוח
    var newBalance = chargeCustomer(customer.customer_id, costData.cost_agorot);

    // רישום ליומן
    logUsage({
      customer_id: customer.customer_id,
      model: body.model,
      prompt_type: body.prompt_type,
      files_count: meta.files_count,
      examples_count: meta.examples_count,
      has_examples: meta.has_examples,
      prompt_length_chars: aiResult.prompt_length_chars || 0,
      text_payload_length_chars: meta.text_payload_length_chars,
      custom_prompt_length_chars: meta.custom_prompt_length_chars,
      has_custom_prompt: meta.has_custom_prompt,
      input_tokens: aiResult.input_tokens || 0,
      output_tokens: aiResult.output_tokens || 0,
      cost_usd_actual: costData.cost_usd_total,
      cost_agorot_charged: costData.cost_agorot,
      balance_after_agorot: newBalance,
      status: 'success',
      error_message: '',
      duration_ms: new Date().getTime() - startMs,
      request_ip: requestIp,
      use_premium: true,
      access_code_provided: true,
      prompt_full: aiResult.prompt_full || '',
      text_payload_full: meta.text_payload_full,
      custom_prompt_full: meta.custom_prompt_full,
      files_summary: meta.files_summary,
      response_full: aiResult.result || '',
    });

    // אזהרת יתרה נמוכה
    var settings = getSettings();
    var lowWarning = newBalance < settings.low_balance_threshold_agorot;

    // התראת אדמין אם לקוח חרג מ-50 ש"ח ביום
    checkDailySpendingAlert(customer.customer_id);

    return _jsonResponse({
      result: aiResult.result,
      balance_agorot: newBalance,
      balance_points_display: (newBalance / 100).toFixed(2),
      cost_agorot: costData.cost_agorot,
      cost_points_display: (costData.cost_agorot / 100).toFixed(2),
      input_tokens: aiResult.input_tokens || 0,
      output_tokens: aiResult.output_tokens || 0,
      cost_usd_actual: costData.cost_usd_total,
      exchange_rate: costData.exchange_rate,
      profit_multiplier: settings.profit_multiplier,
      low_balance_warning: lowWarning,
    });

  } catch (err) {
    return _jsonResponse({
      error: 'server_error',
      message: 'שגיאה לא צפויה: ' + err.toString()
    });
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}


/**
 * doGet - מציג את ממשק הניהול (אם המשתמש מורשה).
 */
function doGet(e) {
  var userEmail = Session.getActiveUser().getEmail();
  if (ADMIN_EMAILS.indexOf(userEmail) < 0) {
    return HtmlService.createHtmlOutput(
      '<div style="text-align:center; padding:40px; font-family:Arial;">' +
      '<h2>אין הרשאה</h2>' +
      '<p>החשבון שלך לא מורשה לצפות בעמוד זה.</p>' +
      '</div>'
    );
  }
  if (e && e.parameter && e.parameter.action === 'init_columns') {
    var msg = addUsageLogContentColumns();
    return HtmlService.createHtmlOutput(
      '<div style="text-align:center; padding:40px; font-family:Arial; direction:rtl;">' +
      '<h2>בוצע</h2><p>' + msg + '</p></div>'
    );
  }
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ניהול - מערכת תמלול תורה')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}


/**
 * עזר - JSON response
 */
function _jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * עזר - סיכום קבצים שנשלחו (שם, סוג, גודל) ללא תוכן הקובץ עצמו.
 */
function _summarizeFiles(files) {
  if (!files || !files.length) return '';
  var arr = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    var size = 0;
    if (f.content_base64) size = Math.ceil(f.content_base64.length * 3 / 4);
    arr.push({
      name: f.name || f.filename || ('file_' + (i + 1)),
      mime_type: f.mime_type || f.type || '',
      size_bytes: size,
    });
  }
  return JSON.stringify(arr);
}


/**
 * עזר - include של HTML חיצוני
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


/**
 * מקבל את מפתח ה-API של השרת לפי המודל.
 * המפתחות נשמרים ב-Script Properties (לא בקוד).
 */
function getServerApiKeyForModel(modelName) {
  var props = PropertiesService.getScriptProperties();

  if (modelName.indexOf('gemini') === 0) {
    return props.getProperty('GEMINI_API_KEY');
  }
  if (modelName.indexOf('claude') === 0) {
    return props.getProperty('CLAUDE_API_KEY');
  }
  if (modelName.indexOf('gpt') === 0) {
    return props.getProperty('OPENAI_API_KEY');
  }
  return null;
}


/**
 * בדיקת קצב גלובלית - מקסימום 10 קריאות/דקה לכל customer_id.
 * משתמש ב-CacheService למהירות.
 */
function checkGlobalRateLimit(customerId) {
  var cache = CacheService.getScriptCache();
  var key = 'rate_' + customerId;
  var data = cache.get(key);

  var now = Date.now();
  var window = data ? JSON.parse(data) : [];
  // מסיר ישנים מ-60 שניות
  window = window.filter(function(t) { return now - t < 60000; });

  if (window.length >= 10) {
    return false;
  }

  window.push(now);
  cache.put(key, JSON.stringify(window), 120);  // אחסון ל-2 דקות
  return true;
}


/**
 * אומדן עלות מקסימלית של קריאה.
 * משמש לבדיקת יתרה לפני קריאה לבינה.
 */
function estimateMaxCost(body) {
  var pricing = getPricingForModel(body.model);
  if (!pricing) return 0;

  // אומדן tokens קלט: 4 תווים = 1 token
  var inputChars = 0;
  if (body.text) inputChars += body.text.length;
  if (body.files) {
    body.files.forEach(function(f) {
      if (f.content_base64) inputChars += f.content_base64.length / 4 * 3;  // base64 -> bytes
    });
  }
  var estimatedInputTokens = Math.ceil(inputChars / 4);

  // אומדן tokens פלט: עד 8000 (תקרה)
  var estimatedOutputTokens = 8000;

  var inputCostUsd = (estimatedInputTokens / 1000000) * pricing.input_price_per_1m_usd;
  var outputCostUsd = (estimatedOutputTokens / 1000000) * pricing.output_price_per_1m_usd;
  var totalUsd = inputCostUsd + outputCostUsd;

  var settings = getSettings();
  var rate = getCurrentExchangeRate();

  var costAgorot = Math.ceil(totalUsd * rate * 100 * settings.profit_multiplier);
  // מרווח ביטחון 20%
  return Math.ceil(costAgorot * 1.20);
}


/**
 * בדיקת התראת הוצאה יומית - אם לקוח חרג מ-50 ש"ח ביום.
 */
function checkDailySpendingAlert(customerId) {
  // בדיקה פעם ביום בלבד לכל לקוח (cache)
  var cache = CacheService.getScriptCache();
  var key = 'spending_alert_' + customerId + '_' + new Date().toISOString().split('T')[0];
  if (cache.get(key)) return;

  var todayUsage = getTodayUsageForCustomer(customerId);
  if (todayUsage > 5000) {  // 5000 אגורות = 50 ש"ח
    sendAdminAlert(customerId, todayUsage);
    cache.put(key, '1', 3600);  // אזהרה אחת ליום
  }
}


/**
 * שליחת התראה למנהל.
 */
function sendAdminAlert(customerId, agorot) {
  var subject = 'התראה: לקוח ' + customerId + ' חרג מ-50 ש"ח היום';
  var body = 'הלקוח ' + customerId + ' צרך ' + (agorot / 100).toFixed(2) + ' ש"ח היום.\n\n' +
             'בדוק את חשבונו בממשק הניהול.';
  ADMIN_EMAILS.forEach(function(email) {
    try {
      MailApp.sendEmail(email, subject, body);
    } catch (e) {}
  });
}
