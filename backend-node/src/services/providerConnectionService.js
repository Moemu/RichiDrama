const capability = require('./modelCapabilityService');
const now = () => new Date().toISOString();

function get(db, id) {
  return db.prepare('SELECT * FROM ai_provider_connections WHERE id=?').get(Number(id)) || null;
}

function bindings(db, id) {
  const ai = require('./aiConfigService');
  return db.prepare('SELECT id FROM ai_service_configs WHERE provider_connection_id=? AND deleted_at IS NULL ORDER BY service_type,id').all(Number(id))
    .map(row => ai.getConfig(db, row.id));
}

function view(db, row) {
  if (!row) return null;
  return { id: row.id, name: row.name, provider: row.provider, base_url: row.base_url, has_api_key: !!row.api_key,
    is_active: !!row.is_active, owner_tenant_id: row.owner_tenant_id,
    bindings: bindings(db, row.id).map(config => ({ id: config.id, name: config.name, service_type: config.service_type, model: config.model,
      default_model: config.default_model, billing_key: config.billing_key, is_active: config.is_active })) };
}

function list(db) { return db.prepare('SELECT * FROM ai_provider_connections ORDER BY name,id').all().map(row => view(db, row)); }

function save(db, actorId, input, id) {
  const existing = id ? get(db, id) : null;
  if (id && !existing) throw new Error('供应商连接不存在');
  const value = { ...existing, ...input };
  const name = String(value.name || '').trim();
  const provider = String(value.provider || '').trim();
  const base = String(value.base_url || '').trim().replace(/\/+$/, '');
  if (!name || !provider || name.length > 200 || provider.length > 80) throw new Error('请填写连接名称和供应商');
  let url;
  try { url = new URL(base); } catch { throw new Error('Base URL 无效'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 必须为无账号和查询参数的 HTTP 地址');
  // Existing bindings keep their transport. Changing provider would require
  // reviewing each model's protocol and endpoint, so use a new connection.
  if (existing && provider !== existing.provider && bindings(db, id).length) throw new Error('已有模型的连接不能更换供应商，请新增连接');
  const key = input.api_key === undefined || input.api_key === '' ? existing?.api_key || '' : String(input.api_key).trim();
  const at = now();
  return db.transaction(() => {
    let connectionId = Number(id);
    if (existing) db.prepare('UPDATE ai_provider_connections SET name=?,provider=?,base_url=?,api_key=?,is_active=?,updated_at=? WHERE id=?')
      .run(name, provider, base, key, value.is_active === false || value.is_active === 0 ? 0 : 1, at, connectionId);
    else connectionId = Number(db.prepare('INSERT INTO ai_provider_connections(name,provider,base_url,api_key,is_active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(name, provider, base, key, value.is_active === false ? 0 : 1, at, at).lastInsertRowid);
    require('./billingService').audit(db, actorId, 'provider_connection.save', 'provider_connection', connectionId, { name, provider });
    return view(db, get(db, connectionId));
  })();
}

function fromLegacy(db, actorId, configId) {
  const ai = require('./aiConfigService');
  const config = ai.getConfig(db, Number(configId));
  if (!config || !capability.capabilities.includes(capability.canonical(config.service_type))) throw new Error('此专用配置不能转换为共享连接');
  if (config.owner_tenant_id) throw new Error('请在项目组中继续管理此组的独立凭据');
  if (config.provider_connection_id) return view(db, get(db, config.provider_connection_id));
  const defaultCapability = capability.infer(config.default_model || config.model[0]);
  if (defaultCapability && defaultCapability !== capability.canonical(config.service_type)) throw new Error('旧配置的默认模型能力不匹配，请先更换为正确的默认模型再转换');
  return db.transaction(() => {
    const shared = save(db, actorId, config);
    db.prepare('UPDATE ai_service_configs SET provider_connection_id=?,api_key=?,updated_at=? WHERE id=?').run(shared.id, '', now(), config.id);
    require('./billingService').audit(db, actorId, 'provider_connection.convert', 'ai_config', config.id, { provider_connection_id: shared.id });
    return view(db, get(db, shared.id));
  })();
}

function providerFamily(provider) {
  const name = String(provider || '').trim().toLowerCase();
  return ['volces', 'volcengine', 'volc'].includes(name) ? 'volcengine' : name;
}

function connectionAddress(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch { return null; }
}

function attachmentProblem(shared, config) {
  if (!config) return '配置不存在或已删除';
  if (config.owner_tenant_id) return '项目组独立配置不能关联到平台连接';
  if (!capability.capabilities.includes(capability.canonical(config.service_type))) return '专用服务不支持关联';
  if (config.provider_connection_id && config.provider_connection_id !== shared.id) return '已属于其他共享连接';
  if (!shared.is_active) return '请先启用目标供应商连接';
  if (providerFamily(config.provider) !== providerFamily(shared.provider)) return '供应商不一致';
  const address = connectionAddress(shared.base_url);
  if (!address || connectionAddress(config.base_url) !== address) return 'Base URL 不一致';
  if (!shared.api_key || config.api_key !== shared.api_key) return 'API Key 不一致或未填写';
  const defaultCapability = capability.infer(config.default_model || config.model[0]);
  if (defaultCapability && defaultCapability !== capability.canonical(config.service_type)) return '默认模型能力不匹配，请先修正旧配置';
  return null;
}

function attachmentCandidates(db, id) {
  const shared = get(db, id);
  if (!shared) throw new Error('供应商连接不存在');
  const ai = require('./aiConfigService');
  return db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND provider_connection_id IS NULL AND owner_tenant_id IS NULL ORDER BY name,id').all()
    .map(row => ai.getConfig(db, row.id))
    .filter(config => capability.capabilities.includes(capability.canonical(config.service_type)))
    .map(config => {
      const reason = attachmentProblem(shared, config);
      return { id: config.id, name: config.name, provider: config.provider, base_url: config.base_url,
        service_type: config.service_type, default_model: config.default_model, eligible: !reason, reason };
    });
}

function attach(db, actorId, id, configIds) {
  if (!Array.isArray(configIds) || !configIds.length || configIds.length > 200 ||
    configIds.some(value => !Number.isSafeInteger(value) || value <= 0)) throw new Error('请选择 1 至 200 条现有配置');
  return db.transaction(() => {
    const shared = get(db, id);
    if (!shared) throw new Error('供应商连接不存在');
    const ai = require('./aiConfigService');
    const configs = [...new Set(configIds)].map(configId => ai.getConfig(db, configId));
    for (const config of configs) {
      const reason = attachmentProblem(shared, config);
      if (reason) throw new Error(`${config?.name || '所选配置'}：${reason}，未关联任何配置`);
    }
    const added = configs.filter(config => !config.provider_connection_id);
    const at = now();
    for (const config of added) {
      db.prepare('UPDATE ai_service_configs SET provider_connection_id=?,api_key=?,updated_at=? WHERE id=?').run(shared.id, '', at, config.id);
    }
    if (added.length) require('./billingService').audit(db, actorId, 'provider_connection.attach', 'provider_connection', shared.id, { config_ids: added.map(config => config.id) });
    return { connection: view(db, get(db, id)), attached: added.map(config => config.id), skipped: configs.length - added.length };
  })();
}

function importModels(db, actorId, id, input, log) {
  const shared = get(db, id);
  if (!shared) throw new Error('供应商连接不存在');
  if (!Array.isArray(input.models) || !input.models.length || input.models.length > 200) throw new Error('请选择 1 至 200 个模型');
  const models = [...new Set(input.models)];
  const rows = models.map(model => {
    if (typeof model !== 'string' || !model || model.length > 200 || /[\s,，\x00-\x1f]/.test(model)) throw new Error('模型 ID 无效');
    return { model, type: capability.resolve(model, input.capabilities?.[model]) };
  });
  return db.transaction(() => {
    const ai = require('./aiConfigService');
    const added = [];
    for (const { model, type } of rows) {
      let config = bindings(db, id).find(item => item.service_type === type && !item.billing_key);
      if (bindings(db, id).some(item => capability.canonical(item.service_type) === type && item.model.includes(model))) continue;
      const previous = config?.model || [];
      if (config) config = ai.updateConfig(db, log, config.id, { model: [...previous, model] });
      else {
        config = ai.createConfig(db, log, { name: `${shared.name} · ${type}`, service_type: type, provider: shared.provider,
          base_url: shared.base_url, api_key: '', model: [model], is_default: false, priority: -100 });
        db.prepare('UPDATE ai_service_configs SET provider_connection_id=? WHERE id=?').run(shared.id, config.id);
        config = ai.getConfig(db, config.id);
        require('./tenantService').bindGlobalConfigToLegacyTenants(db, config);
      }
      require('./modelCatalogService').registerNewModels(db, config, previous);
      added.push(model);
    }
    require('./billingService').audit(db, actorId, 'provider_connection.import', 'provider_connection', id, { models: rows, added });
    return { added, skipped: models.length - added.length };
  })();
}

module.exports = { get, list, view, bindings, save, fromLegacy, attachmentCandidates, attach, importModels };
