const response = require('../response');
const assetService = require('../services/assetService');

function routes(db, log, cfg) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query, owner_user_id: req.auth.id };
        if (String(query.scope || '').toLowerCase() === 'project') {
          const dramaId = Number(query.drama_id);
          if (!Number.isInteger(dramaId) || dramaId <= 0 || !db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(dramaId, req.auth.id)) {
            return response.notFound(res, '项目不存在');
          }
        }
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
        if (body.drama_id && !db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(body.drama_id), req.auth.id)) return response.notFound(res, '项目不存在');
        const item = assetService.create(db, log, { ...body, owner_user_id: req.auth.id });
        response.created(res, item);
      } catch (err) {
        log.error('assets create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    linkProjectResource: (req, res) => {
      try {
        const dramaId = Number(req.body?.drama_id);
        const resourceType = String(req.body?.resource_type || '').trim();
        const resourceId = Number(req.body?.resource_id);
        if (!Number.isInteger(dramaId) || dramaId <= 0 || !Number.isInteger(resourceId) || resourceId <= 0) return response.badRequest(res, '请提供有效的项目与资源 ID');
        if (!db.prepare('SELECT 1 FROM dramas WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(dramaId, req.auth.id)) return response.notFound(res, '项目不存在');
        const linked = require('../services/assetMappingService').linkProjectResource(db, log, dramaId, resourceType, resourceId);
        if (linked.status === 'not_found') return response.notFound(res, '项目资源不存在');
        if (linked.status === 'detached') return response.error(res, 409, 'RESOURCE_DETACHED', '该资源已从素材库解除关联；分镜引用不会自动恢复。');
        response.success(res, linked.asset);
      } catch (err) {
        log.error('assets link project resource', { error: err.message });
        response.badRequest(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = assetService.getByIdForOwner(db, req.params.id, req.auth.id);
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
        const item = assetService.update(db, log, req.params.id, req.body || {}, req.auth.id);
        if (!item) return response.notFound(res, '资源不存在');
        response.success(res, item);
      } catch (err) {
        log.error('assets update', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const current = assetService.getByIdForOwner(db, req.params.id, req.auth.id);
        if (current?.source_type === 'project_resource') {
          const detached = require('../services/assetMappingService').detachProjectResource(db, current.id, req.auth.id);
          if (!detached) return response.notFound(res, '资源关联不存在');
          return response.success(res, { message: '已解除项目资源关联，历史分镜引用保持不变', detached: true });
        }
        const ok = assetService.deleteById(db, log, req.params.id, req.auth.id);
        if (!ok) return response.notFound(res, '资源不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('assets delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    restoreProjectResource: (req, res) => {
      try {
        const item = require('../services/assetMappingService').restoreProjectResource(db, log, req.params.id, req.auth.id);
        if (!item) return response.notFound(res, '资源关联不存在');
        response.success(res, item);
      } catch (err) { response.badRequest(res, err.message); }
    },
    listResourceLinks: (req, res) => {
      try {
        const dramaId = req.query?.drama_id == null ? null : Number(req.query.drama_id);
        if (dramaId != null && (!Number.isInteger(dramaId) || !db.prepare('SELECT 1 FROM dramas WHERE id=? AND owner_user_id=? AND deleted_at IS NULL').get(dramaId, req.auth.id))) {
          return response.notFound(res, '项目不存在');
        }
        const items = require('../services/assetMappingService').listResourceLinks(db, req.auth.id, dramaId, req.query?.status);
        response.success(res, items);
      } catch (err) { response.badRequest(res, err.message); }
    },
    batchDelete: (req, res) => {
      try {
        const body = req.body || {};
        const ids = Array.isArray(body.ids) ? body.ids : [];
        // all_matching is deliberately explicit so an empty selected list can
        // never erase a library by accident.
        if (!ids.length && body.all_matching !== true) return response.badRequest(res, '请至少选择一个素材，或明确指定清空素材库');
        const count = assetService.deleteMany(db, log, {
          ids,
          owner_user_id: req.auth.id,
          ...(body.all_matching === true ? {
            type: body.type,
            keyword: body.keyword,
            favorite: body.favorite,
          } : {}),
        });
        response.success(res, { count, message: count ? `已删除 ${count} 个素材` : '没有可删除的素材' });
      } catch (err) {
        log.error('assets batch delete', { error: err.message });
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
      try {
        if (!assetService.getByIdForOwner(db, req.params.id, req.auth.id)) return response.notFound(res, '素材不存在');
        const out = await require('../services/assetSd2Service').certify(db, log, cfg, req.params.id, req.auth.id); if (!out.ok) return response.badRequest(res, out.error); response.success(res, out);
      }
      catch (err) { log.error('assets sd2-certify', { error: err.message }); response.internalError(res, err.message); }
    },
    sd2BatchCertify: (req, res) => {
      try {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        if (!ids.length) return response.badRequest(res, '请至少选择一张图片素材');
        const out = require('../services/assetSd2Service').queueBatchCertification(db, log, cfg, req.auth.id, ids);
        response.success(res, { ...out, message: `已排队 ${out.queued} 张真人素材认证，将自动完成` });
      } catch (err) { log.error('assets sd2 batch certify', { error: err.message }); response.internalError(res, err.message); }
    },
    sd2CertifyRefresh: async (req, res) => {
      try { const out = await require('../services/assetSd2Service').refresh(db, log, cfg, req.params.id, req.auth.id); if (!out.ok) return response.badRequest(res, out.error); response.success(res, out); }
      catch (err) { log.error('assets sd2-certify-refresh', { error: err.message }); response.internalError(res, err.message); }
    },
  };
}

module.exports = routes;
