-- Multi-user authentication, ownership and auditable credit billing.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS billing_accounts (
  user_id INTEGER PRIMARY KEY,
  balance_micro INTEGER NOT NULL DEFAULT 0,
  frozen_micro INTEGER NOT NULL DEFAULT 0,
  total_recharged_micro INTEGER NOT NULL DEFAULT 0,
  total_consumed_micro INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_price_books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
  effective_from TEXT,
  effective_to TEXT,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_price_book_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_book_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  model TEXT NOT NULL,
  meter TEXT NOT NULL CHECK(meter IN ('request', 'image', 'second', 'character', 'input_token', 'output_token')),
  unit_price_micro INTEGER NOT NULL DEFAULT 0 CHECK(unit_price_micro >= 0),
  is_free INTEGER NOT NULL DEFAULT 0,
  conditions_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(price_book_id, service_type, model, meter)
);

CREATE TABLE IF NOT EXISTS model_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '*',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, service_type, model)
);

CREATE TABLE IF NOT EXISTS billing_transactions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('recharge', 'adjustment', 'authorization', 'void', 'charge', 'settlement')),
  amount_micro INTEGER NOT NULL,
  balance_after_micro INTEGER NOT NULL,
  frozen_after_micro INTEGER NOT NULL,
  authorization_id TEXT,
  idempotency_key TEXT,
  reference_type TEXT,
  reference_id TEXT,
  reason TEXT,
  snapshot_json TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS billing_usage_logs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  transaction_id TEXT,
  authorization_id TEXT,
  service_type TEXT NOT NULL,
  model TEXT NOT NULL,
  usage_json TEXT NOT NULL,
  charged_micro INTEGER NOT NULL,
  provider_request_id TEXT,
  reference_type TEXT,
  reference_id TEXT,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider_request_id),
  UNIQUE(authorization_id)
);

CREATE TABLE IF NOT EXISTS billing_audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE dramas ADD COLUMN owner_user_id INTEGER;
ALTER TABLE image_generations ADD COLUMN owner_user_id INTEGER;
ALTER TABLE video_generations ADD COLUMN owner_user_id INTEGER;
ALTER TABLE async_tasks ADD COLUMN owner_user_id INTEGER;
ALTER TABLE assets ADD COLUMN owner_user_id INTEGER;
ALTER TABLE image_generations ADD COLUMN billing_authorization_id TEXT;
ALTER TABLE video_generations ADD COLUMN billing_authorization_id TEXT;

CREATE INDEX IF NOT EXISTS idx_dramas_owner ON dramas(owner_user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_image_generations_owner ON image_generations(owner_user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_video_generations_owner ON video_generations(owner_user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_async_tasks_owner ON async_tasks(owner_user_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_user_created ON billing_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_usage_user_created ON billing_usage_logs(user_id, created_at DESC);
