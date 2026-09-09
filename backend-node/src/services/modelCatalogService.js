const billing = require('./billingService');

const serviceTypes = ['text', 'image', 'storyboard_image', 'video', 'video_postprocess', 'tts'];
const now = () => new Date().toISOString();
function entries(db) {
  return db.prepare('SELECT * FROM ai_model_catalog').all();
}
function connections(db) {
  const ai = require('./aiConfigService');
  return db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL').all()
    .map(row => ai.getConfig(db, row.id)).filter(config => serviceTypes.includes(config.service_type));
}
function priceGroups(db, serviceType, keys, books = billing.listPriceBooks(db)) {
  return books.map((book) => ({ ...book, items: book.items.filter((item) => item.service_type === serviceType && keys.includes(item.model)) })).filter((book) => book.items.length);
}
function requiredMeters(type, items) {
  if (type === 'text') return items.some(item => item.meter === 'request') ? [] : ['input_token', 'output_token'];
  if (type === 'image' || type === 'storyboard_image') return ['image'];
  if (type === 'tts') return ['character'];
  return [];
}
function priceReady(type, items) {
  if (type === 'video' && !items.some(item => ['request', 'second', 'input_token', 'output_token'].includes(item.meter))) return false;
  if (type === 'video_postprocess' && !items.some(item => item.meter === 'millisecond')) return false;
  return items.length > 0 && requiredMeters(type, items).every((meter) => items.some((item) => item.meter === meter));
}
function effective(book) {
  const at = now();
  return book.status === 'published' && (!book.effective_from || book.effective_from <= at) && (!book.effective_to || book.effective_to > at);
}
function list(db) {
  const configs = connections(db);
  const books = billing.listPriceBooks(db);
  const rows = new Map(entries(db).map((row) => [`${row.service_type}\0${row.model}`, row]));
  for (const config of configs) for (const model of config.model) {
    const key = `${config.service_type}\0${model}`;
    if (!rows.has(key)) rows.set(key, { service_type: config.service_type, model, display_name: model, status: 'legacy' });
  }
  return [...rows.values()].filter(row => {
    const capability = require('./modelCapabilityService');
    const known = capability.infer(row.model);
    return !known || known === capability.canonical(row.service_type) || configs.some(config => config.service_type === row.service_type && config.model.includes(row.model));
  }).map((row) => {
    const linked = configs.filter((config) => config.service_type === row.service_type && config.model.includes(row.model));
    const keys = [...new Set(linked.map((config) => config.billing_key || row.model))];
    const prices = priceGroups(db, row.service_type, keys.length ? keys : [row.model], books);
    const ready = keys.length > 0 && keys.every(key => prices.some(book => effective(book) && priceReady(row.service_type, book.items.filter(item => item.model === key))));
    return { ...row, connections: linked.map((config) => ({ id: config.id, name: config.name, provider_connection_id: config.provider_connection_id, provider_connection_name: config.provider_connection_name, provider: config.provider, is_active: config.is_active, default_model: config.default_model || config.model[0], billing_key: config.billing_key || row.model })), prices, price_ready: ready, connection_ready: linked.some((config) => config.is_active), managed: row.status !== 'legacy' };
  }).sort((a, b) => `${a.service_type}/${a.model}`.localeCompare(`${b.service_type}/${b.model}`));
}
function save(db, actorId, input, log) {
  const model = String(input.model || '').trim();
  const type = String(input.service_type || '');
  if (!serviceTypes.includes(type) || !model || model.length > 200 || /[\s,，]/.test(model)) throw new Error('请选择服务类型并填写有效模型 ID');
  const status = input.status || 'draft';
  if (!['draft', 'active', 'retired'].includes(status)) throw new Error('无效的模型状态');
  return db.transaction(() => {
    const ai = require('./aiConfigService');
    if (input.config_id) {
      const config = ai.getConfig(db, Number(input.config_id));
      if (!config || config.service_type !== type) throw new Error('连接不存在或服务类型不匹配');
      if (!config.model.includes(model)) ai.updateConfig(db, log, config.id, { model: [...config.model, model] });
    }
    const linked = connections(db).filter((config) => config.service_type === type && config.model.includes(model));
    if (!linked.length) throw new Error('请先选择一个供应商连接');
    if (status === 'active') {
      if (!linked.some((config) => config.is_active)) throw new Error('请先启用供应商连接');
      for (const config of linked.filter((item) => item.is_active)) {
        const groups = priceGroups(db, type, [config.billing_key || model]);
        if (!groups.some((book) => effective(book) && priceReady(type, book.items))) throw new Error('请先发布完整价格，再上架模型');
      }
    }
    if (status === 'retired' || (status === 'draft' && db.prepare("SELECT 1 FROM ai_model_catalog WHERE service_type=? AND model=? AND status='active'").get(type, model))) {
      const defaults = linked.filter((config) => config.is_active && (config.default_model || config.model[0]) === model);
      if (defaults.length) throw new Error(`请先在连接中更换默认模型：${defaults.map((config) => config.name).join('、')}`);
      const scenes = db.prepare("SELECT key FROM ai_model_map WHERE model_override=? AND (service_type=? OR (service_type='storyboard_image' AND ?='image' AND routing_version='capability-default-v1'))").all(model, type, type);
      if (scenes.length) throw new Error('请先在业务场景中更换此默认模型');
    }
    const at = now();
    db.prepare(`INSERT INTO ai_model_catalog(service_type,model,display_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(service_type,model) DO UPDATE SET display_name=excluded.display_name,status=excluded.status,updated_at=excluded.updated_at`)
      .run(type, model, String(input.display_name || model).trim(), status, at, at);
    billing.audit(db, actorId, 'model_catalog.save', 'model', model, { service_type: type, status });
    return list(db).find((row) => row.service_type === type && row.model === model);
  })();
}
function assertAvailable(db, type, model) {
  const row = db.prepare('SELECT status FROM ai_model_catalog WHERE service_type=? AND model=?').get(type, model);
  if (row && row.status !== 'active') throw new Error(`模型 ${model} ${row.status === 'retired' ? '已下架' : '尚未上架'}，请选择其他模型`);
}
function registerNewModels(db, config, previousModels = []) {
  if (!serviceTypes.includes(config.service_type)) return;
  const others = connections(db).filter(item => item.id !== config.id && item.service_type === config.service_type);
  const at = now();
  const insert = db.prepare("INSERT OR IGNORE INTO ai_model_catalog(service_type,model,display_name,status,created_at,updated_at) VALUES (?,?,?,'draft',?,?)");
  for (const model of config.model) {
    if (previousModels.includes(model) || others.some(item => item.model.includes(model))) continue;
    insert.run(config.service_type, model, model, at, at);
  }
}
function filterConfigs(db, configs, userId) {
  const managed = new Map(entries(db).map((row) => [`${row.service_type}\0${row.model}`, row]));
  return configs.map((config) => {
    const model = config.model.filter((model) => {
      const row = managed.get(`${config.service_type}\0${model}`);
      if (!row) return true;
      if (row.status !== 'active') return false;
      if (!userId) return true;
      const meters = billing.activeMeters(db, { id: userId }, config.service_type, config.billing_key || model);
      return priceReady(config.service_type, meters.map((meter) => ({ meter })));
    });
    return { ...config, model, default_model: model.includes(config.default_model) ? config.default_model : model[0] || null };
  }).filter((config) => config.model.length || !serviceTypes.includes(config.service_type));
}
function createPriceDraft(db, actorId, input) {
  const row = list(db).find((item) => item.service_type === input.service_type && item.model === input.model);
  if (!row) throw new Error('模型不存在');
  const books = billing.listPriceBooks(db);
  const base = books.find((book) => book.id === Number(input.price_book_id) && effective(book));
  if (!base) throw new Error('请选择当前已发布价目表');
  const key = String(input.billing_key || row.connections[0]?.billing_key || row.model);
  if (!row.connections.some((config) => config.billing_key === key)) throw new Error('无效的计费关联');
  const items = (input.items || []).map((item) => ({ ...item, service_type: row.service_type, model: key }));
  if (!priceReady(row.service_type, items)) throw new Error('请填写完整计价项');
  if (items.some((item) => !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0)) throw new Error('价格必须为非负数');
  for (const item of items) {
    if (!item.is_free && Number(item.unit_price) === 0) throw new Error('零价格必须显式勾选免费');
    const conditions = item.conditions_json;
    if (conditions != null && (typeof conditions !== 'object' || Array.isArray(conditions))) throw new Error('计价条件必须是 JSON 对象');
    if (conditions?.unit_size != null && (!Number.isSafeInteger(conditions.unit_size) || conditions.unit_size <= 0)) throw new Error('计量数量必须为正整数');
  }
  return db.transaction(() => {
    const draft = billing.savePriceBook(db, actorId, { name: `${base.name} · ${row.display_name} 调价`, items: [...base.items.filter((item) => item.service_type !== row.service_type || item.model !== key), ...items] });
    db.prepare('UPDATE billing_price_books SET parent_price_book_id=?,version=?,system_managed=?,owner_user_id=? WHERE id=?').run(base.id, Number(base.version || 1) + 1, base.system_managed ? 1 : 0, base.owner_user_id, draft.id);
    return billing.listPriceBooks(db).find((book) => book.id === draft.id);
  })();
}
module.exports = { list, save, assertAvailable, filterConfigs, createPriceDraft, priceReady, registerNewModels };
