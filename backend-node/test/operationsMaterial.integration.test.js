const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const operations = require('../src/services/adminOperationsService');
const routes = require('../src/routes/admin');
const { setVideoGenFailed } = require('../src/services/videoService');

test('operations material reads stay task-scoped and historical stage reads survive reopening', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-media-'));
  const dbPath = path.join(root, 'test.db');
  let db = new Database(dbPath);
  let server;
  try {
    runMigrationsAndEnsure(db);
    db.prepare("INSERT INTO video_generations (id,status,upscale_status,interpolation_status,first_frame_url) VALUES (1,'failed','awaiting_source','skipped','uploads/reference.png')").run();
    db.prepare("INSERT INTO video_upscale_jobs (video_generation_id,owner_user_id,status,target_resolution,created_at,updated_at) VALUES (1,2,'cancelled','1080p','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z')").run();
    fs.mkdirSync(path.join(root, 'uploads'));
    fs.writeFileSync(path.join(root, 'uploads/reference.png'), 'fixture-image');
    fs.writeFileSync(path.join(root, 'secret.txt'), 'not-in-snapshot');
    const before = operations.productionDetail(db, 1);
    assert.equal(before.stages.find(s => s.key === 'upscale').status, 'cancelled');
    assert.equal(before.upscale_status, 'awaiting_source', 'historical data is not rewritten');
    db.close();
    db = new Database(dbPath);
    assert.equal(operations.productionDetail(db, 1).stages.find(s => s.key === 'upscale').status, 'cancelled');
    const app = express();
    const admin = routes(db, console, { storage: { type: 'local', local_path: root } });
    app.use((req, res, next) => { req.auth = { id: 1, role: req.headers['x-test-role'] || 'user', console_access: req.headers['x-test-console'] === '1' }; next(); });
    app.get('/production/:id/materials/:ordinal', admin.productionMaterial);
    app.get('/production/:id/output', admin.productionMaterial);
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'x-test-role': 'admin', 'x-test-console': '1' };
    assert.equal((await fetch(`${base}/production/1/output`, { headers })).status, 404);
    db.prepare("UPDATE video_generations SET status='completed', local_path='uploads/final.mp4' WHERE id=1").run();
    fs.writeFileSync(path.join(root, 'uploads/final.mp4'), '0123456789');
    const ranged = await fetch(`${base}/production/1/output`, { headers: { ...headers, Range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206);
    assert.equal(await ranged.text(), '2345');
    assert.equal((await fetch(`${base}/production/1/output`)).status, 403);
    const reopened = new Database(dbPath, { readonly: true });
    try { assert.equal(operations.productionDetail(reopened, 1).local_path, 'uploads/final.mp4'); }
    finally { reopened.close(); }
    const result = await fetch(`${base}/production/1/materials/1`, { headers });
    assert.equal(result.status, 200);
    assert.equal(await result.text(), 'fixture-image');
    assert.match(result.headers.get('cache-control'), /private/);
    assert.equal((await fetch(`${base}/production/1/materials/1`)).status, 403);
    assert.equal((await fetch(`${base}/production/1/materials/1`, { headers: { 'x-test-role': 'admin' } })).status, 403);
    assert.equal((await fetch(`${base}/production/1/materials/2?path=secret.txt`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/production/999/materials/1`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/production/1/materials/1?thumbnail=1`, { headers })).status, 404);
    const billing = require('../src/services/billingService');
    const oldVoid = billing.voidAuthorization;
    billing.voidAuthorization = () => {};
    try {
      db.prepare("UPDATE video_generations SET status='processing', interpolation_status='awaiting_source' WHERE id=1").run();
      db.prepare("INSERT INTO video_interpolation_jobs (video_generation_id,owner_user_id,status,target_fps,billing_authorization_id,created_at,updated_at) VALUES (1,2,'awaiting_source',60,'isolated-interpolation','2026-09-14T00:00:00Z','2026-09-14T00:00:00Z')").run();
      db.prepare("UPDATE video_upscale_jobs SET status='awaiting_source', billing_authorization_id='isolated-auth' WHERE video_generation_id=1").run();
      setVideoGenFailed(db, 1, 'fixture generation failure', new Date().toISOString());
      assert.equal(db.prepare('SELECT upscale_status FROM video_generations WHERE id=1').get().upscale_status, 'cancelled');
      assert.equal(db.prepare('SELECT interpolation_status FROM video_generations WHERE id=1').get().interpolation_status, 'cancelled');
    } finally { billing.voidAuthorization = oldVoid; }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

