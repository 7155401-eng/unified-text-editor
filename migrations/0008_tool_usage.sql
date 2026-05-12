-- Server-side daily quota for new tools.
-- Free logged-in users get one use per tool per day; paid users are unlimited.

CREATE TABLE IF NOT EXISTS tool_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, tool_name, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_tool_usage_user_date
  ON tool_usage(user_id, usage_date);
