const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const configs = require('../src/services/aiConfigService');
const tenants = require('../src/services/tenantService');
const imageClient = require('../src/services/imageClient');
const videoClient = require('../src/services/videoClient');
const taskService = require('../src/services/taskService');
const toolRuns = require('../src/services/toolRunService');

function setup() {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-tenant-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { info() {}, warn() {} };
  return { db, dbPath, admin: auth.ensureBootstrapAdmin(db, log), log };
}
function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

test('existing and newly-created users are safely adopted into the default tenant', () => {
  const { db, dbPath, admin } = setup();
  try {
    const creator = auth.createUser(db, { username: 'tenant-creator', password: 'creator123' }, admin.id);
    const tenant = tenants.tenantForUser(db, creator.id);
    assert.equal(tenant.name, '默认项目组');
    assert.equal(tenant.membership_role, 'creator');
    assert.equal(auth.publicUser(admin).console_access, true);
    assert.equal(auth.publicUser(creator).console_access, false);
    assert.equal(tenants.ensureDefaultTenant(db, admin.id).name, '默认项目组');
    assert.equal(tenants.listTenants(db).filter((item) => item.name === '默认项目组').length, 1);
    assert.equal(tenants.listTenants(db).find((item) => item.name === '默认项目组').price_book_name, '全局已发布价目表（按模型匹配）');
  } finally { teardown(dbPath); }
});

test('tenant bindings restrict configs and use the tenant shared price book', () => {
  const { db, dbPath, admin, log } = setup();
  try {
    const creator = auth.createUser(db, { username: 'tenant-priced', password: 'creator123' }, admin.id);
    const imageA = configs.createConfig(db, log, { service_type: 'image', provider: 'openai', name: '共享图生 A', base_url: 'https://example.invalid', api_key: 'secret-a', model: ['image-a'], is_default: true });
    const imageB = configs.createConfig(db, log, { service_type: 'image', provider: 'openai', name: '隔离图生 B', base_url: 'https://example.invalid', api_key: 'secret-b', model: ['image-b'], is_default: false });
    const videoA = configs.createConfig(db, log, { service_type: 'video', provider: 'openai', name: '共享视频 A', base_url: 'https://example.invalid', api_key: 'secret-video-a', model: ['video-a'], is_default: true });
    const bookA = billing.savePriceBook(db, admin.id, { name: '组 A 价目', status: 'published', items: [{ service_type: 'image', model: 'image-a', meter: 'image', unit_price: 40 }] });
    const bookB = billing.savePriceBook(db, admin.id, { name: '组 B 价目', status: 'published', effective_from: '2030-01-01T00:00:00.000Z', items: [{ service_type: 'image', model: 'image-b', meter: 'image', unit_price: 9 }] });
    const tenant = tenants.writeTenant(db, admin.id, { name: '隔离测试组' });
    tenants.setMember(db, tenant.id, creator.id, 'creator');
    const listedCreator = billing.listUsers(db).find((item) => item.id === creator.id);
    assert.equal(listedCreator.tenant_id, tenant.id);
    assert.equal(listedCreator.tenant_name, '隔离测试组');
    assert.equal(listedCreator.tenant_role, 'creator');
    tenants.replaceBindings(db, tenant.id, { ai_config_ids: [imageA.id, videoA.id], sd2_config_ids: [], price_book_id: bookA.id });
    assert.deepEqual(configs.listConfigs(db, 'image', { tenant_id: tenant.id }).map((item) => item.id), [imageA.id]);
    assert.deepEqual(configs.listConfigs(db, undefined, { tenant_id: tenant.id }).map((item) => item.id).sort((a, b) => a - b), [imageA.id, videoA.id].sort((a, b) => a - b));
    assert.equal(imageClient.getDefaultImageConfig(db, 'image-a', null, 'image', { tenant_id: tenant.id }).id, imageA.id);
    assert.equal(videoClient.getDefaultVideoConfig(db, 'video-a', { tenant_id: tenant.id }).id, videoA.id);
    const task = taskService.createTask(db, log, 'tenant-test', 'tenant-resource', creator.id, tenant.id);
    assert.equal(db.prepare('SELECT tenant_id FROM async_tasks WHERE id=?').get(task.id).tenant_id, tenant.id);
    const toolRun = toolRuns.create(db, { tool_type: 'script_analysis', owner_user_id: creator.id, tenant_id: tenant.id, input: { script: '测试' } });
    assert.equal(db.prepare('SELECT tenant_id FROM tool_runs WHERE id=?').get(toolRun.id).tenant_id, tenant.id);
    const unbound = tenants.writeTenant(db, admin.id, { name: '模板组' });
    const seeded = configs.listOwnedTenantConfigs(db, unbound.id);
    assert.ok(seeded.length > 0, 'new tenants should receive usable configuration templates');
    assert.ok(seeded.every((item) => item.api_key === ''), 'template credentials must be blank');
    assert.equal(tenants.priceBookForUser(db, creator.id).id, bookA.id);
    assert.equal(billing.quote(db, { id: creator.id, role: 'user' }, { service_type: 'image', model: 'image-a', usage: { image: 1 } }).amount, 40);
    assert.throws(() => billing.quote(db, { id: creator.id, role: 'user' }, { service_type: 'image', model: 'image-b', usage: { image: 1 } }), /未定价/);
    tenants.replaceBindings(db, tenant.id, {
      ai_configs: [
        { id: imageA.id, is_default: false },
        { id: imageB.id, is_default: true },
        { id: videoA.id, is_default: true },
      ],
      sd2_config_ids: [], price_book_id: bookA.id,
    });
    assert.equal(configs.listConfigs(db, 'image', { tenant_id: tenant.id })[0].id, imageB.id);
    assert.equal(tenants.tenantDetail(db, tenant.id).configs.find((item) => item.config_id === imageB.id).tenant_is_default, true);
    configs.updateConfig(db, log, imageA.id, { is_default: true });
    assert.equal(configs.listConfigs(db, 'image', { tenant_id: tenant.id })[0].id, imageB.id, 'group default must not follow the platform default');
    assert.ok(bookB.id);
  } finally { teardown(dbPath); }
});

test('the deployed Geeknow gpt-image-2 model is priced at 40 points per image', () => {
  const { db, dbPath, admin } = setup();
  try {
    const quote = billing.quote(db, admin, {
      service_type: 'image', model: 'gpt-image-2', usage: { image: 1 },
    });
    const storyboardQuote = billing.quote(db, admin, {
      service_type: 'storyboard_image', model: 'gpt-image-2', usage: { image: 1 },
    });
    assert.equal(quote.amount, 40);
    assert.equal(storyboardQuote.amount, 40);
  } finally { teardown(dbPath); }
});

test('tenant-owned AI and SD2 configs cannot bleed into another tenant', () => {
  const { db, dbPath, admin, log } = setup();
  try {
    const groupA = tenants.writeTenant(db, admin.id, { name: '配置隔离 A' });
    const groupB = tenants.writeTenant(db, admin.id, { name: '配置隔离 B' });
    const ownA = configs.createConfig(db, log, {
      owner_tenant_id: groupA.id, service_type: 'jimeng2_character_auth', provider: 'custom', name: 'A 的 SD2', base_url: 'https://example.invalid', api_key: 'a-secret', model: [], is_default: false,
    });
    const ownB = configs.createConfig(db, log, {
      owner_tenant_id: groupB.id, service_type: 'video', provider: 'custom', name: 'B 的视频', base_url: 'https://example.invalid', api_key: 'b-secret', model: ['b-video'], is_default: false,
    });
    tenants.bindOwnedConfig(db, groupA.id, ownA, { is_default: true });
    tenants.bindOwnedConfig(db, groupB.id, ownB, { is_default: true });
    assert.deepEqual(configs.listOwnedTenantConfigs(db, groupA.id).map((item) => item.id), [ownA.id]);
    assert.deepEqual(configs.listOwnedTenantConfigs(db, groupB.id).map((item) => item.id), [ownB.id]);
    assert.equal(configs.listOwnedTenantConfigs(db, groupA.id)[0].is_default, true);
    assert.equal(tenants.tenantDetail(db, groupA.id).sd2_configs[0].config_id, ownA.id);
    assert.throws(() => tenants.bindOwnedConfig(db, groupA.id, ownB), /本分组/);
  } finally { teardown(dbPath); }
});
