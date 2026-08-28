-- Customer organizations are explicit billing owners. Existing users keep
-- their personal billing accounts until an administrator adds them here.
CREATE TABLE IF NOT EXISTS customer_organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  config_tenant_id INTEGER NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_organization_memberships (
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'organization_admin')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS organization_billing_accounts (
  organization_id INTEGER PRIMARY KEY,
  balance_micro INTEGER NOT NULL DEFAULT 0,
  frozen_micro INTEGER NOT NULL DEFAULT 0,
  total_recharged_micro INTEGER NOT NULL DEFAULT 0,
  total_consumed_micro INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

ALTER TABLE billing_transactions ADD COLUMN organization_id INTEGER;
ALTER TABLE billing_usage_logs ADD COLUMN organization_id INTEGER;
ALTER TABLE billing_reconciliation_cases ADD COLUMN organization_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_customer_org_members_org ON customer_organization_memberships(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_billing_transactions_org_created ON billing_transactions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_usage_org_created ON billing_usage_logs(organization_id, created_at DESC);
