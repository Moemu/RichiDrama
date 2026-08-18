const express = require('express');
const response = require('../response');
const dramaRoutes = require('./drama');
const taskRoutes = require('./task');
const settingsRoutes = require('./settings');
const aiConfigRoutes = require('./aiConfig');
const propRoutes = require('./prop');
const stubRoutes = require('./stub');
const characterLibraryRoutes = require('./characterLibrary');
const sceneLibraryRoutes = require('./sceneLibrary');
const propLibraryRoutes = require('./propLibrary');
const characterRoutes = require('./characters');
const uploadModule = require('./upload');
const sceneRoutes = require('./scenes');
const storyboardRoutes = require('./storyboards');
const tailFrameLinkRoutes = require('./storyboards_tail_link');
const imageRoutes = require('./images');
const videoRoutes = require('./videos');
const videoMergeRoutes = require('./videoMerges');
const assetRoutes = require('./assets');
const audioRoutes = require('./audio');
const promptOverridesRoutes = require('./promptOverrides');
const sceneModelMapRoutes = require('./sceneModelMap');
const authRoutes = require('./auth');
const billingRoutes = require('./billing');
const adminRoutes = require('./admin');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { ownershipGuard } = require('../middleware/ownership');

function setupRouter(cfg, db, log) {
  const r = express.Router();
  const auth = authRoutes(db);
  const billing = billingRoutes(db);
  const admin = adminRoutes(db, log);
  // Public signup/login endpoints; all workspace data derives identity from JWT.
  r.post('/auth/login', auth.login);
  r.post('/auth/register', auth.register);
  r.use(requireAuth(db));
  // Preserve the authenticated payer through nested and asynchronous service
  // calls, so every text-model invocation can participate in billing.
  r.use((req, res, next) => {
    const tenant = require('../services/tenantService').tenantForUser(db, req.auth?.id);
    return require('../services/billingRequestContext').run({ actor: req.auth, tenant_id: tenant?.id || null, db, log }, next);
  });
  r.get('/auth/me', auth.me);
  r.post('/auth/session-cookie', auth.sessionCookie);
  r.post('/auth/logout', auth.logout);
  r.post('/auth/change-password', auth.changePassword);
  r.patch('/auth/username', auth.changeUsername);
  r.use(ownershipGuard(db));
  const drama = dramaRoutes(db, cfg, log);
  const task = taskRoutes(db, log);
  const settings = settingsRoutes(db, cfg, log);
  const aiConfig = aiConfigRoutes(db, log, cfg);
  const prop = propRoutes(db, log, cfg);
  const stub = stubRoutes(db, cfg, log);
  const sceneModelMap = sceneModelMapRoutes(db, log);
  const omniVideo = require('./omniVideo')(db, log, cfg);
  
  const uploadService = require('../services/uploadService');
  const charLibrary = characterLibraryRoutes(db, cfg, log);
  const sceneLibrary = sceneLibraryRoutes(db, cfg, log);
  const propLibrary = propLibraryRoutes(db, cfg, log);
  const characters = characterRoutes(db, cfg, log, uploadService);
  const uploadHandlers = uploadModule.routes(cfg, log, db);
  const scenes = sceneRoutes(db, log, cfg);
  const storyboards = storyboardRoutes(db, log);
  const tailFrameLink = tailFrameLinkRoutes(db, cfg, log);
  const images = imageRoutes(db, cfg, log);
  const videos = videoRoutes(db, log);
  const videoMerges = videoMergeRoutes(db, log);
  const assets = assetRoutes(db, log, cfg);
  const audio = audioRoutes(db, log, cfg);
  const promptOverrides = promptOverridesRoutes.routes(db, log);
  const tools = require('./tools')(db, log);

  // ---------- billing (self-service) ----------
  r.get('/billing/me', billing.me);
  r.get('/billing/usage', billing.usage);
  r.get('/billing/transactions', billing.transactions);
  r.post('/billing/quotes', billing.quote);
  // Authorization lifecycle is service-owned. Clients may quote a price, but
  // cannot settle or release a provider call themselves.
  r.get('/models/available', (req, res) => {
    const tenant = require('../services/tenantService').tenantForUser(db, req.auth.id);
    const configs = require('../services/aiConfigService').listConfigs(db, null, tenant ? { tenant_id: tenant.id } : {});
    const billingService = require('../services/billingService');
    const out = [];
    for (const config of configs) {
      for (const model of config.model || []) {
        out.push({ service_type: config.service_type, model, provider: config.provider, config_id: config.id });
      }
    }
    response.success(res, out);
  });

  // ---------- administration ----------
  const adminRouter = express.Router();
  adminRouter.use(requireAdmin);
  adminRouter.get('/users', admin.users);
  adminRouter.post('/users', admin.createUser);
  adminRouter.patch('/users/:id', admin.updateUser);
  adminRouter.post('/users/:id/balance-adjustments', admin.balanceAdjustment);
  adminRouter.post('/users/:id/balance-corrections', admin.balanceCorrection);
  adminRouter.get('/tenants', admin.tenants);
  adminRouter.post('/tenants', admin.createTenant);
  adminRouter.get('/tenants/:id', admin.tenant);
  adminRouter.patch('/tenants/:id', admin.updateTenant);
  adminRouter.put('/tenants/:id/members/:userId', admin.setTenantMember);
  adminRouter.put('/tenants/:id/bindings', admin.replaceTenantBindings);
  adminRouter.get('/price-books', admin.priceBooks);
  adminRouter.post('/price-books', admin.createPriceBook);
  adminRouter.patch('/price-books/:id', admin.updatePriceBook);
  adminRouter.get('/transactions', admin.transactions);
  adminRouter.get('/usage', admin.usage);
  adminRouter.get('/overview', admin.overview);
  adminRouter.get('/operations-alert-settings', admin.alertSettings);
  adminRouter.patch('/operations-alert-settings', admin.saveAlertSettings);
  adminRouter.get('/production-export', admin.productionExport);
  adminRouter.get('/operations-reports', admin.reports);
  adminRouter.get('/production', admin.production);
  adminRouter.get('/production/:id', admin.productionDetail);
  adminRouter.get('/media-archives', admin.mediaArchives);
  adminRouter.post('/production/:id/retry-postprocess', admin.retryPostprocess);
  adminRouter.post('/production/:id/adopt-source', admin.adoptSource);
  adminRouter.post('/production/:id/retry-archive', admin.retryArchive);
  adminRouter.get('/billing-reconciliations', admin.reconciliationCases);
  adminRouter.post('/billing-authorizations/:id/collect-settlement-supplement', admin.collectSettlementSupplement);
  adminRouter.post('/billing-authorizations/collect-historical-settlement-supplements', admin.collectHistoricalSettlementSupplements);
  adminRouter.post('/billing-reconciliations/:id/settle', admin.settleReconciliationCase);
  adminRouter.post('/billing-reconciliations/:id/waive', admin.waiveReconciliationCase);
  adminRouter.get('/audit-logs', admin.audit);
  r.use('/admin', adminRouter);

  // ---------- dramas ----------
  r.get('/dramas', drama.listDramas);
  r.post('/dramas', drama.createDrama);
  r.get('/dramas/stats', drama.getDramaStats);
  // 导出/导入（放在 :id 路由前，避免被 :id 捕获）
  r.get('/dramas/:id/export', drama.exportDrama);
  const multer = require('multer');
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
  r.post('/dramas/import', importUpload.single('file'), drama.importDrama);
  r.post('/dramas/import-novel', importUpload.single('file'), async (req, res) => {
    try {
      const novelImportService = require('../services/novelImportService');
      let text = '';
      if (req.file && req.file.buffer) {
        text = req.file.buffer.toString('utf8');
      } else if (req.body && req.body.text) {
        text = req.body.text;
      }
      if (!text.trim()) return response.badRequest(res, '请上传小说文本文件或提供 text 参数');
      const title = req.body?.title || '';
      const maxChapters = Number(req.body?.max_chapters) || 20;
      const aiSummarize = req.body?.ai_summarize === 'true' || req.body?.ai_summarize === true;
      const result = await novelImportService.importNovel(db, log, { text, title, maxChapters, aiSummarize });
      response.success(res, result);
    } catch (err) {
      log.error('dramas import-novel', { error: err.message });
      response.internalError(res, err.message);
    }
  });
  r.get('/dramas/examples', drama.listExamples);
  r.post('/dramas/import-example', drama.importExample);
  r.put('/dramas/:id/outline', drama.saveOutline);
  r.get('/dramas/:id/characters', drama.getCharacters);
  r.put('/dramas/:id/characters', drama.saveCharacters);
  r.put('/dramas/:id/episodes', drama.saveEpisodes);
  r.put('/dramas/:id/progress', drama.saveProgress);
  r.put('/dramas/:id/canvas-layout', drama.saveCanvasLayout);
  r.get('/dramas/:id/props', drama.listProps);
  r.get('/dramas/:id', drama.getDrama);
  r.put('/dramas/:id', drama.updateDrama);
  r.delete('/dramas/:id', drama.deleteDrama);

  // ---------- ai-configs ----------
  // Provider credentials are group-managed operational secrets. Creators can
  // read their own group's sanitized model list, but only console accounts can
  // create, test, rotate, or delete configurations.
  r.get('/ai-configs', aiConfig.list);
  r.get('/ai-configs/vendor-lock', requireAdmin, aiConfig.vendorLock);
  r.post('/ai-configs', requireAdmin, aiConfig.create);
  r.post('/ai-configs/test', requireAdmin, aiConfig.testConnection);
  r.post('/ai-configs/jimeng2-list-assets', requireAdmin, aiConfig.listJimeng2MaterialAssets);
  r.post('/ai-configs/model-ark-asset', requireAdmin, aiConfig.modelArkAsset);
  r.put('/ai-configs/bulk-update-key', requireAdmin, aiConfig.bulkUpdateKey);  // 必须在 /:id 之前
  r.get('/ai-configs/:id', requireAdmin, aiConfig.get);
  r.put('/ai-configs/:id', requireAdmin, aiConfig.update);
  r.delete('/ai-configs/:id', requireAdmin, aiConfig.delete);

  // ---------- generation (角色生成：AI + 入库 + 任务结果) ----------
  r.post('/generation/characters', (req, res) => {
    const characterGenerationService = require('../services/characterGenerationService');
    try {
      const body = req.body || {};
      if (!body.drama_id) {
        return response.badRequest(res, 'drama_id 必填');
      }
      const taskId = characterGenerationService.generateCharacters(db, cfg, log, body);
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/characters', { error: err.message });
      response.internalError(res, err.message || '创建任务失败');
    }
  });

  // 故事生成：带 drama_id 时异步生成并入库；否则同步返回 episodes（兼容旧调用）
  r.post('/generation/story', async (req, res) => {
    const storyGenerationService = require('../services/storyGenerationService');
    try {
      const body = req.body || {};
      if (body.drama_id) {
        const taskId = storyGenerationService.startStoryGeneration(db, log, body);
        return response.success(res, { task_id: taskId, status: 'pending' });
      }
      const result = await storyGenerationService.generateStory(db, log, body);
      response.success(res, result);
    } catch (err) {
      log.error('generation/story', { error: err.message });
      if (err.message && (err.message.includes('未配置') || err.message.includes('必填') || err.message.includes('不存在'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '故事生成失败');
    }
  });

  // ---------- character-library ----------
  r.get('/character-library', charLibrary.list);
  r.post('/character-library', charLibrary.create);
  r.get('/character-library/:id', charLibrary.get);
  r.put('/character-library/:id', charLibrary.update);
  r.delete('/character-library/:id', charLibrary.delete);

  // ---------- scene-library ----------
  r.get('/scene-library', sceneLibrary.list);
  r.post('/scene-library', sceneLibrary.create);
  r.get('/scene-library/:id', sceneLibrary.get);
  r.put('/scene-library/:id', sceneLibrary.update);
  r.delete('/scene-library/:id', sceneLibrary.delete);

  // ---------- prop-library ----------
  r.get('/prop-library', propLibrary.list);
  r.post('/prop-library', propLibrary.create);
  r.get('/prop-library/:id', propLibrary.get);
  r.put('/prop-library/:id', propLibrary.update);
  r.delete('/prop-library/:id', propLibrary.delete);

  // ---------- characters ----------
  r.get('/characters/:id', characters.getOne);
  r.put('/characters/:id', characters.update);
  r.delete('/characters/:id', characters.delete);
  r.post('/characters/batch-generate-images', characters.batchGenerateImages);
  r.post('/characters/:id/generate-image', characters.generateImage);
  r.post('/characters/:id/generate-four-view-image', characters.generateFourViewImage);
  r.post('/characters/:id/generate-prompt', characters.generatePrompt);
  r.post('/characters/:id/upload-image', uploadModule.multerSingle, characters.uploadImage);
  r.put('/characters/:id/image', characters.putImage);
  r.put('/characters/:id/image-from-library', characters.imageFromLibrary);
  r.post('/characters/:id/add-to-library', characters.addToLibrary);
  r.post('/characters/:id/add-to-material-library', characters.addToMaterialLibrary);
  r.post('/characters/:id/sd2-certify', characters.sd2Certify);
  r.post('/characters/:id/sd2-certify/refresh', characters.sd2CertifyRefresh);
  r.post('/characters/:id/sd2-voice-upload', uploadModule.multerAudioSingle, characters.sd2VoiceUpload);
  r.post('/characters/:id/sd2-voice-refresh', characters.sd2VoiceRefresh);
  r.post('/characters/:id/extract-from-image', characters.extractFromImage);
  r.post('/characters/:id/extract-anchors', characters.extractAnchors);

  // ---------- props ----------
  r.get('/props/:id', prop.getPropById);
  r.post('/props', prop.createProp);
  r.put('/props/:id', prop.updateProp);
  r.delete('/props/:id', prop.deleteProp);
  r.post('/props/:id/generate', prop.generateImage);
  r.post('/props/:id/generate-prompt', prop.generatePropPrompt);
  r.post('/props/:id/add-to-library', prop.addToLibrary);
  r.post('/props/:id/add-to-material-library', prop.addToMaterialLibrary);
  r.post('/props/:id/extract-from-image', prop.extractPropFromImage);
  r.post('/props/:id/sd2-certify', prop.sd2Certify);
  r.post('/props/:id/sd2-certify/refresh', prop.sd2CertifyRefresh);

  // ---------- vision: 从图片提取描述（不依赖已有实体 ID）----------
  r.post('/extract-description-from-image', async (req, res) => {
    const { image_url, entity_type, entity_name } = req.body || {};
    if (!image_url) return response.badRequest(res, '缺少 image_url');
    if (!['character', 'scene', 'prop'].includes(entity_type)) return response.badRequest(res, 'entity_type 需为 character/scene/prop');
    try {
      const { extractDescriptionFromImage } = require('../services/aiClient');
      const out = await extractDescriptionFromImage(db, log, entity_type, image_url, entity_name);
      if (!out.ok) return response.badRequest(res, out.error);
      response.success(res, { description: out.description });
    } catch (err) {
      log.error('extract-description-from-image', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- upload ----------
  r.post('/upload/image', uploadModule.multerSingle, uploadHandlers.uploadImage);
  r.post('/media/upload', uploadHandlers.multerMediaSingle, uploadHandlers.uploadMedia);
  r.get('/upload-limits', (req, res) => response.success(res, require('../services/mediaAssetService').limits()));
  r.get('/video-model-capabilities', omniVideo.capabilities);
  r.get('/omni-video-sequences', omniVideo.listSequences);
  r.get('/omni-video-sequences/deleted', omniVideo.listDeletedSequences);
  r.post('/omni-video-sequences', omniVideo.createSequence);
  r.get('/omni-video-sequences/default', omniVideo.defaultSequence);
  r.get('/omni-video-sequences/:id', omniVideo.getSequence);
  r.put('/omni-video-sequences/:id', omniVideo.updateSequence);
  r.delete('/omni-video-sequences/:id', omniVideo.deleteSequence);
  r.post('/omni-video-sequences/:id/restore', omniVideo.restoreSequence);
  r.delete('/omni-video-sequences/:id/purge', omniVideo.purgeSequence);
  r.post('/omni-video-sequences/:id/shots', omniVideo.addShot);
  r.put('/omni-video-sequences/:id/shots/reorder', omniVideo.reorderShots);
  r.put('/omni-video-sequences/:id/shots/:shotId', omniVideo.updateShot);
  r.delete('/omni-video-sequences/:id/shots/:shotId', omniVideo.deleteShot);

  // ---------- AI 工具箱（独立运行历史） ----------
  r.get('/tool-templates', tools.templates);
  r.post('/tool-templates', requireAdmin, tools.createTemplate);
  r.put('/tool-templates/:id', requireAdmin, tools.updateTemplate);
  r.get('/tool-runs', tools.list);
  r.get('/tool-runs/:id', tools.get);
  r.delete('/tool-runs/:id', tools.remove);
  r.post('/tool-runs/:id/restore', tools.restore);
  r.post('/tool-runs/:id/retry', (req, res, next) => { require('../services/billingRequestContext').disableAutoBilling(); next(); }, tools.retry);
  r.post('/tool-runs/:id/import-drama', tools.importDrama);
  r.get('/tool-runs/:id/stream', tools.stream);
  r.post('/tools/:type/runs', (req, res, next) => { require('../services/billingRequestContext').disableAutoBilling(); next(); }, tools.execute);
  r.get('/omni-video-jobs', omniVideo.list);
  r.post('/omni-video-jobs', omniVideo.create);
  r.post('/omni-video-jobs/polish-prompt', omniVideo.polishPrompt);
  r.post('/omni-video-jobs/:id/retry', omniVideo.retry);
  r.post('/omni-video-jobs/:id/retry-postprocess', omniVideo.retryPostprocess);
  r.post('/omni-video-jobs/:id/adopt-source', omniVideo.adoptSource);
  r.post('/omni-video-jobs/:id/adopt', omniVideo.adopt);
  r.post('/omni-video-jobs/:id/extract-frame', omniVideo.extractFrame);
  r.post('/video-generations/:id/extract-frame', omniVideo.extractVideoFrame);
  r.get('/omni-video-jobs/:id', omniVideo.get);

  // ---------- episodes ----------
  // 注意：drama.generateStoryboard 已处理所有逻辑（包括参数解析），这里统一使用 drama 模块的实现
  // 之前可能有部分路由指向了 storyboards.episodeStoryboardsGenerate，这可能导致参数解析不一致
  r.post('/episodes/:episode_id/storyboards', drama.generateStoryboard);
  r.post('/episodes/:episode_id/props/extract', prop.extractProps);
  r.post('/episodes/:episode_id/characters/extract', stub.episodeCharactersExtract);
  r.get('/episodes/:episode_id/storyboards', storyboards.episodeStoryboardsGet);
  r.get('/episodes/:episode_id/generation-settings', storyboards.episodeGenerationSettingsGet);
  r.patch('/episodes/:episode_id/generation-settings', storyboards.episodeGenerationSettingsUpdate);
  r.post('/episodes/:episode_id/finalize', drama.finalizeEpisode);
  r.get('/episodes/:episode_id/download', drama.downloadEpisodeVideo);

  // ---------- tasks ----------
  r.get('/tasks/:task_id', task.getTaskStatus);
  r.post('/tasks/:task_id/cancel', task.cancelTaskStatus);
  r.get('/tasks', task.getResourceTasks);

  // ---------- scenes ----------
  r.get('/scenes/:scene_id', scenes.getOne);
  r.post('/scenes/:scene_id/generate-prompt', scenes.generatePrompt);
  r.put('/scenes/:scene_id', scenes.update);
  r.put('/scenes/:scene_id/prompt', scenes.updatePrompt);
  r.delete('/scenes/:scene_id', scenes.delete);
  r.post('/scenes/generate-image', scenes.generateImage);
  r.post('/scenes', scenes.create);
  r.post('/scenes/:scene_id/generate-four-view-image', scenes.generateFourViewImage);
  r.post('/scenes/:scene_id/add-to-library', scenes.addToLibrary);
  r.post('/scenes/:scene_id/add-to-material-library', scenes.addToMaterialLibrary);
  r.post('/scenes/:scene_id/extract-from-image', scenes.extractFromImage);
  r.post('/scenes/:scene_id/sd2-certify', scenes.sd2Certify);
  r.post('/scenes/:scene_id/sd2-certify/refresh', scenes.sd2CertifyRefresh);

  // ---------- images ----------
  r.get('/images', images.list);
  r.post('/images', images.create);
  r.get('/images/episode/:episode_id/backgrounds', images.episodeBackgrounds);
  r.post('/images/episode/:episode_id/backgrounds/extract', images.episodeBackgroundsExtract);
  r.post('/images/episode/:episode_id/batch', images.episodeBatch);
  r.post('/images/scene/:scene_id', images.scene);
  r.post('/images/upload', images.upload);
  r.get('/images/:id', images.get);
  r.delete('/images/:id', images.delete);

  // ---------- videos ----------
  r.get('/homepage/default-videos', videos.homepageDefaults);
  r.get('/videos', videos.list);
  r.post('/videos/postprocess-quote', videos.postprocessQuote);
  r.post('/videos', videos.create);
  r.post('/videos/image/:image_gen_id', videos.fromImage);
  r.post('/videos/episode/:episode_id/batch', videos.episodeBatch);
  r.get('/videos/:id', videos.get);
  r.delete('/videos/:id', videos.delete);

  // ---------- video-merges ----------
  r.get('/video-merges', videoMerges.list);
  r.post('/video-merges', videoMerges.create);
  r.get('/video-merges/:merge_id', videoMerges.get);
  r.delete('/video-merges/:merge_id', videoMerges.delete);

  // ---------- assets ----------
  r.get('/assets', assets.list);
  r.post('/assets', assets.create);
  r.post('/assets/project-resource-link', assets.linkProjectResource);
  r.get('/asset-resource-links', assets.listResourceLinks);
  r.post('/asset-resource-links/:id/restore', assets.restoreProjectResource);
  r.post('/assets/import/image/:image_gen_id', assets.importImage);
  r.post('/assets/import/video/:video_gen_id', assets.importVideo);
  r.post('/assets/concat', assets.concat);
  r.post('/assets/batch-delete', assets.batchDelete);
  r.post('/assets/sd2-certify/batch', assets.sd2BatchCertify);
  r.post('/assets/:id/trim', assets.trim);
  r.post('/assets/:id/sd2-certify', assets.sd2Certify);
  r.post('/assets/:id/sd2-certify/refresh', assets.sd2CertifyRefresh);
  r.get('/assets/:id/lineage', assets.lineage);
  r.get('/assets/:id', assets.get);
  r.put('/assets/:id', assets.update);
  r.delete('/assets/:id', assets.delete);

  // ---------- storyboards ----------
  r.get('/storyboards/episode/:episode_id/generate', storyboards.episodeStoryboardsGenerate);
  r.put('/storyboards/reorder', storyboards.reorder);
  r.post('/storyboards', storyboards.create);
  r.post('/storyboards/:id/insert-before', storyboards.insertBefore);
  r.get('/storyboards/:id', storyboards.getOne);
  r.put('/storyboards/:id', storyboards.update);
  r.patch('/storyboards/:id/generation-settings', storyboards.storyboardGenerationSettingsUpdate);
  r.delete('/storyboards/:id/generation-settings/overrides', storyboards.storyboardGenerationSettingsClear);
  r.delete('/storyboards/:id', storyboards.delete);
  r.post('/storyboards/:id/props', prop.associateProps);
  r.post('/storyboards/:id/frame-prompt', storyboards.framePrompt);
  r.get('/storyboards/:id/frame-prompts', storyboards.framePromptsGet);
  r.put('/storyboards/:id/frame-prompts/:frame_type', storyboards.framePromptSave);
  r.post('/storyboards/:id/link-tail-frame', tailFrameLink.linkTailFrame);
  r.post('/storyboards/:id/polish-prompt', storyboards.polishPrompt);
  r.post('/storyboards/:id/universal-segment-polish-stream', storyboards.polishUniversalSegmentStream);
  r.post('/storyboards/:id/classic-video-prompt-polish-stream', storyboards.polishClassicVideoPromptStream);
  r.post('/storyboards/:id/universal-segment-prompt-stream', storyboards.generateUniversalSegmentStream);
  r.post('/storyboards/:id/universal-segment-prompt', storyboards.generateUniversalSegmentPrompt);
  r.post('/storyboards/batch-infer-params', storyboards.batchInferParams);
  r.post('/storyboards/:id/upscale', storyboards.upscale);
  r.post('/storyboards/:id/regenerate-layout-description', storyboards.regenerateLayoutDescription);
  r.post('/storyboards/:id/rebuild-video-prompt', storyboards.rebuildVideoPrompt);
  r.post('/storyboards/:id/split-by-audio', storyboards.splitByAudio);

  // ---------- audio ----------
  r.post('/audio/extract', audio.extract);
  r.post('/audio/extract/batch', audio.extractBatch);

  // ---------- settings ----------
  r.get('/settings/language', settings.getLanguage);
  r.put('/settings/language', settings.updateLanguage);
  r.get('/settings/generation', settings.getGenerationSettings);
  r.put('/settings/generation', settings.updateGenerationSettings);

  // ---------- prompt overrides ----------
  r.get('/settings/prompts', promptOverrides.list);
  r.put('/settings/prompts/:key', promptOverrides.update);
  r.delete('/settings/prompts/:key', promptOverrides.reset);

  // ---------- scene model map ----------
  r.get('/scene-model-map', sceneModelMap.list);
  r.post('/scene-model-map', requireAdmin, sceneModelMap.create);
  r.get('/scene-model-map/:key', sceneModelMap.get);
  r.put('/scene-model-map/:key', requireAdmin, sceneModelMap.update);
  r.delete('/scene-model-map/:key', requireAdmin, sceneModelMap.delete);

  // 启动时将已有的覆盖加载到 promptI18n 内存缓存
  try {
    const promptI18n = require('../services/promptI18n');
    const promptOverridesService = require('../services/promptOverridesService');
    const saved = promptOverridesService.listOverrides(db);
    promptI18n.loadOverridesIntoCache(saved);
  } catch (e) {
    console.warn('Failed to load prompt overrides:', e.message);
  }

  return r;
}

module.exports = { setupRouter };
