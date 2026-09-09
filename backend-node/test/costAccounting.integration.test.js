const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const ledger = require('../src/services/costLedgerService');
const prices = require('../src/services/costPriceService');
const query = require('../src/services/costQueryService');
const backfill = require('../src/services/costBackfillService');
const organizations = require('../src/services/customerOrganizationService');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const sample = require('./fixtures/project73CostUsage.json');

test('decimal prices, required dimensions, disjoint tokens and Shanghai boundaries', () => {
  const price = { currency: 'CNY', rules_json: JSON.stringify([{ meter: 'output_token', price: '0.01702', unit_size: '1000', when: { has_video_input: false } }]) };
  assert.equal(prices.calculate(price, { output_token: 4007700 }, { has_video_input: false }).amount_micro, 68211054);
  assert.equal(prices.calculate(price, { output_token: 4007700 }, {}).cost_status, 'missing_price');
  assert.equal(prices.calculate(price, { request: 1 }, { has_video_input: false }).cost_status, 'missing_usage');
  assert.deepEqual(ledger.normalizeUsage({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_tokens_details: { cached_tokens: 30 } }), { input_token: 70, cache_token: 30, output_token: 20 });
  assert.equal(ledger.normalizeUsage({ total_tokens: 120 }), null);
  assert.deepEqual(ledger.normalizeUsage({ input_tokens: 70, cache_read_input_tokens: 30, output_tokens: 20 }), { input_token: 70, cache_token: 30, output_token: 20 });
  assert.equal(query.boundary('2026-09-01'), '2026-08-31T16:00:00.000Z');
  assert.equal(query.boundary('2026-08-31', true), '2026-08-31T16:00:00.000Z');
  assert.throws(() => query.boundary('2026-02-30'));
  assert.equal(prices.prorate(186315, '2.5', '60000'), 7763125);
  const candidate = require('../src/services/costPriceSourceService').candidate({ Name: 'model', ChargeItems: [{ Type: 'InferenceCompletion', UnitCode: 'CNY / 1k tokens', Price: 0.02, OriginalPrice: 0.1, Discount: 0.2 }] });
  assert.equal(candidate.rules[0].price, '0.02', 'API discount is already applied');
  assert.equal(candidate.rules[0].original_price, '0.1');
  const tiered = { currency: 'USD', rules_json: JSON.stringify([{ meter: 'output_token', price: '0.1', unit_size: '1', input_max: 100 }, { meter: 'output_token', price: '0.2', unit_size: '1', input_min: 100 }]) };
  assert.equal(prices.calculate(tiered, { output_token: 1 }, { input_tokens: 99 }).amount_micro, 100000);
  assert.equal(prices.calculate(tiered, { output_token: 1 }, { input_tokens: 100 }).amount_micro, 200000);
  assert.equal(prices.calculate(tiered, { output_token: 1 }, {}).cost_status, 'missing_price');
});

test('cost ledger isolation, attribution, revisions, month versions, backfill and admin HTTP contract', async () => {
  const fixture = await modelCatalogFixture();
  try {
    let db = fixture.db;
    const { admin, config } = fixture;
    const owner = auth.createUser(db, { username: 'cost-owner', password: 'fixture-password' }, admin.id);
    const restricted = auth.createUser(db, { username: 'cost-role-only', password: 'fixture-password' }, admin.id);
    const tenant = db.prepare("SELECT id FROM tenants WHERE status='active' ORDER BY id LIMIT 1").get();
    const organization = organizations.saveOrganization(db, admin.id, { name: '成本验收客户', config_tenant_id: tenant.id });
    organizations.replaceMembers(db, organization.id, [owner.id]);
    db.prepare('INSERT INTO dramas(id,title,owner_user_id,created_at,updated_at) VALUES(73,?,?,?,?)').run('项目 73 隔离估算样本', owner.id, '2026-09-08T00:00:00.000Z', '2026-09-08T00:00:00.000Z');
    const account = Number(db.prepare('INSERT INTO cost_accounts(name,provider,created_at,created_by) VALUES(?,?,?,?)').run('隔离供应商账号', 'fixture', new Date().toISOString(), admin.id).lastInsertRowid);
    db.prepare('INSERT INTO cost_account_bindings VALUES(?,?,?)').run(config.id, account, new Date().toISOString());
    function publish(model, service, meter, price, unit, from = '2026-08-01T00:00:00+08:00', accountId = account) {
      const draft = prices.saveDraft(db, admin.id, { account_id: accountId, model, service_type: service, source: 'isolated fixture', effective_from: from, rules: [{ meter, price, unit_size: unit }] });
      return prices.publish(db, admin.id, draft.id);
    }
    publish('sample-video', 'video', 'output_token', '0.01702', '1000');
    publish('sample-upscale', 'video_postprocess', 'millisecond', '2.5', '60000');
    const boundaryPrice = prices.saveDraft(db, admin.id, { account_id: account, model: 'boundary-model', service_type: 'text', source: 'boundary fixture', effective_from: '2026-09-01T00:00:00+08:00', effective_to: '2026-10-01T00:00:00+08:00', rules: [{ meter: 'output_token', price: '1', unit_size: '1000' }] });
    prices.publish(db, admin.id, boundaryPrice.id);
    const boundaryCall = { account_id: account, model: 'boundary-model', service_type: 'text' };
    assert.equal(prices.select(db, { ...boundaryCall, submitted_at: '2026-08-31T15:59:59.999Z' }), null);
    assert.equal(prices.select(db, { ...boundaryCall, submitted_at: '2026-08-31T16:00:00.000Z' }).id, boundaryPrice.id);
    assert.equal(prices.select(db, { ...boundaryCall, submitted_at: '2026-09-30T16:00:00.000Z' }), null);
    assert.equal(prices.select(db, { ...boundaryCall, account_id: account + 1, submitted_at: '2026-09-01T00:00:00.000Z' }), null);
    const originalUsage = [];
    for (const [index, row] of sample.rows.entries()) {
      const model = row.service_type === 'video' ? 'sample-video' : 'sample-upscale';
      const id = ledger.begin(db, { config, model, service_type: row.service_type, user_id: owner.id, drama_id: 73, source_kind: 'sample', operation_id: `sample-${index}` });
      db.prepare('UPDATE cost_calls SET submitted_at=? WHERE id=?').run('2026-09-08T03:00:00.000Z', id);
      ledger.observe(db, id, { status: 'completed', usage: row.usage, event_key: 'complete' });
      ledger.observe(db, id, { status: 'completed', usage: row.usage, event_key: 'complete' });
      assert.equal(ledger.get(db, id).revisions.length, 1);
      db.prepare('INSERT INTO billing_usage_logs(id,user_id,organization_id,drama_id,service_type,model,usage_json,charged_micro,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`sample-${index}`, owner.id, organization.id, 73, row.service_type, model, JSON.stringify(row.usage), row.charged_micro, '{}', '2026-09-08T03:00:00.000Z');
      originalUsage.push(id);
    }
    const filters = { organization_id: organization.id, drama_id: 73, date_from: '2026-09-01', date_to: '2026-09-30' };
    const totals = query.summary(db, filters);
    assert.equal(totals.output_token, 4007700);
    assert.equal(totals.millisecond, 186315);
    assert.equal((totals.cny_micro / 1e6).toFixed(2), '75.97');
    assert.equal(totals.platform_points, 17933.74);
    const saved = query.createReport(db, admin.id, { organization_id: organization.id, month: '2026-09' });
    const oldCsv = query.reportCsv(db, saved.id, true);
    assert.equal([...query.reportCsvChunks(db, saved.id, true)].join(''), oldCsv);
    const ledgerBefore = JSON.stringify(db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all());
    // Project transfer, renaming and membership changes cannot rewrite calls.
    organizations.replaceMembers(db, organization.id, []);
    db.prepare('UPDATE customer_organizations SET name=? WHERE id=?').run('新客户名称', organization.id);
    db.prepare('UPDATE users SET display_name=? WHERE id=?').run('新显示名', owner.id);
    db.prepare('UPDATE dramas SET title=?,owner_user_id=? WHERE id=73').run('转移后的项目', admin.id);
    const stable = ledger.get(db, originalUsage[0]);
    assert.equal(stable.organization_name, '成本验收客户');
    assert.equal(stable.project_title, '项目 73 隔离估算样本');
    assert.equal(stable.user_name, 'cost-owner');
    publish('sample-video', 'video', 'output_token', '0.02', '1000');
    assert.equal(query.summary(db, filters).cny_micro, totals.cny_micro, 'publishing never rewrites past prices');
    const revisedId = originalUsage.find(id => ledger.get(db, id).service_type === 'video');
    ledger.reprice(db, admin.id, revisedId, '补齐审核价格');
    const revised = ledger.get(db, revisedId).revisions.at(-1);
    ledger.observe(db, revisedId, { status: 'completed', usage: revised.usage });
    assert.equal(ledger.get(db, revisedId).revisions.at(-1).price_id, revised.price_id, 'later evidence preserves the explicit price revision');
    assert.equal(query.reportCsv(db, saved.id, true), oldCsv, 'saved report stays byte-identical');
    assert.equal(query.createReport(db, admin.id, { organization_id: organization.id, month: '2026-09' }).version, 2);
    // Failed unknown submission and late completion remain one attempt.
    const late = ledger.begin(db, { config, model: 'sample-video', service_type: 'video', user_id: owner.id, operation_id: 'late' });
    db.prepare('UPDATE cost_calls SET submitted_at=? WHERE id=?').run('2026-08-31T15:59:59.999Z', late);
    ledger.observe(db, late, { status: 'unknown' });
    assert.equal(ledger.get(db, late).revisions.at(-1).cost_status, 'unverified');
    ledger.observe(db, late, { status: 'completed', usage: { output_token: 10 }, provider_task_id: 'late-task' });
    ledger.byTask(db, 'late-task', { status: 'processing' });
    assert.equal(ledger.get(db, late).status, 'completed');
    assert.equal(query.calls(db, { date_from: '2026-08-01', date_to: '2026-08-31' }).total, 1);
    const missing = ledger.begin(db, { config: {}, model: 'missing', service_type: 'text', user_id: owner.id });
    ledger.observe(db, missing, { status: 'completed', usage: { input_token: 5 } });
    assert.equal(ledger.get(db, missing).revisions.at(-1).cost_status, 'missing_price');
    // Historical imports use persisted account and identity evidence only.
    const evidence = { cost_evidence: { account_id: account, model: 'sample-video', submitted_at: '2026-08-15T03:00:00Z' }, cost_attribution: { user_name: '历史用户', organization_name: '历史客户' } };
    db.prepare('INSERT INTO billing_usage_logs(id,user_id,organization_id,drama_id,project_title_snapshot,service_type,model,usage_json,charged_micro,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('historical-proof', owner.id, organization.id, 73, '历史项目', 'video', 'sample-video', '{"output_token":1000}', 99, JSON.stringify(evidence), '2026-08-15T05:00:00.000Z');
    const preview = backfill.preview(db, admin.id, { date_from: '2026-08-01', date_to: '2026-08-31' });
    assert.equal(preview.preview.eligible, 1);
    assert.equal(backfill.execute(db, admin.id, preview.id).result.inserted, 1);
    assert.equal(backfill.execute(db, admin.id, preview.id).result.inserted, 1);
    const again = backfill.preview(db, admin.id, { date_from: '2026-08-01', date_to: '2026-08-31' });
    assert.equal(again.preview.eligible, 0);
    const missingProof = backfill.preview(db, admin.id, { date_from: '2026-09-01', date_to: '2026-09-30' });
    assert.equal(missingProof.preview.eligible, 0);
    assert.ok(missingProof.preview.items.every(item => item.reasons.length));
    assert.equal(JSON.stringify(db.prepare("SELECT * FROM billing_usage_logs WHERE id<>'historical-proof' ORDER BY id").all()), ledgerBefore);
    for (let i = 0; i < 105; i++) ledger.begin(db, { config, model: 'pagination-model', service_type: 'text', user_id: owner.id, operation_id: `page-${i}` });
    assert.equal(query.calls(db, { model: 'pagination-model', page_size: 100 }).items.length, 100);
    assert.equal(query.calls(db, { model: 'pagination-model', page_size: 100, page: 2 }).items.length, 5);
    const cookie = (await fixture.request('POST', '/auth/login', { username: admin.username, password: 'fixture-password' })).cookie;
    const ownerCookie = (await fixture.request('POST', '/auth/login', { username: owner.username, password: 'fixture-password' })).cookie;
    const restrictedCookie = (await fixture.request('POST', '/auth/login', { username: restricted.username, password: 'fixture-password' })).cookie;
    async function verifyHttp() {
      db.prepare("UPDATE users SET role='admin',console_access=0,account_kind='creator' WHERE id=?").run(restricted.id);
      for (const endpoint of ['/summary?drama_id=73', '/calls?drama_id=73', '/breakdown?group_by=customer&drama_id=73', '/accounts', '/reports', '/prices']) {
        assert.equal((await fixture.request('GET', '/admin/costs' + endpoint, undefined, cookie)).status, 200, endpoint);
        for (const denied of [ownerCookie, restrictedCookie]) assert.ok([403, 404].includes((await fixture.request('GET', '/admin/costs' + endpoint, undefined, denied)).status));
      }
      assert.equal((await fixture.request('GET', '/admin/costs/summary')).status, 401);
      assert.equal((await fixture.request('GET', '/admin/costs/calls?date_from=2026-02-30', undefined, cookie)).status, 400);
    }
    await verifyHttp();
    await fixture.restart(); db = fixture.db;
    await verifyHttp();
    assert.equal(query.reportCsv(db, saved.id, true), oldCsv);
    assert.equal(ledger.get(db, originalUsage[0]).organization_name, '成本验收客户');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM cost_calls WHERE source_key='legacy_usage:historical-proof'").get().n, 1);
  } catch (error) { console.error(error.stack); throw error; } finally { await fixture.close(); }
});
