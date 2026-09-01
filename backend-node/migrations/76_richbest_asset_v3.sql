CREATE TABLE IF NOT EXISTS external_asset_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 0,
  ai_config_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  remote_group_id TEXT NOT NULL,
  name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, ai_config_id, provider)
);

CREATE TABLE IF NOT EXISTS external_asset_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL DEFAULT 0,
  owner_user_id INTEGER,
  local_asset_id INTEGER,
  resource_type TEXT NOT NULL,
  resource_id INTEGER NOT NULL,
  ai_config_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  remote_group_id TEXT,
  remote_asset_id TEXT,
  upload_id TEXT,
  object_key TEXT,
  asset_type TEXT NOT NULL DEFAULT 'Image',
  source_fingerprint TEXT NOT NULL,
  source_image_url TEXT,
  source_local_path TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  source_name TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  stage TEXT NOT NULL DEFAULT 'queued',
  error_code TEXT,
  error_message TEXT,
  provider_request_id TEXT,
  upload_duration_ms INTEGER,
  create_duration_ms INTEGER,
  settlement_duration_ms INTEGER,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active_at TEXT,
  stale_at TEXT,
  UNIQUE(ai_config_id, resource_type, resource_id, source_fingerprint, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_external_asset_bindings_pending
  ON external_asset_bindings(provider, status, stage, updated_at);

CREATE INDEX IF NOT EXISTS idx_external_asset_bindings_resource
  ON external_asset_bindings(resource_type, resource_id, updated_at DESC);
