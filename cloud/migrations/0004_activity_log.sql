-- GDPR-aware activity log for AI Search + MCP (ops / debugging).
-- Anonymous subjects are stored as a one-way hash only (no email, no raw IP).
-- Retention is enforced in application code (purgeExpiredActivityLogs).

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,
  -- 'user' | 'anon'
  subject_kind TEXT NOT NULL,
  -- users.id when logged in; NULL for anonymous
  user_id TEXT,
  -- sha256 hex (truncated) of anon cookie / session key — never reversible to PII alone
  subject_hash TEXT,
  -- opaque request correlation (AI trace_id or MCP session)
  trace_id TEXT,
  path TEXT,
  -- short, redacted query / tool name summary (max ~500 chars in app)
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER,
  -- JSON: tools, groups, error class, response_chars, model — no full transcripts for anon
  meta_json TEXT,
  -- ISO date when this row should be deleted (computed at insert)
  retain_until TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_trace ON activity_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_retain ON activity_logs(retain_until);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_id);
