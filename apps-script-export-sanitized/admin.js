/**
 * admin.gs
 * ========
 * פונקציות לדשבורד ניהול - נקראות מהדף Index.html.
 * כולן בודקות שהמשתמש מורשה.
 */


/**
 * עזר - בדיקת הרשאה.
 */
function _checkAdmin() {
  var email = Session.getActiveUser().getEmail();
  if (ADMIN_EMAILS.indexOf(email) < 0) {
    throw new Error('אין הרשאה');
  }
  return email;
}


// ===== לקוחות =====

function admin_listCustomers() {
  _checkAdmin();
  return getAllCustomers();
}


function admin_addCustomer(name, email, phone) {
  _checkAdmin();
  if (!name) throw new Error('שם נדרש');
  return createCustomer(name, email, phone);
}


function admin_addPoints(customerId, amountShekels, note) {
  _checkAdmin();
  var amountAgorot = Math.round(parseFloat(amountShekels) * 100);
  if (amountAgorot <= 0) throw new Error('סכום לא תקין');
  var ok = addPointsToCustomer(customerId, amountAgorot, note);
  if (!ok) throw new Error('לקוח לא נמצא');
  return {success: true, added_agorot: amountAgorot};
}


function admin_setStatus(customerId, status) {
  _checkAdmin();
  var ok = setCustomerStatus(customerId, status);
  if (!ok) throw new Error('כשל בעדכון סטטוס');
  return {success: true};
}


function admin_regenerateCode(customerId) {
  _checkAdmin();
  var newCode = regenerateAccessCode(customerId);
  if (!newCode) throw new Error('לקוח לא נמצא');
  return {success: true, new_access_code: newCode};
}


// ===== יומן =====

function admin_getCustomerLog(customerId, fromDate, toDate) {
  _checkAdmin();
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_USAGE_LOG);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];

  var fromTs = fromDate ? new Date(fromDate).getTime() : 0;
  var toTs = toDate ? new Date(toDate).getTime() : Date.now() + 86400000;

  var entries = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    headers.forEach(function(h, j) { row[h] = data[i][j]; });

    if (customerId && row.customer_id !== customerId) continue;

    var ts = new Date(row.timestamp).getTime();
    if (ts < fromTs || ts > toTs) continue;

    entries.push(row);
  }
  return entries;
}


// ===== דוחות =====

function admin_getMonthlyReport(year, month) {
  _checkAdmin();

  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_USAGE_LOG);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var colMap = {};
  headers.forEach(function(h, i) { colMap[h] = i; });

  var totalRevenueAgorot = 0;
  var totalCostUsd = 0;
  var callsCount = 0;
  var customerStats = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var ts = new Date(row[colMap['timestamp']]);
    if (ts.getFullYear() !== year || ts.getMonth() !== (month - 1)) continue;
    if (row[colMap['status']] !== 'success') continue;

    var rev = parseInt(row[colMap['cost_agorot_charged']] || 0);
    var cost = parseFloat(row[colMap['cost_usd_actual']] || 0);
    var customerId = row[colMap['customer_id']];

    totalRevenueAgorot += rev;
    totalCostUsd += cost;
    callsCount++;

    if (!customerStats[customerId]) {
      customerStats[customerId] = {customer_id: customerId, calls: 0, revenue_agorot: 0};
    }
    customerStats[customerId].calls++;
    customerStats[customerId].revenue_agorot += rev;
  }

  // 10 הלקוחות הכי פעילים
  var topCustomers = Object.values(customerStats)
    .sort(function(a, b) { return b.calls - a.calls; })
    .slice(0, 10);

  var rate = getCurrentExchangeRate();
  var totalCostShekels = totalCostUsd * rate;
  var totalRevenueShekels = totalRevenueAgorot / 100;
  var profitShekels = totalRevenueShekels - totalCostShekels;

  return {
    year: year,
    month: month,
    calls_count: callsCount,
    total_revenue_shekels: totalRevenueShekels.toFixed(2),
    total_cost_shekels: totalCostShekels.toFixed(2),
    profit_shekels: profitShekels.toFixed(2),
    top_customers: topCustomers,
  };
}


// ===== מפתחות שרת (Script Properties) =====

function admin_getServerKeys() {
  _checkAdmin();
  var props = PropertiesService.getScriptProperties();
  return {
    has_gemini: !!props.getProperty('GEMINI_API_KEY'),
    has_claude: !!props.getProperty('CLAUDE_API_KEY'),
    has_openai: !!props.getProperty('OPENAI_API_KEY'),
  };
}


function admin_setServerKey(provider, apiKey) {
  _checkAdmin();
  var props = PropertiesService.getScriptProperties();
  var keyName = '';
  if (provider === 'gemini') keyName = 'GEMINI_API_KEY';
  else if (provider === 'claude') keyName = 'CLAUDE_API_KEY';
  else if (provider === 'openai') keyName = 'OPENAI_API_KEY';
  else throw new Error('Provider לא תקין');

  props.setProperty(keyName, apiKey);
  return {success: true};
}
