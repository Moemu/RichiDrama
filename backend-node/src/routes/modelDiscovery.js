const discovery = require('../services/modelDiscoveryService');
const response = require('../response');
const ai = require('../services/aiConfigService');

module.exports = function modelDiscoveryRoutes(db, log, cfg) {
  return {
    connections(req, res) { response.success(res, discovery.listConnections(db)); },
    async discover(req, res) {
      try { response.success(res, await discovery.discover(db, req.auth.id, req.params.id, req.body)); }
      catch (error) { response.badRequest(res, error.message); }
    },
    import(req, res) {
      if (ai.getVendorLockStatus(cfg).enabled) return response.badRequest(res, '当前为厂商锁定模式，不允许导入模型');
      try { response.success(res, discovery.importModels(db, req.auth.id, req.params.id, req.body || {}, log)); }
      catch (error) { response.badRequest(res, error.message); }
    },
  };
};
