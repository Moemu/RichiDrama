const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { setupRouter } = require('../src/routes');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const drama = require('../src/services/dramaService');
const assets = require('../src/services/assetService');
const jobs = require('../src/services/lasMediaJobService');
const las = require('../src/services/lasOperatorClient');
const tos = require('../src/services/lasTosBridge');

const log = { info() {}, warn() {}, error() {}, debug() {}, infow() {}, warnw() {}, errorw() {} };

test('authenticated LAS erase-then-translate workflow archives local results and settles once across restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-las-integration-'));
  const storage = path.join(root, 'storage');
  const dbPath = path.join(root, 'test.db');
  fs.mkdirSync(path.join(storage, 'input'), { recursive: true });
  const sourceFile = path.join(storage, 'input', 'source.mp4');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourceFile], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr);
  const original = { upload: tos.upload, download: tos.download, request: las.request, remove: tos.remove };
  let submits = 0;
  let polls = 0;
  const removed = [];
  const providerOutputs = new Map();
  tos.upload = async (_config, key) => `tos://example-bucket/${key}`;
  tos.remove = async (_config, objectPath) => { removed.push(objectPath); return { deleted: true }; };
  tos.download = async (_config, objectPath, target) => { fs.mkdirSync(path.dirname(target), { recursive: true }); if (objectPath.endsWith('.srt')) fs.writeFileSync(target, '1\n00:00:00,000 --> 00:00:01,000\nHello\n'); else fs.copyFileSync(sourceFile, target); return { bytes: fs.statSync(target).size }; };
  las.request = async (_config, action, payload) => {
    if (action === 'submit') {
      submits += 1;
      const taskId = `integration-${submits}`;
      providerOutputs.set(taskId, { video: `${payload.data.output_tos_path}output.mp4`, caption: payload.operator_id === 'las_video_translate' ? `${payload.data.output_tos_path}translated.srt` : null });
      return { task_id: taskId, status: 'PENDING' };
    }
    polls += 1;
    const output = providerOutputs.get(payload.task_id);
    return { task_id: payload.task_id, status: 'COMPLETED', business_code: '0', data: { inpainted_video_path: output.video, translated_caption_path: output.caption } };
  };
  let db = new Database(dbPath);
  const oldLog = console.log;
  const oldWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { runMigrationsAndEnsure(db); } finally { console.log = oldLog; console.warn = oldWarn; }
  const admin = auth.ensureBootstrapAdmin(db, log);
  const user = auth.createUser(db, { username: `las-user-${Date.now()}`, password: 'test-password' }, admin.id);
  billing.adjustBalance(db, admin.id, user.id, 100, 'test balance');
  billing.savePriceBook(db, admin.id, { name: 'LAS fixture prices', status: 'published', items: [
    { service_type: 'video_postprocess', model: 'las-video-inpaint-lite', meter: 'millisecond', unit_price: 1, conditions_json: { unit_size: 60000 } },
    { service_type: 'video_postprocess', model: 'las-video-translate', meter: 'millisecond', unit_price: 2, conditions_json: { unit_size: 60000 } },
  ] });
  const primaryConfig = require('../src/services/aiConfigService').createConfig(db, log, {
    service_type: 'video_localization', provider: 'las', name: 'LAS 视频本地化',
    base_url: 'https://operator.las.cn-beijing.volces.com', api_key: 'test-only',
    is_default: true,
    settings: JSON.stringify({ region: 'cn-beijing', tos_bucket: 'example-bucket', tos_access_key_id: 'test-access', tos_secret_access_key: 'test-secret' }),
  });
  require('../src/services/aiConfigService').createConfig(db, log, {
    service_type: 'video_localization', provider: 'las', name: '旧测试配置',
    base_url: 'https://operator.las.cn-beijing.volces.com', api_key: 'test-only',
    settings: JSON.stringify({ region: 'cn-beijing', tos_bucket: 'stale-bucket', tos_access_key_id: 'test-access', tos_secret_access_key: 'test-secret' }),
  });
  assert.equal(jobs.serviceConfig(db).tosConfig.bucket, 'example-bucket');
  db.prepare('UPDATE ai_service_configs SET is_default=0 WHERE id=?').run(primaryConfig.id);
  assert.throws(() => jobs.serviceConfig(db), /唯一默认配置/);
  db.prepare('UPDATE ai_service_configs SET is_default=1 WHERE id=?').run(primaryConfig.id);
  const project = drama.createDrama(db, log, { title: 'LAS 测试项目', owner_user_id: user.id });
  const source = assets.create(db, log, { owner_user_id: user.id, drama_id: project.id, name: '原片', type: 'video', local_path: 'input/source.mp4', duration: 10, mime_type: 'video/mp4' });
  const cfg = { storage: { type: 'local', local_path: storage }, server: {}, payments: { enabled: false }, vendor_lock: { enabled: false } };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', setupRouter(cfg, db, log));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  let jobId;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    tos.upload = original.upload; tos.download = original.download; las.request = original.request; tos.remove = original.remove;
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function call(method, route, body, token) {
    const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-lmd-session': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  }
  const login = await call('POST', '/auth/login', { username: user.username, password: 'test-password' });
  assert.equal(login.status, 200);
  const token = login.body.data.token;
  const capabilities = await call('GET', '/las-media-jobs/capabilities', null, token);
  assert.equal(capabilities.body.data.ready, true);
  assert.equal(capabilities.body.data.region, 'cn-beijing');
  assert.equal((await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: source.id, stage: 'inpaint', model_level: 'lite', idempotency_key: 'test' })).status, 401);
  const created = await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: source.id, stage: 'inpaint', model_level: 'lite', idempotency_key: 'test' }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  jobId = created.body.data.id;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (jobs.get(db, user.id, jobId).status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const completed = jobs.get(db, user.id, jobId);
  assert.equal(completed.status, 'completed', completed.error_msg);
  assert.equal(completed.billing.state, 'settled');
  assert.ok(completed.billing.charged_credits > 0, '完成任务要能看到实际扣费');
  assert.equal(completed.source_asset_name, '原片');
  assert.equal(completed.output_asset_name, 'LAS 字幕擦除');
  assert.equal(submits, 1);
  assert.equal(polls, 1);
  const output = assets.getByIdForOwner(db, completed.output_asset_id, user.id);
  assert.equal(output.parent_asset_id, source.id);
  assert.ok(fs.existsSync(path.join(storage, output.local_path)));
  const authorizationId = db.prepare('SELECT authorization_id FROM las_media_jobs WHERE id=?').get(jobId).authorization_id;
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(authorizationId).count, 1);
  const repeated = await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: source.id, stage: 'inpaint', model_level: 'lite', idempotency_key: 'test' }, token);
  assert.equal(repeated.body.data.id, jobId);
  assert.equal(submits, 1);
  const conflict = await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: source.id, stage: 'translate', output_language: 'en-US', idempotency_key: 'test' }, token);
  assert.equal(conflict.status, 400);
  assert.match(conflict.body.error.message, /幂等键/);
  const translated = await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: completed.output_asset_id, stage: 'translate', output_language: 'en-US', idempotency_key: 'translate-test' }, token);
  assert.equal(translated.status, 201, JSON.stringify(translated.body));
  const translationId = translated.body.data.id;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (jobs.get(db, user.id, translationId).status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const translation = jobs.get(db, user.id, translationId);
  assert.equal(translation.status, 'completed', translation.error_msg);
  assert.match(translation.caption_url, /^\/static\/las\//);
  assert.ok(fs.existsSync(path.join(storage, translation.caption_url.replace('/static/', ''))));
  assert.equal(submits, 2);
  assert.equal(polls, 2);
  // 中转治理：完成任务在本地归档与 DB 完成态落地后，精确清理本任务登记过的对象；
  // 耗时打点写入 submitted_at/completed_at 供运营台展示。
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = db.prepare('SELECT tos_cleanup_at FROM las_media_jobs WHERE id IN (?,?)').all(jobId, translationId);
    if (rows.every((row) => row.tos_cleanup_at)) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const governance = db.prepare('SELECT submitted_at, completed_at, tos_cleanup_at, tos_policy, tos_objects_json FROM las_media_jobs WHERE id=?').get(jobId);
  assert.ok(governance.submitted_at && governance.completed_at && governance.tos_cleanup_at, '耗时与清理时间必须落库');
  assert.equal(governance.tos_policy, 'cleanup');
  assert.ok(JSON.parse(governance.tos_objects_json).input.bytes > 0, '中转对象要带字节数供运营统计');
  assert.ok(removed.includes(`tos://example-bucket/richidrama/las/${jobId}/input/source.mp4`));
  assert.ok(removed.includes(`tos://example-bucket/richidrama/las/${jobId}/inpaint/output.mp4`));
  assert.ok(removed.includes(`tos://example-bucket/richidrama/las/${translationId}/translate/output.mp4`));
  assert.ok(removed.includes(`tos://example-bucket/richidrama/las/${translationId}/translate/translated.srt`));
  // 历史任务（tos_policy 为 NULL）默认不清理。
  const legacyId = randomUUID();
  const legacyAt = new Date().toISOString();
  db.prepare(`INSERT INTO las_media_jobs(id,owner_user_id,drama_id,source_asset_id,idempotency_key,stage,input_json,output_asset_id,input_tos_path,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'tos://example-bucket/richidrama/las/legacy/input/source.mp4','completed',?,?)`)
    .run(legacyId, user.id, project.id, source.id, `legacy-${legacyId}`, 'inpaint', JSON.stringify({ stage: 'inpaint', model_level: 'lite' }), completed.output_asset_id, legacyAt, legacyAt);
  const removedBefore = removed.length;
  assert.equal(await jobs.cleanupTransit(db, log, cfg, legacyId), null, '历史任务的中转对象不能被清理');
  assert.equal(removed.length, removedBefore);
  // 清理失败不改写任务终态，重试有界且幂等。
  const failingId = randomUUID();
  db.prepare(`INSERT INTO las_media_jobs(id,owner_user_id,drama_id,source_asset_id,idempotency_key,stage,input_json,output_asset_id,input_tos_path,tos_policy,tos_objects_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'cleanup',?,'completed',?,?)`)
    .run(failingId, user.id, project.id, source.id, `failing-${failingId}`, 'inpaint', JSON.stringify({ stage: 'inpaint', model_level: 'lite' }), completed.output_asset_id,
      `tos://example-bucket/richidrama/las/${failingId}/input/source.mp4`, JSON.stringify({ input: { path: `tos://example-bucket/richidrama/las/${failingId}/input/source.mp4`, bytes: 10 } }), legacyAt, legacyAt);
  const originalRemove = tos.remove;
  tos.remove = async () => { throw new Error('LAS TOS DELETE 失败：HTTP 500'); };
  const failedCleanup = await jobs.cleanupTransit(db, log, cfg, failingId);
  assert.equal(failedCleanup.failed, 1);
  assert.equal(db.prepare('SELECT status, tos_cleanup_attempts FROM las_media_jobs WHERE id=?').get(failingId).status, 'completed', '清理失败不能让完成任务变失败');
  assert.equal(db.prepare('SELECT tos_cleanup_attempts FROM las_media_jobs WHERE id=?').get(failingId).tos_cleanup_attempts, 1);
  tos.remove = originalRemove;
  await jobs.cleanupTransit(db, log, cfg, failingId);
  assert.ok(db.prepare('SELECT tos_cleanup_at FROM las_media_jobs WHERE id=?').get(failingId).tos_cleanup_at, '重试后清理成功');
  const originalUpload = tos.upload;
  let releaseUpload;
  let uploadStarted;
  const uploadEntered = new Promise((resolve) => { uploadStarted = resolve; });
  tos.upload = async (...args) => {
    uploadStarted();
    await new Promise((resolve) => { releaseUpload = resolve; });
    return originalUpload(...args);
  };
  let leaseJobId;
  try {
    const leaseJob = await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: source.id, stage: 'inpaint', model_level: 'lite', idempotency_key: 'lease-test' }, token);
    assert.equal(leaseJob.status, 201, JSON.stringify(leaseJob.body));
    leaseJobId = leaseJob.body.data.id;
    await uploadEntered;
    const deadline = Date.parse(db.prepare('SELECT lease_until FROM las_media_jobs WHERE id=?').get(leaseJobId).lease_until) - Date.now();
    assert.ok(deadline > 0 && deadline <= 120_000, '重启后的旧租约最多应阻塞任务两分钟');
  } finally {
    releaseUpload?.();
    tos.upload = originalUpload;
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (jobs.get(db, user.id, leaseJobId).status === 'completed') break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal(jobs.get(db, user.id, leaseJobId).status, 'completed');
  assert.equal(submits, 3);
  const uncertainId = randomUUID();
  const uncertainAuthorization = billing.createAuthorization(db, { id: user.id }, {
    idempotency_key: `las-uncertain:${uncertainId}`, service_type: 'video_postprocess', model: 'las-video-inpaint-lite', provider: 'las',
    usage: { millisecond: 10000 }, drama_id: project.id, reference_type: 'las_media_job', reference_id: uncertainId,
  });
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO las_media_jobs(id,owner_user_id,drama_id,source_asset_id,idempotency_key,stage,input_json,authorization_id,status,lease_token,lease_until,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,'submitting',?,?,?,?)`).run(uncertainId, user.id, project.id, source.id, `uncertain-${uncertainId}`, 'inpaint', JSON.stringify({ stage: 'inpaint', model_level: 'lite' }), uncertainAuthorization.authorization_id, randomUUID(), new Date(Date.now() - 1000).toISOString(), at, at);
  db.close();
  db = new Database(dbPath);
  const recovery = jobs.resume(db, log, cfg);
  assert.equal(jobs.get(db, user.id, jobId).status, 'completed');
  assert.equal(jobs.get(db, user.id, translationId).status, 'completed');
  assert.equal(jobs.get(db, user.id, uncertainId).status, 'reconciliation');
  assert.equal(jobs.get(db, user.id, uncertainId).billing.state, 'reconciling');
  assert.ok(jobs.get(db, user.id, uncertainId).billing.reserved_credits > 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM billing_reconciliation_cases WHERE authorization_id=? AND status='pending'").get(uncertainAuthorization.authorization_id).count, 1);
  assert.equal(submits, 3);
  recovery.stop();
  assert.equal(assets.getByIdForOwner(db, completed.output_asset_id, user.id).local_path, output.local_path);
});

test('failed LAS jobs release registered transit objects while reconciliation rows keep them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-las-release-'));
  const storage = path.join(root, 'storage');
  fs.mkdirSync(storage, { recursive: true });
  const original = { remove: tos.remove };
  const removed = [];
  tos.remove = async (_config, objectPath) => { removed.push(objectPath); return { deleted: true }; };
  const db = new Database(':memory:');
  const out = console.log; const warn = console.warn; console.log = () => {}; console.warn = () => {};
  try { runMigrationsAndEnsure(db); } finally { console.log = out; console.warn = warn; }
  const admin = auth.ensureBootstrapAdmin(db, log);
  require('../src/services/aiConfigService').createConfig(db, log, {
    service_type: 'video_localization', provider: 'las', name: '回收测试配置', base_url: 'https://operator.las.cn-beijing.volces.com', api_key: 'test-only', is_default: true,
    settings: JSON.stringify({ region: 'cn-beijing', tos_bucket: 'example-bucket', tos_access_key_id: 'a', tos_secret_access_key: 'b' }),
  });
  const project = drama.createDrama(db, log, { title: '回收测试', owner_user_id: admin.id });
  const source = assets.create(db, log, { owner_user_id: admin.id, drama_id: project.id, name: '原片', type: 'video', local_path: 'input/source.mp4', duration: 10, mime_type: 'video/mp4' });
  const at = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO las_media_jobs(id,owner_user_id,drama_id,source_asset_id,idempotency_key,stage,input_json,input_tos_path,tos_policy,tos_objects_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?, 'cleanup', ?,?,?,?)`);
  const failedId = randomUUID();
  const failedInput = `tos://example-bucket/richidrama/las/${failedId}/input/source.mp4`;
  insert.run(failedId, admin.id, project.id, source.id, `release-${failedId}`, 'inpaint', JSON.stringify({ stage: 'inpaint', model_level: 'lite' }), failedInput, JSON.stringify({ input: { path: failedInput, bytes: 10 } }), 'failed', at, at);
  const reconcilingId = randomUUID();
  const pendingInput = `tos://example-bucket/richidrama/las/${reconcilingId}/input/source.mp4`;
  insert.run(reconcilingId, admin.id, project.id, source.id, `keep-${reconcilingId}`, 'inpaint', JSON.stringify({ stage: 'inpaint', model_level: 'lite' }), pendingInput, JSON.stringify({ input: { path: pendingInput, bytes: 10 } }), 'reconciliation', at, at);
  const cfg = { storage: { type: 'local', local_path: storage } };
  try {
    const result = await jobs.cleanupTransit(db, log, cfg, failedId);
    assert.deepEqual(result, { cleaned: 1 });
    assert.deepEqual(removed, [failedInput]);
    assert.equal(await jobs.cleanupTransit(db, log, cfg, reconcilingId), null, '待对账任务不能回收——供应商可能仍在读取输入');
    assert.equal(removed.length, 1);
    assert.ok(db.prepare('SELECT tos_cleanup_at FROM las_media_jobs WHERE id=?').get(failedId).tos_cleanup_at);
  } finally {
    tos.remove = original.remove;
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('result selection rejects missing and ambiguous supplier output paths', () => {
  const prefix = 'tos://example-bucket/richidrama/las/a106ecad-410b-4a0b-a250-838a047a1d8f/translate/';
  assert.equal(jobs.resultPaths({ translated: [{ video_path: `${prefix}video.mp4` }] }, prefix).video, `${prefix}video.mp4`);
  assert.throws(() => jobs.resultPaths({ output_video_url: 'https://example.com/signed.mp4' }, prefix), /唯一/);
  assert.throws(() => jobs.resultPaths({ paths: [`${prefix}a.mp4`, `${prefix}b.mp4`] }, prefix), /唯一/);
});
