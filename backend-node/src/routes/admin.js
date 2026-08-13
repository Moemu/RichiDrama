const auth = require('../services/authService');
const billing = require('../services/billingService');
const response = require('../response');

module.exports = function adminRoutes(db) {
  function guarded(fn) { return (req, res) => { try { fn(req, res); } catch (e) { response.badRequest(res, e.message); } }; }
  return {
    users: (_req, res) => response.success(res, billing.listUsers(db)),
    createUser: guarded((req, res) => {
      const user = auth.createUser(db, req.body || {}, req.auth.id);
      billing.audit(db, req.auth.id, 'user.create', 'user', user.id, { username: user.username, role: user.role });
      response.created(res, auth.publicUser(user));
    }),
    updateUser: guarded((req, res) => {
      const user = auth.updateUser(db, Number(req.params.id), req.body || {}); if (!user) return response.notFound(res, '用户不存在');
      billing.audit(db, req.auth.id, 'user.update', 'user', user.id, { role: user.role, is_active: user.is_active }); response.success(res, auth.publicUser(user));
    }),
    adjust: guarded((req, res) => {
      const body = req.body || {};
      const account = body.target_credits !== undefined
        ? billing.setBalance(db, req.auth.id, Number(req.params.id), body.target_credits, body.reason)
        : billing.adjustBalance(db, req.auth.id, Number(req.params.id), body.credits, body.reason);
      response.success(res, billing.publicAccount(account));
    }),
    priceBooks: (_req, res) => response.success(res, billing.listPriceBooks(db)),
    createPriceBook: guarded((req, res) => response.created(res, billing.savePriceBook(db, req.auth.id, req.body || {}))),
    updatePriceBook: guarded((req, res) => response.success(res, billing.savePriceBook(db, req.auth.id, req.body || {}, req.params.id))),
    transactions: (req, res) => response.success(res, billing.pagedTransactions(db, req.query)),
    usage: (req, res) => response.success(res, billing.pagedUsage(db, req.query)),
    reconciliationCases: (req, res) => response.success(res, billing.listReconciliationCases(db, req.query)),
    settleReconciliationCase: guarded((req, res) => response.success(res, billing.settleReconciliationCase(db, req.auth, req.params.id, req.body || {}))),
    waiveReconciliationCase: guarded((req, res) => response.success(res, billing.waiveReconciliationCase(db, req.auth, req.params.id, req.body?.reason))),
    audit: (req, res) => response.success(res, billing.pagedAuditLogs(db, req.query)),
  };
};
