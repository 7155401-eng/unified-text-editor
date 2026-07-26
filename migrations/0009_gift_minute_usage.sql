-- 2026-07-26: Track monthly gift-minute usage separately from paid/admin minute balance.
-- Existing gift_claims keeps the "claimed once per month" guard; this table stores usage numbers for admin reporting.
-- claimed_at is kept as a compatibility alias for the worker's usage-order query.

CREATE TABLE IF NOT EXISTS gift_minute_usage (
  user_id INTEGER NOT NULL,
  year_month TEXT NOT NULL,
  seconds_granted INTEGER NOT NULL DEFAULT 0,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  PRIMARY KEY (user_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_gift_minute_usage_user
ON gift_minute_usage(user_id, created_at);

INSERT OR IGNORE INTO gift_minute_usage (user_id, year_month, seconds_granted, seconds_used, created_at, claimed_at)
SELECT user_id, year_month, 1200, 0, claimed_at, claimed_at
FROM gift_claims;
