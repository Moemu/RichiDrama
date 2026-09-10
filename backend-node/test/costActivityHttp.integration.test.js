const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const { seedCostActivity } = require('./helpers/costActivityFixture');
const ledger = require('../src/services/costLedgerService');
const prices = require('../src/services/providerPriceService');
const ai = require('../src/services/aiConfigService');

test('cost filter options include current and historical projects and survive restart without changing usage', async () => {
  const f = await modelCatalogFixture();
  try {
    seedCostActivity(f.db, f.admin.id);
    const member = require('../src/services/authService').createUser(f.db, { username: 'filter-user', password: 'fixture-password' }, f.admin.id);
    f.db.prepare("INSERT INTO dramas(id,title,owner_user_id,created_at,updated_at) VALUES(74,'另一用户的项目',?,'2026-09-01','2026-09-01')").run(member.id);
    f.db.prepare("UPDATE dramas SET title='',deleted_at='2026-09-09' WHERE id=73").run();
    const original = JSON.stringify(f.db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all());
    const path = '/admin/costs/filter-options';
    assert.equal((await f.request('GET', path)).status, 401);
    const memberCookie = (await f.request('POST', '/auth/login', { username: member.username, password: 'fixture-password' })).cookie;
    assert.equal((await f.request('GET', path, undefined, memberCookie)).status, 403);
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    const result = await f.request('GET', path, undefined, cookie);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.projects.find(p => p.id === 73), { id: 73, title: '历史项目名称' });
    assert.deepEqual(result.body.data.projects.find(p => p.id === 74), { id: 74, title: '另一用户的项目' });
    assert.deepEqual(result.body.data.users.find(u => u.id === member.id), { id: member.id, username: 'filter-user' });
    await f.restart();
    assert.deepEqual((await f.request('GET', path, undefined, cookie)).body.data, result.body.data);
    assert.equal(JSON.stringify(f.db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all()), original);
  } finally { await f.close(); }
});

test('activity reads original prices and usage without setup, imports or repricing; snapshots survive restart', async () => {
  const f = await modelCatalogFixture();
  try {
    let db = f.db;
    seedCostActivity(db, f.admin.id);
    const owner = require('../src/services/authService').createUser(db, { username: 'project-owner', password: 'fixture-password' }, f.admin.id);
    db.prepare('UPDATE dramas SET owner_user_id=? WHERE id=73').run(owner.id);
    db.prepare("UPDATE billing_usage_logs SET project_title_snapshot=NULL,created_at='2026-09-08T04:00:00.000Z' WHERE id='legacy-0'").run();
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    async function get(suffix) { const r = await f.request('GET', '/admin/costs/activity' + suffix, undefined, cookie); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data; }
    assert.equal((await f.request('GET', '/admin/costs/activity')).status, 401);
    const original = JSON.stringify(db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all());
    const transactions = JSON.stringify(db.prepare('SELECT * FROM billing_transactions ORDER BY id').all());
    const result = await get('?drama_id=73&date_from=2026-09-08&date_to=2026-09-08');
    assert.equal(result.summary.calls, 222);
    assert.equal(result.summary.calculated_calls, 222);
    assert.equal(result.summary.supplier_priced_calls, 222);
    assert.equal(result.summary.total_tokens, 37472400);
    assert.equal(result.summary.millisecond, 1591080);
    assert.equal(result.summary.model_amount_micro, 1651658800);
    assert.equal(result.summary.charged_micro, 1651658800);
    assert.equal(result.summary.difference_calls, 0);
    assert.equal(result.breakdown.items[0].label, '历史项目名称', 'an unnamed latest record does not hide the known project snapshot');
    assert.deepEqual(result.breakdown.items[0].owners, [{ id: owner.id, username: 'project-owner' }], 'project owner is distinct from the caller');
    assert.equal(result.breakdown.items[0].has_unknown_owner, false);
    for (const basis of ['billing_activity_v1', 'supplier_daily_v1']) {
      for (const groupBy of ['project', 'customer', 'user', 'model', 'operation', 'hour', 'day', 'month']) {
        const grouped = await get(`?drama_id=73&basis=${basis}&group_by=${groupBy}`);
        assert.ok(grouped.breakdown.items.every(g => g.owners.length === 1 && g.owners[0].username === 'project-owner'));
      }
    }
    db.prepare("INSERT INTO dramas(id,title,owner_user_id,created_at,updated_at) VALUES(74,'Other owner',?,'2026-09-01','2026-09-01')").run(f.admin.id);
    db.prepare("UPDATE billing_usage_logs SET drama_id=74 WHERE id='legacy-1'").run();
    const mixed = await get('?group_by=user');
    assert.deepEqual(new Set(mixed.breakdown.items[0].owners.map(o => o.username)), new Set(['project-owner', f.admin.username]));
    db.prepare("UPDATE billing_usage_logs SET drama_id=NULL WHERE id='legacy-1'").run();
    assert.equal((await get('?group_by=user')).breakdown.items[0].has_unknown_owner, true);
    db.prepare("UPDATE billing_usage_logs SET drama_id=73 WHERE id='legacy-1'").run();
    assert.equal(result.calls.items.length, 20);
    assert.equal((await get('?drama_id=73&page=12')).calls.items.length, 2);
    const video = await get('?drama_id=73&service_type=video');
    assert.equal(video.summary.calls, 116);
    assert.equal(video.summary.charged_micro, video.summary.model_amount_micro, 'all totals use the same filtered records');
    assert.equal((await get('?date_from=2026-09-09')).summary.calls, 0);
    const detail = await get('/usage:legacy-0');
    assert.equal(detail.rates[0].quantity, 324900, 'real usage, not the much larger authorization quote');
    assert.equal(detail.rates[0].subtotal_micro, 12021300);
    assert.equal(detail.rates[0].unit_size, 1000000);
    assert.equal(detail.supplier_amount_micro, 12021300, 'original official product-page price sources remain recognized');
    assert.equal(detail.config_id, null, 'no inferred supplier account');
    db.prepare("UPDATE billing_usage_logs SET usage_json='{}' WHERE id='legacy-0'").run();
    assert.equal((await get('/usage:legacy-0')).model_amount_micro, 12021300, 'settlement actual usage is a safe fallback');
    db.prepare("UPDATE billing_usage_logs SET usage_json='{\"output_token\":1}' WHERE id='legacy-0'").run();
    assert.equal((await get('/usage:legacy-0')).cost_status, 'unverified');
    assert.equal((await get('/usage:legacy-0')).usage, null, 'conflicting quantities do not become a misleading total');
    db.prepare('UPDATE billing_usage_logs SET usage_json=? WHERE id=?').run(JSON.stringify({ output_token: 324900 }), 'legacy-0');
    for (const table of ['cost_calls', 'cost_prices', 'cost_accounts', 'cost_backfill_batches', 'cost_reprice_batches']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
    // Older imported records and live retries are evidence, never extra usage.
    const batch = require('../src/services/costBackfillService').preview(db, f.admin.id, { drama_id: 73, date_from: '2026-09-08', date_to: '2026-09-08' });
    require('../src/services/costBackfillService').execute(db, f.admin.id, batch.id);
    for (let i = 0; i < 2; i++) {
      const id = ledger.begin(db, { config: f.config, authorization_id: 'legacy-auth-0', service_type: 'video', model: detail.model });
      ledger.observe(db, id, { status: i ? 'completed' : 'failed', usage: i ? { output_token: 324900 } : null });
    }
    assert.equal((await get('?drama_id=73')).summary.calls, 222);
    assert.equal((await get('/usage:legacy-0')).attempts.length, 3);
    assert.equal((await get('/usage:legacy-0')).config_name, f.config.name);
    // Current membership and price edits never rewrite historical payer or rate.
    const organizations = require('../src/services/customerOrganizationService');
    const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
    const org = organizations.saveOrganization(db, f.admin.id, { name: '隔离客户', config_tenant_id: tenant.id });
    organizations.replaceMembers(db, org.id, [f.admin.id]);
    db.prepare('UPDATE billing_price_book_items SET unit_price_micro=99999999').run();
    assert.equal((await get('?customer_kind=personal')).summary.calls, 222);
    assert.equal((await get('?organization_id=' + org.id)).summary.calls, 0);
    await f.restart(); db = f.db;
    assert.deepEqual((await get('?drama_id=73')).breakdown.items[0].owners, result.breakdown.items[0].owners);
    assert.deepEqual((await get('?drama_id=73')).summary, result.summary);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all()), original);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM billing_transactions ORDER BY id').all()), transactions);
    assert.equal((await f.request('GET', '/admin/costs/activity?date_from=2026-02-30', undefined, cookie)).status, 400);
    assert.equal((await f.request('GET', '/admin/costs/activity?drama_id=-1', undefined, cookie)).status, 400);
  } finally { await f.close(); }
});

test('shared pricing handles complex text, tiers, differences, missing usage and frozen monthly exports through HTTP', async () => {
  const f = await modelCatalogFixture();
  try {
    let db = f.db;
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    async function api(method, path, body) { const r = await f.request(method, '/admin/costs' + path, body, cookie); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data; }
    const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
    const org = require('../src/services/customerOrganizationService').saveOrganization(db, f.admin.id, { name: '核算客户', config_tenant_id: tenant.id });
    const model = 'doubao-seed-2-1-pro-250528';
    ai.createConfig(db, f.log, { service_type: 'text', provider: 'volcengine', name: '隔离复杂模型', base_url: 'http://supplier.invalid', model, billing_key: model });
    const rows = prices.buildCandidateRows(db, { FoundationModelName: 'doubao-seed-2-1-pro', MultiChargeItems: [{ ChargeItems: [
      { Type: 'InferencePrompt', Price: 0.006, UnitCode: '千tokens' }, { Type: 'InferenceCompletion', Price: 0.03, UnitCode: '千tokens' },
    ] }] });
    assert.equal(rows.length, 2); assert.ok(rows.every(r => r.mapping_status === 'mapped'));
    const rates = rows.map(r => ({ meter: r.meter, unit_price_micro: r.new_unit_price_micro, unit_size: r.unit_size,
      conditions: { ...JSON.parse(r.new_conditions_json || '{}'), provider: 'volcengine', currency: 'CNY', source: 'ListModelActivations', source_sync_id: 'fixture-sync' } }));
    function seed(id, usage, snapshot, charged, at = '2026-09-08T16:30:00.000Z') {
      const json = JSON.stringify({ account_scope: 'organization', service_type: 'text', model: 'local-billing-key', provider_model: model, ...snapshot });
      db.prepare('INSERT INTO billing_transactions(id,user_id,organization_id,type,amount_micro,balance_after_micro,frozen_after_micro,snapshot_json,created_at) VALUES(?,?,?,\'authorization\',0,0,0,?,?)').run('auth-' + id, f.admin.id, org.id, json, at);
      db.prepare('INSERT INTO billing_usage_logs(id,user_id,organization_id,authorization_id,service_type,model,usage_json,charged_micro,snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, f.admin.id, org.id, 'auth-' + id, 'text', 'local-billing-key', JSON.stringify(usage), charged, json, at);
    }
    seed('complex', { input_token: 2000, output_token: 1000 }, { rates }, 42000);
    let result = await api('GET', '/activity?model=' + model + '&date_from=2026-09-09&date_to=2026-09-09');
    assert.equal(result.summary.calls, 1); assert.equal(result.summary.model_amount_micro, 42000); assert.equal(result.summary.supplier_amount_micro, 42000);
    assert.equal((await api('GET', '/activity?date_to=2026-09-08')).summary.calls, 0, 'Shanghai date boundary');
    seed('custom', { input_token: 2000, output_token: 1000 }, { rates: rates.map(r => ({ ...r, conditions: {} })) }, 42000);
    seed('official-product', { input_token: 2000, output_token: 1000 }, { rates: rates.map(r => ({ ...r, conditions: { ...r.conditions, source: 'https://www.volcengine.com/product/doubao/' } })) }, 42000);
    assert.equal((await api('GET', '/activity/usage:official-product')).supplier_amount_micro, 42000);
    seed('tier', { input_token: 40000 }, { rates: [{ meter: 'input_token', unit_price_micro: 1000, unit_size: 1000,
      conditions: { usage_tiers: [{ id: 'small', selector_meter: 'input_token', min_inclusive: 0, max_inclusive: 32768, unit_price_points: 0.1, unit_size: 1000 },
        { id: 'large', selector_meter: 'input_token', min_inclusive: 32769, max_inclusive: 131072, unit_price_points: 0.2, unit_size: 1000 }] } }] }, 40000);
    let detail = await api('GET', '/activity/usage:tier');
    assert.equal(detail.model_amount_micro, 80000); assert.equal(detail.difference_micro, -40000); assert.equal(detail.rates[0].rate_id, 'large');
    db.prepare(`INSERT INTO billing_transactions(id,user_id,type,amount_micro,balance_after_micro,frozen_after_micro,authorization_id,idempotency_key,snapshot_json,created_at)
      VALUES('supplement',?,'adjustment',-40000,0,0,'auth-tier','settlement-supplement:auth-tier:80000','{}','2026-09-09T01:00:00.000Z')`).run(f.admin.id);
    db.prepare("UPDATE billing_usage_logs SET charged_micro=charged_micro+40000 WHERE id='tier'").run();
    assert.equal((await api('GET', '/activity/usage:tier')).difference_micro, 0);
    seed('empty', {}, { usage: { input_token: 999999 }, rates }, 0);
    assert.equal((await api('GET', '/activity/usage:empty')).cost_status, 'missing_usage');
    seed('missing-price', { output_token: 10 }, {}, 50);
    assert.equal((await api('GET', '/activity/usage:missing-price')).cost_status, 'missing_price');
    db.prepare(`INSERT INTO billing_transactions(id,user_id,organization_id,type,amount_micro,balance_after_micro,frozen_after_micro,snapshot_json,created_at)
      VALUES('pending',?,?,'authorization',1000000,0,0,?,'2026-09-09T01:00:00.000Z')`).run(f.admin.id, org.id, JSON.stringify({ service_type: 'text', model, rates, usage: { output_token: 999999 } }));
    assert.equal((await api('GET', '/activity/authorization:pending')).usage, null);
    db.prepare(`INSERT INTO billing_transactions(id,user_id,type,amount_micro,balance_after_micro,frozen_after_micro,authorization_id,snapshot_json,created_at)
      VALUES('void-pending',?,'void',0,0,0,'pending','{}','2026-09-09T01:01:00.000Z')`).run(f.admin.id);
    assert.equal((await api('GET', '/activity/authorization:pending')).cost_status, 'released');
    assert.equal((await api('GET', '/activity?cost_status=released')).summary.released_calls, 1);
    assert.equal((await api('GET', '/activity?cost_status=released')).summary.missing_usage_calls, 0);
    db.prepare("DELETE FROM billing_transactions WHERE id='void-pending'").run();
    const observed = ledger.begin(db, { config: f.config, authorization_id: 'pending', model, service_type: 'text' });
    ledger.observe(db, observed, { status: 'completed', usage: { output_token: 1000 } });
    assert.equal((await api('GET', '/activity/authorization:pending')).model_amount_micro, 30000);
    result = await api('GET', '/activity?organization_id=' + org.id);
    assert.equal(result.summary.calls, 7); assert.equal(result.summary.calculated_calls, 5); assert.equal(result.summary.supplier_priced_calls, 3);
    assert.equal((await api('GET', '/activity/usage:custom')).supplier_amount_micro, null);
    db.transaction(() => { for (let i = 0; i < 1000; i++) seed('extra-' + i, { output_token: 1 }, { rates }, 30); })();
    result = await api('GET', '/activity?organization_id=' + org.id);
    assert.equal(result.summary.calls, 1007, 'report reads are not limited by old 1000-row backfill batches');
    const report = await api('POST', '/reports', { organization_id: org.id, month: '2026-09', basis: 'billing_activity_v1' });
    assert.equal(report.summary.calls, 1007);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cost_report_items WHERE report_id=?').get(report.id).n, 1007);
    assert.deepEqual(report.summary.charged_micro, result.summary.charged_micro);
    const frozen = JSON.stringify(report.summary);
    const csv = require('../src/services/costQueryService').reportCsv(db, report.id, true);
    assert.match(csv, /原调用价格快照/); assert.match(csv, /usage:complex/); assert.match(csv, /large/);
    const streaming = require('../src/services/costQueryService').reportCsvChunks(db, report.id, true);
    for (let i = 0; i < 6; i++) streaming.next();
    assert.doesNotThrow(() => db.transaction(() => db.prepare('SELECT 1').get())(), 'a paused CSV download must not hold an active SQLite iterator');
    streaming.return();
    // Changing current source records cannot change a saved report.
    db.prepare("UPDATE billing_usage_logs SET charged_micro=1 WHERE id='custom'").run();
    await f.restart(); db = f.db;
    assert.equal(JSON.stringify((await api('GET', '/reports/' + report.id)).summary), frozen);
    assert.equal(require('../src/services/costQueryService').reportCsv(db, report.id, true), csv);
  } finally { await f.close(); }
});
