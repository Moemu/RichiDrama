const auth = require('../services/authService');
const billing = require('../services/billingService');
const operations = require('../services/adminOperationsService');
const response = require('../response');

module.exports = function adminRoutes(db, log = console) {
  function guarded(fn) { return (req, res) => { try { fn(req, res); } catch (e) { response.badRequest(res, e.message); } }; }
  function guardedAsync(fn) { return async (req, res) => { try { await fn(req, res); } catch (e) { response.badRequest(res, e.message); } }; }
  function confirmed(req) {
    const body = req.body || {};
    if (body.confirm !== true || !String(body.reason || '').trim() || !String(body.idempotency_key || '').trim()) {
      throw new Error('高影响处置必须确认、填写原因并携带幂等键');
    }
    return body;
  }
  function productionItem(id) {
    const item = operations.productionDetail(db, id);
    if (!item) throw new Error('生产任务不存在');
    return item;
  }
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
    balanceAdjustment: guarded((req, res) => {
      const body = req.body || {};
      const account = billing.adjustBalance(db, req.auth.id, Number(req.params.id), body.amount_credits, body.reason, {
        operation: body.operation, idempotency_key: body.idempotency_key,
      });
      response.success(res, billing.publicAccount(account));
    }),
    balanceCorrection: guarded((req, res) => {
      const body = req.body || {};
      response.success(res, billing.publicAccount(billing.setBalance(db, req.auth.id, Number(req.params.id), body.target_credits, body.reason, {
        idempotency_key: body.idempotency_key,
      })));
    }),
    priceBooks: (_req, res) => response.success(res, billing.listPriceBooks(db)),
    createPriceBook: guarded((req, res) => response.created(res, billing.savePriceBook(db, req.auth.id, req.body || {}))),
    updatePriceBook: guarded((req, res) => response.success(res, billing.savePriceBook(db, req.auth.id, req.body || {}, req.params.id))),
    transactions: (req, res) => response.success(res, billing.pagedTransactions(db, req.query)),
    usage: (req, res) => response.success(res, billing.pagedUsage(db, req.query)),
    reconciliationCases: (req, res) => response.success(res, billing.pagedReconciliationCases(db, req.query)),
    overview: (req, res) => response.success(res, operations.overview(db, req.query)),
    alertSettings: (_req, res) => response.success(res, operations.alertSettings(db)),
    saveAlertSettings: guarded((req, res) => response.success(res, operations.saveAlertSettings(db, req.body || {}))),
    productionExport: (req, res) => {
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="production-${stamp}.csv"`);
      res.send(operations.productionCsv(db, req.query));
    },
    reports: (req, res) => response.success(res, require('../services/operationsReportService').listReports(db, req.query)),
    production: (req, res) => response.success(res, operations.listProduction(db, req.query)),
    productionDetail: (req, res) => {
      const item = operations.productionDetail(db, req.params.id);
      if (!item) return response.notFound(res, '生产任务不存在');
      response.success(res, item);
    },
    mediaArchives: (req, res) => response.success(res, operations.listArchives(db, req.query)),
    retryPostprocess: guardedAsync(async (req, res) => {
      const body = confirmed(req); const item = productionItem(req.params.id);
      if (!item.omni_job_id) throw new Error('该历史视频没有 Omni 工作台关联，不能从运营台发起阶段重试');
      const job = require('../services/omniVideoService').retryPostprocess(db, log, item.omni_job_id, req.auth, body.stage);
      billing.audit(db, req.auth.id, 'admin.production.retry_postprocess', 'video_generation', item.id, { stage: body.stage, reason: body.reason, idempotency_key: body.idempotency_key });
      response.success(res, job);
    }),
    adoptSource: guardedAsync(async (req, res) => {
      const body = confirmed(req); const item = productionItem(req.params.id);
      if (!item.omni_job_id) throw new Error('该历史视频没有 Omni 工作台关联，不能从运营台采用原片');
      const job = require('../services/omniVideoService').adoptSourceVideo(db, log, item.omni_job_id, req.auth);
      billing.audit(db, req.auth.id, 'admin.production.adopt_source', 'video_generation', item.id, { reason: body.reason, idempotency_key: body.idempotency_key });
      response.success(res, job);
    }),
    retryArchive: guardedAsync(async (req, res) => {
      const body = confirmed(req); const item = productionItem(req.params.id);
      const result = await require('../services/videoService').archiveCompletedVideo(db, log, item.id);
      billing.audit(db, req.auth.id, 'admin.production.retry_archive', 'video_generation', item.id, { reason: body.reason, idempotency_key: body.idempotency_key });
      response.success(res, result);
    }),
    collectSettlementSupplement: guarded((req, res) => response.success(res, billing.collectSettlementSupplement(db, req.auth, req.params.id, req.body?.reason))),
    collectHistoricalSettlementSupplements: guarded((req, res) => response.success(res, billing.collectHistoricalSettlementSupplements(db, req.auth, req.body || {}))),
    settleReconciliationCase: guarded((req, res) => response.success(res, billing.settleReconciliationCase(db, req.auth, req.params.id, req.body || {}))),
    waiveReconciliationCase: guarded((req, res) => response.success(res, billing.waiveReconciliationCase(db, req.auth, req.params.id, req.body?.reason))),
    audit: (req, res) => response.success(res, billing.pagedAuditLogs(db, req.query)),
  };
};
