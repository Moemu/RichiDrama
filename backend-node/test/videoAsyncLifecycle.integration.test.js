const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { setupRouter } = require('../src/routes');
const auth = require('../src/services/authService');
const aiConfigs = require('../src/services/aiConfigService');
const billing = require('../src/services/billingService');
const omni = require('../src/services/omniVideoService');
const videoService = require('../src/services/videoService');
const videoUpscale = require('../src/services/videoUpscaleService');

const POSTPROCESS_MODEL = 'volcengine-video-generative-enhancement';
const BILLING_MODEL = 'video-async-billing-model';

function logger() {
  return { info() {}, warn() {}, error() {}, infow() {}, warnw() {} };
}

function silenceMigrations(db) {
  const output = console.log;
  const warning = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { runMigrationsAndEnsure(db); } finally {
    console.log = output;
    console.warn = warning;
  }
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-video-async-'));
  const storage = path.join(root, 'storage');
  const dbPath = path.join(root, 'test.db');
  fs.mkdirSync(storage, { recursive: true });
  const db = new Database(dbPath);
  silenceMigrations(db);
  const sourceRelative = 'library/videos/source.mp4';
  const outputRelative = 'library/videos/stage-output.mp4';
  const sourcePath = path.join(storage, sourceRelative);
  const outputPath = path.join(storage, outputRelative);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  const generated = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=blue:s=640x360:r=24:d=1', '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', sourcePath,
  ], { encoding: 'utf8' });
  if (generated.error || generated.status !== 0) {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`ffmpeg fixture failed: ${generated.error?.message || generated.stderr}`);
  }
  fs.copyFileSync(sourcePath, outputPath);
  return { root, storage, dbPath, db, sourceRelative, outputRelative };
}

function configFor(fixture) {
  return {
    app: { name: 'video-async-test', language: 'zh' },
    database: { path: fixture.dbPath, type: 'sqlite' },
    storage: { type: 'local', local_path: fixture.storage },
    server: {},
    payments: { enabled: false },
  };
}

async function openApi(db, cfg, log) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/v1', setupRouter(cfg, db, log));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  return {
    base,
    server,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function request(api, method, route, body, cookie) {
  const response = await fetch(api.base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
  return { status: response.status, body: parsed, cookie: response.headers.get('set-cookie')?.split(';')[0] || null };
}

async function login(api, username, password) {
  const result = await request(api, 'POST', '/auth/login', { username, password });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.cookie);
  return result.cookie;
}

async function waitFor(check, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for asynchronous video state');
}

function setStorageEnv(storagePath, callback) {
  const names = ['CFG_STORAGE__TYPE', 'CFG_STORAGE__LOCAL_PATH'];
  const old = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.CFG_STORAGE__TYPE = 'local';
  process.env.CFG_STORAGE__LOCAL_PATH = storagePath;
  return Promise.resolve().then(callback).finally(() => {
    for (const name of names) {
      if (old[name] === undefined) delete process.env[name];
      else process.env[name] = old[name];
    }
  });
}

async function openJsonServer(handler) {
  const server = http.createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      await handler(req, res, body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function seedAdmin(db, suffix = Date.now()) {
  return auth.createUser(db, {
    username: `video-async-admin-${suffix}`,
    password: 'test-password',
    account_kind: 'platform_admin',
  }, null);
}

function seedPostprocessConfig(db, log, baseUrl) {
  return aiConfigs.createConfig(db, log, {
    service_type: 'video_postprocess', provider: 'volcengine', api_protocol: 'mediakit',
    name: 'video async fake MediaKit', base_url: baseUrl, api_key: 'test-media-kit',
    model: [POSTPROCESS_MODEL], default_model: POSTPROCESS_MODEL, is_default: true,
    settings: JSON.stringify({ poll_interval_ms: 1, poll_max_attempts: 1 }),
  });
}

function seedCompletedStage(db, fixture, ownerId, generationId, marker = 1) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO video_generations
    (id, owner_user_id, provider, model, status, source_local_path, upscale_resolution,
     upscale_status, postprocess_recovery_version, created_at, updated_at)
    VALUES (?, ?, 'volcengine', ?, 'upscale_pending', ?, '1080p', 'completed', ?, ?, ?)`)
    .run(generationId, ownerId, POSTPROCESS_MODEL, fixture.sourceRelative, marker, now, now);
  db.prepare(`INSERT INTO video_upscale_jobs
    (video_generation_id, owner_user_id, target_resolution, source_local_path, output_local_path,
     status, created_at, updated_at, completed_at)
    VALUES (?, ?, '1080p', ?, ?, 'completed', ?, ?, ?)`)
    .run(generationId, ownerId, fixture.sourceRelative, fixture.outputRelative, now, now, now);
}

function seedReconciliationStage(db, fixture, ownerId, generationId, authorizationId, marker = 1) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO video_generations
    (id, owner_user_id, provider, model, status, source_local_path, upscale_resolution,
     upscale_status, billing_authorization_id, postprocess_recovery_version, created_at, updated_at)
    VALUES (?, ?, 'volcengine', ?, 'billing_reconciliation', ?, '1080p', 'reconciliation_required', ?, ?, ?, ?)`)
    .run(generationId, ownerId, POSTPROCESS_MODEL, fixture.sourceRelative, authorizationId, marker, now, now);
  db.prepare(`INSERT INTO video_upscale_jobs
    (video_generation_id, owner_user_id, billing_authorization_id, target_resolution,
     source_local_path, output_local_path, status, created_at, updated_at)
    VALUES (?, ?, ?, '1080p', ?, ?, 'reconciliation_required', ?, ?)`)
    .run(generationId, ownerId, authorizationId, fixture.sourceRelative, fixture.outputRelative, now, now);
}

test('resolved stage settlement recovers through HTTP, then restart is idempotent and excludes legacy rows', { concurrency: false }, async () => {
  const fixture = createFixture();
  const log = logger();
  let api;
  let fakeMediaKit;
  let db = fixture.db;
  let step = 'fixture';
  try {
    await setStorageEnv(fixture.storage, async () => {
      step = 'fake server';
      fakeMediaKit = await openJsonServer(async (_req, res) => {
        fakeMediaKit.calls += 1;
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'provider call is forbidden in this recovery test' }));
      });
      fakeMediaKit.calls = 0;
      const cfg = configFor(fixture);
      const admin = seedAdmin(db, 'reconcile');
      seedPostprocessConfig(db, log, fakeMediaKit.base);
      billing.savePriceBook(db, admin.id, {
        name: `video async price ${Date.now()}`,
        status: 'published',
        items: [{ service_type: 'video_postprocess', model: BILLING_MODEL, meter: 'millisecond', unit_price: 64 }],
      });
      billing.adjustBalance(db, admin.id, admin.id, 100000, 'video async recovery balance');
      const authorization = billing.createAuthorization(db, { id: admin.id, role: 'admin' }, {
        idempotency_key: `video-async-recovery-${Date.now()}`,
        service_type: 'video_postprocess', model: BILLING_MODEL, usage: { millisecond: 1000 },
      });
      const generationId = 8101;
      seedReconciliationStage(db, fixture, admin.id, generationId, authorization.authorization_id);
      const caseRow = billing.markPendingReconciliation(db, { id: admin.id, role: 'admin' }, authorization.authorization_id, {
        provider_request_id: 'fake-stage-request', observed_usage: { millisecond: 1000 },
      });

      // This row represents a case resolved before the opt-in marker existed.
      const oldGenerationId = 8102;
      const oldAuthId = 'legacy-stage-authorization';
      seedReconciliationStage(db, fixture, admin.id, oldGenerationId, oldAuthId, 0);
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO billing_reconciliation_cases
        (id, authorization_id, user_id, service_type, model, status, resolution_json, due_at, created_at)
        VALUES (?, ?, ?, 'video_postprocess', ?, 'resolved', ?, ?, ?)`)
        .run('legacy-stage-case', oldAuthId, admin.id, POSTPROCESS_MODEL, JSON.stringify({ usage: { millisecond: 1 } }), now, now);

      api = await openApi(db, cfg, log);
      const cookie = await login(api, `video-async-admin-reconcile`, 'test-password');
      const settled = await request(api, 'POST', `/admin/billing-reconciliations/${caseRow.id}/settle`, {
        usage: { millisecond: 1000 }, provider_request_id: 'fake-stage-request', reason: 'test settlement',
      }, cookie);
      step = 'settled HTTP';
      assert.equal(settled.status, 200, JSON.stringify(settled.body));

      // Wait for the HTTP-triggered recovery callback, then reopen the same
      // database to verify that startup recovery is idempotent.
      await waitFor(() => db.prepare('SELECT status FROM video_generations WHERE id=?').get(generationId)?.status === 'completed');
      await waitFor(() => {
        const row = db.prepare('SELECT resolution_json FROM billing_reconciliation_cases WHERE id=?').get(caseRow.id);
        try { return JSON.parse(row?.resolution_json || '{}').postprocess_recovery?.status === 'completed'; } catch (_) { return false; }
      });
      step = 'initial recovery';
      await api.close();
      api = null;
      db.close();
      db = new Database(fixture.dbPath);
      silenceMigrations(db);
      const restarted = billing.recoverResolvedVideoReconciliations(db, log);
      step = 'restart scan';
      assert.equal(restarted.queued, 0);
      assert.equal(fakeMediaKit.calls, 0, 'recovery must reuse the local stage output');
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(authorization.authorization_id).count, 1);
      assert.equal(db.prepare('SELECT status FROM video_upscale_jobs WHERE video_generation_id=?').get(generationId).status, 'completed');

      // A second startup pass must not charge or submit again.
      assert.equal(billing.recoverResolvedVideoReconciliations(db, log).queued, 0);
      videoService.resumeCompletedPostprocessVideoGenerations(db, log);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(fakeMediaKit.calls, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(authorization.authorization_id).count, 1);
      assert.equal(db.prepare('SELECT status FROM video_generations WHERE id=?').get(oldGenerationId).status, 'billing_reconciliation', 'legacy resolved case must remain untouched');
      assert.equal(db.prepare('SELECT status FROM video_upscale_jobs WHERE video_generation_id=?').get(oldGenerationId).status, 'reconciliation_required');

      // Verify the persisted resolved case through the real admin HTTP read.
      api = await openApi(db, cfg, log);
      const restored = await request(api, 'GET', '/admin/billing-reconciliations?status=resolved', undefined, cookie);
      assert.equal(restored.status, 200);
      assert.ok(restored.body.data.items.some((item) => item.id === caseRow.id));
    });
  } catch (error) {
    throw new Error(`${step}: ${error.message || error}`, { cause: error });
  } finally {
    if (api) await api.close();
    if (fakeMediaKit) await fakeMediaKit.close();
    try { if (db.open) db.close(); } catch (_) {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('startup resumes a completed stage only for an opted-in generation and is restart-idempotent', { concurrency: false }, async () => {
  const fixture = createFixture();
  const log = logger();
  let fakeMediaKit;
  let db = fixture.db;
  try {
    await setStorageEnv(fixture.storage, async () => {
      fakeMediaKit = await openJsonServer(async (_req, res) => {
        fakeMediaKit.calls += 1;
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{}');
      });
      fakeMediaKit.calls = 0;
      const admin = seedAdmin(db, 'stage');
      seedPostprocessConfig(db, log, fakeMediaKit.base);
      seedCompletedStage(db, fixture, admin.id, 8201, 1);
      seedCompletedStage(db, fixture, admin.id, 8202, 0);

      assert.deepEqual(videoService.resumeCompletedPostprocessVideoGenerations(db, log), { queued: 1 });
      await waitFor(() => db.prepare('SELECT status FROM video_generations WHERE id=8201').get().status === 'completed');
      assert.equal(db.prepare('SELECT status FROM video_generations WHERE id=8202').get().status, 'upscale_pending');
      assert.equal(fakeMediaKit.calls, 0);

      db.close();
      db = new Database(fixture.dbPath);
      silenceMigrations(db);
      assert.deepEqual(videoService.resumeCompletedPostprocessVideoGenerations(db, log), { queued: 0 });
      assert.equal(db.prepare('SELECT status FROM video_generations WHERE id=8201').get().status, 'completed');
      assert.equal(fakeMediaKit.calls, 0);
    });
  } finally {
    if (fakeMediaKit) await fakeMediaKit.close();
    try { if (db.open) db.close(); } catch (_) {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('legacy processing finalization does not opt into post-process recovery', { concurrency: false }, async () => {
  const fixture = createFixture();
  const log = logger();
  const originalUpscaleProcess = videoUpscale.process;
  let db = fixture.db;
  try {
    await setStorageEnv(fixture.storage, async () => {
      const admin = seedAdmin(db, 'legacy-finalize');
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO video_generations
        (id, owner_user_id, provider, model, status, source_local_path, resolution,
         upscale_resolution, upscale_status, postprocess_recovery_version, created_at, updated_at)
        VALUES (8401, ?, 'volcengine', ?, 'upscale_pending', ?, '720p', '1080p', 'pending', 0, ?, ?)`)
        .run(admin.id, POSTPROCESS_MODEL, fixture.sourceRelative, now, now);

      // Simulate the already accepted stage result. The test must reach the
      // real finalizer without submitting a provider request.
      videoUpscale.process = async () => ({ local_path: fixture.outputRelative, provider_request_id: 'legacy-stage' });
      const result = await videoService.resumePostprocessVideoGeneration(db, log, 8401);

      assert.equal(result.status, 'completed');
      assert.equal(db.prepare('SELECT status, postprocess_recovery_version FROM video_generations WHERE id=8401').get().status, 'completed');
      assert.equal(db.prepare('SELECT postprocess_recovery_version FROM video_generations WHERE id=8401').get().postprocess_recovery_version, 0);
    });
  } finally {
    videoUpscale.process = originalUpscaleProcess;
    try { if (db.open) db.close(); } catch (_) {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('late provider success cannot overwrite an HTTP cancellation', { concurrency: false }, async () => {
  const fixture = createFixture();
  const log = logger();
  let api;
  let provider;
  let releaseMedia;
  let mediaStartedResolve;
  const mediaStarted = new Promise((resolve) => { mediaStartedResolve = resolve; });
  const mediaBytes = fs.readFileSync(path.join(fixture.storage, fixture.sourceRelative));
  try {
    await setStorageEnv(fixture.storage, async () => {
      provider = await openJsonServer(async (req, res) => {
        if (req.method === 'POST') {
          provider.createCalls += 1;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ video_url: `${provider.base}/media.mp4` }));
          return;
        }
        if (req.url === '/media.mp4') {
          provider.mediaCalls += 1;
          mediaStartedResolve();
          await new Promise((resolve) => { releaseMedia = resolve; });
          res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mediaBytes.length });
          res.end(mediaBytes);
          return;
        }
        res.writeHead(404);
        res.end();
      });
      provider.createCalls = 0;
      provider.mediaCalls = 0;
      const db = fixture.db;
      const cfg = configFor(fixture);
      const admin = seedAdmin(db, 'cancel');
      aiConfigs.createConfig(db, log, {
        service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine',
        name: 'video async fake provider', base_url: provider.base, api_key: 'test-video-provider',
        model: ['video-async-model'], default_model: 'video-async-model',
        endpoint: '/v1/videos/generations', query_endpoint: '/v1/videos/generations/{taskId}', is_default: true,
      });
      const now = new Date().toISOString();
      const generationId = Number(db.prepare(`INSERT INTO video_generations
        (owner_user_id, provider, model, prompt, status, created_at, updated_at)
        VALUES (?, 'volcengine', 'video-async-model', 'cancel race', 'processing', ?, ?)`)
        .run(admin.id, now, now).lastInsertRowid);
      const jobId = Number(db.prepare(`INSERT INTO omni_video_jobs
        (video_generation_id, owner_user_id, mode, prompt, created_at, updated_at)
        VALUES (?, ?, 'omni', 'cancel race', ?, ?)`)
        .run(generationId, admin.id, now, now).lastInsertRowid);
      api = await openApi(db, cfg, log);
      const cookie = await login(api, `video-async-admin-cancel`, 'test-password');

      const running = videoService.processVideoGeneration(db, log, generationId);
      await mediaStarted;
      const cancelled = await request(api, 'POST', `/omni-video-jobs/${jobId}/cancel`, {}, cookie);
      assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
      assert.equal(db.prepare('SELECT status FROM video_generations WHERE id=?').get(generationId).status, 'failed');
      releaseMedia();
      await running;

      const row = db.prepare('SELECT status, video_url, local_path FROM video_generations WHERE id=?').get(generationId);
      assert.equal(row.status, 'failed');
      assert.equal(row.video_url, null);
      assert.equal(row.local_path, null);
      assert.equal(provider.createCalls, 1);
      assert.equal(provider.mediaCalls, 1);
    });
  } finally {
    if (api) await api.close();
    if (provider) await provider.close();
    try { if (fixture.db.open) fixture.db.close(); } catch (_) {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('stage failure updates the storyboard projection without a provider call', { concurrency: false }, async () => {
  const fixture = createFixture();
  const log = logger();
  let db = fixture.db;
  try {
    await setStorageEnv(fixture.storage, async () => {
      const admin = seedAdmin(db, 'failure');
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO storyboards
        (id, episode_id, active_video_generation_id, status, error_msg, updated_at, deleted_at)
        VALUES (8301, 1, 8301, 'processing', NULL, ?, NULL)`).run(now);
      db.prepare(`INSERT INTO video_generations
        (id, owner_user_id, storyboard_id, provider, model, status, source_local_path,
         upscale_resolution, upscale_status, created_at, updated_at)
        VALUES (8301, ?, 8301, 'volcengine', ?, 'upscale_pending', ?, '1080p', 'pending', ?, ?)`)
        .run(admin.id, POSTPROCESS_MODEL, fixture.sourceRelative, now, now);
      db.prepare(`INSERT INTO video_upscale_jobs
        (video_generation_id, owner_user_id, target_resolution, source_local_path, status, created_at, updated_at)
        VALUES (8301, ?, '1080p', ?, 'pending', ?, ?)`)
        .run(admin.id, fixture.sourceRelative, now, now);

      const result = await videoUpscale.process(db, log, 8301, fixture.storage);
      assert.equal(result, null);
      assert.equal(db.prepare('SELECT status FROM video_generations WHERE id=8301').get().status, 'failed');
      assert.equal(db.prepare('SELECT status FROM video_upscale_jobs WHERE video_generation_id=8301').get().status, 'failed');
      const storyboard = db.prepare('SELECT status, error_msg, active_video_generation_id FROM storyboards WHERE id=8301').get();
      assert.equal(storyboard.status, 'failed');
      assert.match(storyboard.error_msg, /MediaKit|配置/);
      assert.equal(storyboard.active_video_generation_id, 8301);
    });
  } finally {
    try { if (db.open) db.close(); } catch (_) {}
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
