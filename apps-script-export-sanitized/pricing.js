/**
 * pricing.gs
 * ==========
 * חישוב עלויות, ניהול שערי חליפין, וגישה למחירוני המודלים.
 */


/**
 * חישוב עלות בפועל אחרי קריאת בינה.
 * מחזיר אובייקט עם cost_agorot, cost_usd_total, exchange_rate.
 */
function calculateCost(modelName, inputTokens, outputTokens) {
  var pricing = getPricingForModel(modelName);
  if (!pricing) {
    return {
      cost_agorot: 1,  // מינימום
      cost_usd_total: 0,
      exchange_rate: getCurrentExchangeRate(),
    };
  }

  var inputCostUsd = (inputTokens / 1000000) * pricing.input_price_per_1m_usd;
  var outputCostUsd = (outputTokens / 1000000) * pricing.output_price_per_1m_usd;
  var totalUsd = inputCostUsd + outputCostUsd;

  var rate = getCurrentExchangeRate();
  var settings = getSettings();

  // עיגול כלפי מעלה (ceil) למניעת הפסד
  var costAgorot = Math.ceil(totalUsd * rate * 100 * settings.profit_multiplier);
  // מינימום 1 אגורה
  costAgorot = Math.max(costAgorot, settings.min_charge_agorot);

  return {
    cost_agorot: costAgorot,
    cost_usd_total: totalUsd,
    cost_usd_input: inputCostUsd,
    cost_usd_output: outputCostUsd,
    exchange_rate: rate,
    profit_multiplier: settings.profit_multiplier,
  };
}


/**
 * שליפת מחירי מודל.
 */
function getPricingForModel(modelName) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_PRICING);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['model_name']] === modelName) {
      var enabled = data[i][colMap['enabled']];
      if (enabled === false || enabled === 'FALSE' || enabled === 'false') {
        return null;
      }
      return {
        model_name: data[i][colMap['model_name']],
        provider: data[i][colMap['provider']],
        input_price_per_1m_usd: parseFloat(data[i][colMap['input_price_per_1m_usd']] || 0),
        output_price_per_1m_usd: parseFloat(data[i][colMap['output_price_per_1m_usd']] || 0),
        enabled: true,
      };
    }
  }
  return null;
}


/**
 * שער חליפין נוכחי.
 * מנסה את הערך החי מ-GOOGLEFINANCE.
 * אם לא תקין (#N/A) - חוזר לשער גיבוי.
 */
function getCurrentExchangeRate() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_EXCHANGE);
  var data = sheet.getDataRange().getValues();

  // B2 (שורה 2 עמודה B - אינדקס 1,1)
  var liveRate = data[1] ? data[1][1] : null;

  // בדיקה אם הערך תקין
  if (typeof liveRate === 'number' && liveRate > 0 && liveRate < 100) {
    // עדכון הגיבוי
    saveBackupRate(liveRate);
    return liveRate;
  }

  // נופל לגיבוי
  return getBackupRate();
}


/**
 * שמירת שער גיבוי בהגדרות.
 */
function saveBackupRate(rate) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['key']] === 'last_usd_ils_rate') {
      sheet.getRange(i + 1, colMap['value'] + 1).setValue(rate);
      return;
    }
  }
}


/**
 * שער גיבוי אחרון.
 */
function getBackupRate() {
  var settings = getSettings();
  var rate = parseFloat(settings.last_usd_ils_rate || 0);
  if (rate > 0 && rate < 100) {
    return rate;
  }
  return 3.7;  // ברירת מחדל בטוחה
}


/**
 * שליפת כל ההגדרות מהגיליון.
 */
function getSettings() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  var settings = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][colMap['key']];
    var value = data[i][colMap['value']];
    if (key) {
      settings[key] = value;
    }
  }

  // ערכי ברירת מחדל
  settings.profit_multiplier = parseFloat(settings.profit_multiplier || 5);
  settings.min_charge_agorot = parseInt(settings.min_charge_agorot || 1);
  settings.low_balance_threshold_agorot = parseInt(settings.low_balance_threshold_agorot || 1000);
  settings.contact_for_purchase_url = settings.contact_for_purchase_url || 'https://shchiche.com/contact';
  settings.contact_for_purchase_phone = settings.contact_for_purchase_phone || '0527155401';
  settings.contact_for_purchase_message = settings.contact_for_purchase_message || 'פנה אלינו לרכישת נקודות נוספות';

  return settings;
}
