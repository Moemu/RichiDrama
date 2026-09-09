CREATE TABLE IF NOT EXISTS cost_reprice_batches (
 id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by INTEGER NOT NULL,
 filters_json TEXT NOT NULL, preview_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'preview', executed_at TEXT, result_json TEXT
);
