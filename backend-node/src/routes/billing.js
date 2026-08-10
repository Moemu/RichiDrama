const billing = require('../services/billingService');
const response = require('../response');

module.exports = function billingRoutes(db) {
  return {
    me: (req, res) => response.success(res, billing.publicAccount(billing.account(db, req.auth.id))),
    usage: (req, res) => response.success(res, billing.listUsage(db, { user_id: req.auth.role === 'admin' && req.query.user_id ? req.query.user_id : req.auth.id })),
    transactions: (req, res) => response.success(res, billing.listTransactions(db, { user_id: req.auth.role === 'admin' && req.query.user_id ? req.query.user_id : req.auth.id })),
    quote: (req, res) => { try { response.success(res, billing.quote(db, req.auth, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    authorize: (req, res) => { try { response.created(res, billing.createAuthorization(db, req.auth, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    settle: (req, res) => { try { response.success(res, billing.settleAuthorization(db, req.auth, req.params.id, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    void: (req, res) => { try { response.success(res, billing.voidAuthorization(db, req.auth, req.params.id, req.body?.reason)); } catch (e) { response.badRequest(res, e.message); } },
  };
};
