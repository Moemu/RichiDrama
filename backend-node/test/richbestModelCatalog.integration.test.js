const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const aiConfigs = require('../src/services/aiConfigService');
const catalog = require('../src/services/modelCatalogService');
const discovery = require('../src/services/modelDiscoveryService');

const log = { info() {}, warn() {}, error() {} };

/** 模型列表走流式读取，替身响应必须提供 getReader。 */
function jsonResponse(payload, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    ok: true, status: 200,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    body: { getReader: () => {
      let delivered = false;
      return {
        read: async () => (delivered ? { done: true, value: undefined } : ((delivered = true), { done: false, value: bytes })),
        cancel: async () => {},
        releaseLock: () => {},
      };
    } },
  };
}

async function withDatabase(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-catalog-'));
  const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    return await run(db);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const RELAY_MODELS = { object: 'list', data: [
  { id: 'doubao-seedance-2.0', object: 'model', display_name: 'Doubao Seedance 2.0', modality: 'video', capabilities: { chat: false, stream: false } },
  { id: 'wan3.0-video', object: 'model', display_name: 'Wan 3.0 视频', modality: 'video', capabilities: { maxN: 1 } },
  { id: 'doubao-seed-2.1-turbo', object: 'model', display_name: 'Doubao Seed 2.1 Turbo', modality: 'text', capabilities: { imageInput: true, stream: true } },
] };

test('relay model discovery reads the project catalog and keeps id distinct from display name', async () => withDatabase(async (db) => {
  const config = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_catalog', model: [], is_default: true,
  });
  const seen = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    seen.push({ url: String(url), method: init?.method });
    return jsonResponse(RELAY_MODELS, { 'x-request-id': 'req-catalog-1' });
  };
  try {
    const result = await discovery.discover(db, 1, config.id, {});
    assert.equal(result.source, 'richbest_models');
    assert.deepEqual(seen, [{ url: 'https://api.richbest.cn/v1/models', method: 'GET' }]);
    assert.deepEqual(result.models.map((model) => model.id), ['doubao-seed-2.1-turbo', 'doubao-seedance-2.0', 'wan3.0-video']);
    const wan = result.models.find((model) => model.id === 'wan3.0-video');
    assert.equal(wan.display_name, 'Wan 3.0 视频');
    assert.equal(wan.modality, 'video');
    assert.equal(wan.capability, null, '中转别名不靠模型名正则猜能力');
    assert.equal(result.next_page, null);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('importing relay models stores the provider display name for the picker', async () => withDatabase(async (db) => {
  const config = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_catalog', model: [], is_default: true,
  });
  const importResult = discovery.importModels(db, 1, config.id, {
    models: ['doubao-seedance-2.0', 'wan3.0-video'],
    display_names: { 'doubao-seedance-2.0': 'Doubao Seedance 2.0', 'wan3.0-video': 'Wan 3.0 视频' },
  }, log);
  assert.deepEqual(importResult.added, ['doubao-seedance-2.0', 'wan3.0-video']);
  const rows = catalog.list(db).filter((row) => row.service_type === 'video');
  assert.equal(rows.find((row) => row.model === 'wan3.0-video').display_name, 'Wan 3.0 视频');
  // 展示名可以中文，提交值仍是中转别名
  assert.ok(rows.every((row) => !/\s/.test(row.model)));
}));

test('relay pages beyond the first are refused instead of importing a partial catalog', async () => withDatabase(async (db) => {
  const config = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_catalog', model: [], is_default: true,
  });
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ ...RELAY_MODELS, has_more: true });
  try {
    await assert.rejects(() => discovery.discover(db, 1, config.id, {}), /额外分页/);
  } finally {
    global.fetch = originalFetch;
  }
}));

test('unpriced relay models stay invisible until a price is published, and no credential leaks', async () => withDatabase(async (db) => {
  const config = aiConfigs.createConfig(db, log, {
    service_type: 'video', provider: 'richbest', name: 'relay', base_url: 'https://api.richbest.cn/v1',
    api_key: 'vap_live_catalog', model: ['doubao-seedance-2.0'], default_model: 'doubao-seedance-2.0', is_default: true,
  });
  // 目录里还是草稿（未发布价格）时不进入用户可选列表 —— 这就是逐模型灰度的闸门。
  catalog.save(db, 1, { service_type: 'video', model: 'doubao-seedance-2.0', display_name: 'Doubao Seedance 2.0', status: 'draft', config_id: config.id }, log);
  assert.deepEqual(aiConfigs.listPublicConfigs(db, 'video', { user_id: 1 }), []);

  const book = db.prepare("INSERT INTO billing_price_books (name,status,effective_from,created_by,created_at,updated_at) VALUES ('relay','published','2000-01-01T00:00:00.000Z',1,datetime('now'),datetime('now'))").run();
  db.prepare("INSERT INTO billing_price_book_items (price_book_id,service_type,model,meter,unit_price_micro,is_free,conditions_json,created_at,updated_at) VALUES (?, 'video', 'doubao-seedance-2.0', 'second', 500, 0, NULL, datetime('now'), datetime('now'))").run(book.lastInsertRowid);
  catalog.save(db, 1, { service_type: 'video', model: 'doubao-seedance-2.0', display_name: 'Doubao Seedance 2.0', status: 'active', config_id: config.id }, log);

  const rows = aiConfigs.listPublicConfigs(db, 'video', { user_id: 1 });
  const [publicRow] = rows;
  assert.deepEqual(publicRow.model, ['doubao-seedance-2.0']);
  assert.equal(publicRow.display_names['doubao-seedance-2.0'], 'Doubao Seedance 2.0');
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes('vap_live'), false, '业务 Key 绝不出现在给前端的列表里');
  assert.equal(serialized.includes('base_url'), false);
}));
