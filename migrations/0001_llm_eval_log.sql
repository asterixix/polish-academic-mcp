-- LLM chat eval ingestion (POST /internal/eval-log)
CREATE TABLE IF NOT EXISTS llm_eval_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  eval_test_case_id TEXT,
  composite_score REAL,
  passed INTEGER NOT NULL DEFAULT 0,
  upstream_model_label TEXT,
  chat_session_id TEXT,
  mcp_client_label TEXT,
  prompt TEXT,
  generated_text TEXT NOT NULL,
  metadata_json TEXT,
  export_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_eval_log_created ON llm_eval_log(created_at);
CREATE INDEX IF NOT EXISTS idx_llm_eval_log_case ON llm_eval_log(eval_test_case_id);
