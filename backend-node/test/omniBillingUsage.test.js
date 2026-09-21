const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const aiConfigs = require('../src/services/aiConfigService');
const tenants = require('../src/services/tenantService');
const { buildAuthorizationUsage, quote, create } = require('../src/services/omniVideoService');

test('omni video freezes the canonical output-token meter from duration and resolution, not a fixed cap', () => {
  // 1280×720 × 24fps × 5s ÷ 1024 = 108,000 → 含 15% 余量向上取整到百位。
  assert.deepEqual(
    buildAuthorizationUsage(['output_token'], { billing_reserve_output_tokens: 48000 }, 5, { resolution: '720p', aspect_ratio: '16:9' }),
    { output_token: 124200 },
  );
  // 分辨率越高冻结越多（480p 明显低于 720p），而不再受配置里的小数字支配。
  const low = buildAuthorizationUsage(['output_token'], {}, 4, { resolution: '480p', aspect_ratio: '16:9' }).output_token;
  const high = buildAuthorizationUsage(['output_token'], {}, 4, { resolution: '720p', aspect_ratio: '16:9' }).output_token;
  assert.ok(low > 40594, `480p 4s 估算必须覆盖实测 40,594，实际 ${low}`);
  assert.ok(high > 87300, `720p 4s 估算必须覆盖实测 87,300，实际 ${high}`);
  assert.ok(high > low * 2, '像素翻倍时冻结量必须随之上升');
  assert.deepEqual(buildAuthorizationUsage(['second'], {}, 5), { second: 5 });
  assert.throws(() => buildAuthorizationUsage(['input_token'], {}, 5), /billing_reserve_input_tokens/);
});

test('omni video quote uses the published output-token meter for Seedance 2.0 Mini', () => {
  const dbPath = path.join(os.tmpdir(), `omni-video-quote-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    const log = { info() {}, warn() {} };
    const admin = auth.ensureBootstrapAdmin(db, log);
    const model = 'doubao-seedance-2-0-mini-260615';
    const tenant = tenants.tenantForUser(db, admin.id);
    const config = aiConfigs.createConfig(db, log, {
      service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine_omni',
      name: 'Seedance 2.0 Mini quote test', base_url: 'https://example.invalid', api_key: 'test',
      model: [model], default_model: model, is_default: true,
      settings: JSON.stringify({ billing_reserve_output_tokens: 1000000 }), owner_tenant_id: tenant.id,
    });
    tenants.bindOwnedConfig(db, tenant.id, config, { is_default: true });
    const result = quote(db, { model, duration: 5, resolution: '720p' }, admin);
    assert.deepEqual(result.usage, { output_token: 124200 });
    assert.equal(result.amount, 285.66);
    assert.equal(result.rates[0].meter, 'output_token');
    assert.equal(result.reserve.output_tokens, 124200, '报价需回传冻结估算依据，用户可感知口径变化');
    assert.match(result.reserve.basis, /5s × 720p × 16:9/);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
  }
});

test('omni video rejects an unsupported source resolution before billing authorization', () => {
  const dbPath = path.join(os.tmpdir(), `omni-video-resolution-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  const billing = require('../src/services/billingService');
  const originalCreateAuthorization = billing.createAuthorization;
  let authorizationCalls = 0;
  try {
    runMigrationsAndEnsure(db);
    const log = { info() {}, warn() {}, error() {} };
    const admin = auth.ensureBootstrapAdmin(db, log);
    const model = 'doubao-seedance-2-0-fast-260128';
    const tenant = tenants.tenantForUser(db, admin.id);
    const config = aiConfigs.createConfig(db, log, {
      service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine_omni',
      name: 'Seedance 2.0 Fast resolution test', base_url: 'https://example.invalid', api_key: 'test',
      model: [model], default_model: model, is_default: true,
      settings: JSON.stringify({ billing_reserve_output_tokens: 1000000 }), owner_tenant_id: tenant.id,
    });
    tenants.bindOwnedConfig(db, tenant.id, config, { is_default: true });
    billing.createAuthorization = (...args) => { authorizationCalls += 1; return originalCreateAuthorization(...args); };

    assert.throws(() => create(db, log, {
      model, prompt: '测试镜头', resolution: '1080p', duration: 15,
      owner_user_id: admin.id, tenant_id: tenant.id, idempotency_key: 'unsupported-resolution-test',
    }, admin), /不支持 1080p 原片/);
    assert.equal(authorizationCalls, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 0);
  } finally {
    billing.createAuthorization = originalCreateAuthorization;
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
  }
});

test('omni video rejects an unsupported Volcengine aspect ratio before billing authorization', () => {
  const dbPath = path.join(os.tmpdir(), `omni-video-aspect-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  const billing = require('../src/services/billingService');
  const originalCreateAuthorization = billing.createAuthorization;
  let authorizationCalls = 0;
  try {
    runMigrationsAndEnsure(db);
    const log = { info() {}, warn() {}, error() {} };
    const admin = auth.ensureBootstrapAdmin(db, log);
    const model = 'doubao-seedance-2-0-mini-260615';
    const tenant = tenants.tenantForUser(db, admin.id);
    const config = aiConfigs.createConfig(db, log, {
      service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine_omni',
      name: 'Seedance aspect test', base_url: 'https://example.invalid', api_key: 'test',
      model: [model], default_model: model, is_default: true,
      settings: JSON.stringify({ billing_reserve_output_tokens: 1000000 }), owner_tenant_id: tenant.id,
    });
    tenants.bindOwnedConfig(db, tenant.id, config, { is_default: true });
    billing.createAuthorization = (...args) => { authorizationCalls += 1; return originalCreateAuthorization(...args); };

    assert.throws(() => create(db, log, {
      model, prompt: '测试镜头', resolution: '720p', aspect_ratio: '2:3', duration: 15,
      owner_user_id: admin.id, tenant_id: tenant.id, idempotency_key: 'unsupported-aspect-test',
    }, admin), /不支持 2:3 画幅/);
    assert.equal(authorizationCalls, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 0);
  } finally {
    billing.createAuthorization = originalCreateAuthorization;
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
  }
});
