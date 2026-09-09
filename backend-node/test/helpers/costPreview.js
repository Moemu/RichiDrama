// Isolated UI acceptance server. No recovery workers or supplier credentials.
const { modelCatalogFixture } = require('./modelCatalogFixture');
const ledger = require('../../src/services/costLedgerService');
const prices = require('../../src/services/costPriceService');
const sample = require('../fixtures/project73CostUsage.json');

(async () => {
  const fixture = await modelCatalogFixture(5679);
  const { db, admin, config } = fixture;
  const orgService = require('../../src/services/customerOrganizationService');
  const tenant = db.prepare("SELECT id FROM tenants WHERE status='active' ORDER BY id LIMIT 1").get();
  const customer = orgService.saveOrganization(db, admin.id, { name: '项目 73 · 隔离验收客户', config_tenant_id: tenant.id });
  orgService.replaceMembers(db, customer.id, [admin.id]);
  db.prepare('INSERT INTO dramas(id,title,owner_user_id,created_at,updated_at) VALUES(73,?,?,?,?)').run('项目 73 规则估算样本', admin.id, new Date().toISOString(), new Date().toISOString());
  const account = Number(db.prepare('INSERT INTO cost_accounts(name,provider,created_at,created_by) VALUES(?,?,?,?)').run('隔离测试供应商（无真实凭证）', 'fixture', new Date().toISOString(), admin.id).lastInsertRowid);
  db.prepare('INSERT INTO cost_account_bindings VALUES(?,?,?)').run(config.id, account, new Date().toISOString());
  for (const [model, type, meter, value, unit] of [['sample-video','video','output_token','0.01702','1000'], ['sample-upscale','video_postprocess','millisecond','2.5','60000']]) {
    const draft = prices.saveDraft(db, admin.id, { account_id: account, model, service_type: type, effective_from: '2026-08-01T00:00:00+08:00', source: '项目 73 隔离规则估算，不代表已核实账单', rules: [{ meter, price: value, original_price: value, unit_size: unit }] });
    prices.publish(db, admin.id, draft.id);
  }
  for (const [index, row] of sample.rows.entries()) {
    const model = row.service_type === 'video' ? 'sample-video' : 'sample-upscale';
    const id = ledger.begin(db, { config, model, service_type: row.service_type, user_id: admin.id, drama_id: 73, source_kind: row.service_type === 'video' ? 'omni_video' : 'video_upscale', operation_id: `sample-${index}` });
    db.prepare('UPDATE cost_calls SET submitted_at=? WHERE id=?').run('2026-09-08T03:00:00.000Z', id);
    ledger.observe(db, id, { status: 'completed', usage: row.usage, evidence_kind: 'isolated_project73_sample' });
    db.prepare('INSERT INTO billing_usage_logs(id,user_id,organization_id,drama_id,service_type,model,usage_json,charged_micro,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`sample-${index}`, admin.id, customer.id, 73, row.service_type, model, JSON.stringify(row.usage), row.charged_micro, '{}', '2026-09-08T03:00:00.000Z');
  }
  require('./historicalCostFixture').seedHistoricalCosts(db, admin.id, 74);
  const backfill = require('../../src/services/costBackfillService');
  const history = backfill.preview(db, admin.id, { date_from: '2026-09-01', date_to: '2026-09-30', drama_id: 74 });
  backfill.execute(db, admin.id, history.id);
  const laterPrice = prices.saveDraft(db, admin.id, { account_id: account, scope: 'project', drama_id: 74,
    model: 'doubao-seedance-2-0-fast-260128', service_type: 'video', effective_from: '2026-09-01T00:00:00+08:00',
    source: '隔离验收：先补录缺价记录，再发布价格', rules: [{ meter: 'output_token', price: '0.01702', unit_size: '1000' }] });
  prices.publish(db, admin.id, laterPrice.id);
  // A second project makes incomplete coverage and failure feedback reviewable.
  const id = ledger.begin(db, { config: {}, model: '未绑定账号的调用', service_type: 'text', user_id: admin.id, operation_id: 'unknown-sample' });
  ledger.observe(db, id, { status: 'unknown' });
  console.log('Isolated cost acceptance API ready at 127.0.0.1:5679', { database_root: fixture.root });
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
})().catch(error => { console.error(error); process.exitCode = 1; });
