const response = require('../response');
const assetService = require('../services/assetService');

function routes(db, log, cfg) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query };
        const { items, total, page, pageSize } = assetService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('assets list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      try {
        const item = assetService.create(db, log, req.body || {});
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
        if (!lineage) return response.notFound(res, '璧勬簮涓嶅瓨鍦?);
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
