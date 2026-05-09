-- משה 2026-05-10: שתי טבלאות חדשות:
--   1) app_settings — key/value לשמירת סודות תשלום מהדף הניהולי (PayPal, Yaad).
--      היא מאפשרת לעדכן ערכים חיים בלי לפרוס מחדש את ה-Worker. הקוד מעדיף
--      קודם את ה-DB ואחר כך נופל ל-env.* לתאימות אחורה.
--   2) custom_packages — חבילות בדיקה ייעודיות. כל חבילה מקבלת token מקרי
--      וזמינה רק דרך ?pkg=<token>. אינה נראית למשתמשים רגילים.
--
-- הרצה: wrangler d1 execute ravtext-subscribers --file=migrations/0005_payment_config_and_packages.sql --remote

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_user_id INTEGER
);

CREATE TABLE IF NOT EXISTS custom_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  hours REAL,
  days INTEGER,
  created_by_user_id INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_custom_packages_token ON custom_packages(token);
