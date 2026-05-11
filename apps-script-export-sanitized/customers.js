/**
 * customers.gs
 * ============
 * ניהול לקוחות, יתרות, חיובים, ויומן שימוש.
 */


/**
 * חיפוש לקוח לפי קוד אישי.
 * מחזיר אובייקט לקוח או null.
 */
function getCustomerByCode(accessCode) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  // איתור עמודות לפי שם
  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['access_code']] === accessCode) {
      return {
        row_index: i + 1,
        customer_id: data[i][colMap['customer_id']],
        name: data[i][colMap['name']],
        email: data[i][colMap['email']],
        phone: data[i][colMap['phone']],
        access_code: data[i][colMap['access_code']],
        balance_agorot: parseInt(data[i][colMap['balance_agorot']] || 0),
        total_purchased_agorot: parseInt(data[i][colMap['total_purchased_agorot']] || 0),
        total_used_agorot: parseInt(data[i][colMap['total_used_agorot']] || 0),
        status: data[i][colMap['status']] || 'active',
        created_at: data[i][colMap['created_at']],
        notes: data[i][colMap['notes']],
      };
    }
  }
  return null;
}


/**
 * חיוב לקוח באגורות.
 * מחזיר את היתרה החדשה.
 */
function chargeCustomer(customerId, amountAgorot) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['customer_id']] === customerId) {
      rowIdx = i;
      break;
    }
  }
  if (rowIdx < 0) {
    throw new Error('לקוח לא נמצא: ' + customerId);
  }

  var balance = parseInt(data[rowIdx][colMap['balance_agorot']] || 0);
  var totalUsed = parseInt(data[rowIdx][colMap['total_used_agorot']] || 0);

  var newBalance = balance - amountAgorot;
  var newTotalUsed = totalUsed + amountAgorot;

  sheet.getRange(rowIdx + 1, colMap['balance_agorot'] + 1).setValue(newBalance);
  sheet.getRange(rowIdx + 1, colMap['total_used_agorot'] + 1).setValue(newTotalUsed);

  return newBalance;
}


/**
 * החזר לקוח (rollback) - מחזיר אגורות אחרי כשל.
 */
function refundCustomer(customerId, amountAgorot) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['customer_id']] === customerId) {
      var balance = parseInt(data[i][colMap['balance_agorot']] || 0);
      var totalUsed = parseInt(data[i][colMap['total_used_agorot']] || 0);
      sheet.getRange(i + 1, colMap['balance_agorot'] + 1).setValue(balance + amountAgorot);
      sheet.getRange(i + 1, colMap['total_used_agorot'] + 1).setValue(totalUsed - amountAgorot);
      return;
    }
  }
}


/**
 * הוספת רשומה ליומן השימוש.
 */
function logUsage(entry) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_USAGE_LOG);
  var MAX_CELL = 49000;  // Google Sheets cell limit ~50000 chars
  function _trim(s) {
    if (s == null) return '';
    s = String(s);
    if (s.length > MAX_CELL) return s.substring(0, MAX_CELL) + '...[TRUNCATED]';
    return s;
  }
  // ודא שהעמודות החדשות (תוכן מלא) קיימות בכותרת
  try {
    var lastCol = sheet.getLastColumn();
    if (lastCol > 0) {
      var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var newCols = [
        'use_premium', 'access_code_provided',
        'prompt_full', 'text_payload_full', 'custom_prompt_full',
        'files_summary', 'response_full',
      ];
      var toAdd = newCols.filter(function(c) { return headers.indexOf(c) < 0; });
      if (toAdd.length > 0) {
        sheet.getRange(1, lastCol + 1, 1, toAdd.length).setValues([toAdd]);
        sheet.getRange(1, lastCol + 1, 1, toAdd.length).setFontWeight('bold');
      }
    }
  } catch (hdrErr) {}
  var row = [
    new Date(),  // timestamp
    entry.customer_id,
    entry.model,
    entry.prompt_type,
    entry.files_count != null ? entry.files_count : 0,
    entry.examples_count != null ? entry.examples_count : 0,
    !!entry.has_examples,
    entry.prompt_length_chars != null ? entry.prompt_length_chars : 0,
    entry.text_payload_length_chars != null ? entry.text_payload_length_chars : 0,
    entry.custom_prompt_length_chars != null ? entry.custom_prompt_length_chars : 0,
    !!entry.has_custom_prompt,
    entry.input_tokens,
    entry.output_tokens,
    entry.cost_usd_actual,
    entry.cost_agorot_charged,
    entry.balance_after_agorot,
    entry.status,
    entry.error_message || '',
    entry.request_ip || '',
    entry.duration_ms != null ? entry.duration_ms : 0,
    !!entry.use_premium,
    !!entry.access_code_provided,
    _trim(entry.prompt_full),
    _trim(entry.text_payload_full),
    _trim(entry.custom_prompt_full),
    _trim(entry.files_summary),
    _trim(entry.response_full),
  ];
  sheet.appendRow(row);
}


/**
 * סך השימוש של לקוח היום (באגורות).
 */
function getTodayUsageForCustomer(customerId) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_USAGE_LOG);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  var today = new Date();
  today.setHours(0, 0, 0, 0);

  var total = 0;
  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['customer_id']] === customerId) {
      var ts = new Date(data[i][colMap['timestamp']]);
      if (ts >= today && data[i][colMap['status']] === 'success') {
        total += parseInt(data[i][colMap['cost_agorot_charged']] || 0);
      }
    }
  }
  return total;
}


/**
 * הוספת לקוח חדש.
 * מחזיר את הקוד האישי שנוצר.
 */
function createCustomer(name, email, phone) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);

  // מספר רץ
  var data = sheet.getDataRange().getValues();
  var newId = 'CUS_' + (data.length).toString().padStart(5, '0');

  // קוד אישי אקראי 16 תווים
  var accessCode = generateRandomCode(16);

  var row = [
    newId,
    name || '',
    email || '',
    phone || '',
    accessCode,
    0,  // balance_agorot
    0,  // total_purchased_agorot
    0,  // total_used_agorot
    'active',
    new Date(),
    '',  // notes
  ];
  sheet.appendRow(row);

  return {
    customer_id: newId,
    access_code: accessCode,
  };
}


/**
 * הוספת נקודות ללקוח.
 */
function addPointsToCustomer(customerId, amountAgorot, note) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['customer_id']] === customerId) {
      var balance = parseInt(data[i][colMap['balance_agorot']] || 0);
      var totalPurchased = parseInt(data[i][colMap['total_purchased_agorot']] || 0);
      sheet.getRange(i + 1, colMap['balance_agorot'] + 1).setValue(balance + amountAgorot);
      sheet.getRange(i + 1, colMap['total_purchased_agorot'] + 1).setValue(totalPurchased + amountAgorot);

      // עדכון הערות אם סופקו
      if (note) {
        var existingNotes = data[i][colMap['notes']] || '';
        var newNote = (existingNotes ? existingNotes + '\n' : '') +
                      new Date().toISOString().split('T')[0] + ': +' +
                      (amountAgorot / 100).toFixed(2) + ' ש"ח - ' + note;
        sheet.getRange(i + 1, colMap['notes'] + 1).setValue(newNote);
      }
      return true;
    }
  }
  return false;
}


/**
 * חסימה / שחרור לקוח.
 */
function setCustomerStatus(customerId, status) {
  if (['active', 'blocked', 'expired'].indexOf(status) < 0) {
    return false;
  }
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['customer_id']] === customerId) {
      sheet.getRange(i + 1, colMap['status'] + 1).setValue(status);
      return true;
    }
  }
  return false;
}


/**
 * החלפת קוד אישי (אם הקוד הקיים נחשף).
 */
function regenerateAccessCode(customerId) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  for (var i = 1; i < data.length; i++) {
    if (data[i][colMap['customer_id']] === customerId) {
      var newCode = generateRandomCode(16);
      sheet.getRange(i + 1, colMap['access_code'] + 1).setValue(newCode);
      return newCode;
    }
  }
  return null;
}


/**
 * רשימת כל הלקוחות (לאדמין dashboard).
 */
function getAllCustomers() {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CUSTOMERS);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var customers = [];
  for (var i = 1; i < data.length; i++) {
    var c = {};
    headers.forEach(function(h, j) {
      c[h] = data[i][j];
    });
    customers.push(c);
  }
  return customers;
}


/**
 * יצירת קוד אישי אקראי.
 */
function generateRandomCode(length) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var result = '';
  for (var i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
