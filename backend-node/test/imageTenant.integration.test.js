const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const express = require('express');
const sharp = require('sharp');

test('image HTTP generation uses the project group credential and preserves its local result after restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-image-tenant-'));
  const previousCwd = process.cwd();
  process.chdir(root);
  const cfg = {
    app: { name: 'Image tenant test' }, server: {},
    database: { type: 'sqlite', path: path.join(root, 'test.db') },
    storage: { type: 'local', local_path: path.join(root, 'storage') },
    payments: { enabled: false }, image_proxy: { use_for_video: false },
    vendor_lock: { enabled: false }, style: { default_image_size: '32x32' },
  };
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify(cfg));
  const { getDb, closeDb } = require('../src/db');
  const { runMigrationsAndEnsure } = require('../src/db/migrate');
  const { setupRouter } = require('../src/routes');
  const auth = require('../src/services/authService');
  const tenants = require('../src/services/tenantService');
  const configs = require('../src/services/aiConfigService');
  const billing = require('../src/services/billingService');
  const images = require('../src/services/imageClient');
  const context = require('../src/services/billingRequestContext');
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const keys = [];
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
  const provider = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      keys.push(req.headers.authorization);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [{ url: `data:image/png;base64,${png.toString('base64')}` }] }));
    });
  });
  let server;
  let db;
  let base;
  async function start() {
    db = getDb(cfg.database);
    runMigrationsAndEnsure(db);
    const app = express();
    app.use(express.json());
    app.use('/api/v1', setupRouter(cfg, db, log));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }
  async function stop() {
    if (server) { await new Promise((resolve) => server.close(resolve)); server = null; }
    closeDb();
  }
  async function request(method, route, body, token) {
    const result = await fetch(base + route, {
      method, headers: { 'content-type': 'application/json', ...(token ? { 'x-lmd-session': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await result.json();
    assert.ok(result.ok, `${method} ${route}: ${JSON.stringify(payload)}`);
    return payload.data;
  }
  try {
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    await start();
    const admin = auth.createUser(db, { username: 'admin-test', password: 'test', account_kind: 'platform_admin' }, null);
    const creator = auth.createUser(db, { username: 'creator-test', password: 'test' }, admin.id);
    const template = {
      service_type: 'image', provider: 'volcengine', api_protocol: 'volcengine',
      base_url: `http://127.0.0.1:${provider.address().port}`, model: ['isolated-image'], is_active: true,
    };
    const globalConfig = configs.createConfig(db, log, { ...template, name: 'Global', api_key: 'global-fixture-key', is_default: true });
    const groupConfig = configs.createConfig(db, log, { ...template, name: 'Group', api_key: 'group-fixture-key', is_default: false });
    const tenant = tenants.writeTenant(db, admin.id, { name: 'Image isolation' });
    tenants.setMember(db, tenant.id, creator.id, 'creator');
    const book = billing.savePriceBook(db, admin.id, {
      name: 'Image test prices', status: 'published',
      items: [{ service_type: 'image', model: 'isolated-image', meter: 'image', unit_price: 1 }],
    });
    tenants.replaceBindings(db, tenant.id, { ai_config_ids: [groupConfig.id], sd2_config_ids: [], price_book_id: book.id });
    billing.adjustBalance(db, admin.id, creator.id, 10, 'Isolated test');
    assert.equal(images.getDefaultImageConfig(db, 'isolated-image').id, globalConfig.id);
    context.run({ tenant_id: tenant.id }, () => {
      assert.equal(images.getDefaultImageConfig(db, 'isolated-image').id, groupConfig.id);
    });
    const session = await request('POST', '/auth/login', { username: creator.username, password: 'test' });
    const project = await request('POST', '/dramas', { title: 'Image tenant fixture' }, session.token);
    const pending = await request('POST', '/images', {
      drama_id: project.id, prompt: 'A red square', model: 'isolated-image', size: '32x32', idempotency_key: 'tenant-image-1',
    }, session.token);
    let result;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      result = await request('GET', `/images/${pending.id}`, undefined, session.token);
      if (['completed', 'failed'].includes(result.status)) break;
      await delay(50);
    }
    assert.equal(result.status, 'completed', result.error_msg);
    assert.deepEqual(keys, ['Bearer group-fixture-key']);
    assert.ok(result.local_path);
    assert.ok(fs.existsSync(path.join(cfg.storage.local_path, result.local_path)));
    const row = db.prepare('SELECT tenant_id, billing_authorization_id FROM image_generations WHERE id=?').get(pending.id);
    assert.equal(row.tenant_id, tenant.id);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(row.billing_authorization_id).count, 1);
    await delay(20);
    await stop();
    await start();
    const restored = await request('GET', `/images/${pending.id}`, undefined, session.token);
    assert.equal(restored.local_path, result.local_path);
    assert.equal(restored.status, 'completed');
    assert.equal(keys.length, 1);
    const costs = db.prepare('SELECT c.*,r.usage_json FROM cost_calls c JOIN cost_revisions r ON r.id=c.latest_revision_id').all();
    assert.equal(costs.length, 1, 'image restore must not create another supplier attempt');
    assert.deepEqual(JSON.parse(costs[0].usage_json), { request: 1, image: 1 });
  } finally {
    await stop();
    await new Promise((resolve) => provider.close(resolve));
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
