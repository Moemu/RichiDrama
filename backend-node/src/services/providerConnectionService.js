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
    bindings: bindings(db, row.id).map(config => ({ id: config.id, service_type: config.service_type, model: config.model,
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

module.exports = { get, list, view, bindings, save, fromLegacy, importModels };
