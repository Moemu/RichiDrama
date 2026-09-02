CREATE TABLE IF NOT EXISTS richbest_asset_rebind_runs (
  id TEXT PRIMARY KEY,
  actor_user_id INTEGER NOT NULL,
  cutoff_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  total INTEGER NOT NULL DEFAULT 0,
  succeeded INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS richbest_asset_rebind_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  binding_id INTEGER NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  old_remote_asset_id TEXT,
  new_binding_id INTEGER,
  new_remote_asset_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(run_id, binding_id)
);

CREATE INDEX IF NOT EXISTS idx_richbest_rebind_runs_status
  ON richbest_asset_rebind_runs(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_richbest_rebind_items_run
  ON richbest_asset_rebind_items(run_id, status, id);
