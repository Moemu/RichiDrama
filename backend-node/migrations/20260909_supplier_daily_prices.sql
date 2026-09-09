CREATE TABLE IF NOT EXISTS supplier_cost_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_day TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'processing',
  source_config_id INTEGER,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  fetched_at TEXT,
  request_ids_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL DEFAULT '[]',
  error_summary TEXT
);
