const test = require('node:test');
const assert = require('node:assert/strict');
const { modelCatalogFixture } = require('./helpers/modelCatalogFixture');
const ai = require('../src/services/aiConfigService');
const providers = require('../src/services/providerConnectionService');
const tenants = require('../src/services/tenantService');
const billing = require('../src/services/billingService');
const auth = require('../src/services/authService');

const credentials = { provider: 'volcengine', base_url: 'http://supplier.invalid/api/v3', api_key: 'shared-fixture-secret' };
function create(f, input = {}) {
  return ai.createConfig(f.db, f.log, { ...credentials, name: 'Legacy image', service_type: 'image', model: ['doubao-seedream-4-5'], ...input });
}
async function login(f, username = f.admin.username) {
  return (await f.request('POST', '/auth/login', { username, password: 'fixture-password' })).cookie;
}

test('four legacy Ark configurations attach over HTTP without replacing defaults, transport, tenant bindings or history', async () => {
  const f = await modelCatalogFixture();
  try {
    const cookie = await login(f);
    const configs = [
      create(f, { name: '火山引擎（方舟） 分镜图片生成', service_type: 'storyboard_image', is_default: true, api_protocol: 'volcengine', endpoint: '/images/generations' }),
      create(f, { name: '火山引擎（方舟） 文本生成图片', service_type: 'image', is_default: true, api_protocol: 'openai', base_url: credentials.base_url + '/', endpoint: '/images/generations' }),
      create(f, { name: '火山引擎 即梦 视频', service_type: 'video', provider: 'volces', model: ['doubao-seedance-2-0-fast-260128'], is_default: true, api_protocol: 'volcengine_omni', endpoint: '/contents/generations/tasks', query_endpoint: '/contents/generations/tasks/{taskId}', settings: JSON.stringify({ video_capabilities: { mode: 'omni' } }) }),
      create(f, { name: '火山引擎 即梦 文本', service_type: 'text', provider: 'volc', model: ['doubao-seed-2-0-pro'], is_default: true, api_protocol: 'openai', endpoint: '/chat/completions', billing_key: 'legacy-text-key' }),
    ];
    const group = tenants.writeTenant(f.db, f.admin.id, { name: 'Legacy bound group' });
    tenants.replaceBindings(f.db, group.id, { ai_config_ids: configs.map(config => config.id), price_book_id: f.book.id });
    f.db.prepare('INSERT INTO ai_model_map(key,service_type,config_id,model_override) VALUES(?,?,?,?)').run('legacy_storyboard', 'storyboard_image', configs[0].id, configs[0].default_model);
    const taskService = require('../src/services/taskService');
    const task = taskService.createTask(f.db, f.log, 'image_generation', 'legacy-resource', f.admin.id);
    taskService.updateTaskStatus(f.db, task.id, 'processing', 35, 'historical progress');
    const request = { service_type: 'image', model: 'existing-image', usage: { image: 1 }, idempotency_key: 'before-connection-attach' };
    const authorization = billing.createAuthorization(f.db, f.admin, request);
    const historic = () => ({
      task: f.db.prepare('SELECT * FROM async_tasks WHERE id=?').get(task.id),
      prices: f.db.prepare('SELECT * FROM billing_price_book_items WHERE price_book_id=? AND model IN (?,?) ORDER BY id').all(f.book.id, 'existing-image', 'other-image'),
      scenes: f.db.prepare('SELECT * FROM ai_model_map ORDER BY id').all(),
      bindings: f.db.prepare('SELECT * FROM tenant_ai_config_bindings WHERE tenant_id=? ORDER BY id').all(group.id),
      authorization: billing.getAuthorization(f.db, authorization.authorization_id),
    });
    const before = historic();
    const rows = configs.map(config => f.db.prepare('SELECT * FROM ai_service_configs WHERE id=?').get(config.id));
    const shared = (await f.request('POST', '/admin/provider-connections/convert', { config_id: configs[0].id }, cookie)).body.data;
    const route = `/admin/provider-connections/${shared.id}`;
    const candidates = await f.request('GET', route + '/candidates', undefined, cookie);
    assert.equal(candidates.status, 200);
    assert.equal(JSON.stringify(candidates.body).includes(credentials.api_key), false);
    assert.deepEqual(candidates.body.data.filter(row => row.eligible).map(row => row.id).sort(), configs.slice(1).map(row => row.id).sort());
    const result = await f.request('POST', route + '/attach', { config_ids: configs.slice(1).map(config => config.id) }, cookie);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.data.attached.length, 3);
    assert.equal(result.body.data.connection.bindings.length, 4);
    assert.equal(JSON.stringify(result.body).includes(credentials.api_key), false);
    const preserved = ({ api_key, provider_connection_id, updated_at, ...rest }) => rest;
    for (const original of rows) {
      const stored = f.db.prepare('SELECT * FROM ai_service_configs WHERE id=?').get(original.id);
      assert.deepEqual(preserved(stored), preserved(original));
      assert.equal(stored.api_key, '');
      assert.equal(stored.provider_connection_id, shared.id);
      assert.equal(ai.getConfig(f.db, original.id).provider, original.provider);
      assert.equal(require('../src/services/aiClient').getDefaultConfig(f.db, original.service_type, { tenant_id: group.id }).id, original.id);
    }
    assert.deepEqual(historic(), before);
    const repeat = await f.request('POST', route + '/attach', { config_ids: configs.map(config => config.id) }, cookie);
    assert.equal(repeat.body.data.attached.length, 0);
    assert.equal(repeat.body.data.skipped, 4);
    await f.restart();
    assert.deepEqual(historic(), before);
    assert.equal((await f.request('GET', `/tasks/${task.id}`, undefined, cookie)).status, 200);
    const after = await f.request('GET', '/admin/provider-connections', undefined, cookie);
    assert.equal(after.body.data.find(row => row.id === shared.id).bindings.length, 4);
    assert.equal((await f.request('GET', route + '/candidates', undefined, cookie)).body.data.some(row => configs.some(config => config.id === row.id)), false);
    assert.equal(billing.createAuthorization(f.db, f.admin, request).reused, true);
    assert.equal((await f.request('PATCH', route, { api_key: 'replacement-fixture-secret' }, cookie)).status, 200);
    assert.ok(configs.every(config => ai.getConfig(f.db, config.id).api_key === 'replacement-fixture-secret'));
    assert.equal(billing.settleAuthorization(f.db, f.admin, authorization.authorization_id, { usage: { image: 1 } }).charged, 1);
  } finally { await f.close(); }
});

test('attachment rechecks compatibility atomically and rejects unauthorized, tenant, stale and invalid selections', async () => {
  const f = await modelCatalogFixture();
  try {
    const cookie = await login(f);
    const shared = providers.save(f.db, f.admin.id, { ...credentials, name: 'Shared Ark' });
    const route = `/admin/provider-connections/${shared.id}`;
    const good = create(f, { name: 'Compatible' });
    const tenant = tenants.writeTenant(f.db, f.admin.id, { name: 'Private group' });
    const other = providers.save(f.db, f.admin.id, { ...credentials, name: 'Other connection' });
    const bound = create(f, { name: 'Already bound' });
    providers.attach(f.db, f.admin.id, other.id, [bound.id]);
    const bad = [
      create(f, { name: 'Wrong key', api_key: 'different-fixture-secret' }),
      create(f, { name: 'Wrong URL', base_url: 'http://supplier.invalid/other-region' }),
      create(f, { name: 'Wrong provider', provider: 'agnes' }),
      create(f, { name: 'Wrong default', service_type: 'video' }),
      create(f, { name: 'Private', owner_tenant_id: tenant.id }),
      create(f, { name: 'Special service', service_type: 'model_ark_asset' }),
      bound,
    ];
    const deleted = create(f, { name: 'Deleted' }); ai.deleteConfig(f.db, f.log, deleted.id); bad.push(deleted);
    const member = auth.createUser(f.db, { username: 'attachment-member', password: 'fixture-password' }, f.admin.id);
    const memberCookie = await login(f, member.username);
    assert.equal((await f.request('GET', route + '/candidates', undefined, memberCookie)).status, 403);
    assert.equal((await f.request('POST', route + '/attach', { config_ids: [good.id] }, memberCookie)).status, 403);
    for (const config of bad) {
      const result = await f.request('POST', route + '/attach', { config_ids: [good.id, config.id] }, cookie);
      assert.equal(result.status, 400, config.name);
      assert.equal(ai.getConfig(f.db, good.id).provider_connection_id, null);
      assert.equal(ai.getConfig(f.db, good.id).api_key, credentials.api_key);
    }
    for (const ids of [[], [good.id, 999999], ['1'], [null]]) assert.equal((await f.request('POST', route + '/attach', { config_ids: ids }, cookie)).status, 400);
    const candidates = (await f.request('GET', route + '/candidates', undefined, cookie)).body.data;
    assert.equal(candidates.find(row => row.id === bad[0].id).reason, 'API Key 不一致或未填写');
    assert.equal(candidates.some(row => row.id === bad[4].id), false);
    assert.equal(candidates.some(row => row.id === bound.id), false);
    assert.equal(JSON.stringify(candidates).includes('different-fixture-secret'), false);
    await f.request('PATCH', route, { api_key: 'changed-after-preview' }, cookie);
    assert.equal((await f.request('POST', route + '/attach', { config_ids: [good.id] }, cookie)).status, 400);
    await f.request('PATCH', route, { api_key: credentials.api_key, is_active: false }, cookie);
    assert.equal((await f.request('POST', route + '/attach', { config_ids: [good.id] }, cookie)).status, 400);
    assert.equal(ai.getConfig(f.db, good.id).provider_connection_id, null);
    await f.request('PATCH', route, { is_active: true }, cookie);
    const attached = await f.request('POST', route + '/attach', { config_ids: [good.id, good.id] }, cookie);
    assert.deepEqual(attached.body.data.attached, [good.id]);
  } finally { await f.close(); }
});
