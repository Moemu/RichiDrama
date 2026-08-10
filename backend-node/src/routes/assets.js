const response = require('../response');
const assetService = require('../services/assetService');

function routes(db, log, cfg) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query, owner_user_id: req.auth.role === 'admin' ? undefined : req.auth.id };
        // Backfill legacy projects on their first material-pool read. New
        // entity writes are synchronized in their services, so this only
        // migrates existing character/scene/prop images once.
        if (query.drama_id) require('../services/assetMappingService').syncDramaAssets(db, log, query.drama_id);
        const { items, total, page, pageSize } = assetService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('assets list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const body = req.body || {};
        if (req.auth.role !== 'admin' && body.drama_id && !db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(body.drama_id), req.auth.id)) return response.notFound(res, '项目不存在');
        const item = assetService.create(db, log, { ...body, owner_user_id: req.auth.id });
        response.created(res, item);
      } catch (err) {
        log.error('assets create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = assetService.getById(db, req.params.id);
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        log.error('assets get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    lineage: (req, res) => {
      try {
        const lineage = assetService.getLineage(db, req.params.id);
        if (!lineage) return response.notFound(res, '资源不存在');
        response.success(res, lineage);
      } catch (err) {
        log.error('assets lineage', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    update: (req, res) => {
      try {
        const item = assetService.update(db, log, req.params.id, req.body || {});
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        log.error('assets update', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = assetService.deleteById(db, log, req.params.id);
        if (!ok) return response.notFound(res, '资源不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('assets delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    importImage: (req, res) => {
      try {
        const item = assetService.importFromImage(db, log, req.params.image_gen_id);
        if (!item) return response.notFound(res, '图片生成记录不存在');
        response.created(res, item);
      } catch (err) {
        log.error('assets import image', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    importVideo: (req, res) => {
      try {
        const item = assetService.importFromVideo(db, log, req.params.video_gen_id);
        if (!item) return response.notFound(res, '视频生成记录不存在');
        response.created(res, item);
      } catch (err) {
        log.error('assets import video', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    trim: (req, res) => {
      try {
        const source = assetService.getById(db, req.params.id);
        if (!source) return response.notFound(res, '资源不存在');
        const item = require('../services/omniMediaProcessService').trimVideoAsset(db, log, source, req.body || {});
        response.created(res, item);
      } catch (err) {
        log.error('assets trim', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    concat: (req, res) => {
      try {
        const ids = Array.isArray(req.body?.asset_ids) ? req.body.asset_ids.map(Number).filter((id) => id > 0) : [];
        if (ids.length < 2) return response.badRequest(res, '请至少选择两段视频进行拼接');
        const sources = ids.map((id) => assetService.getById(db, id));
        if (sources.some((item) => !item)) return response.badRequest(res, '所选素材中包含不存在或已删除的项目');
        const item = require('../services/omniMediaProcessService').concatVideoAssets(db, log, sources);
        response.created(res, item);
      } catch (err) {
        log.error('assets concat', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    sd2Certify: async (req, res) => {
      try { const out = await require('../services/assetSd2Service').certify(db, log, cfg, req.params.id); if (!out.ok) return response.badRequest(res, out.error); response.success(res, out); }
      catch (err) { log.error('assets sd2-certify', { error: err.message }); response.internalError(res, err.message); }
    },
    sd2CertifyRefresh: async (req, res) => {
      try { const out = await require('../services/assetSd2Service').refresh(db, log, cfg, req.params.id); if (!out.ok) return response.badRequest(res, out.error); response.success(res, out); }
      catch (err) { log.error('assets sd2-certify-refresh', { error: err.message }); response.internalError(res, err.message); }
    },
  };
}

module.exports = routes;
