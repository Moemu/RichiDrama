CREATE TABLE IF NOT EXISTS ai_provider_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  owner_tenant_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE ai_service_configs ADD COLUMN provider_connection_id INTEGER;

ALTER TABLE ai_model_map ADD COLUMN routing_version TEXT;
