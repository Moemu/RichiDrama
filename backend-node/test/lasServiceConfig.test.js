const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfig = require('../src/services/aiConfigService');
const jobs = require('../src/services/lasMediaJobService');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-las-config-'));
  const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
  runMigrationsAndEnsure(db);
  return { db, root };
}

function teardown(root) {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}

function saveConfig(db) {
  return aiConfig.createConfig(db, log, {
    service_type: 'video_localization', provider: 'las', name: 'LAS 视频本地化',
    base_url: 'https://operator.las.cn-beijing.volces.com', api_key: 'Bearer las-key',
    settings: JSON.stringify({ region: 'cn-beijing', tos_bucket: 'example-bucket', tos_access_key_id: 'test-ak', tos_secret_access_key: 'test-sk' }),
  });
}

test('LAS 专用服务缺失时拒绝提交，且不借用其它专用服务的连接', () => {
  const { db, root } = setup();
  try {
    assert.throws(() => jobs.serviceConfig(db), /尚未启用/);
    const at = new Date().toISOString();
    db.prepare(`INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, is_default, is_active, settings, created_at, updated_at)
      VALUES ('video_postprocess', 'volcengine_mediakit', 'MediaKit', 'https://mediakit.cn-beijing.volces.com', 'other-key', 1, 1, '{}', ?, ?)`)
      .run(at, at);
    assert.throws(() => jobs.serviceConfig(db), /尚未启用/);
  } finally {
    teardown(root);
  }
});

test('LAS 专用服务把算子与 TOS 锁在同一地域和 Bucket，停用后立即失效', () => {
  const { db, root } = setup();
  try {
    const created = saveConfig(db);
    const { clientConfig, tosConfig } = jobs.serviceConfig(db);
    assert.equal(clientConfig.apiKey, 'las-key');
    assert.equal(clientConfig.baseUrl, 'https://operator.las.cn-beijing.volces.com');
    assert.equal(tosConfig.host, 'example-bucket.tos-cn-beijing.volces.com');
    assert.equal(clientConfig.bucket, tosConfig.bucket);
    assert.equal(clientConfig.region, tosConfig.region);
    db.prepare('UPDATE ai_service_configs SET is_active = 0 WHERE id = ?').run(created.id);
    assert.throws(() => jobs.serviceConfig(db), /尚未启用/);
  } finally {
    teardown(root);
  }
});
