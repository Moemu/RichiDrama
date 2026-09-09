const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const { model, activation } = require('./helpers/seedreamProPrices');
const ai = require('../src/services/aiConfigService');
const auth = require('../src/services/authService');
const prices = require('../src/services/providerPriceService');
const providers = require('../src/services/providerConnectionService');

async function login(f, username = f.admin.username) {
  return (await f.request('POST', '/auth/login', { username, password: 'fixture-password' })).cookie;
}

test('shared connections store credentials once, classify imports atomically and preserve scoped model selection after restart', async () => {
  const f = await modelCatalogFixture();
  try {
    const cookie = await login(f);
    const member = auth.createUser(f.db, { username: 'connection-member', password: 'fixture-password' }, f.admin.id);
    const memberCookie = await login(f, member.username);
    assert.equal((await f.request('GET', '/admin/provider-connections', undefined, memberCookie)).status, 403);
    const made = await f.request('POST', '/admin/provider-connections', { name: 'Shared fixture', provider: 'volces', base_url: 'http://supplier.invalid/api/v3', api_key: 'isolated-connection-key' }, cookie);
    assert.equal(made.status, 200, JSON.stringify(made.body));
    assert.equal(JSON.stringify(made.body).includes('isolated-connection-key'), false);
    const id = made.body.data.id;
    const route = `/admin/model-discovery/provider-${id}/import`;
    assert.equal((await f.request('POST', route, { models: [model, 'unclassified'] }, cookie)).status, 400);
    assert.equal(providers.bindings(f.db, id).length, 0);
    assert.equal((await f.request('POST', route, { models: [model], capabilities: { [model]: 'video' } }, cookie)).status, 400);
    const imported = await f.request('POST', route, { models: [model, 'doubao-seedance-2-0-fast-260128', 'custom-text'], capabilities: { 'custom-text': 'text' } }, cookie);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.equal(imported.body.data.added.length, 3);
    const bindings = providers.bindings(f.db, id);
    assert.deepEqual(bindings.map(row => row.service_type), ['image', 'text', 'video']);
    assert.ok(bindings.every(row => row.api_key === 'isolated-connection-key'));
    assert.ok(f.db.prepare('SELECT api_key FROM ai_service_configs WHERE provider_connection_id=?').all(id).every(row => row.api_key === ''));
    const image = bindings.find(row => row.service_type === 'image');
    assert.ok(ai.listConfigs(f.db, 'storyboard_image').some(row => row.id === image.id));
    assert.equal(require('../src/services/imageClient').getDefaultImageConfig(f.db, model, null, 'storyboard_image').id, image.id);
    assert.equal(require('../src/services/aiClient').getDefaultConfig(f.db, 'image').id, f.config.id);
    const sceneBody = { key: 'default_resource_image_generation', service_type: 'image', config_id: image.id, model_override: model, routing_version: 'capability-default-v1' };
    assert.equal((await f.request('POST', '/scene-model-map', sceneBody, cookie)).status, 400, 'draft model cannot become a scene default');
    require('../src/services/billingService').savePriceBook(f.db, f.admin.id, { name: 'New image default fixture', status: 'published', items: [{ service_type: 'image', model, meter: 'image', unit_price: 1 }] });
    assert.equal((await f.request('POST', '/admin/model-catalog', { service_type: 'image', model, status: 'active' }, cookie)).status, 200);
    assert.equal((await f.request('POST', '/scene-model-map', sceneBody, cookie)).status, 201);
    assert.equal(require('../src/services/aiClient').getDefaultConfig(f.db, 'image').id, image.id);
    assert.equal(ai.getConfig(f.db, f.config.id).is_default, true, 'original default flag remains stored');
    assert.equal(require('../src/services/imageClient').getDefaultImageConfig(f.db, 'existing-image').id, f.config.id, 'explicit request still wins');
    const storyboardScene = { ...sceneBody, key: 'default_storyboard_image_generation', service_type: 'storyboard_image' };
    assert.equal((await f.request('POST', '/scene-model-map', storyboardScene, cookie)).status, 201);
    assert.equal(require('../src/services/imageClient').getDefaultImageConfig(f.db, null, null, 'storyboard_image').id, image.id);
    const duplicate = await f.request('POST', route, { models: [model] }, cookie);
    assert.equal(duplicate.body.data.skipped, 1);
    const tenant = require('../src/services/tenantService').writeTenant(f.db, f.admin.id, { name: 'Isolated connection group' });
    assert.ok(ai.listConfigs(f.db, 'image', { tenant_id: tenant.id }).every(row => row.api_key !== 'isolated-connection-key'));
    assert.equal((await f.request('PUT', `/ai-configs/${image.id}`, { api_key: 'wrong-place' }, cookie)).status, 400);
    assert.equal((await f.request('PUT', `/ai-configs/${image.id}`, { service_type: 'video' }, cookie)).status, 400);
    const updated = await f.request('PATCH', `/admin/provider-connections/${id}`, { api_key: 'replacement-fixture-key' }, cookie);
    assert.equal(updated.status, 200);
    assert.ok(providers.bindings(f.db, id).every(row => row.api_key === 'replacement-fixture-key'));
    await f.restart();
    assert.equal(ai.getConfig(f.db, image.id).api_key, 'replacement-fixture-key');
    assert.equal(ai.getConfig(f.db, f.config.id).api_key, 'fixture-only');
    assert.deepEqual(ai.getConfig(f.db, f.config.id).model, ['existing-image', 'other-image']);
    assert.equal(f.db.prepare('SELECT status FROM ai_model_catalog WHERE service_type=? AND model=?').get('image', model).status, 'active');
    assert.equal(require('../src/services/aiClient').getDefaultConfig(f.db, 'image').id, image.id);
    const listed = await f.request('GET', '/admin/provider-connections', undefined, cookie);
    assert.equal(JSON.stringify(listed.body).includes('replacement-fixture-key'), false);
    assert.equal((await f.request('PATCH', `/admin/provider-connections/${id}`, { is_active: false }, cookie)).status, 200);
    assert.ok(providers.bindings(f.db, id).every(row => !row.is_active));
  } finally { await f.close(); }
});

test('legacy mixed video connection keeps its IDs and defaults while corrected image mapping invalidates price-sync reuse over HTTP', async () => {
  const f = await modelCatalogFixture();
  const originalFetch = global.fetch;
  try {
    const cookie = await login(f);
    const legacy = ai.createConfig(f.db, f.log, { service_type: 'video', provider: 'volces', name: 'Mixed legacy', base_url: 'http://supplier.invalid/api/v3', api_key: 'legacy-fixture-key', model: ['doubao-seedance-2-0-fast-260128', model], default_model: 'doubao-seedance-2-0-fast-260128', is_default: true });
    ai.createConfig(f.db, f.log, { service_type: 'model_ark_asset', provider: 'volcengine', name: 'Isolated AK/SK', model: ['asset'], settings: JSON.stringify({ access_key_id: 'test-ak', secret_access_key: 'test-sk' }) });
    const originalPrices = f.db.prepare('SELECT * FROM billing_price_book_items').all();
    let calls = 0;
    global.fetch = async (url, init) => {
      if (String(url).startsWith('http://127.0.0.1:')) return originalFetch(url, init);
      assert.match(String(url), /^https:\/\/open\.volcengineapi\.com/);
      calls++;
      return new Response(JSON.stringify({ ResponseMetadata: { RequestId: `mock-${calls}` }, Result: { TotalCount: 1, Items: [activation] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const sync = async () => {
      const result = await f.request('POST', '/admin/provider-prices/volcengine/sync', {}, cookie);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body.data;
    };
    const first = await sync();
    assert.equal(first.candidates.find(row => row.provider_model === model).mapping_status, 'unmapped');
    const bad = await f.request('POST', `/admin/model-discovery/${legacy.id}/import`, { models: ['doubao-seedream-4-5'] }, cookie);
    assert.equal(bad.status, 400);
    const converted = await f.request('POST', '/admin/provider-connections/convert', { config_id: legacy.id }, cookie);
    assert.equal(converted.status, 200, JSON.stringify(converted.body));
    const id = converted.body.data.id;
    const credential = ai.listConfigs(f.db, 'model_ark_asset')[0];
    const discovery = await f.request('POST', `/admin/model-discovery/provider-${id}/fetch`, { source: 'volcengine_activations', credential_config_id: credential.id }, cookie);
    assert.equal(discovery.status, 200, JSON.stringify(discovery.body));
    assert.equal(discovery.body.data.models[0].capability, 'image');
    assert.equal(discovery.body.data.models[0].configured, false, 'old video membership does not mark the image capability configured');
    const same = ai.getConfig(f.db, legacy.id);
    for (const key of ['id', 'default_model', 'billing_key', 'endpoint', 'query_endpoint', 'is_default', 'api_key']) assert.deepEqual(same[key], legacy[key], key);
    assert.deepEqual(JSON.parse(f.db.prepare('SELECT model FROM ai_service_configs WHERE id=?').get(legacy.id).model), legacy.model, 'stored historical models remain unchanged');
    assert.deepEqual(same.model, ['doubao-seedance-2-0-fast-260128'], 'shared connection excludes known wrong capabilities from new choices');
    assert.equal((await f.request('POST', `/admin/model-discovery/provider-${id}/import`, { models: [model] }, cookie)).status, 200);
    const second = await sync();
    assert.equal(second.status, 'completed');
    assert.notEqual(first.response_hash, second.response_hash);
    const mapped = second.candidates.filter(row => row.provider_model === model);
    assert.deepEqual(mapped.map(row => row.meter).sort(), ['image', 'input_image']);
    assert.ok(mapped.every(row => row.mapping_status === 'mapped' && row.service_type === 'image'));
    assert.equal((await sync()).status, 'unchanged');
    assert.deepEqual(f.db.prepare('SELECT * FROM billing_price_book_items').all(), originalPrices);
    assert.equal(prices.syncView(f.db, first.id).candidates.find(row => row.provider_model === model).mapping_status, 'unmapped');
    await f.restart();
    assert.equal(ai.getConfig(f.db, legacy.id).default_model, legacy.default_model);
    assert.deepEqual(prices.buildCandidateRows(f.db, activation).map(row => row.meter).sort(), ['image', 'input_image']);
    assert.equal(prices.syncView(f.db, first.id).candidates.find(row => row.provider_model === model).mapping_status, 'unmapped');
  } finally { global.fetch = originalFetch; await f.close(); }
});
