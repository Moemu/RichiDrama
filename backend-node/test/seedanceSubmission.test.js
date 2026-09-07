const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const aiConfigs = require('../src/services/aiConfigService');
const tenants = require('../src/services/tenantService');
const billing = require('../src/services/billingService');
const videoService = require('../src/services/videoService');
const config = require('../src/config');
const MODEL = 'doubao-seedance-2-0-fast-260128';
const log = { info() {}, warn() {}, error() {} };

test('authenticated submissions reject invalid assets before billing and preserve history across restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-submit-'));
  const filename = path.join(root, 'test.db');
  const originalConfig = config.loadConfig;
  const originalProcess = videoService.processVideoGeneration;
  const originalAuthorization = billing.createAuthorization;
  let authorizationCalls = 0;
  const processed = [];
  let server;
  let db;
  // Every dependency is isolated: fresh database, temporary storage, dummy key,
  // and a replaced generation worker. No provider or OSS request can run.
  config.loadConfig = () => ({ storage: { type: 'local', local_path: root, base_url: '/static' } });
  videoService.processVideoGeneration = (_db, _log, id) => { processed.push(id); };
  billing.createAuthorization = (...args) => { authorizationCalls++; return originalAuthorization(...args); };
  try {
    db = getDb({ path: filename, type: 'sqlite' });
    runMigrationsAndEnsure(db);
    const admin = auth.ensureBootstrapAdmin(db, log);
    const password = 'isolated-input-validation-test';
    const user = auth.createUser(db, { username: 'input-validation', password }, admin.id);
    const tenant = tenants.tenantForUser(db, user.id);
    const aiConfig = aiConfigs.createConfig(db, log, {
      service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine_omni', name: 'input-validation-test',
      base_url: 'https://example.invalid', api_key: 'dummy-key', model: [MODEL], default_model: MODEL, is_default: true,
      settings: JSON.stringify({ billing_reserve_output_tokens: 1000000 }), owner_tenant_id: tenant.id,
    });
    tenants.bindOwnedConfig(db, tenant.id, aiConfig, { is_default: true });
    billing.adjustBalance(db, admin.id, user.id, 100000, 'test balance');
    const now = new Date().toISOString();
    const dramaId = Number(db.prepare('INSERT INTO dramas (title,owner_user_id,created_at,updated_at) VALUES (?,?,?,?)')
      .run('输入校验测试', user.id, now, now).lastInsertRowid);
    const addAsset = (name, type, duration, size = 1000) => Number(db.prepare(`INSERT INTO assets
      (name,type,owner_user_id,url,width,height,file_size,duration,processing_status,created_at,updated_at)
      VALUES (?,?,?, ?,1280,720,?,?,'ready',?,?)`).run(name, type, user.id, `/static/${name}`, size, duration, now, now).lastInsertRowid);
    const imageId = addAsset('image.png', 'image', null);
    const audioId = addAsset('西西.wav', 'audio', 1.416417, 249934);
    const audio2 = addAsset('second.wav', 'audio', 2);
    const historyId = Number(db.prepare(`INSERT INTO video_generations
      (drama_id,owner_user_id,provider,model,status,local_path,created_at,updated_at)
      VALUES (?,?,'volcengine',?,'completed','history/original.mp4',?,?)`).run(dramaId, user.id, MODEL, now, now).lastInsertRowid);
    const history = db.prepare('SELECT * FROM video_generations WHERE id=?').get(historyId);
    const serve = async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.requestId = req.headers['x-request-id']; next(); });
      app.post('/api/v1/auth/login', require('../src/routes/auth')(db).login);
      const authenticate = require('../src/middleware/auth').requireAuth(db);
      const omni = require('../src/routes/omniVideo')(db, log, config.loadConfig());
      const videos = require('../src/routes/videos')(db, log);
      app.post('/api/v1/omni-video/jobs', authenticate, omni.create);
      app.get('/api/v1/omni-video/jobs/:id', authenticate, omni.get);
      app.post('/api/v1/videos', authenticate, videos.create);
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      return `http://127.0.0.1:${server.address().port}`;
    };
    let base = await serve();
    const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user.username, password }) });
    const token = (await login.json()).data.token;
    const post = async (route, body, authenticated = true) => {
      const result = await fetch(`${base}${route}`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'X-Request-Id': 'input-validation-test', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      }, body: JSON.stringify(body) });
      return { status: result.status, json: await result.json() };
    };
    const input = { model: MODEL, prompt: '测试镜头', resolution: '480p', duration: 5, drama_id: dramaId,
      idempotency_key: 'validation-test-1', assets: [{ asset_id: imageId }, { asset_id: audioId }] };
    const baseline = () => ({
      generations: db.prepare('SELECT COUNT(*) n FROM video_generations').get().n,
      tasks: db.prepare('SELECT COUNT(*) n FROM async_tasks').get().n,
      transactions: db.prepare('SELECT COUNT(*) n FROM billing_transactions').get().n,
      account: billing.account(db, user.id),
    });
    const before = baseline();
    assert.equal((await post('/api/v1/omni-video/jobs', input, false)).status, 401);
    const failed = await post('/api/v1/omni-video/jobs', input);
    assert.equal(failed.status, 400); assert.match(failed.json.error.message, /西西.wav.*1.416417.*2–15/);
    assert.equal(authorizationCalls, 0); assert.deepEqual(processed, []); assert.deepEqual(baseline(), before);

    const legacy = await post('/api/v1/videos', { ...input, assets: undefined, reference_image_urls: ['/static/image.png', '/static/missing.svg'] });
    assert.equal(legacy.status, 400); assert.match(legacy.json.error.message, /格式 svg/);
    assert.equal(authorizationCalls, 0); assert.deepEqual(baseline(), before);
    const large1 = addAsset('large1.png', 'image', null, 29 * 1024 * 1024);
    const large2 = addAsset('large2.png', 'image', null, 29 * 1024 * 1024);
    const tooLarge = await post('/api/v1/omni-video/jobs', { ...input, assets: [{ asset_id: large1 }, { asset_id: large2 }] });
    assert.equal(tooLarge.status, 400); assert.match(tooLarge.json.error.message, /64 MB/);
    assert.equal(authorizationCalls, 0); assert.deepEqual(baseline(), before);
    const characterId = db.prepare(`INSERT INTO characters (drama_id,name,seedance2_voice_asset,created_at,updated_at)
      VALUES (?,'参考角色',?,?,?)`).run(dramaId, JSON.stringify({ status: 'active', url: '/static/西西.wav' }), now, now).lastInsertRowid;
    for (const [route, body] of [
      ['/api/v1/videos', { ...input, assets: undefined, image_url: '/static/image.png' }],
      ['/api/v1/omni-video/jobs', { ...input, assets: [{ asset_id: imageId }] }],
    ]) {
      const voiceFailure = await post(route, body);
      assert.equal(voiceFailure.status, 400); assert.match(voiceFailure.json.error.message, /西西.wav.*2–15/);
    }
    assert.equal(authorizationCalls, 0); assert.deepEqual(baseline(), before);
    db.prepare('UPDATE characters SET deleted_at=? WHERE id=?').run(now, characterId);
    const skipped = await post('/api/v1/omni-video/jobs', { ...input, assets: [{ asset_id: imageId }, { asset_id: audioId, send_to_model: false }] });
    assert.equal(skipped.status, 201, JSON.stringify(skipped.json));
    await new Promise(setImmediate);
    assert.equal(processed.length, 1);
    assert.equal(authorizationCalls, 1);
    db.prepare("UPDATE video_generations SET status='failed' WHERE id=?").run(skipped.json.data.video_generation_id);

    db.prepare('UPDATE assets SET duration=2 WHERE id=?').run(audioId);
    const valid = await post('/api/v1/omni-video/jobs', { ...input, idempotency_key: 'validation-test-valid', assets: [{ asset_id: imageId }, { asset_id: audioId }, { asset_id: audio2 }] });
    assert.equal(valid.status, 201, JSON.stringify(valid.json));
    await new Promise(setImmediate);
    assert.equal(processed.length, 2);
    const jobId = valid.json.data.omni_job_id;
    const snapshot = db.prepare('SELECT request_snapshot_json FROM omni_video_jobs WHERE id=?').get(jobId).request_snapshot_json;
    assert.equal(JSON.parse(snapshot).input_validation.version, 1);

    await new Promise((resolve) => server.close(resolve)); server = null; closeDb();
    db = getDb({ path: filename, type: 'sqlite' }); runMigrationsAndEnsure(db); base = await serve();
    const read = await fetch(`${base}/api/v1/omni-video/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(read.status, 200);
    const restored = await read.json();
    assert.equal(restored.data.assets.filter((asset) => asset.media_type === 'audio').length, 2);
    assert.equal(db.prepare('SELECT request_snapshot_json FROM omni_video_jobs WHERE id=?').get(jobId).request_snapshot_json, snapshot);
    assert.deepEqual(db.prepare('SELECT * FROM video_generations WHERE id=?').get(historyId), history);
    assert.equal(processed.length, 2);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    closeDb(); config.loadConfig = originalConfig; videoService.processVideoGeneration = originalProcess;
    billing.createAuthorization = originalAuthorization;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
