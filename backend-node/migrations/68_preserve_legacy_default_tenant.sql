-- The original shared group may be renamed without losing its established
-- provider configuration library.
ALTER TABLE tenants ADD COLUMN uses_legacy_global_configs INTEGER NOT NULL DEFAULT 0;
UPDATE tenants SET uses_legacy_global_configs = 1 WHERE name = '默认项目组';
