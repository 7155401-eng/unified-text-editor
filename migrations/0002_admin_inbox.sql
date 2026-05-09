-- משה 2026-05-09: תיבת ניהול — דיווחי באגים/עדכונים, פניות יצירת קשר, ולוג שימושים.
-- מורצת ידנית: wrangler d1 execute ravtext-subscribers --file=migrations/0002_admin_inbox.sql

-- לוח דיווחי באגים ועדכונים. גם משתמשים שולחים לכאן (source='user'),
-- וגם מנהל יכול להוסיף רשומות פנימיות (source='admin') לתכנון/מעקב.
-- status הוא ערך חופשי; הצעות מובנות: new/planning/in_dev/done/custom_tag.
CREATE TABLE IF NOT EXISTS bug_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_email TEXT,
  source TEXT NOT NULL DEFAULT 'user',     -- 'user' | 'admin'
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',      -- 'new' | 'planning' | 'in_dev' | 'done' | <custom>
  admin_note TEXT,                         -- הערה פרטית — נראית רק במנהל
  meta TEXT,                               -- JSON: ua, url, screen
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status);
CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports(user_id);

-- פניות "צור קשר" — פתק קצר ממשתמש למנהל.
CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_email TEXT,
  body TEXT NOT NULL,
  read_at INTEGER,                         -- 0/null = לא נקרא; epoch sec = נקרא
  meta TEXT,                               -- JSON
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_read ON contact_messages(read_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_contact_messages_user ON contact_messages(user_id);

-- לוג שימושים — נשלח מהלקוח ב-key actions (login, sample_load, render, export, וכד').
-- detail = JSON קצר עם פרטים נוספים (שם דוגמה, סוג ייצוא וכו').
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_email TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_usage_events_user ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_event ON usage_events(event);
