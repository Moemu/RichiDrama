CREATE TABLE IF NOT EXISTS tool_prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_type TEXT NOT NULL,
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'zh',
  content TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_templates_type ON tool_prompt_templates(tool_type, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS tool_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_type TEXT NOT NULL,
  batch_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  model TEXT,
  language TEXT NOT NULL DEFAULT 'zh',
  status TEXT NOT NULL DEFAULT 'pending',
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT,
  streamed_text TEXT NOT NULL DEFAULT '',
  error_msg TEXT,
  task_id TEXT,
  continuation_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_runs_type ON tool_runs(tool_type, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_tool_runs_batch ON tool_runs(batch_id, deleted_at);

CREATE TABLE IF NOT EXISTS tool_run_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_run_id INTEGER NOT NULL,
  asset_id INTEGER NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  usage TEXT,
  snapshot_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(tool_run_id) REFERENCES tool_runs(id),
  FOREIGN KEY(asset_id) REFERENCES assets(id)
);
CREATE INDEX IF NOT EXISTS idx_tool_run_assets_run ON tool_run_assets(tool_run_id, ordinal);
