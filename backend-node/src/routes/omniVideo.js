const response = require('../response');
const omniVideoService = require('../services/omniVideoService');
const capabilityService = require('../services/videoModelCapabilities');
const sequenceService = require('../services/omniSequenceService');
module.exports = function routes(db, log) { return {
  list(req, res) { try { response.success(res, omniVideoService.list(db)); } catch (err) { response.internalError(res, err.message); } },
  create(req, res) { try { response.created(res, omniVideoService.create(db, log, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  retry(req, res) { try { response.created(res, omniVideoService.retry(db, log, req.params.id)); } catch (err) { response.badRequest(res, err.message); } },
  get(req, res) { try { const job = omniVideoService.get(db, req.params.id); if (!job) return response.notFound(res, '全能视频任务不存在'); response.success(res, job); } catch (err) { response.internalError(res, err.message); } },
  capabilities(req, res) { response.success(res, capabilityService.list(db)); },
  listSequences(req, res) { try { response.success(res, sequenceService.list(db)); } catch (err) { response.internalError(res, err.message); } },
  defaultSequence(req, res) { try { response.success(res, sequenceService.ensureDefault(db)); } catch (err) { response.internalError(res, err.message); } },
  getSequence(req, res) { try { const sequence = sequenceService.get(db, req.params.id); if (!sequence) return response.notFound(res, '全能创作项目不存在'); response.success(res, sequence); } catch (err) { response.internalError(res, err.message); } },
  createSequence(req, res) { try { response.created(res, sequenceService.createSequence(db, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  updateSequence(req, res) { try { response.success(res, sequenceService.updateSequence(db, req.params.id, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  addShot(req, res) { try { response.created(res, sequenceService.createShot(db, req.params.id, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  updateShot(req, res) { try { response.success(res, sequenceService.updateShot(db, req.params.id, req.params.shotId, req.body || {})); } catch (err) { response.badRequest(res, err.message); } },
  deleteShot(req, res) { try { sequenceService.deleteShot(db, req.params.id, req.params.shotId); response.success(res, { ok: true }); } catch (err) { response.badRequest(res, err.message); } },
  reorderShots(req, res) { try { response.success(res, sequenceService.reorder(db, req.params.id, req.body?.shot_ids)); } catch (err) { response.badRequest(res, err.message); } },
}; };
