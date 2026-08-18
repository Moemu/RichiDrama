const response = require('../response');
const imageService = require('../services/imageService');
const taskService = require('../services/taskService');
const backgroundExtractionService = require('../services/backgroundExtractionService');

function routes(db, cfg, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query, owner_user_id: req.auth.id };
        const { items, total, page, pageSize } = imageService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('images list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const body = req.body || {};
        if (body.drama_id) {
          const own = db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(body.drama_id), req.auth.id);
          if (!own) return response.notFound(res, '项目不存在');
        }
        const billing = require('../services/billingService');
        // The current provider adapters request exactly one image (n: 1) and
        // completion persists one image row. Reject a mismatched count instead
        // of freezing several images then settling one.
        const requestedCount = body.count == null ? 1 : Number(body.count);
        if (!Number.isSafeInteger(requestedCount) || requestedCount !== 1) {
          return response.badRequest(res, '当前图片接口每次仅支持生成 1 张');
        }
        const tenant = require('../services/tenantService').tenantForUser(db, req.auth.id);
        const aiOptions = tenant ? { tenant_id: tenant.id } : {};
        const imageConfig = require('../services/aiConfigService').listConfigs(db, body.service_type || 'image', aiOptions)[0]
          || require('../services/aiConfigService').listConfigs(db, 'storyboard_image', aiOptions)[0];
        const model = String(body.model || imageConfig?.default_model || imageConfig?.model?.[0] || '').trim();
        if (!model) return response.badRequest(res, '请选择图片模型后再生成');
        const billingTarget = require('../services/aiConfigService').resolveBillingTarget(db, body.service_type || 'image', model, body.ai_config_id, aiOptions);
        if (!String(body.idempotency_key || '').trim()) return response.badRequest(res, '图片生成请求缺少幂等键，请刷新后重试');
        const authorization = billing.createAuthorization(db, req.auth, {
          idempotency_key: String(body.idempotency_key).trim(),
          service_type: body.service_type || 'image', model: billingTarget.billing_key,
          usage: { image: 1 }, reference_type: 'image_generation', reference_id: body.drama_id || null,
        });
        const rec = imageService.create(db, log, { ...body, model, owner_user_id: req.auth.id, tenant_id: tenant?.id || null, billing_authorization_id: authorization.authorization_id });
        response.created(res, rec);
      } catch (err) {
        log.error('images create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = imageService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('images get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = imageService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('images delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    scene: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'image_generation', req.params.scene_id);
        setTimeout(() => taskService.updateTaskResult(db, task.id, []), 100);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('images scene', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBackgrounds: (req, res) => {
      try {
        const list = imageService.getBackgroundsForEpisode(db, req.params.episode_id);
        response.success(res, list);
      } catch (err) {
        log.error('images episode backgrounds', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBackgroundsExtract: (req, res) => {
      try {
        const body = req.body || {};
        const taskId = backgroundExtractionService.extractBackgroundsForEpisode(
          db,
          cfg,
          log,
          req.params.episode_id,
          body.model,
          body.style,
          body.language
        );
        response.success(res, { task_id: taskId, status: 'pending', message: '场景提取任务已创建，正在后台处理...' });
      } catch (err) {
        log.error('images episode backgrounds extract', { error: err.message });
        if (err.message && (err.message.includes('script content') || err.message.includes('not found'))) {
          return response.badRequest(res, err.message);
        }
        response.internalError(res, err.message || '任务创建失败');
      }
    },
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('images episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    upload: (req, res) => {
      try {
        const body = req.body || {};
        const item = imageService.upload(db, log, body);
        response.created(res, item);
      } catch (err) {
        log.error('images upload', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
