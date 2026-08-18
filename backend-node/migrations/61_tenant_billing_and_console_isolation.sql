-- Forward-compatible tenancy foundation. Existing users and records remain
-- unassigned (tenant_id NULL) and keep the pre-tenancy global behavior.
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'creator' CHECK(role IN ('creator', 'tenant_admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS tenant_ai_config_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  service_type TEXT NOT NULL,
  ai_config_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, service_type, ai_config_id)
);

CREATE TABLE IF NOT EXISTS tenant_sd2_config_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  ai_config_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(tenant_id, ai_config_id)
);

CREATE TABLE IF NOT EXISTS tenant_price_book_bindings (
  tenant_id INTEGER PRIMARY KEY,
  price_book_id INTEGER NOT NULL,
  active_at TEXT NOT NULL,
  created_by INTEGER,
  updated_at TEXT NOT NULL
);

ALTER TABLE users ADD COLUMN console_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'creator';
ALTER TABLE billing_transactions ADD COLUMN tenant_id INTEGER;
ALTER TABLE billing_usage_logs ADD COLUMN tenant_id INTEGER;
ALTER TABLE image_generations ADD COLUMN tenant_id INTEGER;
ALTER TABLE video_generations ADD COLUMN tenant_id INTEGER;
ALTER TABLE async_tasks ADD COLUMN tenant_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant ON tenant_memberships(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_ai_configs_lookup ON tenant_ai_config_bindings(tenant_id, service_type, is_active);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_tenant_created ON billing_transactions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_usage_tenant_created ON billing_usage_logs(tenant_id, created_at DESC);
