const billing = require('../services/billingService');
const response = require('../response');

module.exports = function billingRoutes(db) {
  return {
    me: (req, res) => { try { response.success(res, billing.publicAccount(billing.payerAccount(db, req.auth.id))); } catch (e) { response.badRequest(res, e.message); } },
    usage: (req, res) => {
      const organization = require('../services/customerOrganizationService').membershipForUser(db, req.auth.id);
      const scope = req.auth.role === 'admin' && req.query.user_id ? { user_id: req.query.user_id } : organization ? { organization_id: organization.id } : { user_id: req.auth.id };
      response.success(res, billing.pagedUsage(db, { ...req.query, ...scope }));
    },
    transactions: (req, res) => {
      const organization = require('../services/customerOrganizationService').membershipForUser(db, req.auth.id);
      const scope = req.auth.role === 'admin' && req.query.user_id ? { user_id: req.query.user_id } : organization ? { organization_id: organization.id } : { user_id: req.auth.id };
      response.success(res, billing.pagedTransactions(db, { ...req.query, ...scope }));
    },
    quote: (req, res) => { try { response.success(res, billing.quote(db, req.auth, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    authorize: (req, res) => { try { response.created(res, billing.createAuthorization(db, req.auth, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    settle: (req, res) => { try { response.success(res, billing.settleAuthorization(db, req.auth, req.params.id, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    void: (req, res) => { try { response.success(res, billing.voidAuthorization(db, req.auth, req.params.id, req.body?.reason)); } catch (e) { response.badRequest(res, e.message); } },
  };
};
