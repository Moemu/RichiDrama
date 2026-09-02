const auth = require('../services/authService');
const billing = require('../services/billingService');
const operations = require('../services/adminOperationsService');
const tenants = require('../services/tenantService');
const customerOrganizations = require('../services/customerOrganizationService');
const providerPrices = require('../services/providerPriceService');
const richbestRebind = require('../services/richbestAssetRebindService');
const response = require('../response');

module.exports = function adminRoutes(db, log = console, cfg = {}) {
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
      const tenantId = Number(req.body?.tenant_id);
      // 未显式指定分组时，createUser 已自动加入新用户默认分组。
      if (Number.isSafeInteger(tenantId) && tenantId > 0) tenants.setMember(db, tenantId, user.id, req.body?.tenant_role);
      billing.audit(db, req.auth.id, 'user.create', 'user', user.id, { username: user.username, role: user.role, account_kind: user.account_kind || 'creator', tenant_id: tenantId || null });
      response.created(res, auth.publicUser(user));
    }),
    updateUser: guarded((req, res) => {
      const user = auth.updateUser(db, Number(req.params.id), req.body || {}); if (!user) return response.notFound(res, '用户不存在');
      billing.audit(db, req.auth.id, 'user.update', 'user', user.id, { role: user.role, account_kind: user.account_kind || 'creator', is_active: user.is_active }); response.success(res, auth.publicUser(user));
    }),
    tenants: (_req, res) => response.success(res, tenants.listTenants(db)),
    tenant: (req, res) => {
      const tenant = tenants.tenantDetail(db, Number(req.params.id));
      return tenant ? response.success(res, tenant) : response.notFound(res, '分组不存在');
    },
    createTenant: guarded((req, res) => {
      const tenant = tenants.writeTenant(db, req.auth.id, req.body || {});
      billing.audit(db, req.auth.id, 'tenant.create', 'tenant', tenant.id, { name: tenant.name });
      response.created(res, tenant);
    }),
    updateTenant: guarded((req, res) => {
      const tenant = tenants.writeTenant(db, req.auth.id, req.body || {}, Number(req.params.id));
      if (!tenant) return response.notFound(res, '分组不存在');
      billing.audit(db, req.auth.id, 'tenant.update', 'tenant', tenant.id, { name: tenant.name, status: tenant.status });
      response.success(res, tenant);
    }),
    setTenantMember: guarded((req, res) => {
      const tenant = tenants.setMember(db, Number(req.params.id), Number(req.params.userId), req.body?.role);
      billing.audit(db, req.auth.id, 'tenant.member.set', 'tenant', tenant.id, { user_id: Number(req.params.userId), role: req.body?.role || 'creator' });
      response.success(res, tenant);
    }),
    replaceTenantBindings: guarded((req, res) => {
      const tenant = tenants.replaceBindings(db, Number(req.params.id), req.body || {});
      billing.audit(db, req.auth.id, 'tenant.bindings.replace', 'tenant', tenant.id, { ai_config_ids: req.body?.ai_config_ids || [], sd2_config_ids: req.body?.sd2_config_ids || [], price_book_id: req.body?.price_book_id || null });
      response.success(res, tenant);
    }),
    customerOrganizations: (_req, res) => response.success(res, customerOrganizations.listOrganizations(db).map((item) => ({ ...item, ...billing.publicAccount({ ...item, organization_id: item.id, account_scope: 'organization', account_name: item.name }) }))),
    customerOrganization: (req, res) => {
      const organization = customerOrganizations.organizationDetail(db, Number(req.params.id));
      return organization ? response.success(res, { ...organization, account: billing.publicAccount({ ...organization.account, organization_id: organization.id, account_scope: 'organization', account_name: organization.name }) }) : response.notFound(res, '客户账户不存在');
    },
    createCustomerOrganization: guarded((req, res) => {
      const organization = customerOrganizations.saveOrganization(db, req.auth.id, req.body || {});
      billing.audit(db, req.auth.id, 'customer_organization.create', 'customer_organization', organization.id, { name: organization.name, config_tenant_id: organization.config_tenant_id });
      response.created(res, organization);
    }),
    updateCustomerOrganization: guarded((req, res) => {
      const organization = customerOrganizations.saveOrganization(db, req.auth.id, req.body || {}, Number(req.params.id));
      if (!organization) return response.notFound(res, '客户账户不存在');
      billing.audit(db, req.auth.id, 'customer_organization.update', 'customer_organization', organization.id, { name: organization.name, status: organization.status, config_tenant_id: organization.config_tenant_id });
      response.success(res, organization);
    }),
    replaceCustomerOrganizationMembers: guarded((req, res) => {
      const organization = customerOrganizations.replaceMembers(db, Number(req.params.id), req.body?.members || []);
      billing.audit(db, req.auth.id, 'customer_organization.members.replace', 'customer_organization', organization.id, { member_ids: organization.members.map((item) => item.id) });
      response.success(res, organization);
    }),
    adjustCustomerOrganizationBalance: guarded((req, res) => {
      const body = req.body || {};
      const result = billing.adjustOrganizationBalance(db, req.auth.id, Number(req.params.id), body.amount_credits, body.reason, { operation: body.operation, idempotency_key: body.idempotency_key });
      response.success(res, billing.publicAccount({ ...result, organization_id: Number(req.params.id), account_scope: 'organization' }));
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
    providerPriceProbe: guardedAsync(async (req, res) => response.success(res, await providerPrices.probe(db, req.auth.id, { billPeriod: req.body?.bill_period }))),
    providerPriceProbeStatus: (_req, res) => response.success(res, providerPrices.sourceCheck(db)),
    providerPriceSync: guardedAsync(async (req, res) => response.success(res, await providerPrices.sync(db, req.auth.id, { triggerType: 'manual' }))),
    providerPriceSyncs: (req, res) => response.success(res, providerPrices.listSyncs(db, req.query?.limit)),
    providerPriceSyncDetail: (req, res) => {
      const item = providerPrices.syncView(db, req.params.id);
      return item ? response.success(res, item) : response.notFound(res, '同步批次不存在');
    },
    updateProviderPriceCandidate: guarded((req, res) => response.success(res, providerPrices.updateCandidate(db, req.auth.id, req.params.id, Number(req.params.candidateId), req.body || {}))),
    createProviderPriceDraft: guarded((req, res) => response.created(res, providerPrices.createDraft(db, req.auth.id, req.params.id))),
    publishPriceBook: guarded((req, res) => response.success(res, providerPrices.publish(db, req.auth.id, Number(req.params.id), confirmed(req)))),
    rollbackPriceBook: guarded((req, res) => response.success(res, providerPrices.rollback(db, req.auth.id, Number(req.params.id), confirmed(req)))),
    notices: (req, res) => response.success(res, providerPrices.listNotices(db, req.query?.limit)),
    archiveNotice: guarded((req, res) => response.success(res, providerPrices.archiveNotice(db, req.auth.id, req.params.id))),
    transactions: (req, res) => response.success(res, billing.pagedTransactions(db, req.query)),
    usage: (req, res) => response.success(res, billing.pagedUsage(db, req.query)),
    usageSummary: (req, res) => response.success(res, billing.usageSummary(db, req.query)),
    projectUsage: (req, res) => response.success(res, billing.projectUsage(db, req.query)),
    projectUsageDetail: (req, res) => {
      const result = billing.projectUsageDetail(db, req.params.dramaId, req.query);
      return result ? response.success(res, result) : response.notFound(res, '项目不存在');
    },
    projectUsageSection: (section) => (req, res) => {
      const result = billing.projectUsageSection(db, req.params.dramaId, req.query, section);
      return result ? response.success(res, result) : response.notFound(res, '项目不存在');
    },
    unassignedProjectUsage: (req, res) => response.success(res, billing.unassignedProjectUsage(db, req.query)),
    backfillProjectUsage: guarded((req, res) => {
      const body = confirmed(req);
      const result = billing.backfillProjectSnapshots(db, req.auth.id, body.idempotency_key);
      response.success(res, { ...result, reason: body.reason });
    }),
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
    richbestRebindCandidates: guarded((req, res) => response.success(res, richbestRebind.listCandidates(db, req.query))),
    richbestRebindRun: (req, res) => {
      const run = richbestRebind.view(db, req.params.id);
      return run ? response.success(res, run) : response.notFound(res, '重绑任务不存在');
    },
    createRichbestRebind: guarded((req, res) => {
      const body = confirmed(req);
      const run = richbestRebind.create(db, req.auth.id, body);
      billing.audit(db, req.auth.id, 'admin.richbest_asset.rebind', 'richbest_asset_rebind', run.id, {
        cutoff_at: run.cutoff_at,
        binding_ids: run.items.map((item) => item.binding_id),
        reason: body.reason,
        reused: !!run.reused,
      });
      richbestRebind.dispatch(db, log, cfg, run.id);
      response.created(res, run);
    }),
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
