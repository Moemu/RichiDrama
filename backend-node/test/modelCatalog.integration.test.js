const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');

test('catalog lifecycle and versioned prices preserve historical configurations and authorizations across restart', async () => {
  const f = await modelCatalogFixture();
  try {
    const login = await f.request('POST', '/auth/login', { username: 'catalog-admin', password: 'fixture-password' });
    assert.equal(login.status, 200);
    const call = (method, route, body) => f.request(method, route, body, login.cookie);
    const initial = await call('GET', '/admin/model-catalog');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.data.find(row => row.model === 'existing-image').status, 'legacy');
    assert.equal(JSON.stringify(initial.body).includes('fixture-only'), false);
    const signup = await f.request('POST', '/auth/register', { username: 'catalog-creator', password: 'fixture-password' });
    assert.equal((await f.request('GET', '/admin/model-catalog', undefined, signup.cookie)).status, 403);
    assert.equal((await f.request('POST', '/admin/model-catalog', {}, signup.cookie)).status, 403);
    const draft = { config_id: f.config.id, service_type: 'image', model: 'new-image', display_name: '新图片模型', status: 'draft' };
    assert.equal((await call('POST', '/admin/model-catalog', draft)).status, 200);
    assert.equal((await call('GET', '/ai-configs?selectable=true')).body.data.some(c => c.model.includes('new-image')), false);
    assert.equal((await call('POST', '/admin/model-catalog', { ...draft, status: 'active' })).status, 400);
    const denied = await call('POST', '/billing/quotes', { service_type: 'image', model: 'new-image', usage: { image: 1 } });
    assert.equal(denied.status, 400);
    const pricing = { service_type: 'image', model: 'new-image', price_book_id: f.book.id, items: [{ meter: 'image', unit_price: 2 }] };
    const bookCount = f.db.prepare('SELECT COUNT(*) n FROM billing_price_books').get().n;
    assert.equal((await call('POST', '/admin/model-catalog/price-draft', { ...pricing, items: [{ meter: 'image', unit_price: 0 }] })).status, 400);
    assert.equal((await call('POST', '/admin/model-catalog/price-draft', { ...pricing, items: [{ meter: 'image', unit_price: 2, conditions_json: { unit_size: -1 } }] })).status, 400);
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM billing_price_books').get().n, bookCount);
    const saved = await call('POST', '/admin/model-catalog/price-draft', pricing);
    assert.equal(saved.status, 201, JSON.stringify(saved.body));
    const next = saved.body.data;
    assert.equal(next.items.find(item => item.model === 'other-image').unit_price, 1);
    assert.equal((await call('POST', `/admin/price-books/${next.id}/publish`, {})).status, 400);
    const publish = await call('POST', `/admin/price-books/${next.id}/publish`, { confirm: true, reason: 'test catalog price', idempotency_key: 'catalog-test-publish', notice_title: '验收', notice_body: '验收价格' });
    assert.equal(publish.status, 200, JSON.stringify(publish.body));
    assert.equal((await call('POST', '/admin/model-catalog', { ...draft, status: 'active' })).status, 200);
    assert.equal((await call('GET', '/ai-configs?selectable=true')).body.data.some(c => c.model.includes('new-image')), true);
    const clientConfig = { service_type: 'image', name: '新连接', provider: 'fixture', base_url: 'http://supplier.invalid', api_key: 'fixture-only', model: ['connection-model', 'existing-image'], catalog_managed: true };
    assert.equal((await call('POST', '/ai-configs', clientConfig)).status, 201);
    const withConnection = (await call('GET', '/admin/model-catalog')).body.data;
    assert.equal(withConnection.find(row => row.model === 'connection-model').status, 'draft');
    assert.equal(withConnection.find(row => row.model === 'existing-image').status, 'legacy');
    const authorizationBody = { service_type: 'image', model: 'new-image', usage: { image: 1 }, idempotency_key: 'before-retire' };
    const billing = require('../src/services/billingService');
    const authorization = billing.createAuthorization(f.db, f.admin, authorizationBody);
    assert.equal((await call('POST', '/admin/model-catalog', { ...draft, status: 'retired' })).status, 200);
    assert.equal((await call('POST', '/billing/quotes', authorizationBody)).status, 400);
    assert.throws(() => billing.createAuthorization(f.db, f.admin, { ...authorizationBody, idempotency_key: 'after-retire' }), /下架/);
    assert.equal(billing.createAuthorization(f.db, f.admin, authorizationBody).reused, true);
    // Real business HTTP route must stop before submitting an image request.
    const dramaId = Number(f.db.prepare("INSERT INTO dramas(title,owner_user_id,created_at,updated_at) VALUES ('catalog test',?,?,?)").run(f.admin.id, new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
    const rejectedGeneration = await call('POST', '/images', { drama_id: dramaId, model: 'new-image', prompt: 'isolated rejection test', idempotency_key: 'retired-image' });
    assert.match(JSON.stringify(rejectedGeneration.body), /下架/);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM image_generations WHERE model='new-image'").get().n, 0);
    assert.equal((await call('POST', '/admin/model-catalog', { service_type: 'image', model: 'existing-image', status: 'retired' })).status, 400);
    const before = f.db.prepare('SELECT model,default_model FROM ai_service_configs WHERE id=?').get(f.config.id);
    await f.restart();
    const after = await call('GET', '/admin/model-catalog');
    assert.equal(after.body.data.find(row => row.model === 'new-image').status, 'retired');
    assert.equal(after.body.data.find(row => row.model === 'existing-image').status, 'legacy');
    assert.deepEqual(f.db.prepare('SELECT model,default_model FROM ai_service_configs WHERE id=?').get(f.config.id), before);
    const settled = billing.settleAuthorization(f.db, f.admin, authorization.authorization_id, { usage: { image: 1 } });
    assert.equal(settled.charged, 2);
    assert.equal(billing.settleAuthorization(f.db, f.admin, authorization.authorization_id, { usage: { image: 1 } }).reused, true);
  } finally { await f.close(); }
});

test('catalog readiness matches supported billing meters', () => {
  const { priceReady } = require('../src/services/modelCatalogService');
  const items = (...meters) => meters.map(meter => ({ meter }));
  assert.equal(priceReady('text', items('input_token')), false);
  assert.equal(priceReady('text', items('input_token', 'output_token')), true);
  assert.equal(priceReady('text', items('request')), true);
  assert.equal(priceReady('video', items('output_token')), true);
  assert.equal(priceReady('video', items('character')), false);
  assert.equal(priceReady('tts', items('second')), false);
  assert.equal(priceReady('tts', items('character')), true);
  assert.equal(priceReady('video_postprocess', items('millisecond')), true);
});
