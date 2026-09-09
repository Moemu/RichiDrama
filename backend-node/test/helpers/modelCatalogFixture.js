const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { once } = require('node:events');
const { getDb, closeDb } = require('../../src/db');
const { runMigrationsAndEnsure } = require('../../src/db/migrate');
const auth = require('../../src/services/authService');
const ai = require('../../src/services/aiConfigService');
const billing = require('../../src/services/billingService');

async function modelCatalogFixture(port = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minidrama-model-catalog-'));
  const cwd = process.cwd();
  const cfg = { app: { language: 'zh' }, database: { path: path.join(root, 'test.db'), type: 'sqlite' }, storage: { type: 'local', local_path: path.join(root, 'storage') }, payments: { enabled: false }, server: {} };
  // Full app startup starts recovery workers. The fixture mounts only HTTP
  // routes, with an empty isolated database and unreachable supplier URLs.
  fs.writeFileSync(path.join(root, 'config.yaml'), JSON.stringify(cfg));
  process.chdir(root);
  const log = { info() {}, warn() {}, error() {}, infow() {}, warnw() {}, errorw() {} };
  const { setupRouter } = require('../../src/routes');
  let db; let server; let base;
  async function start() {
    db = getDb(cfg.database);
    runMigrationsAndEnsure(db);
    const app = express(); app.use(express.json()); app.use('/api/v1', setupRouter(cfg, db, log));
    server = app.listen(port, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  }
  async function stop() { if (server) { await new Promise(resolve => server.close(resolve)); server = null; } closeDb(); }
  async function request(method, route, body, cookie) {
    const result = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: result.status, body: await result.json(), cookie: result.headers.get('set-cookie')?.split(';')[0] };
  }
  await start();
  const admin = auth.createUser(db, { username: 'catalog-admin', password: 'fixture-password', account_kind: 'platform_admin' }, null);
  const config = ai.createConfig(db, log, { service_type: 'image', name: '验收图片连接', provider: 'fixture', base_url: 'http://supplier.invalid', api_key: 'fixture-only', model: ['existing-image', 'other-image'], default_model: 'existing-image', is_default: true });
  const book = billing.savePriceBook(db, admin.id, { name: '验收价目', status: 'published', items: ['existing-image', 'other-image'].map(model => ({ service_type: 'image', model, meter: 'image', unit_price: 1 })) });
  billing.adjustBalance(db, admin.id, admin.id, 100, 'isolated test');
  return { root, admin, config, book, log, get db() { return db; }, request, async restart() { await stop(); await start(); }, async close() { await stop(); process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); } };
}
module.exports = { modelCatalogFixture };
