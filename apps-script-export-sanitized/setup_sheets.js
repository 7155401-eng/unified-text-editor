/**
 * setup_sheets.gs
 * ===============
 * קובץ עזר חד-פעמי - יוצר את מבנה 5 הגיליונות.
 * 
 * שימוש:
 *  1. הרץ את initSpreadsheet() פעם אחת.
 *  2. כל 5 הגיליונות ייווצרו עם הכותרות הנכונות.
 *  3. ערכי ברירת מחדל יוטמעו.
 *  4. ה-SPREADSHEET_ID יוחזר ללוג - העתק אותו ל-Code.gs.
 */


/**
 * יצירת כל הגיליונות.
 * הרץ פעם אחת בלבד.
 */
function initSpreadsheet() {
  var ss = null;
  // אם SPREADSHEET_ID מוגדר (לא placeholder) — השתמש בקיים
  try {
    if (typeof SPREADSHEET_ID !== 'undefined' &&
        SPREADSHEET_ID && SPREADSHEET_ID !== 'PLACEHOLDER_SPREADSHEET_ID') {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    }
  } catch (e) {
    ss = null;
  }
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Torah Transcription - Server Data');
  }

  Logger.log('Spreadsheet ID: ' + ss.getId());
  Logger.log('Spreadsheet URL: ' + ss.getUrl());

  // יצירת 5 הגיליונות
  _createCustomersSheet(ss);
  _createUsageLogSheet(ss);
  _createExchangeSheet(ss);
  _createPricingSheet(ss);
  _createSettingsSheet(ss);

  // מחיקת גיליון "Sheet1" אם קיים
  try {
    var defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet) ss.deleteSheet(defaultSheet);
  } catch (e) {}

  Logger.log('=== Setup complete ===');
  Logger.log('Update SPREADSHEET_ID in Code.gs to: ' + ss.getId());

  return ss.getId();
}


function _createCustomersSheet(ss) {
  var name = 'לקוחות';
  var sheet = ss.getSheetByName(name);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(name);

  var headers = [
    'customer_id', 'name', 'email', 'phone', 'access_code',
    'balance_agorot', 'total_purchased_agorot', 'total_used_agorot',
    'status', 'created_at', 'notes',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}


/**
 * הוספת העמודות החדשות ליומן בלי למחוק את הנתונים הקיימים.
 */
function addUsageLogContentColumns() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('יומן_שימוש');
  if (!sheet) {
    _createUsageLogSheet(ss);
    return 'יצרתי גיליון חדש';
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) {
    _createUsageLogSheet(ss);
    return 'יצרתי גיליון חדש';
  }
  var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var newCols = [
    'use_premium', 'access_code_provided',
    'prompt_full', 'text_payload_full', 'custom_prompt_full',
    'files_summary', 'response_full',
  ];
  var toAdd = newCols.filter(function(c) { return currentHeaders.indexOf(c) < 0; });
  if (toAdd.length === 0) return 'כל העמודות כבר קיימות';
  var startCol = lastCol + 1;
  sheet.getRange(1, startCol, 1, toAdd.length).setValues([toAdd]);
  sheet.getRange(1, startCol, 1, toAdd.length).setFontWeight('bold');
  return 'הוספתי ' + toAdd.length + ' עמודות: ' + toAdd.join(', ');
}


function _createUsageLogSheet(ss) {
  var name = 'יומן_שימוש';
  var sheet = ss.getSheetByName(name);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(name);

  var headers = [
    'timestamp', 'customer_id', 'model', 'prompt_type',
    'files_count', 'examples_count', 'has_examples',
    'prompt_length_chars', 'text_payload_length_chars',
    'custom_prompt_length_chars', 'has_custom_prompt',
    'input_tokens', 'output_tokens', 'cost_usd_actual',
    'cost_agorot_charged', 'balance_after_agorot',
    'status', 'error_message',
    'request_ip', 'duration_ms',
    'use_premium', 'access_code_provided',
    'prompt_full', 'text_payload_full', 'custom_prompt_full',
    'files_summary', 'response_full',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}


function _createExchangeSheet(ss) {
  var name = 'שערי_מטבע';
  var sheet = ss.getSheetByName(name);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(name);

  // כותרות
  sheet.getRange('A1:B1').setValues([['מטבע', 'שער']]).setFontWeight('bold');

  // נוסחאות חיות
  sheet.getRange('A2').setValue('USD/ILS');
  sheet.getRange('B2').setFormula('=GOOGLEFINANCE("CURRENCY:USDILS")');

  sheet.getRange('A3').setValue('EUR/ILS');
  sheet.getRange('B3').setFormula('=GOOGLEFINANCE("CURRENCY:EURILS")');

  sheet.getRange('A4').setValue('GBP/ILS');
  sheet.getRange('B4').setFormula('=GOOGLEFINANCE("CURRENCY:GBPILS")');

  sheet.getRange('A10').setValue('עדכון אחרון');
  sheet.getRange('B10').setFormula('=NOW()');
}


function _createPricingSheet(ss) {
  var name = 'מחירוני_מודלים';
  var sheet = ss.getSheetByName(name);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(name);

  var headers = [
    'model_name', 'provider',
    'input_price_per_1m_usd', 'output_price_per_1m_usd',
    'enabled', 'notes',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  // ערכי ברירת מחדל - מחירים מעודכנים נכון לאפריל 2026
  // (יש לעדכן ידנית כשהמחירים משתנים)
  var rows = [
    ['gemini-2.0-flash', 'gemini', 0.10, 0.40, true, 'זול ומהיר'],
    ['gemini-1.5-pro', 'gemini', 1.25, 5.00, true, 'איכותי יותר'],
    ['gemini-3.1-pro', 'gemini', 1.25, 5.00, true, 'הכי טוב'],
    ['claude-opus-4-7', 'claude', 15.00, 75.00, true, 'הטוב ביותר להכרעת נוסח'],
    ['claude-sonnet-4-6', 'claude', 3.00, 15.00, true, 'איזון איכות/מחיר'],
    ['claude-haiku-4-5', 'claude', 0.80, 4.00, true, 'מהיר וזול'],
  ];
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}


function _createSettingsSheet(ss) {
  var name = 'הגדרות';
  var sheet = ss.getSheetByName(name);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(name);

  var headers = ['key', 'value', 'description'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);

  var rows = [
    ['profit_multiplier', 5, 'המכפיל מעלות אמיתית של הבינה'],
    ['min_charge_agorot', 1, 'חיוב מינימום לקריאה (אגורות)'],
    ['low_balance_threshold_agorot', 1000, 'סף אזהרת יתרה נמוכה (10 ש"ח)'],
    ['contact_for_purchase_url', 'https://shchiche.com/contact', 'לינק לרכישת נקודות'],
    ['contact_for_purchase_phone', '0527155401', 'טלפון לרכישה'],
    ['contact_for_purchase_message', 'פנה אלינו לרכישת נקודות נוספות', 'טקסט הודעה'],
    ['last_usd_ils_rate', 3.7, 'שער גיבוי אחרון תקין (מתעדכן אוטומטית)'],
    ['daily_alert_threshold_agorot', 5000, 'התראת אדמין מעל 50 ש"ח ביום'],
    ['max_call_cost_agorot', 500, 'מקסימום עלות לקריאה אחת (5 ש"ח)'],
  ];
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

  // עיצוב: רוחב עמודות נוח
  sheet.setColumnWidth(1, 280);
  sheet.setColumnWidth(2, 280);
  sheet.setColumnWidth(3, 420);
}


/**
 * הגדרת מפתחות ה-API של השרת ב-Script Properties.
 * החלף את הערכים בפועל ואז הרץ פעם אחת.
 */
function setServerApiKeys() {
  // ============= מלא את שני הערכים הללו =============
  var GEMINI_KEY = 'PUT_YOUR_GEMINI_KEY_HERE';
  var CLAUDE_KEY = 'PUT_YOUR_CLAUDE_KEY_HERE';
  var OPENAI_KEY = '';  // אופציונלי
  // ====================================================

  var props = PropertiesService.getScriptProperties();
  if (GEMINI_KEY && GEMINI_KEY !== 'PUT_YOUR_GEMINI_KEY_HERE') {
    props.setProperty('GEMINI_API_KEY', GEMINI_KEY);
    Logger.log('GEMINI_API_KEY set.');
  } else {
    Logger.log('GEMINI_API_KEY skipped — fill in the constant first.');
  }
  if (CLAUDE_KEY && CLAUDE_KEY !== 'PUT_YOUR_CLAUDE_KEY_HERE') {
    props.setProperty('CLAUDE_API_KEY', CLAUDE_KEY);
    Logger.log('CLAUDE_API_KEY set.');
  } else {
    Logger.log('CLAUDE_API_KEY skipped — fill in the constant first.');
  }
  if (OPENAI_KEY) {
    props.setProperty('OPENAI_API_KEY', OPENAI_KEY);
    Logger.log('OPENAI_API_KEY set.');
  }
  Logger.log('Done. Current script properties: ' +
             JSON.stringify(props.getProperties()).replace(/[A-Za-z0-9_-]{20,}/g, '<HIDDEN>'));
}


/**
 * יצירת לקוח דוגמה (אתה / מבחן).
 * הרץ פעם אחת לאחר initSpreadsheet כדי שיהיה לך קוד גישה לבדיקות.
 */
function addSelfAsCustomer() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('לקוחות');
  if (!sheet) {
    Logger.log('Sheet "לקוחות" not found — run initSpreadsheet first.');
    return;
  }

  var customerId = 'CUST_' + Utilities.formatDate(new Date(), 'GMT', 'yyyyMMddHHmmss');
  var accessCode = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  var row = [
    customerId,
    'משה (אדמין)',
    'yiddishebilder@gmail.com',
    '0527155401',
    accessCode,
    100000,        // יתרה התחלתית: 1000 ש"ח לבדיקות
    100000,        // total_purchased
    0,             // total_used
    'active',
    new Date(),
    'חשבון מבחן/אדמין',
  ];
  sheet.appendRow(row);
  Logger.log('=== Customer added ===');
  Logger.log('customer_id: ' + customerId);
  Logger.log('access_code: ' + accessCode);
  Logger.log('balance: 100,000 אגורות (1000 ש"ח)');
  Logger.log('---');
  Logger.log('השתמש בקוד הגישה הזה בתוכנת התמלול במצב פרמיום.');
}
