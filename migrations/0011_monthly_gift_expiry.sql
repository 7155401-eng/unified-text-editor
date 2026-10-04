-- Monthly gift minutes expire when a new Israel-calendar month starts.
-- Migration 0009 already created gift_minute_usage; this migration must ALTER
-- the existing production table rather than relying on CREATE TABLE IF NOT EXISTS.

ALTER TABLE gift_minute_usage
ADD COLUMN seconds_expired INTEGER NOT NULL DEFAULT 0;
