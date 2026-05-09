-- משה 2026-05-10: 3 שינויים:
-- 1. id_number — תעודת זהות נדרשת לתשלום (כמו טלפון). יעד שריג מבקשים את זה,
--    אנחנו שומרים אצלנו ומעבירים ב-UserId.
-- 2. subscription_active — דגל בוליאני: 1 = יחודש אוטומטית, 0 = בוטל ע"י משתמש.
--    plan_renew_at לבדו לא מספיק כי 0 מסמן גם "אין מנוי" וגם "בוטל".
-- 3. cancellation_reason / cancelled_at — תיעוד לפעולת ביטול.
--
-- הרצה: wrangler d1 execute ravtext-subscribers --file=migrations/0006_id_number_and_subscription_status.sql --remote

ALTER TABLE users ADD COLUMN id_number TEXT;
ALTER TABLE users ADD COLUMN subscription_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN cancelled_at INTEGER;
ALTER TABLE users ADD COLUMN cancellation_reason TEXT;

-- טבלה ליומן ניסיונות חיוב חוזר. כל ניסיון נרשם כאן (הצליח/נכשל),
-- כדי לאפשר ניטור מצד מנהל ולהפעיל חסימה אחרי כשלונות עוקבים.
CREATE TABLE IF NOT EXISTS recurring_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  txn_id TEXT,
  error TEXT,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recurring_charges_user ON recurring_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_charges_attempted ON recurring_charges(attempted_at);
