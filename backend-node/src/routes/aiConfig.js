const aiConfigService = require('../services/aiConfigService');
const response = require('../response');

function list(db) {
  return (req, res) => {
    const requestedTenantId = Number(req.query?.tenant_id);
    if (requestedTenantId) {
      if (req.auth?.role !== 'admin') return response.forbidden(res, '仅运营后台可管理分组 API');
      const tenant = require('../services/tenantService').tenantDetail(db, requestedTenantId);
      if (!tenant) return response.notFound(res, '项目分组不存在');
      return response.success(res, aiConfigService.listOwnedTenantConfigs(db, requestedTenantId, req.query.service_type));
    }
    const tenant = require('../services/tenantService').tenantForUser(db, req.auth?.id);
    const options = tenant ? { tenant_id: tenant.id } : {};
    const list = req.auth?.role === 'admin'
      ? aiConfigService.listConfigs(db, req.query.service_type, options)
      : aiConfigService.listPublicConfigs(db, req.query.service_type, options);
    response.success(res, list);
  };
}

function get(db) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const config = aiConfigService.getConfig(db, id);
    if (!config) return response.notFound(res, '配置不存在');
    const tenantId = Number(req.query?.tenant_id);
    if (tenantId && Number(config.owner_tenant_id) !== tenantId) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

function vendorLock(cfg) {
  return (req, res) => {
    const status = aiConfigService.getVendorLockStatus(cfg);
    response.success(res, status);
  };
}

function create(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许添加配置');
    }
    const body = req.body || {};
    const tenantId = Number(body.tenant_id || req.query?.tenant_id);
    if (tenantId && !require('../services/tenantService').tenantDetail(db, tenantId)) return response.notFound(res, '项目分组不存在');
    if (!body.service_type || !body.name || !body.provider || !body.base_url) {
      return response.badRequest(res, '缺少必填字段: service_type, name, provider, base_url');
    }
    if (body.api_key === undefined || body.api_key === null) {
      return response.badRequest(res, '缺少必填字段: api_key');
    }
    try {
      const config = aiConfigService.createConfig(db, log, {
        ...body,
        owner_tenant_id: tenantId || null,
        // 分组默认项记录在绑定表，不能改动其他分组或旧平台配置。
        is_default: tenantId ? false : body.is_default,
        model: body.model ?? [],
      });
      if (tenantId) require('../services/tenantService').bindOwnedConfig(db, tenantId, config, { is_default: body.is_default !== false, priority: body.priority });
      response.created(res, config);
    } catch (err) {
      log.errorw('Create AI config failed', { error: err.message });
      response.internalError(res, '创建失败');
    }
  };
}

function update(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');

    let body = req.body || {};
    const tenantId = Number(body.tenant_id || req.query?.tenant_id);
    const owned = aiConfigService.getConfig(db, id);
    if (tenantId && Number(owned?.owner_tenant_id) !== tenantId) return response.notFound(res, '配置不存在');

    // 普通成员只拿到不含凭据的共享配置列表。限制其更新字段，避免前端的
    // 空端点/空设置覆盖管理员已经保存的供应商接入和计费参数。
    if (req.auth?.role !== 'admin') {
      const editableFields = [
        'name',
        'model',
        'default_model',
        'priority',
        'is_default',
        'is_active'
      ];
      body = Object.fromEntries(
        editableFields
          .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
          .map((field) => [field, body[field]])
      );
    }

    // 锁定模式下只允许修改 api_key、default_model、is_default
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      const allowed = {};
      if (body.api_key !== undefined) allowed.api_key = body.api_key;
      if (body.default_model !== undefined) allowed.default_model = body.default_model;
      if (body.is_default !== undefined) allowed.is_default = body.is_default;
      body = allowed;
    }

    if (tenantId) body = { ...body, is_default: false };
    const config = aiConfigService.updateConfig(db, log, id, body);
    if (!config) return response.notFound(res, '配置不存在');
    if (tenantId) require('../services/tenantService').bindOwnedConfig(db, tenantId, config, { is_default: req.body?.is_default !== false, priority: req.body?.priority });
    response.success(res, config);
  };
}

function remove(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许删除配置');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const tenantId = Number(req.query?.tenant_id);
    const owned = aiConfigService.getConfig(db, id);
    if (tenantId && Number(owned?.owner_tenant_id) !== tenantId) return response.notFound(res, '配置不存在');
    const ok = aiConfigService.deleteConfig(db, log, id);
    if (!ok) return response.notFound(res, '配置不存在');
    response.success(res, { message: '删除成功' });
  };
}

function bulkUpdateKey(db, log, cfg) {
  return (req, res) => {
    if (!aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '批量换Key仅在厂商锁定模式下可用');
    }
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的 API Key');
    }
    try {
      const count = aiConfigService.bulkUpdateApiKey(db, log, api_key.trim());
      response.success(res, { updated: count, message: `已更新 ${count} 条配置的 API Key` });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换Key失败');
    }
  };
}

function testConnection(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    // Creators see a credential-free shared-config list. Resolve a selected
    // config on the server so they can test it without exposing its API key.
    let input = body;
    if (body.config_id != null) {
      const config = aiConfigService.getConfig(db, Number(body.config_id));
      if (!config) return response.notFound(res, '配置不存在');
      input = {
        ...config,
        model: body.model || config.model,
        endpoint: body.endpoint ?? config.endpoint,
        settings: body.settings ?? config.settings,
      };
    }
    if (!input.base_url || !input.api_key) {
      return response.badRequest(res, '缺少 base_url 或 api_key');
    }
    try {
      await aiConfigService.testConnection({
        base_url: input.base_url,
        api_key: input.api_key,
        model: input.model,
        provider: input.provider,
        endpoint: input.endpoint,
        service_type: input.service_type,
        settings: input.settings,
      });
      response.success(res, { message: '连接测试成功' });
    } catch (err) {
      log.error('AI config test connection failed', { error: err.message });
      response.badRequest(res, '连接测试失败: ' + (err.message || '未知错误'));
    }
  };
}

/** ModelArk / 方舟私有资产库：代理调用 CreateAssetGroup、ListAssets 等（与官方 Action 名一致） */
function modelArkAsset(log) {
  return async (req, res) => {
    const body = req.body || {};
    const action = (body.action || '').toString().trim();
    try {
      const modelArkAssetProxyService = require('../services/modelArkAssetProxyService');
      const data = await modelArkAssetProxyService.callModelArkAsset(
        {
          base_url: body.base_url,
          api_key: body.api_key,
          action,
          body: body.payload,
          path_mode: body.path_mode,
          http_method: body.http_method,
          api_version: body.api_version,
          auth_mode: body.auth_mode,
          access_key_id: body.access_key_id,
          secret_access_key: body.secret_access_key,
          sign_region: body.sign_region,
          sign_service: body.sign_service,
          session_token: body.session_token,
          project_name: body.project_name,
        },
        log
      );
      response.success(res, data);
    } catch (err) {
      log.error('model-ark-asset proxy failed', { error: err.message, action });
      const status = err.status >= 400 && err.status < 600 ? err.status : 400;
      return response.error(res, status, 'MODEL_ARK_ASSET', err.message || '请求失败', err.payload);
    }
  };
}

/** 即梦2角色认证：代理 GET 素材列表（表单未保存也可用当前填写的网关与 Token） */
function listJimeng2MaterialAssets(log) {
  return async (req, res) => {
    const body = req.body || {};
    const base_url = (body.base_url || '').toString().trim().replace(/\/$/, '');
    const { normalizeMaterialHubToken } = require('../services/jimengMaterialHubService');
    let api_key = normalizeMaterialHubToken(body.api_key || '');
    if (!base_url || !api_key) {
      return response.badRequest(res, '请先填写网关 URL 与 Token');
    }
    const jimengMaterialHubService = require('../services/jimengMaterialHubService');
    const ctx = { baseUrl: base_url, token: api_key };
    const r = await jimengMaterialHubService.listAssets(ctx, { limit: body.limit, cursor: body.cursor }, log);
    if (!r.ok) {
      return response.badRequest(res, String(r.error || '列出素材失败').slice(0, 800));
    }
    response.success(res, r.data);
  };
}

module.exports = function aiConfigRoutes(db, log, cfg) {
  return {
    list: list(db),
    get: get(db),
    vendorLock: vendorLock(cfg),
    create: create(db, log, cfg),
    update: update(db, log, cfg),
    delete: remove(db, log, cfg),
    testConnection: testConnection(db, log),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(log),
    modelArkAsset: modelArkAsset(log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};
