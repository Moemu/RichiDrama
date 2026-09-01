const billing = require('../services/billingService');
const response = require('../response');

module.exports = function billingRoutes(db) {
  function scopedQuery(req) {
    const organizations = require('../services/customerOrganizationService');
    const membership = organizations.membershipForUser(db, req.auth.id);
    const query = { ...(req.query || {}) };
    if (req.auth.role === 'admin' && query.user_id) return { ...query, user_id: Number(query.user_id) };
    delete query.organization_id;
    if (membership?.membership_role === 'organization_admin') {
      return { ...query, organization_id: membership.id };
    }
    return { ...query, user_id: req.auth.id };
  }

  return {
    me: (req, res) => { try { response.success(res, billing.publicAccount(billing.payerAccount(db, req.auth.id))); } catch (e) { response.badRequest(res, e.message); } },
    usage: (req, res) => response.success(res, billing.pagedUsage(db, scopedQuery(req))),
    usageMembers: (req, res) => {
      const organizations = require('../services/customerOrganizationService');
      const membership = organizations.membershipForUser(db, req.auth.id);
      if (membership?.membership_role !== 'organization_admin') return response.forbidden(res, '仅客户管理员可以查看消费成员');
      return response.success(res, organizations.usageMembers(db, membership.id));
    },
    transactions: (req, res) => response.success(res, billing.pagedTransactions(db, scopedQuery(req))),
    quote: (req, res) => { try { response.success(res, billing.quote(db, req.auth, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    resourceImageQuote: (req, res) => {
      try { response.success(res, require('../services/imageBillingService').quoteResourceImages(db, req.auth, req.body || {})); }
      catch (e) { response.badRequest(res, e.message); }
    },
    authorize: (req, res) => { try { response.created(res, billing.createAuthorization(db, req.auth, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    settle: (req, res) => { try { response.success(res, billing.settleAuthorization(db, req.auth, req.params.id, req.body || {})); } catch (e) { response.badRequest(res, e.message); } },
    void: (req, res) => { try { response.success(res, billing.voidAuthorization(db, req.auth, req.params.id, req.body?.reason)); } catch (e) { response.badRequest(res, e.message); } },
  };
};
