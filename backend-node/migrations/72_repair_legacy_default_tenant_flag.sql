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
-- is_default 恒为 0:部分唯一索引 (tenant_id,service_type) WHERE is_default=1
-- 禁止同组同类型两条默认,回填行若带默认会撞索引导致启动崩溃,
-- 组内默认仍由既有绑定/用户选择决定。
INSERT OR IGNORE INTO tenant_ai_config_bindings (tenant_id, service_type, ai_config_id, is_active, priority, is_default, created_at, updated_at)
SELECT t.id, c.service_type, c.id, 1, c.priority, 0,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM tenants t
JOIN ai_service_configs c
  ON c.deleted_at IS NULL AND c.is_active = 1 AND COALESCE(c.owner_tenant_id, 0) = 0
WHERE t.status = 'active' AND COALESCE(t.uses_legacy_global_configs, 0) = 1
  AND NOT EXISTS (
    SELECT 1 FROM tenant_ai_config_bindings b
    WHERE b.tenant_id = t.id AND b.ai_config_id = c.id
  );

-- 归一化:createConfig 曾把"全局"写成 owner_tenant_id=0(Number(null)=0
-- 通过了安全整数校验),导致所有 IS NULL 判断匹配不到全局配置。
-- 统一为 NULL 语义,存量 0 一并修正。
UPDATE ai_service_configs SET owner_tenant_id = NULL WHERE COALESCE(owner_tenant_id, 0) = 0;
