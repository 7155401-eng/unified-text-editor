-- 2026-10-04: monthly gift minutes expire at the end of their calendar month.
-- Historical rows are made distinguishable from genuinely consumed gift time.
-- Runtime cleanup in worker/minute_access.js subtracts each still-unused
-- previous-month gift from users.balance_seconds and records it as expired.

ALTER TABLE gift_minute_usage ADD COLUMN seconds_expired INTEGER NOT NULL DEFAULT 0;

UPDATE gift_minute_usage
SET seconds_expired = COALESCE(seconds_expired, 0);
