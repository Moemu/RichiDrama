CREATE TABLE IF NOT EXISTS las_media_jobs (
  id TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL,
  drama_id INTEGER NOT NULL,
  source_asset_id INTEGER NOT NULL,
  output_asset_id INTEGER,
  caption_local_path TEXT,
  idempotency_key TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('translate', 'inpaint')),
  input_json TEXT NOT NULL,
  input_tos_path TEXT,
  provider_task_id TEXT,
  result_json TEXT,
  authorization_id TEXT,
  lease_token TEXT,
  lease_until TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitting', 'processing', 'finalizing', 'completed', 'failed', 'reconciliation')),
  error_msg TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_user_id, idempotency_key),
  FOREIGN KEY(owner_user_id) REFERENCES users(id),
  FOREIGN KEY(drama_id) REFERENCES dramas(id),
  FOREIGN KEY(source_asset_id) REFERENCES assets(id),
  FOREIGN KEY(output_asset_id) REFERENCES assets(id)
);

CREATE INDEX IF NOT EXISTS idx_las_media_jobs_owner_project ON las_media_jobs(owner_user_id, drama_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_las_media_jobs_status ON las_media_jobs(status, updated_at);
