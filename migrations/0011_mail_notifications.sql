-- 2026-10-04: durable mail queue for RavText inquiries.
-- Delivery is relayed through Shchiche's existing WordPress/WP Mail SMTP stack.
-- The relay never receives a reusable secret: it gets a short-lived random token
-- and pulls the exact queued payload back from RavText before sending.

CREATE TABLE IF NOT EXISTS mail_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  user_email TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  relay_token TEXT,
  relay_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_mail_notifications_pending
ON mail_notifications(status, next_attempt_at, id);
