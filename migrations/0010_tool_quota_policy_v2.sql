-- Server-authoritative tool quota state for desktop→web policy parity.
-- Runtime code also creates these tables defensively with IF NOT EXISTS so a
-- Worker deployment cannot fail closed merely because D1 migration deployment
-- lags behind the code deployment.

CREATE TABLE IF NOT EXISTS tool_quota_state (
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  window_start INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  units INTEGER NOT NULL DEFAULT 0,
  last_activity INTEGER NOT NULL DEFAULT 0,
  last_success INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_tool_quota_state_updated
  ON tool_quota_state(updated_at);

CREATE TABLE IF NOT EXISTS tool_quota_receipts (
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  response_json TEXT,
  PRIMARY KEY (user_id, tool_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_quota_receipts_created
  ON tool_quota_receipts(created_at);
