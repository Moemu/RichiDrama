function hasTable(db, table) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
}

function tenantForUser(db, userId) {
  if (!userId || !hasTable(db, 'tenant_memberships')) return null;
  return db.prepare(`SELECT t.id, t.name, t.status, tm.role AS membership_role
    FROM tenant_memberships tm JOIN tenants t ON t.id = tm.tenant_id
    WHERE tm.user_id = ? AND t.status = 'active'`).get(userId) || null;
}

function configIdsForService(db, tenantId, serviceType) {
  if (!tenantId || !hasTable(db, 'tenant_ai_config_bindings')) return [];
  return db.prepare(`SELECT ai_config_id FROM tenant_ai_config_bindings
    WHERE tenant_id = ? AND service_type = ? AND is_active = 1
    ORDER BY is_default DESC, priority DESC, id DESC`).all(tenantId, serviceType)
    .map((row) => Number(row.ai_config_id)).filter(Number.isSafeInteger);
}

function configIdsForTenant(db, tenantId) {
  if (!tenantId || !hasTable(db, 'tenant_ai_config_bindings')) return [];
  return db.prepare('SELECT ai_config_id FROM tenant_ai_config_bindings WHERE tenant_id=? AND is_active=1 ORDER BY service_type, is_default DESC, priority DESC, id DESC').all(tenantId)
    .map((row) => Number(row.ai_config_id)).filter(Number.isSafeInteger);
}

function usesLegacyGlobalConfigs(db, tenantId) {
  if (!tenantId || !hasTable(db, 'tenants')) return true;
  return Number(db.prepare('SELECT uses_legacy_global_configs FROM tenants WHERE id=?').get(tenantId)?.uses_legacy_global_configs) === 1;
}

function priceBookForUser(db, userId) {
  const tenant = tenantForUser(db, userId);
  if (!tenant || !hasTable(db, 'tenant_price_book_bindings')) return null;
  return db.prepare(`SELECT pb.id, pb.name, pb.status FROM tenant_price_book_bindings binding
    JOIN billing_price_books pb ON pb.id = binding.price_book_id
    WHERE binding.tenant_id = ? AND pb.status = 'published'`).get(tenant.id) || null;
}

function ensureDefaultTenant(db, actorId) {
  if (!hasTable(db, 'tenants')) return null;
  const at = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO tenants (name,status,created_by,created_at,updated_at) VALUES ('默认项目组','active',?,?,?)`)
      .run(actorId || null, at, at);
    const tenant = db.prepare("SELECT id FROM tenants WHERE name='默认项目组'").get();
    if (!tenant) return;
    db.prepare(`INSERT OR IGNORE INTO tenant_memberships (tenant_id,user_id,role,created_at,updated_at)
      SELECT ?,id,CASE WHEN role='admin' THEN 'tenant_admin' ELSE 'creator' END,?,? FROM users`).run(tenant.id, at, at);
    db.prepare(`INSERT OR IGNORE INTO tenant_ai_config_bindings (tenant_id,service_type,ai_config_id,is_active,priority,is_default,created_at,updated_at)
      SELECT ?,service_type,id,1,priority,is_default,?,? FROM ai_service_configs WHERE deleted_at IS NULL AND is_active=1`).run(tenant.id, at, at);
    db.prepare(`INSERT OR IGNORE INTO tenant_sd2_config_bindings (tenant_id,ai_config_id,is_active,created_at,updated_at)
      SELECT ?,id,1,?,? FROM ai_service_configs WHERE deleted_at IS NULL AND is_active=1 AND service_type IN ('jimeng2_character_auth','model_ark_asset')`).run(tenant.id, at, at);
  })();
  const defaultTenant = db.prepare("SELECT * FROM tenants WHERE name='默认项目组'").get() || null;
  // 发布该能力前已存在的非默认分组也获得相同的无密钥模板；只处理
  // 尚未拥有专属配置的分组，历史绑定和已经填写的密钥保持不动。
  if (hasTable(db, 'tenant_ai_config_bindings')) {
    const groups = db.prepare('SELECT id FROM tenants WHERE status=? AND COALESCE(uses_legacy_global_configs, 0)=0').all('active');
    for (const group of groups) {
      const owned = db.prepare('SELECT 1 FROM ai_service_configs WHERE owner_tenant_id=? AND deleted_at IS NULL LIMIT 1').get(group.id);
      if (!owned) seedOwnedConfigTemplates(db, group.id, actorId);
    }
  }
  return defaultTenant;
}

function listTenants(db) {
  if (!hasTable(db, 'tenants')) return [];
  return db.prepare(`SELECT t.*, COUNT(tm.user_id) AS member_count,
    (SELECT pb.name FROM tenant_price_book_bindings binding JOIN billing_price_books pb ON pb.id = binding.price_book_id WHERE binding.tenant_id = t.id) AS price_book_name,
    (SELECT binding.price_book_id FROM tenant_price_book_bindings binding WHERE binding.tenant_id = t.id) AS price_book_id
    FROM tenants t LEFT JOIN tenant_memberships tm ON tm.tenant_id = t.id
    GROUP BY t.id ORDER BY t.id`).all().map((row) => ({
    ...row,
    // The default group deliberately keeps legacy per-model published-price
    // resolution. Show that explicit fallback instead of an empty table cell.
    price_book_name: row.price_book_name || (row.name === '默认项目组' ? '全局已发布价目表（按模型匹配）' : null),
    member_count: Number(row.member_count || 0),
  }));
}

function tenantDetail(db, tenantId) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id=?').get(tenantId);
  if (!tenant) return null;
  const members = db.prepare(`SELECT u.id, u.username, u.display_name, u.role, u.is_active, tm.role AS membership_role
    FROM tenant_memberships tm JOIN users u ON u.id=tm.user_id WHERE tm.tenant_id=? ORDER BY u.id`).all(tenantId)
    .map((row) => ({ ...row, is_active: !!row.is_active }));
  const configs = db.prepare(`SELECT b.id AS binding_id, b.service_type, b.is_active, b.priority AS tenant_priority, b.is_default AS tenant_is_default, c.id AS config_id, c.name, c.provider, c.model, c.default_model
    FROM tenant_ai_config_bindings b JOIN ai_service_configs c ON c.id=b.ai_config_id
    WHERE b.tenant_id=? AND c.deleted_at IS NULL ORDER BY b.service_type, b.is_default DESC, b.priority DESC, c.id`).all(tenantId)
    .map((row) => ({ ...row, is_active: !!row.is_active, tenant_is_default: !!row.tenant_is_default, tenant_priority: Number(row.tenant_priority || 0) }));
  const sd2 = db.prepare(`SELECT b.id AS binding_id, b.is_active, c.id AS config_id, c.service_type, c.name, c.provider
    FROM tenant_sd2_config_bindings b JOIN ai_service_configs c ON c.id=b.ai_config_id
    WHERE b.tenant_id=? AND c.deleted_at IS NULL ORDER BY c.service_type, c.id`).all(tenantId)
    .map((row) => ({ ...row, is_active: !!row.is_active }));
  const priceBook = db.prepare(`SELECT pb.id, pb.name, pb.status FROM tenant_price_book_bindings b JOIN billing_price_books pb ON pb.id=b.price_book_id WHERE b.tenant_id=?`).get(tenantId) || null;
  return { ...tenant, members, configs, sd2_configs: sd2, price_book: priceBook };
}

function writeTenant(db, actorId, input, id) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('分组名称必填');
  const status = input.status === 'disabled' ? 'disabled' : 'active';
  const at = new Date().toISOString();
  if (id) {
    const changed = db.prepare('UPDATE tenants SET name=?, status=?, updated_at=? WHERE id=?').run(name, status, at, Number(id));
    if (!changed.changes) return null;
    return tenantDetail(db, Number(id));
  }
  const info = db.prepare('INSERT INTO tenants (name,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?)').run(name, status, actorId, at, at);
  const tenantId = Number(info.lastInsertRowid);
  seedOwnedConfigTemplates(db, tenantId, actorId);
  return tenantDetail(db, tenantId);
}

function sanitizeTemplateSettings(raw) {
  if (!raw) return raw || null;
  try {
    const value = JSON.parse(raw);
    for (const key of Object.keys(value)) {
      if (/(?:key|secret|token|credential|access[_-]?id|session)/i.test(key)) delete value[key];
    }
    return JSON.stringify(value);
  } catch (_) { return null; }
}

// 新分组直接继承平台已验证的服务结构、模型、端点和默认项；所有
// 凭据与 SD2 私有参数保持为空，运营人员只需补齐本组密钥即可启用。
function seedOwnedConfigTemplates(db, tenantId, actorId) {
  const templates = db.prepare(`SELECT * FROM ai_service_configs
    WHERE deleted_at IS NULL AND owner_tenant_id IS NULL AND is_active=1
    ORDER BY service_type, is_default DESC, priority DESC, id`).all();
  if (!templates.length) return;
  const aiConfigs = require('./aiConfigService');
  for (const row of templates) {
    const created = aiConfigs.createConfig(db, { info() {} }, {
      owner_tenant_id: tenantId,
      service_type: row.service_type,
      provider: row.provider,
      api_protocol: row.api_protocol,
      name: `${row.name}（${db.prepare('SELECT name FROM tenants WHERE id=?').get(tenantId).name}）`,
      base_url: row.base_url,
      api_key: '',
      model: (() => { try { return JSON.parse(row.model || '[]') } catch (_) { return [] } })(),
      default_model: row.default_model,
      billing_key: row.billing_key,
      endpoint: row.endpoint,
      query_endpoint: row.query_endpoint,
      priority: row.priority,
      is_default: false,
      settings: sanitizeTemplateSettings(row.settings),
    });
    bindOwnedConfig(db, tenantId, created, { is_default: !!row.is_default, priority: row.priority });
  }
}

function setMember(db, tenantId, userId, role = 'creator') {
  const target = tenantDetail(db, Number(tenantId));
  if (!target) throw new Error('分组不存在');
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(Number(userId));
  if (!user) throw new Error('用户不存在');
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO tenant_memberships (tenant_id,user_id,role,created_at,updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET tenant_id=excluded.tenant_id, role=excluded.role, updated_at=excluded.updated_at`)
    .run(target.id, user.id, role === 'tenant_admin' ? 'tenant_admin' : 'creator', at, at);
  return tenantDetail(db, target.id);
}

function bindOwnedConfig(db, tenantId, config, options = {}) {
  const target = tenantDetail(db, Number(tenantId));
  if (!target) throw new Error('分组不存在');
  if (Number(config.owner_tenant_id) !== Number(target.id)) throw new Error('只能绑定本分组创建的配置');
  const at = new Date().toISOString();
  db.transaction(() => {
    if (options.is_default) db.prepare('UPDATE tenant_ai_config_bindings SET is_default=0, updated_at=? WHERE tenant_id=? AND service_type=?').run(at, target.id, config.service_type);
    db.prepare(`INSERT INTO tenant_ai_config_bindings (tenant_id,service_type,ai_config_id,is_active,priority,is_default,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,service_type,ai_config_id) DO UPDATE SET is_active=1, priority=excluded.priority, is_default=excluded.is_default, updated_at=excluded.updated_at`)
      .run(target.id, config.service_type, config.id, 1, Number(options.priority || 0), options.is_default ? 1 : 0, at, at);
    if (['jimeng2_character_auth', 'model_ark_asset'].includes(config.service_type)) {
      db.prepare(`INSERT INTO tenant_sd2_config_bindings (tenant_id,ai_config_id,is_active,created_at,updated_at)
        VALUES (?,?,1,?,?) ON CONFLICT(tenant_id,ai_config_id) DO UPDATE SET is_active=1, updated_at=excluded.updated_at`).run(target.id, config.id, at, at);
    }
  })();
  return tenantDetail(db, target.id);
}

function replaceBindings(db, tenantId, input) {
  const target = tenantDetail(db, Number(tenantId));
  if (!target) throw new Error('分组不存在');
  const rawAiConfigs = Array.isArray(input.ai_configs) ? input.ai_configs : null;
  const aiIds = [...new Set((rawAiConfigs || input.ai_config_ids || []).map((item) => Number(typeof item === 'object' ? item.id : item)).filter(Number.isSafeInteger))];
  const sd2Ids = [...new Set((input.sd2_config_ids || []).map(Number).filter(Number.isSafeInteger))];
  const priceBookId = input.price_book_id == null || input.price_book_id === '' ? null : Number(input.price_book_id);
  const at = new Date().toISOString();
  db.transaction(() => {
    const validate = (ids, kind) => {
      if (!ids.length) return;
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ai_service_configs WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`).get(...ids).n;
      if (Number(count) !== ids.length) throw new Error(`${kind}包含不存在的配置`);
    };
    validate(aiIds, 'API 配置'); validate(sd2Ids, 'SD2 配置');
    if (priceBookId) {
      const book = db.prepare("SELECT id FROM billing_price_books WHERE id=? AND status='published'").get(priceBookId);
      if (!book) throw new Error('请选择已发布的价目表');
    }
    const configRows = aiIds.length
      ? db.prepare(`SELECT id, service_type, priority, is_default FROM ai_service_configs WHERE id IN (${aiIds.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...aiIds)
      : [];
    const submitted = new Map((rawAiConfigs || []).map((item) => [Number(item?.id), item]));
    const defaultsByService = new Map();
    for (const config of configRows) {
      const requested = submitted.get(Number(config.id));
      if (requested?.is_default === true) {
        if (defaultsByService.has(config.service_type)) throw new Error(`${config.service_type} 只能选择一个默认 API`);
        defaultsByService.set(config.service_type, config.id);
      }
    }
    // Older clients submit only ai_config_ids. Keep their behavior stable by
    // adopting the platform default when available, otherwise the first bound
    // configuration becomes the group's usable default.
    for (const config of configRows) {
      if (!defaultsByService.has(config.service_type) && Number(config.is_default) === 1) defaultsByService.set(config.service_type, config.id);
    }
    for (const config of configRows) {
      if (!defaultsByService.has(config.service_type)) defaultsByService.set(config.service_type, config.id);
    }
    db.prepare('DELETE FROM tenant_ai_config_bindings WHERE tenant_id=?').run(target.id);
    db.prepare('DELETE FROM tenant_sd2_config_bindings WHERE tenant_id=?').run(target.id);
    const aiInsert = db.prepare('INSERT INTO tenant_ai_config_bindings (tenant_id,service_type,ai_config_id,is_active,priority,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)');
    for (const config of configRows) {
      const requested = submitted.get(Number(config.id));
      const priority = Number.isFinite(Number(requested?.priority)) ? Number(requested.priority) : Number(config.priority || 0);
      aiInsert.run(target.id, config.service_type, config.id, 1, priority, defaultsByService.get(config.service_type) === config.id ? 1 : 0, at, at);
    }
    const sd2Insert = db.prepare('INSERT INTO tenant_sd2_config_bindings (tenant_id,ai_config_id,is_active,created_at,updated_at) VALUES (?,?,1,?,?)');
    for (const configId of sd2Ids) sd2Insert.run(target.id, configId, at, at);
    if (priceBookId) db.prepare(`INSERT INTO tenant_price_book_bindings (tenant_id,price_book_id,active_at,created_by,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(tenant_id) DO UPDATE SET price_book_id=excluded.price_book_id, active_at=excluded.active_at, updated_at=excluded.updated_at`).run(target.id, priceBookId, at, null, at);
    else db.prepare('DELETE FROM tenant_price_book_bindings WHERE tenant_id=?').run(target.id);
  })();
  return tenantDetail(db, target.id);
}

module.exports = { hasTable, tenantForUser, configIdsForService, configIdsForTenant, usesLegacyGlobalConfigs, priceBookForUser, ensureDefaultTenant, listTenants, tenantDetail, writeTenant, setMember, bindOwnedConfig, replaceBindings };
