-- Generalized server-authoritative tool quota events.
-- Batch A2 starts with Nikud Merger (1 successful merge per rolling 7 days).
-- Future tools can reuse the same event ledger for success counts / units.

CREATE TABLE IF NOT EXISTS tool_quota_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE(user_id, tool_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_quota_events_lookup
  ON tool_quota_events(user_id, tool_name, event_kind, created_at);

CREATE INDEX IF NOT EXISTS idx_tool_quota_events_idempotency
  ON tool_quota_events(user_id, tool_name, idempotency_key);
