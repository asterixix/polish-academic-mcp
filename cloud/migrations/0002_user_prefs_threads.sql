-- Researcher preferences + ensure chat threads support audit blobs

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  research_context TEXT NOT NULL DEFAULT '',
  response_style TEXT NOT NULL DEFAULT 'detailed',
  memory_notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Extra columns for richer thread metadata (SQLite ignores if already present via IF NOT EXISTS pattern)
-- D1 supports ADD COLUMN; run once.
ALTER TABLE search_threads ADD COLUMN audit_json TEXT;
ALTER TABLE search_threads ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
