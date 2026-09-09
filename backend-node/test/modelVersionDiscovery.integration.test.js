const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const ai = require('../src/services/aiConfigService');
const billing = require('../src/services/billingService');

test('foundation discovery imports date versions and sends the exact version through billed HTTP generation', async () => {
  const f = await modelCatalogFixture();
  const originalFetch = global.fetch;
  const family = 'doubao-seed-2-1-turbo';
  const model = `${family}-260628`;
  const sentModels = [];
  const supplier = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks));
      sentModels.push(body.model);
      if (body.model !== model) { res.writeHead(404); return res.end(JSON.stringify({ error: { message: 'InvalidEndpointOrModel.NotFound' } })); }
      res.setHeader('content-type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ id: 'version-fixture', choices: [{ delta: { content: JSON.stringify([{ episode: 1, title: 'Fixture', content: 'Story' }]) } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: 'version-fixture', choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  supplier.listen(0, '127.0.0.1'); await once(supplier, 'listening');
  try {
    const cookie = (await f.request('POST', '/auth/login', { username: f.admin.username, password: 'fixture-password' })).cookie;
    const call = (method, route, body) => f.request(method, route, body, cookie);
    const shared = await call('POST', '/admin/provider-connections', { name: 'Version fixture', provider: 'volcengine', base_url: `http://127.0.0.1:${supplier.address().port}`, api_key: 'fixture-only' });
    assert.equal(shared.status, 200);
    const route = `/admin/model-discovery/provider-${shared.body.data.id}`;
    const credential = ai.createConfig(f.db, f.log, { service_type: 'model_ark_asset', provider: 'volcengine', name: 'Fixture AK', model: 'asset', settings: JSON.stringify({ access_key_id: 'fixture-ak', secret_access_key: 'fixture-sk' }) });
    const queries = [];
    global.fetch = async (url, init) => {
      if (new URL(url).hostname === '127.0.0.1') return originalFetch(url, init);
      assert.equal(new URL(url).hostname, 'open.volcengineapi.com');
      const action = new URL(url).searchParams.get('Action');
      const body = JSON.parse(init.body); queries.push({ action, body });
      const items = action === 'ListModelActivations' ? [{ FoundationModelName: family, State: 'Available' }] : [
        { FoundationModelName: family, ModelVersion: '260628', Status: 'Published' },
        { FoundationModelName: family, ModelVersion: '260628', Status: 'Published' },
        { FoundationModelName: family, ModelVersion: 'invalid' },
        { FoundationModelName: 'other-model', ModelVersion: '260628' },
      ];
      return new Response(JSON.stringify({ ResponseMetadata: { RequestId: 'version-list-fixture' }, Result: { TotalCount: items.length, Items: items } }));
    };
    const common = { credential_config_id: credential.id };
    const families = await call('POST', `${route}/fetch`, { ...common, source: 'volcengine_activations' });
    assert.equal(families.body.data.models[0].importable, false);
    assert.equal(families.body.data.models[0].foundation_model, family);
    assert.equal((await call('POST', `${route}/import`, { source: 'volcengine_activations', models: [family] })).status, 400);
    assert.equal((await call('POST', `${route}/fetch`, { ...common, source: 'volcengine_versions' })).status, 400);
    const versions = await call('POST', `${route}/fetch`, { ...common, source: 'volcengine_versions', foundation_model: family });
    assert.equal(versions.status, 200, JSON.stringify(versions.body));
    assert.deepEqual(versions.body.data.models.map(row => row.id), [model]);
    assert.equal(versions.body.data.ignored, 2);
    assert.equal(queries[1].action, 'ListFoundationModelVersions');
    assert.equal(queries[1].body.FoundationModelName, family);
    assert.equal((await call('POST', `${route}/import`, { source: 'volcengine_versions', models: [model] })).status, 200);
    assert.equal((await call('POST', `${route}/import`, { source: 'volcengine_versions', models: [model] })).body.data.added.length, 0);
    const config = ai.listConfigs(f.db, 'text').find(row => row.model.includes(model));
    assert.ok(config);
    billing.savePriceBook(f.db, f.admin.id, { name: 'Version fixture price', status: 'published', items: ['request', 'input_token', 'output_token'].map(meter => ({ service_type: 'text', model, meter, unit_price: 1, conditions_json: { unit_size: meter === 'request' ? 1 : 1000000 } })) });
    assert.equal((await call('POST', '/admin/model-catalog', { service_type: 'text', model, status: 'active' })).status, 200);
    const historical = f.db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=?').all(f.book.id);
    const creator = require('../src/services/authService').createUser(f.db, { username: 'version-creator', password: 'fixture-password' }, f.admin.id);
    billing.adjustBalance(f.db, f.admin.id, creator.id, 100, 'Fixture balance');
    const creatorCookie = (await f.request('POST', '/auth/login', { username: creator.username, password: 'fixture-password' })).cookie;
    const generateCall = (method, route, body) => f.request(method, route, body, creatorCookie);
    const project = await generateCall('POST', '/dramas', { title: 'Version fixture' });
    assert.equal(project.status, 201);
    const created = await generateCall('POST', '/tools/script_writing/runs', { drama_id: project.body.data.id, model, idempotency_key: 'version-generation', input: { premise: 'Fixture story' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    let run;
    for (let attempt = 0; attempt < 100; attempt++) {
      run = (await generateCall('GET', `/tool-runs/${created.body.data.id}`)).body.data;
      if (['completed', 'failed'].includes(run.status)) break;
      await delay(25);
    }
    assert.equal(run.status, 'completed', run.error_msg);
    assert.deepEqual(sentModels, [model]);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(run.billing_authorization_id).n, 1);
    await f.restart();
    assert.equal((await generateCall('GET', `/tool-runs/${run.id}`)).body.data.model, model);
    assert.equal((await generateCall('GET', `/tool-runs/${run.id}`)).body.data.status, 'completed');
    assert.deepEqual(ai.getConfig(f.db, config.id).model, [model]);
    for (const row of historical) assert.deepEqual(f.db.prepare('SELECT * FROM billing_price_book_items WHERE id=?').get(row.id), row);
    assert.deepEqual(sentModels, [model]);
  } finally { global.fetch = originalFetch; await new Promise(resolve => supplier.close(resolve)); await f.close(); }
});
