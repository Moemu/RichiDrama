const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const activations = require('./helpers/volcengineMiniSeedream4Prices.json');
const ai = require('../src/services/aiConfigService');
const prices = require('../src/services/providerPriceService');

test('account Mini and Seedream 4 prices sync, publish and quote through HTTP after restart', async () => {
  const f = await modelCatalogFixture();
  const originalFetch = global.fetch;
  try {
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    for (const [service_type, model] of [['text', 'doubao-seed-2-0-mini'], ['image', 'doubao-seedream-4-0'], ['storyboard_image', 'doubao-seedream-4-0']]) {
      ai.createConfig(f.db, f.log, { service_type, provider: 'volcengine', name: model, model, billing_key: model });
    }
    ai.createConfig(f.db, f.log, { service_type: 'model_ark_asset', provider: 'volcengine', name: 'Fixture credentials', model: 'asset', settings: JSON.stringify({ access_key_id: 'fixture-ak', secret_access_key: 'fixture-sk' }) });
    const historical = f.db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=?').all(f.book.id);
    global.fetch = async (url, init) => {
      if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, init);
      assert.match(String(url), /^https:\/\/open\.volcengineapi\.com/);
      return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'fixture-prices' }, Result: { TotalCount: 2, Items: activations } }));
    };
    const sync = await f.request('POST', '/admin/provider-prices/volcengine/sync', {}, cookie);
    assert.equal(sync.status, 200, JSON.stringify(sync.body));
    const rows = sync.body.data.candidates;
    assert.equal(rows.length, 4);
    assert.ok(rows.every(row => row.mapping_status === 'mapped' && row.review_status === 'pending'));
    const input = rows.find(row => row.meter === 'input_token');
    const output = rows.find(row => row.meter === 'output_token');
    assert.deepEqual(input.new_conditions.usage_tiers.map(tier => tier.unit_price_points), [20, 40, 80]);
    assert.deepEqual(output.new_conditions.usage_tiers.map(tier => tier.unit_price_points), [200, 400, 800]);
    assert.deepEqual(input.new_conditions.usage_tiers.map(tier => [tier.min_inclusive, tier.max_inclusive]), [[0, 32768], [32769, 131072], [131073, 262144]]);
    assert.ok(rows.filter(row => row.meter === 'image').every(row => row.new_conditions.rates.every(rate => rate.unit_price_points === 20)));
    const repeated = await f.request('POST', '/admin/provider-prices/volcengine/sync', {}, cookie);
    assert.equal(repeated.body.data.status, 'unchanged');
    assert.deepEqual(f.db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=?').all(f.book.id), historical);
    const at = new Date().toISOString();
    f.db.prepare("INSERT INTO provider_price_source_checks(provider,ark_status,billing_status,checked_at,updated_at) VALUES ('volcengine','success','success',?,?)").run(at, at);
    const base = `/admin/provider-price-syncs/${sync.body.data.id}`;
    assert.equal((await f.request('POST', `${base}/create-draft`, {}, cookie)).status, 400);
    for (const row of rows) assert.equal((await f.request('PATCH', `${base}/candidates/${row.id}`, { review_status: 'accepted' }, cookie)).status, 200);
    const draft = await f.request('POST', `${base}/create-draft`, {}, cookie);
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const published = await f.request('POST', `/admin/price-books/${draft.body.data.id}/publish`, { confirm: true, reason: 'isolated fixture', idempotency_key: 'mini-seedream4-fixture' }, cookie);
    assert.equal(published.status, 200, JSON.stringify(published.body));
    await f.restart();
    assert.deepEqual((await f.request('GET', base, undefined, cookie)).body.data.candidates.map(row => row.new_conditions), rows.map(row => row.new_conditions));
    for (const [tokens, price] of [[32768, 20], [32769, 40], [131072, 40], [131073, 80], [262144, 80]]) {
      const quote = await f.request('POST', '/billing/quotes', { service_type: 'text', model: 'doubao-seed-2-0-mini', usage: { input_token: tokens, output_token: 1000 } }, cookie);
      assert.equal(quote.status, 200, JSON.stringify(quote.body));
      assert.equal(quote.body.data.amount, Math.round((tokens * price / 1000000 + price / 100) * 10000) / 10000);
    }
    assert.equal((await f.request('POST', '/billing/quotes', { service_type: 'text', model: 'doubao-seed-2-0-mini', usage: { input_token: 262145 } }, cookie)).status, 400);
    for (const service_type of ['image', 'storyboard_image']) for (const has_image_input of [false, true]) {
      const quote = await f.request('POST', '/billing/quotes', { service_type, model: 'doubao-seedream-4-0', usage: { image: 1 }, pricing_context: { has_image_input } }, cookie);
      assert.equal(quote.status, 200, JSON.stringify(quote.body));
      assert.equal(quote.body.data.amount, 20);
    }
    for (const row of historical) assert.deepEqual(f.db.prepare('SELECT * FROM billing_price_book_items WHERE id=?').get(row.id), row);
  } finally { global.fetch = originalFetch; await f.close(); }
});

test('incomplete or changed account pricing shapes stay unmapped', async () => {
  const f = await modelCatalogFixture();
  try {
    for (const [service_type, item] of [['text', activations[0]], ['image', activations[1]]]) ai.createConfig(f.db, f.log, { service_type, provider: 'volcengine', name: item.FoundationModelName, model: item.FoundationModelName });
    const changes = [
      [0, item => item.MultiChargeItems.pop()],
      [0, item => item.MultiChargeItems.reverse()],
      [0, item => { item.MultiChargeItems[2].MaxPromptTokens = 524288; }],
      [0, item => { item.MultiChargeItems[0].MaxCompletionTokens = 4096; }],
      [0, item => { item.MultiChargeItems[0].ChargeItems.find(charge => charge.Type === 'InferencePrompt').Price = null; }],
      [0, item => { item.MultiChargeItems[0].ChargeItems = item.MultiChargeItems[0].ChargeItems.filter(charge => charge.Type !== 'InferencePrompt'); }],
      [0, item => item.MultiChargeItems[0].ChargeItems.push(item.MultiChargeItems[0].ChargeItems.find(charge => charge.Type === 'InferencePrompt'))],
      [1, item => item.MultiChargeItems.push(item.MultiChargeItems[0])],
      [1, item => { item.MultiChargeItems[0].MaxPixels = 4096; }],
      [1, item => { item.MultiChargeItems[0].ChargeItems[0].UnitCode = 'unknown'; }],
    ];
    for (const [index, mutate] of changes) {
      const item = structuredClone(activations[index]); mutate(item);
      const rows = prices.buildCandidateRows(f.db, item);
      assert.ok(rows.length && rows.every(row => row.mapping_status === 'unmapped'), `${index}: ${mutate}`);
    }
  } finally { await f.close(); }
});
