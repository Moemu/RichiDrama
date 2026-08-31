ALTER TABLE billing_price_books ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE billing_price_books ADD COLUMN parent_price_book_id INTEGER;
ALTER TABLE billing_price_books ADD COLUMN source_sync_id TEXT;
ALTER TABLE billing_price_books ADD COLUMN system_managed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_price_books ADD COLUMN reviewed_by INTEGER;
ALTER TABLE billing_price_books ADD COLUMN reviewed_at TEXT;
ALTER TABLE billing_price_books ADD COLUMN published_by INTEGER;
ALTER TABLE billing_price_books ADD COLUMN published_at TEXT;
ALTER TABLE billing_price_books ADD COLUMN publish_reason TEXT;
ALTER TABLE billing_price_books ADD COLUMN publish_idempotency_key TEXT;

UPDATE billing_price_books
SET system_managed = 1
WHERE owner_user_id IS NULL
  AND (name LIKE '火山引擎官方公开价目%' OR name LIKE '火山引擎同步价目%');

CREATE TABLE IF NOT EXISTS provider_price_source_checks (
  provider TEXT PRIMARY KEY,
  ark_status TEXT NOT NULL DEFAULT 'unknown',
  billing_status TEXT NOT NULL DEFAULT 'unknown',
  ark_request_id TEXT,
  billing_request_id TEXT,
  checked_at TEXT,
  error_summary TEXT,
  detail_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_price_sync_locks (
  provider TEXT PRIMARY KEY,
  lock_token TEXT NOT NULL,
  locked_until TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_price_syncs (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  source_config_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('processing','completed','failed','unchanged')),
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','scheduled')),
  response_hash TEXT,
  provider_request_ids_json TEXT,
  raw_response_json TEXT,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  mapped_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  error_summary TEXT,
  fetched_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_price_sync_hash
  ON provider_price_syncs(provider, response_hash)
  WHERE response_hash IS NOT NULL AND status = 'completed';

CREATE TABLE IF NOT EXISTS provider_price_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  display_name TEXT,
  charge_type TEXT NOT NULL,
  unit_code TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  provider_unit_price TEXT,
  service_type TEXT,
  billing_key TEXT,
  meter TEXT,
  unit_size INTEGER,
  new_unit_price_micro INTEGER,
  current_unit_price_micro INTEGER,
  current_price_book_item_id INTEGER,
  change_ratio REAL,
  mapping_status TEXT NOT NULL CHECK(mapping_status IN ('mapped','unmapped','ambiguous')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','accepted','rejected')),
  error_summary TEXT,
  raw_item_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(sync_id, provider_model, charge_type, unit_code, service_type, billing_key)
);

CREATE INDEX IF NOT EXISTS idx_provider_price_candidates_sync
  ON provider_price_candidates(sync_id, mapping_status, review_status);

CREATE TABLE IF NOT EXISTS system_notices (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'pricing',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  price_book_id INTEGER,
  effective_at TEXT NOT NULL,
  published_by INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  archived_by INTEGER,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_notices_active
  ON system_notices(status, effective_at DESC);

CREATE TABLE IF NOT EXISTS system_notice_acknowledgements (
  notice_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY(notice_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_price_book_publish_idempotency
  ON billing_price_books(publish_idempotency_key)
  WHERE publish_idempotency_key IS NOT NULL;
