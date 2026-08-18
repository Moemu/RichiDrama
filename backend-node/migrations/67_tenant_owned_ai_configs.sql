-- A provider credential belongs to exactly one project group unless it is a
-- legacy platform configuration.  This prevents a later group edit from
-- silently changing another group's key, model route, or SD2 credentials.
ALTER TABLE ai_service_configs ADD COLUMN owner_tenant_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_ai_service_configs_owner_tenant
  ON ai_service_configs(owner_tenant_id, service_type, deleted_at);
