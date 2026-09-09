'use strict';
const express = require('express');
const response = require('../response');
const prices = require('../services/costPriceService');
const ledger = require('../services/costLedgerService');
const query = require('../services/costQueryService');
const backfill = require('../services/costBackfillService');
const reprice = require('../services/costRepriceService');
const activity = require('../services/costActivityService');

module.exports = function costRoutes(db) {
  const router = express.Router();
  const handle = fn => (req, res) => { try { const result = fn(req, res); if (!res.headersSent) response.success(res, result); } catch (error) { response.badRequest(res, error.message); } };
  router.get('/activity', handle(req => activity.activity(db, req.query)));
  router.get('/activity/:id', handle(req => activity.detail(db, req.params.id)));
  router.get('/summary', handle(req => query.summary(db, req.query)));
  router.post('/reprices/preview', handle(req => reprice.preview(db, req.auth.id, req.body)));
  router.get('/reprices/:id', handle(req => reprice.get(db, req.params.id)));
  router.post('/reprices/:id/execute', handle(req => {
    if (req.body.confirm !== true) throw new Error('请先检查批量估算预览并确认');
    return reprice.execute(db, req.auth.id, req.params.id, req.body.reason);
  }));
  router.get('/breakdown', handle(req => query.breakdown(db, req.query)));
  router.get('/calls', handle(req => query.calls(db, req.query)));
  router.get('/calls/:id', handle(req => ledger.get(db, req.params.id)));
  router.post('/calls/:id/reprice', handle(req => ledger.reprice(db, req.auth.id, req.params.id, req.body.reason)));
  router.get('/accounts', handle(() => ({ items: db.prepare('SELECT * FROM cost_accounts ORDER BY id').all(), bindings: db.prepare('SELECT * FROM cost_account_bindings').all(), configs: db.prepare('SELECT id,name,provider,service_type,provider_connection_id FROM ai_service_configs').all() })));
  router.post('/accounts', handle(req => {
    const { name, provider } = req.body;
    if (!name?.trim() || !provider?.trim()) throw new Error('账号名称和供应商不能为空');
    const id = db.prepare('INSERT INTO cost_accounts(name,provider,created_at,created_by) VALUES(?,?,?,?)').run(name.trim(), provider.trim(), new Date().toISOString(), req.auth.id).lastInsertRowid;
    return db.prepare('SELECT * FROM cost_accounts WHERE id=?').get(id);
  }));
  router.put('/accounts/:id/bindings/:configId', handle(req => {
    if (!db.prepare('SELECT 1 FROM cost_accounts WHERE id=?').get(req.params.id) || !db.prepare('SELECT 1 FROM ai_service_configs WHERE id=?').get(req.params.configId)) throw new Error('账号或配置不存在');
    db.prepare('INSERT INTO cost_account_bindings VALUES(?,?,?) ON CONFLICT(config_id) DO UPDATE SET account_id=excluded.account_id,updated_at=excluded.updated_at').run(req.params.configId, req.params.id, new Date().toISOString());
    require('../services/billingService').audit(db, req.auth.id, 'cost.account.bind', 'ai_config', req.params.configId, { account_id: Number(req.params.id) });
    return { updated: true };
  }));
  router.get('/prices', handle(req => {
    const rows = db.prepare('SELECT id FROM cost_prices WHERE (? IS NULL OR account_id=?) ORDER BY id DESC LIMIT 100').all(req.query.account_id || null, req.query.account_id || null);
    return rows.map(row => prices.get(db, row.id));
  }));
  router.post('/price-sources/fetch', async (req, res) => {
    try { response.success(res, await require('../services/costPriceSourceService').fetchCandidates(db, req.auth.id, req.body)); }
    catch (error) { response.badRequest(res, error.publicMessage || error.message); }
  });
  router.get('/price-sources', handle(() => db.prepare('SELECT id,account_id,config_id,fetched_at FROM cost_price_sources ORDER BY fetched_at DESC LIMIT 100').all()));
  router.get('/price-sources/:id', handle(req => require('../services/costPriceSourceService').get(db, req.params.id)));
  router.post('/prices', handle(req => prices.saveDraft(db, req.auth.id, req.body)));
  router.post('/prices/:id/publish', handle(req => {
    if (req.body.confirm !== true) throw new Error('请审核账号、币种、计量、规格和生效时间后确认发布');
    return prices.publish(db, req.auth.id, req.params.id);
  }));
  router.get('/reports', handle(req => db.prepare('SELECT id,organization_id,month,version,generated_at FROM cost_reports WHERE (? IS NULL OR organization_id=?) ORDER BY generated_at DESC LIMIT 100').all(req.query.organization_id || null, req.query.organization_id || null)));
  router.post('/reports', handle(req => req.body.basis === 'billing_activity_v1'
    ? activity.createReport(db, req.auth.id, req.body) : query.createReport(db, req.auth.id, req.body)));
  router.get('/reports/:id', handle(req => query.report(db, req.params.id)));
  router.get('/reports/:id/export', handle((req, res) => {
    if (!query.report(db, req.params.id)) throw new Error('月报不存在');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cost-report-${req.params.id.replace(/[^a-zA-Z0-9-]/g, '')}.csv"`);
    res.flushHeaders();
    const stream = require('node:stream').Readable.from(query.reportCsvChunks(db, req.params.id, req.query.detail === 'true'));
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }));
  router.get('/backfills', handle(() => db.prepare('SELECT id,created_at,status,executed_at FROM cost_backfill_batches ORDER BY created_at DESC LIMIT 100').all()));
  router.post('/backfills/preview', handle(req => backfill.preview(db, req.auth.id, req.body)));
  router.get('/backfills/:id', handle(req => backfill.get(db, req.params.id)));
  router.post('/backfills/:id/execute', handle(req => {
    if (req.body.confirm !== true) throw new Error('请先查看预览并确认执行');
    return backfill.execute(db, req.auth.id, req.params.id);
  }));
  return router;
};
