-- משה 2026-05-09: סכמת תשלומים פרמיום.
-- מורצת ידנית: wrangler d1 execute ravtext-subscribers --file=migrations/0001_premium_payments.sql
--
-- הנחה: טבלת users כבר קיימת עם שדות (id, email, status, expires_at, is_admin, last_login_at).
-- מוסיפים שדות לתשלום: balance_seconds (יתרת שעות בשניות), plan_type, plan_renew_at.

ALTER TABLE users ADD COLUMN balance_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN plan_type TEXT;          -- 'subscription' | 'hours' | NULL
ALTER TABLE users ADD COLUMN plan_renew_at INTEGER;   -- 0 = cancelled, >0 = next renewal epoch sec

-- כוונות תשלום (יוצרים בלחיצה על "שלם", סוגרים ב-callback).
CREATE TABLE IF NOT EXISTS payment_intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,                  -- 'yaad' | 'paypal'
  token TEXT NOT NULL UNIQUE,              -- ה-token הפנימי שאנחנו שולחים לספק
  txn_id TEXT,                             -- מזהה עסקה אצל הספק (paypal order id, yaad txn id)
  amount INTEGER NOT NULL,                 -- בש"ח
  plan_code TEXT,                          -- 'monthly' | 'yearly' | NULL
  pack_code TEXT,                          -- 'h1' | 'h5' | 'h10' | 'h20' | NULL
  status TEXT NOT NULL,                    -- 'pending' | 'awaiting_paypal' | 'completed' | 'failed'
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status ON payment_intents(status);

-- היסטוריית תשלומים שאושרו.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  amount INTEGER NOT NULL,
  plan_code TEXT,
  pack_code TEXT,
  txn_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

-- מימושי מתנה חודשית (משתמש אחד לחודש = רשומה אחת).
CREATE TABLE IF NOT EXISTS gift_claims (
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,                -- 'YYYY-MM'
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, year_month),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
