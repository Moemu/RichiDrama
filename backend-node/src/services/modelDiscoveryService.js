const { randomUUID } = require('node:crypto');
const ai = require('./aiConfigService');
const catalog = require('./modelCatalogService');
const billing = require('./billingService');
const { signedHeaders } = require('./providerPriceService');

const serviceTypes = new Set(['text', 'image', 'storyboard_image', 'video', 'tts']);
const sources = new Set(['openai', 'volcengine_endpoints']);
const pageSize = 100;

function settings(config) {
  try { return JSON.parse(config.settings || '{}'); } catch { return {}; }
}

function defaultSource(config) {
  if (/volc|volces|火山/.test(`${config.provider} ${config.api_protocol}`.toLowerCase())) return 'volcengine_endpoints';
  return 'openai';
}

function listConnections(db) {
  const configs = db.prepare('SELECT id FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY name,id').all().map(row => ai.getConfig(db, row.id));
  const summary = config => ({ id: config.id, name: config.name, service_type: config.service_type, owner_tenant_id: config.owner_tenant_id });
  return {
    connections: configs.filter(config => serviceTypes.has(config.service_type)).map(config => ({ ...summary(config), source: defaultSource(config) })),
    credentials: configs.filter(config => config.service_type === 'model_ark_asset' && config.is_active && settings(config).access_key_id && settings(config).secret_access_key).map(summary),
  };
}

function connection(db, id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new Error('无效的连接 ID');
  const config = ai.getConfig(db, Number(id));
  if (!config || !serviceTypes.has(config.service_type)) throw new Error('连接不存在或不支持模型获取');
  return config;
}

function modelsUrl(base) {
  let url;
  try { url = new URL(base); } catch { throw new Error('连接的 Base URL 无效，请先编辑连接'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Base URL 仅支持无账号、查询参数和片段的 HTTP 地址');
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = !path ? '/v1/models' : path.endsWith('/models') ? path : `${path}/models`;
  return url.toString();
}

async function readJson(response) {
  // A proxy may return an HTML error page or an unbounded stream.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('模型列表响应为空');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('模型列表响应过大，请缩小供应商返回范围');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('供应商未返回有效的模型列表 JSON'); }
}

function validId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s,，\x00-\x1f\x7f]/.test(value);
}

async function discover(db, actorId, configId, input = {}) {
  const config = connection(db, configId);
  const source = input.source || defaultSource(config);
  if (!sources.has(source)) throw new Error('不支持此模型列表来源');
  const page = Number(input.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || (source === 'openai' && page !== 1)) throw new Error('无效的模型列表页码');
  const requestId = randomUUID();
  let url; let init; let credentialId = null;
  if (source === 'openai') {
    const key = String(config.api_key || '').trim().replace(/^Bearer\s+/i, '');
    if (!key || ai.isMaskedApiKey(key)) throw new Error('请先保存连接的 API Key');
    url = modelsUrl(config.base_url);
    init = { method: 'GET', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'X-Client-Request-Id': requestId } };
  } else {
    const credential = ai.getConfig(db, Number(input.credential_config_id) || 0);
    if (!credential || credential.service_type !== 'model_ark_asset' || !credential.is_active) throw new Error('请选择已保存且启用的 ModelArk AK/SK 配置');
    if (credential.owner_tenant_id && credential.owner_tenant_id !== config.owner_tenant_id) throw new Error('凭据配置不属于此连接的项目组');
    const value = settings(credential);
    if (!value.access_key_id || !value.secret_access_key) throw new Error('ModelArk 配置缺少 AK/SK');
    if (value.session_token) throw new Error('当前模型获取仅支持长期 AK/SK，请选择对应的 ModelArk 配置');
    const region = value.sign_region || 'cn-beijing';
    if (!/^cn-[a-z0-9-]+$/.test(region)) throw new Error('此来源仅支持火山国内区域，请选择对应的 ModelArk 配置');
    credentialId = credential.id;
    const signed = signedHeaders({ accessKeyId: value.access_key_id, secretAccessKey: value.secret_access_key, region, service: 'ark', action: 'ListEndpoints', version: '2024-01-01', body: { PageNumber: page, PageSize: pageSize, ...(value.project_name ? { ProjectName: value.project_name } : {}) } });
    url = signed.url;
    init = { method: 'POST', headers: signed.headers, body: signed.bodyText };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let providerRequestId = null;
  try {
    // Discovery is a read-only administration operation. It never invokes
    // inference, creates an authorization, or publishes prices.
    const result = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    providerRequestId = result.headers.get('x-request-id') || null;
    if (!result.ok) {
      await result.body?.cancel();
      const hint = [401, 403].includes(result.status) ? '请检查密钥和列表读取权限' : result.status === 404 ? '此连接不支持该列表 API，请检查来源和 Base URL' : result.status === 429 ? '供应商限流，请稍后重试' : result.status >= 300 && result.status < 400 ? '列表接口返回重定向，请在连接中保存最终地址' : '请稍后重试或检查供应商服务';
      throw new Error(`获取模型失败（HTTP ${result.status}）：${hint}`);
    }
    const payload = await readJson(result);
    providerRequestId = payload.ResponseMetadata?.RequestId || providerRequestId;
    if (payload.ResponseMetadata?.Error || payload.error) throw new Error('供应商拒绝模型列表请求，请检查密钥和列表读取权限');
    const raw = source === 'openai' ? payload.data : payload.Result?.Items;
    if (!Array.isArray(raw)) throw new Error('供应商响应不包含模型列表，请检查所选接口来源');
    if (source === 'openai' && payload.has_more) throw new Error('此兼容接口要求额外分页，当前不支持；未导入任何模型');
    const total = source === 'openai' ? raw.length : payload.Result?.TotalCount;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('供应商响应缺少有效的模型总数');
    const models = new Map(); let ignored = 0;
    for (const item of raw) {
      const id = source === 'openai' ? item?.id : item?.Id;
      if (!validId(id)) { ignored++; continue; }
      models.set(id, { id, display_name: String((source === 'openai' ? item.name : item.Name) || id).slice(0, 200), provider_status: source === 'openai' ? null : String(item.Status || ''), configured: config.model.includes(id) });
    }
    const nextPage = source === 'volcengine_endpoints' && page * pageSize < total ? page + 1 : null;
    if (nextPage && !raw.length) throw new Error('供应商分页响应不完整，请重新获取');
    billing.audit(db, actorId, 'model_catalog.discover', 'ai_config', config.id, { request_id: requestId, provider_request_id: providerRequestId, source, credential_config_id: credentialId, page, count: models.size });
    return { request_id: requestId, provider_request_id: providerRequestId, source, service_type: config.service_type, models: [...models.values()].sort((a, b) => a.id.localeCompare(b.id)), total, next_page: nextPage, ignored };
  } catch (error) {
    const message = controller.signal.aborted ? '获取模型超时，请稍后重试' : error instanceof TypeError ? '无法连接模型列表服务，请检查 Base URL 和网络' : error.message;
    billing.audit(db, actorId, 'model_catalog.discover_failed', 'ai_config', config.id, { request_id: requestId, provider_request_id: providerRequestId, source });
    throw new Error(message);
  } finally { clearTimeout(timer); }
}

function importModels(db, actorId, configId, input, log) {
  if (!Array.isArray(input.models) || !input.models.length || input.models.length > 200) throw new Error('请选择 1 至 200 个模型');
  const models = [...new Set(input.models)];
  if (models.some(model => !validId(model))) throw new Error('包含无效模型 ID，未导入任何模型');
  return db.transaction(() => {
    const config = connection(db, configId);
    const added = models.filter(model => !config.model.includes(model));
    if (added.length) {
      const updated = ai.updateConfig(db, log, config.id, { model: [...config.model, ...added] });
      catalog.registerNewModels(db, updated, config.model);
      billing.audit(db, actorId, 'model_catalog.import', 'ai_config', config.id, { models: added });
    }
    return { added, skipped: models.length - added.length };
  })();
}

module.exports = { listConnections, discover, importModels, modelsUrl };
