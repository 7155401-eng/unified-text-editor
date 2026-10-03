-- 2026-10-04: monthly gift minutes expire at the end of their calendar month.
--
-- The worker performs the backward-compatible ALTER TABLE inside
-- worker/minute_access.js (wrapped so it is safe whether the column exists or
-- not). Keep this migration idempotent: it documents the target schema and
-- creates it correctly on a fresh database without failing if runtime already
-- upgraded an existing database.

CREATE TABLE IF NOT EXISTS gift_minute_usage (
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,
  seconds_granted INTEGER NOT NULL DEFAULT 0,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  seconds_expired INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (user_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_gift_minute_usage_user
ON gift_minute_usage(user_id, created_at);
