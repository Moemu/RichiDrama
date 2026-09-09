const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const { seedHistoricalCosts } = require('./helpers/historicalCostFixture');
const prices = require('../src/services/costPriceService');

test('old personal logs import actual usage without account proof; reviewed scopes estimate through HTTP and survive restart', async () => {
  const fixture = await modelCatalogFixture();
  try {
    let db = fixture.db;
    seedHistoricalCosts(db, fixture.admin.id);
    const original = JSON.stringify(db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all());
    const cookie = (await fixture.request('POST', '/auth/login', { username: fixture.admin.username, password: 'fixture-password' })).cookie;
    async function api(method, route, body) {
      const response = await fixture.request(method, '/admin/costs' + route, body, cookie);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return response.body.data;
    }
    const filters = { date_from: '2026-09-01', date_to: '2026-09-30', drama_id: 73 };
    const originalUsage = db.prepare("SELECT usage_json FROM billing_usage_logs WHERE id='legacy-0'").get().usage_json;
    db.prepare("UPDATE billing_usage_logs SET usage_json='{}' WHERE id='legacy-0'").run();
    const fallback = await api('POST', '/backfills/preview', filters);
    assert.deepEqual(fallback.preview.items.find(x => x.source_id === 'legacy-0').usage, JSON.parse(originalUsage));
    db.prepare("UPDATE billing_usage_logs SET usage_json=? WHERE id='legacy-0'").run('{"output_token":1}');
    const conflict = await api('POST', '/backfills/preview', filters);
    assert.equal(conflict.preview.eligible, 221);
    assert.match(conflict.preview.items.find(x => x.source_id === 'legacy-0').reasons.join(), /冲突/);
    db.prepare("UPDATE billing_usage_logs SET usage_json=? WHERE id='legacy-0'").run(originalUsage);
    const initial = await api('POST', '/backfills/preview', filters);
    assert.equal(initial.preview.eligible, 222);
    assert.equal(initial.preview.unpriced, 222);
    assert.ok(initial.preview.items.every(x => x.call.customer_kind === 'personal' && x.call.account_id === null && x.call.organization_id === null));
    assert.equal((await api('POST', `/backfills/${initial.id}/execute`, { confirm: true })).result.inserted, 222);
    let totals = await api('GET', '/summary?drama_id=73');
    assert.equal(totals.output_token, 37472400);
    assert.equal(totals.millisecond, 1591080);
    assert.equal(totals.platform_points, 165165.88);
    assert.equal(totals.missing_price_calls, 222);
    const account = await api('POST', '/accounts', { name: '组织账单来源（隔离）', provider: 'fixture' });
    const input = { account_id: account.id, model: 'doubao-seedance-2-0-fast-260128', service_type: 'video', source: '人工核对账单费率的隔离样本', effective_from: '2026-09-01T00:00:00+08:00', rules: [{ meter: 'output_token', price: '0.01702', unit_size: '1000' }] };
    const legacy = await api('POST', '/prices', input);
    await api('POST', `/prices/${legacy.id}/publish`, { confirm: true });
    const call = { account_id: null, drama_id: 73, model: input.model, service_type: 'video', submitted_at: '2026-09-08T03:00:00.000Z' };
    assert.equal(prices.select(db, call), null, 'old account-only prices cannot cross accounts');
    const project = await api('POST', '/prices', { ...input, scope: 'project', drama_id: 73 });
    assert.equal((await fixture.request('POST', '/admin/costs/prices', { ...input, scope: 'project', drama_id: -1 }, cookie)).status, 400);
    assert.equal(prices.select(db, call), null, 'draft never applies');
    await api('POST', `/prices/${project.id}/publish`, { confirm: true });
    assert.equal(prices.select(db, call).id, project.id);
    assert.equal(prices.select(db, { ...call, drama_id: 74 }), null);
    assert.equal((await api('GET', '/summary?drama_id=73')).calculated_calls, 0, 'publish does not rewrite imported records');
    const ids = db.prepare("SELECT id FROM cost_calls WHERE service_type='video'").all();
    for (const row of ids) await api('POST', `/calls/${row.id}/reprice`, { reason: '明确按已审核项目价格估算' });
    totals = await api('GET', '/summary?drama_id=73');
    assert.equal(totals.cny_micro, 637780248);
    assert.equal(totals.calculated_calls, 116);
    assert.equal(totals.missing_price_calls, 106);
    const platform = await api('POST', '/prices', { ...input, scope: 'platform' });
    await api('POST', `/prices/${platform.id}/publish`, { confirm: true });
    assert.equal(prices.select(db, { ...call, drama_id: 74 }).id, platform.id);
    assert.equal(prices.select(db, call).id, project.id, 'project scope precedes platform scope');
    await fixture.restart(); db = fixture.db;
    assert.equal((await api('GET', '/summary?drama_id=73')).cny_micro, 637780248);
    assert.equal((await api('POST', '/backfills/preview', filters)).preview.eligible, 0);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM billing_usage_logs ORDER BY id').all()), original);
    assert.equal((await api('GET', `/backfills/${initial.id}`)).preview.unpriced, 222, 'old batch stays immutable');
  } finally { await fixture.close(); }
});
