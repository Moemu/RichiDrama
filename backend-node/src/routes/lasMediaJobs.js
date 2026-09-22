const response = require('../response');
const jobs = require('../services/lasMediaJobService');

module.exports = (db, log, cfg) => ({
  capabilities: (_req, res) => {
    let ready = true;
    try {
      const las = require('../services/lasOperatorClient').configuration();
      const tos = require('../services/lasTosBridge').configuration();
      ready = las.region === tos.region && las.bucket === tos.bucket;
    } catch (_) { ready = false; }
    response.success(res, { ready, region: String(process.env.LAS_REGION || 'cn-beijing') });
  },
  create: async (req, res) => {
    try { response.created(res, await jobs.create(db, log, cfg, req.auth.id, req.body || {})); }
    catch (error) { response.badRequest(res, error.message); }
  },
  list: (req, res) => {
    try {
      const dramaId = Number(req.query.drama_id);
      if (!Number.isInteger(dramaId) || dramaId <= 0 || !require('../services/projectAccessService').access(db, dramaId, req.auth.id)) return response.notFound(res, '项目不存在');
      response.success(res, jobs.list(db, req.auth.id, dramaId));
    } catch (error) { response.badRequest(res, error.message); }
  },
  get: (req, res) => {
    const job = jobs.get(db, req.auth.id, req.params.id);
    return job ? response.success(res, job) : response.notFound(res, 'LAS 任务不存在');
  },
});
