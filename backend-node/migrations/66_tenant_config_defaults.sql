-- A project group may bind several configurations for the same service.  The
-- selected default belongs to that group, rather than changing the platform
-- library's global default used by other groups.
ALTER TABLE tenant_ai_config_bindings ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_ai_config_bindings ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

-- Preserve existing behavior: where a legacy global default is bound to a
-- group, adopt it as that group's initial default.  Other groups can then
-- select their own default without affecting this compatibility baseline.
UPDATE tenant_ai_config_bindings
SET is_default = 1
WHERE ai_config_id IN (
  SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND is_default = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_ai_config_one_default_per_service
  ON tenant_ai_config_bindings(tenant_id, service_type)
  WHERE is_active = 1 AND is_default = 1;

CREATE INDEX IF NOT EXISTS idx_tenant_ai_config_resolution
  ON tenant_ai_config_bindings(tenant_id, service_type, is_active, is_default DESC, priority DESC);
