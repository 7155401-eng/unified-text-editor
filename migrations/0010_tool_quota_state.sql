-- Generalized server-authoritative Free/Premium tool quota state.
-- Supersedes tool_usage incrementally; tools move here only when their
-- success/action endpoint is migrated in the same release.

CREATE TABLE IF NOT EXISTS tool_quota_state (
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  window_started_at INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  units_used INTEGER NOT NULL DEFAULT 0,
  session_started_at INTEGER NOT NULL DEFAULT 0,
  session_last_at INTEGER NOT NULL DEFAULT 0,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tool_name)
);

CREATE TABLE IF NOT EXISTS tool_quota_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  event_key TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, tool_name, event_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_quota_events_user_tool
  ON tool_quota_events(user_id, tool_name, created_at);
