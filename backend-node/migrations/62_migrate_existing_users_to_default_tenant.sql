-- Safe adoption for the existing single-project installation.  This only adds
-- membership/binding metadata: it never changes historical owner_user_id,
-- project rows, task states, balances, or ledger entries.
INSERT OR IGNORE INTO tenants (name, status, created_by, created_at, updated_at)
SELECT '默认项目组', 'active', id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, created_at, updated_at)
SELECT t.id, u.id, CASE WHEN u.role = 'admin' THEN 'tenant_admin' ELSE 'creator' END,
  strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM users u JOIN tenants t ON t.name = '默认项目组';

-- Bind every currently active shared service configuration to the default
-- tenant. Future tenants start empty and must be explicitly configured.
INSERT OR IGNORE INTO tenant_ai_config_bindings (tenant_id, service_type, ai_config_id, is_active, created_at, updated_at)
SELECT t.id, c.service_type, c.id, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_service_configs c JOIN tenants t ON t.name = '默认项目组'
WHERE c.deleted_at IS NULL AND c.is_active = 1;

-- SD2 credentials are a separate binding surface even though they are stored
-- in the same protected AI-config table.
INSERT OR IGNORE INTO tenant_sd2_config_bindings (tenant_id, ai_config_id, is_active, created_at, updated_at)
SELECT t.id, c.id, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM ai_service_configs c JOIN tenants t ON t.name = '默认项目组'
WHERE c.deleted_at IS NULL AND c.is_active = 1
  AND c.service_type IN ('jimeng2_character_auth', 'model_ark_asset');

-- The default group intentionally keeps legacy dynamic global price-book
-- resolution. New groups are explicitly bound by the operations console.

-- Existing administrator records retain access after console access becomes a
-- separate gate. Ordinary creator accounts cannot gain console access merely
-- by being in the default tenant.
UPDATE users SET console_access = 1, account_kind = 'platform_admin'
WHERE role = 'admin' AND (console_access = 0 OR account_kind != 'platform_admin');
