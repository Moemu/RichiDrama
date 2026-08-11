const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const { normalizeAspectRatioForApi } = require('../services/videoClient');

function routes(db, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query, owner_user_id: req.auth.id };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('videos list', { error: err.message });
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
        const videoConfig = require('../services/aiConfigService').listConfigs(db, body.service_type || 'video')[0];
        const modelForBilling = String(body.model || videoConfig?.default_model || videoConfig?.model?.[0] || '').trim();
        if (!modelForBilling) return response.badRequest(res, '请选择视频模型后再生成');
        const billingTarget = require('../services/aiConfigService').resolveBillingTarget(db, body.service_type || 'video', modelForBilling, body.ai_config_id);
        const configForBilling = require('../services/aiConfigService').getConfig(db, billingTarget.config_id) || videoConfig;
        let settings = {}; try { settings = JSON.parse(configForBilling?.settings || '{}'); } catch (_) {}
        const meters = billing.activeMeters(db, req.auth, body.service_type || 'video', billingTarget.billing_key);
        const usage = {};
        if (meters.includes('second')) usage.second = Number(body.duration || 15) || 15;
        if (meters.includes('request')) usage.request = 1;
        if (meters.includes('input_token')) {
          const cap = Number(settings.billing_reserve_input_tokens);
          if (!Number.isSafeInteger(cap) || cap <= 0) return response.badRequest(res, '视频模型按 token 计费，需在 AI 配置 settings 中设置 billing_reserve_input_tokens 作为单次预授权上限');
          usage.input_token = cap;
        }
        if (meters.includes('output_token')) {
          const cap = Number(settings.billing_reserve_output_tokens ?? settings.billing_reserve_input_tokens);
          if (!Number.isSafeInteger(cap) || cap <= 0) return response.badRequest(res, '视频模型按 token 计费，需在 AI 配置 settings 中设置 billing_reserve_output_tokens 作为单次预授权上限');
          usage.output_token = cap;
        }
        if (!Object.keys(usage).length) return response.badRequest(res, '该视频模型未配置可用计费项');
        const authorization = billing.createAuthorization(db, req.auth, {
          idempotency_key: body.idempotency_key || `video:${req.auth.id}:${Date.now()}:${Math.random()}`,
          service_type: body.service_type || 'video', model: billingTarget.billing_key,
          usage, pricing_context: { has_video_input: !!body.video_url, resolution: body.resolution || '480p', has_audio: !!body.audio_url }, reference_type: 'video_generation', reference_id: body.drama_id || null,
        });
        const task = taskService.createTask(db, log, 'video_generation', String(body.drama_id || ''), req.auth.id);
        const now = new Date().toISOString();
        const dramaId = Number(body.drama_id) || 0;
        const storyboardId = body.storyboard_id != null ? Number(body.storyboard_id) : null;
        const provider = body.provider || 'chatfire';
        let prompt = body.prompt || '';
        const style = (body.style || '').toString().trim();
        if (style) {
          const baseLower = String(prompt || '').toLowerCase();
          const styleLower = style.toLowerCase();
          if (!baseLower.includes(styleLower)) {
            prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
          }
        }
        const model = modelForBilling;
        const duration = body.duration ?? 15;
        // 画幅：请求体归一化（全角冒号等）后写入 DB；未传则从 drama.metadata 读取并同样归一化
        let aspectRatio = null;
        if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
          aspectRatio = normalizeAspectRatioForApi(body.aspect_ratio);
        }
        if (!aspectRatio && dramaId) {
          try {
            const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
            if (dramaRow && dramaRow.metadata) {
              const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
              if (meta && meta.aspect_ratio) aspectRatio = normalizeAspectRatioForApi(meta.aspect_ratio);
            }
          } catch (_) {}
        }
        const resolution = body.resolution ?? null;
        const seed = body.seed != null ? Number(body.seed) : null;
        const cameraFixed = body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null;
        const watermark = body.watermark != null ? (body.watermark ? 1 : 0) : 0;
        const imageUrl = body.image_url ?? null;
        // 首尾帧：支持 URL 或本地路径（sxy，存到 first_frame_url / last_frame_url）
        const firstFrameUrl = body.first_frame_url ?? body.first_frame_local_path ?? null;
        const lastFrameUrl = body.last_frame_url ?? body.last_frame_local_path ?? null;
        // 多图模式：sxy，存 JSON 数组到 reference_image_urls
        const refImagesJson =
          body.reference_image_urls && Array.isArray(body.reference_image_urls)
            ? JSON.stringify(body.reference_image_urls.slice(0, 10))
            : null;
        db.prepare(
          `INSERT INTO video_generations (drama_id, storyboard_id, owner_user_id, billing_authorization_id, provider, prompt, model, duration, aspect_ratio, resolution, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
        ).run(dramaId, storyboardId, req.auth.id, authorization.authorization_id, provider, prompt, model, duration, aspectRatio, resolution, seed, cameraFixed, watermark, imageUrl, firstFrameUrl, lastFrameUrl, refImagesJson, task.id, now, now);
        const videoGenId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        setImmediate(() => {
          videoService.processVideoGeneration(db, log, videoGenId);
        });
        const item = videoService.getById(db, videoGenId);
        response.created(res, item || { id: videoGenId, task_id: task.id, status: 'processing' });
      } catch (err) {
        log.error('videos create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('videos delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    fromImage: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'video_generation', req.params.image_gen_id);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('videos fromImage', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('videos episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
