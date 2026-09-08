const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const { modelsUrl } = require('../src/services/modelDiscoveryService');

test('OpenAI discovery and additive import use saved credentials and preserve existing models across restart', async () => {
  const requests = [];
  const supplier = http.createServer((req, res) => {
    requests.push({ url: req.url, method: req.method, authorization: req.headers.authorization });
    if (req.url === '/denied/models') { res.writeHead(401); return res.end('secret must not be returned'); }
    if (req.url === '/redirect/models') { res.writeHead(302, { location: '/v1/models' }); return res.end(); }
    if (req.url === '/invalid/models') return res.end('<html>not JSON</html>');
    if (req.url === '/shape/models') return res.end('{}');
    if (req.url === '/empty/models') return res.end(JSON.stringify({ data: [] }));
    res.setHeader('x-request-id', 'upstream-list-1');
    res.end(JSON.stringify({ data: [{ id: 'new-image', name: '新图片' }, { id: 'existing-image' }, { id: 'new-image' }, { id: 'shared-legacy' }, { id: 'retired-image' }, { id: 'bad id' }] }));
  });
  supplier.listen(0, '127.0.0.1'); await once(supplier, 'listening');
  const supplierUrl = `http://127.0.0.1:${supplier.address().port}`;
  const f = await modelCatalogFixture();
  try {
    const login = await f.request('POST', '/auth/login', { username: 'catalog-admin', password: 'fixture-password' });
    const call = (method, route, body) => f.request(method, route, body, login.cookie);
    const path = `/admin/model-discovery/${f.config.id}`;
    assert.equal((await f.request('POST', `${path}/fetch`, {})).status, 401);
    const viewer = await f.request('POST', '/auth/register', { username: 'discovery-viewer', password: 'fixture-password' });
    for (const [method, route] of [['GET', '/admin/model-discovery/connections'], ['POST', `${path}/fetch`], ['POST', `${path}/import`]]) {
      assert.equal((await f.request(method, route, method === 'GET' ? undefined : {}, viewer.cookie)).status, 403);
    }
    assert.equal(requests.length, 0);
    await call('PUT', `/ai-configs/${f.config.id}`, { base_url: supplierUrl, api_key: 'saved-discovery-secret' });
    const createConfig = (models, name) => call('POST', '/ai-configs', { name, service_type: 'image', provider: 'openai', model: models, api_key: 'second-secret', base_url: supplierUrl });
    require('../src/services/aiConfigService').createConfig(f.db, f.log, { name: 'empty connection', service_type: 'image', provider: 'openai', model: [], api_key: 'second-secret', base_url: supplierUrl });
    assert.equal((await createConfig(['shared-legacy'], 'shared connection')).status, 201);
    await call('POST', '/admin/model-catalog', { config_id: f.config.id, service_type: 'image', model: 'retired-image', status: 'draft' });
    await call('POST', '/admin/model-catalog', { service_type: 'image', model: 'retired-image', status: 'retired' });
    const summary = await call('GET', '/admin/model-discovery/connections');
    assert.equal(summary.body.data.connections.some(config => config.name === 'empty connection'), true);
    assert.equal(/secret|api_key|settings|base_url/.test(JSON.stringify(summary.body)), false);
    const before = f.db.prepare('SELECT model,default_model,billing_key FROM ai_service_configs WHERE id=?').get(f.config.id);
    const result = await call('POST', `${path}/fetch`, { source: 'openai', base_url: 'https://must-not-be-used.invalid', api_key: 'must-not-be-used' });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.provider_request_id, 'upstream-list-1');
    assert.equal(result.body.data.ignored, 1);
    assert.equal(result.body.data.models.length, 4);
    assert.equal(result.body.data.models.find(model => model.id === 'existing-image').configured, true);
    assert.deepEqual(requests[0], { url: '/v1/models', method: 'GET', authorization: 'Bearer saved-discovery-secret' });
    assert.deepEqual(f.db.prepare('SELECT model,default_model,billing_key FROM ai_service_configs WHERE id=?').get(f.config.id), before);
    assert.equal(JSON.stringify(result.body).includes('saved-discovery-secret'), false);
    const selected = { models: ['new-image', 'existing-image', 'shared-legacy', 'retired-image', 'new-image'] };
    const imported = await call('POST', `${path}/import`, selected);
    assert.equal(imported.status, 200, JSON.stringify(imported.body));
    assert.deepEqual(imported.body.data.added, ['new-image', 'shared-legacy']);
    assert.equal(imported.body.data.skipped, 2);
    assert.equal((await call('POST', `${path}/import`, selected)).body.data.added.length, 0);
    assert.equal((await call('POST', `${path}/import`, { models: ['atomic-model', 'bad id'] })).status, 400);
    assert.equal((await call('POST', `${path}/import`, { models: Array.from({ length: 201 }, (_, i) => `many-${i}`) })).status, 400);
    assert.equal((await call('POST', `${path}/fetch`, { source: 'unsupported' })).status, 400);
    assert.equal((await call('POST', `${path}/fetch`, { source: 'openai', page: 2 })).status, 400);
    for (const endpoint of ['denied', 'redirect', 'invalid', 'shape']) {
      await call('PUT', `/ai-configs/${f.config.id}`, { base_url: `${supplierUrl}/${endpoint}` });
      const failed = await call('POST', `${path}/fetch`, { source: 'openai' });
      assert.equal(failed.status, 400, endpoint);
      assert.equal(JSON.stringify(failed.body).includes('secret'), false);
    }
    assert.equal(requests.filter(request => request.url === '/v1/models').length, 1, 'redirects never forward credentials');
    await call('PUT', `/ai-configs/${f.config.id}`, { base_url: `${supplierUrl}/empty` });
    assert.deepEqual((await call('POST', `${path}/fetch`, { source: 'openai' })).body.data.models, []);
    await f.restart();
    const rows = (await call('GET', '/admin/model-catalog')).body.data;
    assert.equal(rows.find(row => row.model === 'new-image').status, 'draft');
    assert.equal(rows.find(row => row.model === 'shared-legacy').status, 'legacy');
    assert.equal(rows.find(row => row.model === 'existing-image').status, 'legacy');
    assert.equal(rows.find(row => row.model === 'retired-image').status, 'retired');
    assert.equal(rows.some(row => row.model === 'atomic-model'), false);
    const after = f.db.prepare('SELECT model,default_model,billing_key FROM ai_service_configs WHERE id=?').get(f.config.id);
    assert.equal(after.default_model, before.default_model);
    assert.equal(after.billing_key, before.billing_key);
    assert.deepEqual(JSON.parse(after.model), [...JSON.parse(before.model), 'new-image', 'shared-legacy']);
    assert.equal((await call('GET', '/ai-configs?selectable=true')).body.data.some(config => config.model.includes('new-image')), false);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_transactions WHERE type='authorization'").get().n, 0);
  } finally { await f.close(); await new Promise(resolve => supplier.close(resolve)); }
});

test('Volcengine endpoint discovery signs a single requested page and never substitutes foundation names', async t => {
  const f = await modelCatalogFixture();
  const nativeFetch = global.fetch;
  const upstream = [];
  t.mock.method(global, 'fetch', async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return nativeFetch(url, init);
    assert.equal(new URL(url).host, 'open.volcengineapi.com');
    assert.equal(new URL(url).searchParams.get('Action'), 'ListEndpoints');
    assert.match(init.headers.Authorization, /^HMAC-SHA256 Credential=TEST_AK\//);
    assert.equal(init.redirect, 'manual');
    upstream.push(JSON.parse(init.body));
    const second = JSON.parse(init.body).PageNumber === 2;
    return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'volc-list-page' }, Result: { TotalCount: 101, Items: second ? [{ Id: 'ep-second', Name: '第二页', Status: 'Running' }] : Array.from({ length: 100 }, (_, i) => ({ Id: `ep-${i}`, Name: `模型 ${i}`, Status: 'Running', ModelReference: { FoundationModel: { Name: 'family-name', ModelVersion: '1.0' } } })) } }), { status: 200 });
  });
  try {
    const login = await f.request('POST', '/auth/login', { username: 'catalog-admin', password: 'fixture-password' });
    const call = (method, route, body) => f.request(method, route, body, login.cookie);
    const credential = await call('POST', '/ai-configs', { service_type: 'model_ark_asset', name: 'ModelArk test', provider: 'volcengine', base_url: 'https://ark.cn-beijing.volces.com/api/v3', settings: JSON.stringify({ access_key_id: 'TEST_AK', secret_access_key: 'TEST_SK', sign_region: 'cn-beijing', project_name: 'default' }), model: [] });
    assert.equal(credential.status, 201, JSON.stringify(credential.body));
    const path = `/admin/model-discovery/${f.config.id}`;
    assert.equal((await call('POST', `${path}/fetch`, { source: 'volcengine_endpoints' })).status, 400);
    assert.equal(upstream.length, 0);
    const body = { source: 'volcengine_endpoints', credential_config_id: credential.body.data.id };
    const first = await call('POST', `${path}/fetch`, body);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.next_page, 2);
    assert.equal(first.body.data.models[0].id, 'ep-0');
    assert.equal(JSON.stringify(first.body).includes('family-name'), false);
    assert.equal(JSON.stringify(first.body).includes('TEST_SK'), false);
    assert.equal(upstream.length, 1);
    const second = await call('POST', `${path}/fetch`, { ...body, page: 2 });
    assert.equal(second.body.data.next_page, null);
    assert.deepEqual(upstream[1], { PageNumber: 2, PageSize: 100, ProjectName: 'default' });
    assert.equal((await call('POST', `${path}/import`, { models: ['ep-second'] })).status, 200);
    await f.restart();
    assert.equal((await call('GET', '/admin/model-catalog')).body.data.find(row => row.model === 'ep-second').status, 'draft');
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('OpenAI model URLs preserve custom base paths and reject embedded credentials or query overrides', () => {
  assert.equal(modelsUrl('https://api.openai.com'), 'https://api.openai.com/v1/models');
  assert.equal(modelsUrl('https://example.com/v1/'), 'https://example.com/v1/models');
  assert.equal(modelsUrl('https://example.com/custom/api/v3'), 'https://example.com/custom/api/v3/models');
  assert.equal(modelsUrl('https://example.com/v1/models'), 'https://example.com/v1/models');
  for (const url of ['file:///tmp/key', 'https://user:password@example.com', 'https://example.com?api_key=secret', 'https://example.com#fragment']) assert.throws(() => modelsUrl(url));
});
