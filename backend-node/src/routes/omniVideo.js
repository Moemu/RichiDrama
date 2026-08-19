const response = require('../response');
const omniVideoService = require('../services/omniVideoService');
const capabilityService = require('../services/videoModelCapabilities');
const sequenceService = require('../services/omniSequenceService');
module.exports = function routes(db, log, cfg) { return {
  list(req, res) { try { response.success(res, omniVideoService.list(db, { ...(req.query || {}), owner_user_id: req.auth.id })); } catch (err) { response.internalError(res, err.message); } },
  create(req, res) { try {
    const body = req.body || {};
    if (body.drama_id && !db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(body.drama_id), req.auth.id)) return response.notFound(res, '项目不存在');
    if (body.sequence_id && !db.prepare('SELECT 1 FROM omni_video_sequences WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(body.sequence_id), req.auth.id)) return response.notFound(res, '全能创作项目不存在');
    const tenant = require('../services/tenantService').tenantForUser(db, req.auth.id);
    response.created(res, omniVideoService.create(db, log, { ...body, owner_user_id: req.auth.id, tenant_id: tenant?.id || null }, req.auth));
  } catch (err) { response.badRequest(res, err.message); } },
  polishPrompt: async (req, res) => {
    try {
      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) return response.badRequest(res, '请先填写提示词');
      const assets = Array.isArray(req.body?.assets) ? req.body.assets : [];
      const assetSummary = assets.slice(0, 12).map((asset) => `${asset.alias || asset.name || '素材'}（${asset.type || 'image'}，${asset.usage || 'reference'}）`).join('、') || '无素材';
      const tenant = require('../services/tenantService').tenantForUser(db, req.auth.id);
      const suggestion = await require('../services/aiClient').generateText(db, log, 'text', [
        '请在不改变用户意图、不编造素材内容的前提下，给出一版更清晰、可直接用于视频生成的中文提示词。',
        '保持人物、动作、镜头、时长、画幅和明确的 @素材引用；只输出润色后的提示词，不要解释。',
        `用户原文：${prompt}`,
        `已选素材：${assetSummary}`,
      ].join('\n'), '你是视频提示词编辑。忠实保留用户意图，避免夸张、虚构和替换用户指定的素材。', { scene_key: 'omni_video_polish', max_tokens: 1200, temperature: 0.35, tenant_id: tenant?.id || null });
      response.success(res, { suggestion: String(suggestion || '').trim(), original_prompt: prompt });
    } catch (err) { response.badRequest(res, err.message || '提示词润色失败'); }
  },
  retry(req, res) { try { response.created(res, omniVideoService.retry(db, log, req.params.id, req.auth)); } catch (err) { response.badRequest(res, err.message); } },
  cancel(req, res) { try { response.success(res, omniVideoService.cancelJob(db, log, req.params.id, req.auth)); } catch (err) { response.badRequest(res, err.message); } },
  retryPostprocess(req, res) { try { response.created(res, omniVideoService.retryPostprocess(db, log, req.params.id, req.auth, req.body?.stage)); } catch (err) { response.badRequest(res, err.message); } },
  adoptSource(req, res) { try { response.success(res, omniVideoService.adoptSourceVideo(db, log, req.params.id, req.auth)); } catch (err) { response.badRequest(res, err.message); } },
  adopt(req, res) { try { response.success(res, omniVideoService.adoptCompletedVersion(db, req.params.id, req.auth)); } catch (err) { response.badRequest(res, err.message); } },
  extractFrame(req, res) { try { response.created(res, require('../services/omniFrameService').extract(db, cfg, log, req.params.id, req.body?.position)); } catch (err) { response.badRequest(res, err.message); } },
  extractVideoFrame(req, res) { try { response.created(res, require('../services/omniFrameService').extractVideoGeneration(db, cfg, log, req.params.id, req.body?.position)); } catch (err) { response.badRequest(res, err.message); } },
  get(req, res) { try { const job = omniVideoService.get(db, req.params.id); if (!job) return response.notFound(res, '全能视频任务不存在'); response.success(res, job); } catch (err) { response.internalError(res, err.message); } },
  capabilities(req, res) { const tenant = require('../services/tenantService').tenantForUser(db, req.auth.id); response.success(res, capabilityService.list(db, tenant ? { tenant_id: tenant.id } : {})); },
  listSequences(req, res) { try { response.success(res, sequenceService.list(db, { owner_user_id: req.auth.id })); } catch (err) { response.internalError(res, err.message); } },
  listDeletedSequences(req, res) { try { response.success(res, sequenceService.list(db, { deleted: true, owner_user_id: req.auth.id })); } catch (err) { response.internalError(res, err.message); } },
  defaultSequence(req, res) { try { response.success(res, sequenceService.ensureDefault(db, req.auth.id)); } catch (err) { response.internalError(res, err.message); } },
  getSequence(req, res) { try { const sequence = sequenceService.get(db, req.params.id); if (!sequence) return response.notFound(res, '全能创作项目不存在'); response.success(res, sequence); } catch (err) { response.internalError(res, err.message); } },
  createSequence(req, res) { try { response.created(res, sequenceService.createSequence(db, { ...(req.body || {}), owner_user_id: req.auth.id })); } catch (err) { response.badRequest(res, err.message); } },
  updateSequence(req, res) { try { response.success(res, sequenceService.updateSequence(db, req.params.id, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  deleteSequence(req, res) { try { sequenceService.deleteSequence(db, req.params.id); response.success(res, { ok: true }); } catch (err) { response.badRequest(res, err.message); } },
  restoreSequence(req, res) { try { response.success(res, sequenceService.restoreSequence(db, req.params.id)); } catch (err) { response.badRequest(res, err.message); } },
  purgeSequence(req, res) { try { sequenceService.purgeSequence(db, req.params.id); response.success(res, { ok: true }); } catch (err) { response.badRequest(res, err.message); } },
  addShot(req, res) { try { response.created(res, sequenceService.createShot(db, req.params.id, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  updateShot(req, res) { try { response.success(res, sequenceService.updateShot(db, req.params.id, req.params.shotId, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  deleteShot(req, res) { try { sequenceService.deleteShot(db, req.params.id, req.params.shotId); response.success(res, { ok: true }); } catch (err) { response.badRequest(res, err.message); } },
  reorderShots(req, res) { try { response.success(res, sequenceService.reorder(db, req.params.id, req.body?.shot_ids)); } catch (err) { response.badRequest(res, err.message); } },
}; };
