const response = require('../response');
const jobs = require('../services/viralEditJobService');

module.exports = (db, log, cfg) => ({
  quote: async (req, res) => {
    try { response.success(res, await jobs.quote(db, cfg, req.auth.id, req.body || {})); }
    catch (error) { response.badRequest(res, error.message); }
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
    return job ? response.success(res, job) : response.notFound(res, '投流剪辑任务不存在');
  },
  saveAsset: async (req, res) => {
    try {
      response.success(res, await jobs.saveOutputAsAsset(db, log, cfg, req.auth.id, req.params.id, Number(req.params.clipIndex)));
    } catch (error) { response.badRequest(res, error.message); }
  },
});
