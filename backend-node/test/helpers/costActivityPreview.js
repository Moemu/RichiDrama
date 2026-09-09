// Local UI fixture: isolated SQLite, no workers and no supplier credentials.
const { modelCatalogFixture } = require('./modelCatalogFixture');
const { seedCostActivity } = require('./costActivityFixture');
(async () => {
  const fixture = await modelCatalogFixture(5679);
  const { db, admin } = fixture;
  seedCostActivity(db, admin.id);
  const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
  const org = require('../../src/services/customerOrganizationService').saveOrganization(db, admin.id, { name: '隔离月报客户', config_tenant_id: tenant.id });
  db.prepare(`INSERT INTO billing_usage_logs(id,user_id,organization_id,service_type,model,usage_json,charged_micro,snapshot_json,created_at)
    VALUES('report-example',?,?,'text','custom-model','{"output_token":1000}',20000,?,'2026-09-09T02:00:00.000Z')`).run(admin.id, org.id,
      JSON.stringify({ rates: [{ meter: 'output_token', unit_price_micro: 20000, unit_size: 1000, conditions: {}, price_book_name: '隔离自定义价目' }] }));
  db.prepare(`INSERT INTO billing_usage_logs(id,user_id,service_type,model,usage_json,charged_micro,snapshot_json,created_at)
    VALUES('missing-example',?,'text','无历史价格样本','{"output_token":100}',200,'{}','2026-09-09T02:01:00.000Z')`).run(admin.id);
  console.log('Isolated original-price activity preview ready at 127.0.0.1:5679');
  process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
})().catch(error => { console.error(error); process.exitCode = 1; });
