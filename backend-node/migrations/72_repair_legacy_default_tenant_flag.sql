-- 修复全新装机(迁移68之后才建库)的场景:ensureDefaultTenant 曾漏设
-- uses_legacy_global_configs,导致默认项目组既无绑定又不借用全局配置,
-- AI 配置列表恒为空、新建配置不可见也不被生成/计费链路选中。
-- 只修复"没有任何绑定"的默认项目组,不影响已有健康绑定或显式隔离的分组。
UPDATE tenants SET uses_legacy_global_configs = 1
WHERE name = '默认项目组'
  AND COALESCE(uses_legacy_global_configs, 0) = 0
  AND id NOT IN (SELECT DISTINCT tenant_id FROM tenant_ai_config_bindings);

-- 回填:legacy 组一旦有绑定就只看绑定表,而 ensureDefaultTenant 只在
-- 领养时同步存量配置。把已有全局配置补绑给所有 legacy 组,消除"添加成功
-- 但列表不显示、生成/计费选不到"的存量隐形配置。
INSERT INTO tenant_ai_config_bindings (tenant_id, service_type, ai_config_id, is_active, priority, is_default, created_at, updated_at)
SELECT t.id, c.service_type, c.id, 1, c.priority, c.is_default,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM tenants t
JOIN ai_service_configs c
  ON c.deleted_at IS NULL AND c.is_active = 1 AND c.owner_tenant_id IS NULL
WHERE t.status = 'active' AND COALESCE(t.uses_legacy_global_configs, 0) = 1
  AND NOT EXISTS (
    SELECT 1 FROM tenant_ai_config_bindings b
    WHERE b.tenant_id = t.id AND b.ai_config_id = c.id
  );
