const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const activations = require('./helpers/volcengineAliasPrices');
const ai = require('../src/services/aiConfigService');
const prices = require('../src/services/providerPriceService');
const billing = require('../src/services/billingService');

test('shared bindings price every configured alias and skip unchanged rows through HTTP and restart', async () => {
  const f = await modelCatalogFixture();
  const originalFetch = global.fetch;
  try {
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    const call = (method, route, body) => f.request(method, route, body, cookie);
    const provider = await call('POST', '/admin/provider-connections', { name: 'Alias fixture', provider: 'volces', base_url: 'http://supplier.invalid/api/v3', api_key: 'fixture-only' });
    assert.equal(provider.status, 200);
    const route = `/admin/model-discovery/provider-${provider.body.data.id}/import`;
    const models = activations.map(item => item.FoundationModelName);
    assert.equal((await call('POST', route, { models: models.map(model => `${model}-260909`) })).status, 200);
    ai.createConfig(f.db, f.log, { service_type: 'model_ark_asset', provider: 'volcengine', name: 'Fixture credentials', model: 'asset', settings: JSON.stringify({ access_key_id: 'fixture-ak', secret_access_key: 'fixture-sk' }) });
    const oldRows = activations.flatMap(item => prices.buildCandidateRows(f.db, item));
    assert.equal(oldRows.length, 8);
    const book = billing.savePriceBook(f.db, f.admin.id, { name: 'Historical alias fixture', status: 'published', items: oldRows.map(row => ({ service_type: row.service_type, model: row.billing_key, meter: row.meter, unit_price: row.new_unit_price_micro / 10000, conditions_json: JSON.parse(row.new_conditions_json) })) });
    f.db.prepare('UPDATE billing_price_books SET system_managed=1,version=100 WHERE id=?').run(book.id);
    const historical = f.db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=?').all(book.id);
    assert.equal((await call('POST', route, { models })).status, 200);
    const configsBefore = f.db.prepare('SELECT id,model,default_model,billing_key FROM ai_service_configs ORDER BY id').all();
    assert.ok(configsBefore.filter(row => row.model.includes('260909')).every(row => !row.billing_key));
    const catalog = () => call('GET', '/admin/model-catalog');
    assert.ok((await catalog()).body.data.filter(row => models.includes(row.model)).every(row => !row.price_ready));
    let upstream = structuredClone(activations);
    global.fetch = async (url, init) => {
      if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, init);
      assert.match(String(url), /^https:\/\/open\.volcengineapi\.com/);
      return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'alias-fixture' }, Result: { TotalCount: upstream.length, Items: upstream } }));
    };
    const sync = await call('POST', '/admin/provider-prices/volcengine/sync', {});
    assert.equal(sync.status, 200, JSON.stringify(sync.body));
    const rows = sync.body.data.candidates;
    assert.equal(rows.length, 16);
    assert.equal(rows.filter(row => row.is_unchanged).length, 8);
    assert.ok(rows.filter(row => row.is_unchanged).every(row => row.billing_key.endsWith('-260909')));
    const base = `/admin/provider-price-syncs/${sync.body.data.id}`;
    const at = new Date().toISOString();
    f.db.prepare("INSERT INTO provider_price_source_checks(provider,ark_status,billing_status,checked_at,updated_at) VALUES ('volcengine','success','success',?,?)").run(at, at);
    assert.equal((await call('POST', `${base}/create-draft`, {})).status, 400);
    for (const row of rows.filter(row => !row.is_unchanged)) assert.equal((await call('PATCH', `${base}/candidates/${row.id}`, { review_status: 'accepted' })).status, 200);
    const draft = await call('POST', `${base}/create-draft`, {});
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const published = await call('POST', `/admin/price-books/${draft.body.data.id}/publish`, { confirm: true, reason: 'Alias fixture', idempotency_key: 'alias-fixture', notify_users: false });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    for (const row of (await catalog()).body.data.filter(row => models.includes(row.model))) {
      assert.equal(row.price_ready, true, row.model);
      assert.equal((await call('POST', '/admin/model-catalog', { service_type: row.service_type, model: row.model, status: 'active' })).status, 200);
    }
    const fresh = await call('POST', '/admin/provider-prices/volcengine/sync', {});
    assert.equal(fresh.body.data.status, 'completed');
    assert.equal(fresh.body.data.changed_count, 0);
    assert.ok(fresh.body.data.candidates.every(row => row.is_unchanged));
    const count = f.db.prepare('SELECT COUNT(*) n FROM billing_price_books').get().n;
    assert.equal((await call('POST', `/admin/provider-price-syncs/${fresh.body.data.id}/create-draft`, {})).status, 400);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM billing_price_books').get().n, count);
    const repeated = await call('POST', '/admin/provider-prices/volcengine/sync', {});
    assert.equal(repeated.body.data.reused_from_sync_id, fresh.body.data.id);
    const lite = upstream.find(item => item.FoundationModelName === 'doubao-seed-2-0-lite');
    lite.MultiChargeItems[2].ChargeItems[1].Price *= 2;
    const tierChanged = await call('POST', '/admin/provider-prices/volcengine/sync', {});
    const changes = tierChanged.body.data.candidates.filter(row => !row.is_unchanged);
    assert.equal(changes.length, 2);
    assert.ok(changes.every(row => row.new_unit_price_micro === row.current_unit_price_micro && row.conditions_changed));
    assert.deepEqual(f.db.prepare('SELECT id,model,default_model,billing_key FROM ai_service_configs ORDER BY id').all(), configsBefore);
    await f.restart();
    assert.equal((await call('GET', `/admin/provider-price-syncs/${repeated.body.data.id}`)).body.data.reused_from_sync_id, fresh.body.data.id);
    assert.ok((await catalog()).body.data.filter(row => models.includes(row.model)).every(row => row.price_ready && row.status === 'active'));
    for (const before of configsBefore) {
      const after = f.db.prepare('SELECT model,default_model,billing_key FROM ai_service_configs WHERE id=?').get(before.id);
      assert.equal(after.default_model, before.default_model);
      assert.equal(after.billing_key, before.billing_key);
      assert.ok(JSON.parse(before.model).every(model => JSON.parse(after.model).includes(model)));
    }
    for (const row of historical) assert.deepEqual(f.db.prepare('SELECT * FROM billing_price_book_items WHERE id=?').get(row.id), row);
    for (const model of ['doubao-seed-2-0-lite', 'doubao-seed-2-1-turbo']) {
      const quote = await call('POST', '/billing/quotes', { service_type: 'text', model, usage: { input_token: 1000, output_token: 1000 } });
      assert.equal(quote.status, 200, JSON.stringify(quote.body));
      assert.ok(quote.body.data.amount > 0);
    }
  } finally { global.fetch = originalFetch; await f.close(); }
});

test('an explicit billing key remains shared by dated and base model IDs', async () => {
  const f = await modelCatalogFixture();
  try {
    const item = activations[0];
    const model = item.FoundationModelName;
    ai.createConfig(f.db, f.log, { service_type: 'text', provider: 'volcengine', name: 'Explicit billing fixture', model: [`${model}-260909`, model], billing_key: 'custom-contract-key' });
    const rows = prices.buildCandidateRows(f.db, item);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.billing_key === 'custom-contract-key'));
  } finally { await f.close(); }
});

test('equal scalar prices still require review when the billing unit changes', async () => {
  const f = await modelCatalogFixture();
  try {
    const model = 'doubao-seed-1-6';
    ai.createConfig(f.db, f.log, { service_type: 'text', provider: 'volcengine', name: 'Unit fixture', model, billing_key: 'unit-fixture' });
    billing.savePriceBook(f.db, f.admin.id, { name: 'Unit fixture', status: 'published', items: [{ service_type: 'text', model: 'unit-fixture', meter: 'input_token', unit_price: 80, conditions_json: { unit_size: 1000 } }] });
    const rows = prices.buildCandidateRows(f.db, { FoundationModelName: model, ChargeItems: [{ Type: 'InferencePrompt', Price: 0.0008, UnitCode: '千 tokens' }] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].new_unit_price_micro, rows[0].current_unit_price_micro);
    assert.equal(rows[0].conditions_changed, 1);
  } finally { await f.close(); }
});
