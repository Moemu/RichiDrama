const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const { normalizeAspectRatioForApi } = require('../services/videoClient');
const postprocessPolicy = require('../services/videoPostprocessPolicy');

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
    homepageDefaults: (req, res) => {
      try {
        // 默认轮播返回产品配置的固定媒体资源，不关联管理员或任何用户作品。
        response.success(res, videoService.listHomepageDefaultVideos(db, 3));
      } catch (err) {
        log.error('homepage default videos', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const body = req.body || {};
        let policy;
        try { policy = postprocessPolicy.normalize(body); }
        catch (error) { return response.badRequest(res, error.message); }
        if (body.drama_id) {
          const own = db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(body.drama_id), req.auth.id);
          if (!own) return response.notFound(res, '项目不存在');
        }
        const billing = require('../services/billingService');
        const tenant = require('../services/tenantService').tenantForUser(db, req.auth.id);
        const aiOptions = tenant ? { tenant_id: tenant.id } : {};
        const videoConfig = require('../services/aiConfigService').listConfigs(db, body.service_type || 'video', aiOptions)[0];
        const modelForBilling = String(body.model || videoConfig?.default_model || videoConfig?.model?.[0] || '').trim();
        if (!modelForBilling) return response.badRequest(res, '请选择视频模型后再生成');
        const billingTarget = require('../services/aiConfigService').resolveBillingTarget(db, body.service_type || 'video', modelForBilling, body.ai_config_id, aiOptions);
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
        if (!String(body.idempotency_key || '').trim()) return response.badRequest(res, '视频生成请求缺少幂等键，请刷新后重试');
        const authorization = billing.createAuthorization(db, req.auth, {
          idempotency_key: String(body.idempotency_key).trim(),
          service_type: body.service_type || 'video', model: billingTarget.billing_key,
          usage, pricing_context: { has_video_input: !!body.video_url, resolution: body.resolution || '480p', has_audio: !!body.audio_url }, reference_type: 'video_generation', reference_id: body.drama_id || null,
        });
        const task = taskService.createTask(db, log, 'video_generation', String(body.drama_id || ''), req.auth.id, tenant?.id || null);
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
        const resolution = policy.resolution;
        const upscaleResolution = policy.upscale_resolution;
        const targetFps = policy.target_fps;
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
          `INSERT INTO video_generations (drama_id, storyboard_id, owner_user_id, tenant_id, billing_authorization_id, provider, prompt, model, duration, aspect_ratio, resolution, upscale_resolution, target_fps, seed, camera_fixed, watermark, image_url, first_frame_url, last_frame_url, reference_image_urls, intermediate_cleanup_enabled, status, task_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'processing', ?, ?, ?)`
        ).run(dramaId, storyboardId, req.auth.id, tenant?.id || null, authorization.authorization_id, provider, prompt, model, duration, aspectRatio, resolution, upscaleResolution, targetFps, seed, cameraFixed, watermark, imageUrl, firstFrameUrl, lastFrameUrl, refImagesJson, task.id, now, now);
        const videoGenId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        try {
          if (upscaleResolution) require('../services/videoUpscaleService').reserveForGeneration(db, videoGenId, upscaleResolution);
          if (targetFps) require('../services/videoInterpolationService').reserveForGeneration(db, videoGenId, targetFps);
        } catch (error) {
          videoService.setVideoGenFailed(db, videoGenId, error.message, new Date().toISOString());
          taskService.updateTaskError(db, task.id, error.message);
          throw error;
        }
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
    postprocessQuote: (req, res) => {
      try {
        let policy;
        try { policy = postprocessPolicy.normalize(req.body || {}); }
        catch (error) { return response.badRequest(res, error.message); }
        const durationMs = Math.max(1000, Math.ceil(Number(req.body?.duration || 15) * 1000));
        const billing = require('../services/billingService');
        const { fpsTier, resolutionTier } = require('../services/videoInterpolationService');
        const stages = [];
        if (policy.upscale_resolution) {
          const sourceFps = Math.min(120, Math.max(15, Number(req.body?.source_fps || 30)));
          const estimated = billing.quote(db, req.auth, { service_type: 'video_postprocess', model: 'volcengine-video-generative-enhancement', usage: { millisecond: durationMs }, pricing_context: { resolution_tier: policy.upscale_resolution, fps_tier: fpsTier(sourceFps) } });
          stages.push({ stage: 'upscale', target: policy.upscale_resolution, estimated_points: estimated.amount, pricing_fps: sourceFps });
        }
        if (policy.target_fps) {
          const estimated = billing.quote(db, req.auth, { service_type: 'video_postprocess', model: 'volcengine-video-frame-interpolation', usage: { millisecond: durationMs }, pricing_context: { resolution_tier: resolutionTier(policy.upscale_resolution || policy.resolution), fps_tier: fpsTier(policy.target_fps) } });
          stages.push({ stage: 'interpolation', target: `${policy.target_fps}fps`, estimated_points: estimated.amount, pricing_fps: policy.target_fps });
        }
        response.success(res, {
          policy, chain: `${postprocessPolicy.describe(policy)} → 本地规范 ${normalizeAspectRatioForApi(req.body?.aspect_ratio) || '16:9'}`,
          estimated_total_points: stages.reduce((sum, item) => sum + Number(item.estimated_points || 0), 0),
          note: '按请求时长估算；实际按本地探测的输出毫秒、分辨率和帧率结算；最终画幅规范化不额外收费',
        });
      } catch (error) { response.badRequest(res, error.message); }
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
