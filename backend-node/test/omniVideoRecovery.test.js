const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const omni = require('../src/services/omniVideoService');
const auth = require('../src/services/authService');
const aiConfigs = require('../src/services/aiConfigService');
const tenants = require('../src/services/tenantService');
const billing = require('../src/services/billingService');
const videoService = require('../src/services/videoService');

test('only safe provider material-fetch timeouts enable failed-generation retry', () => {
  const internalTimeout = 'Timeout while downloading url: https://ark-common-storage-prod-cn-beijing.tos-cn-beijing.volces.com/ark-async-gateway/cgt-test/2?x-tos-process=image%2Fformat%2Cjpg Request id: 021788';
  const inputFetchTimeout = '火山 Seedance 全能创建失败: 400 - The parameter `content[1].image_url` specified in the request is not valid: timeout while fetching resource. Request id: 021788333812264a7468c13ae862cf181a1dbcac0db1f8247ce00';
  const inputVideoFetchTimeout = '火山 Seedance 全能创建失败: 400 - The parameter `content[7].video_url` specified in the request is not valid: timeout while fetching resource. Request id: 021788424545508f836aa75e744066f138d0c171bcc7779be28b8';
  const inputAudioFetchTimeout = '火山 Seedance 全能创建失败: 400 - The parameter `content[8].audio_url` specified in the request is not valid: timeout while fetching resource. Request id: 021788';
  assert.equal(omni.isProviderInternalMaterialTimeout(internalTimeout), true);
  assert.equal(omni.isProviderInputImageFetchTimeout(inputFetchTimeout), true);
  assert.equal(omni.isProviderInputMediaFetchTimeout(inputFetchTimeout), true);
  assert.equal(omni.isProviderInputMediaFetchTimeout(inputVideoFetchTimeout), true);
  assert.equal(omni.isProviderInputMediaFetchTimeout(inputAudioFetchTimeout), true);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: internalTimeout }), true);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: inputFetchTimeout, provider_task_id: null }), true);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: inputVideoFetchTimeout, provider_task_id: null }), true);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: inputAudioFetchTimeout, provider_task_id: null }), true);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: inputFetchTimeout, provider_task_id: 'already-created' }), false);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: inputVideoFetchTimeout, provider_task_id: 'already-created' }), false);
  assert.equal(omni.canRetryGeneration({ status: 'retryable', error_msg: 'restart recovery' }), true);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: 'failed to download input image https://customer.example/reference.png' }), false);
  assert.equal(omni.canRetryGeneration({ status: 'failed', error_msg: 'Timeout while downloading url: https://example.com/image.jpg' }), false);
});

test('SD2 recovery marks an unrecoverable waiting job invalid instead of retrying forever', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-sd2-recovery-'));
  try {
    const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
    runMigrationsAndEnsure(db);
    const now = new Date().toISOString();
    const generation = db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, status, created_at, updated_at)
      VALUES (1, 'volces', 'seedance', 'sd2_waiting', ?, ?)`)
      .run(now, now);
    db.prepare(`INSERT INTO omni_video_jobs
      (video_generation_id, owner_user_id, prompt, model_requested, model_resolved, request_snapshot_json, created_at, updated_at)
      VALUES (?, 1, 'test', 'seedance', 'seedance', '{}', ?, ?)`)
      .run(generation.lastInsertRowid, now, now);

    omni.resumeSd2WaitingGenerations(db, { warn() {} });

    const row = db.prepare('SELECT status, error_msg FROM video_generations WHERE id=?').get(generation.lastInsertRowid);
    assert.equal(row.status, 'invalid');
    assert.match(row.error_msg, /缺少可恢复的请求快照/);
  } finally {
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SD2 waiting generation resumes after restart when an old snapshot has no idempotency key', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-sd2-resume-'));
  const dbPath = path.join(root, 'test.db');
  const originalProcess = videoService.processVideoGeneration;
  let db;
  try {
    db = getDb({ path: dbPath, type: 'sqlite' });
    runMigrationsAndEnsure(db);
    const warnings = [];
    const log = { info() {}, warn(...args) { warnings.push(args); }, error() {} };
    const admin = auth.ensureBootstrapAdmin(db, log);
    billing.adjustBalance(db, admin.id, admin.id, 10000, 'SD2 recovery test balance');
    const tenant = tenants.tenantForUser(db, admin.id);
    const model = 'doubao-seedance-2-0-mini-260615';
    const config = aiConfigs.createConfig(db, log, {
      service_type: 'video', provider: 'volcengine', api_protocol: 'volcengine_omni',
      name: 'SD2 recovery test', base_url: 'https://example.invalid', api_key: 'test',
      model: [model], default_model: model, is_default: true,
      settings: JSON.stringify({ billing_reserve_output_tokens: 1000000 }), owner_tenant_id: tenant.id,
    });
    tenants.bindOwnedConfig(db, tenant.id, config, { is_default: true });
    const now = new Date().toISOString();
    const pendingCertification = JSON.stringify({ status: 'processing', stage: 'processing', hub_asset_id: 'asset-pending', asset_url: 'asset://asset-pending' });
    const asset = db.prepare(`INSERT INTO assets
      (owner_user_id, name, type, url, local_path, width, height, file_size, processing_status, requires_sd2_identity, seedance2_asset, created_at, updated_at)
      VALUES (?, '真人参考图.png', 'image', '/static/library/identity.png', 'library/identity.png', 12699, 7559, 30023620, 'ready', 1, ?, ?, ?)`)
      .run(admin.id, pendingCertification, now, now);

    const waiting = omni.create(db, log, {
      model, prompt: '真人参考镜头', resolution: '480p', duration: 5,
      owner_user_id: admin.id, tenant_id: tenant.id, idempotency_key: 'client-sd2-waiting-1',
      assets: [{ asset_id: Number(asset.lastInsertRowid), alias: '真人参考图', type: 'image', role: 'reference', usage: 'reference' }],
    }, admin);
    assert.equal(waiting.status, 'sd2_waiting');
    const storedJob = db.prepare('SELECT id, request_snapshot_json FROM omni_video_jobs WHERE video_generation_id=?').get(waiting.video_generation_id);
    assert.deepEqual(videoService.loadOmniReferenceImageInputs(db, waiting.video_generation_id, ['https://cdn.example/identity.png']), [{
      url: 'https://cdn.example/identity.png', local_path: 'library/identity.png', width: 12699, height: 7559, file_size: 30023620,
    }]);
    const storedSnapshot = JSON.parse(storedJob.request_snapshot_json);
    assert.equal(storedSnapshot.idempotency_key, 'client-sd2-waiting-1');
    assert.equal(omni.get(db, storedJob.id).request_snapshot.idempotency_key, undefined);

    omni.resumeSd2WaitingGenerations(db, log);
    const stillWaiting = db.prepare('SELECT status, billing_authorization_id FROM video_generations WHERE id=?').get(waiting.video_generation_id);
    assert.equal(stillWaiting.status, 'sd2_waiting');
    assert.equal(stillWaiting.billing_authorization_id, null);
    assert.equal(warnings.some((entry) => String(entry[0]).includes('resume failed')), false);

    // Emulate a record created by the older release, then make the remote
    // certification active before restarting the backend.
    delete storedSnapshot.idempotency_key;
    db.prepare('UPDATE omni_video_jobs SET request_snapshot_json=? WHERE id=?').run(JSON.stringify(storedSnapshot), storedJob.id);
    db.prepare('UPDATE assets SET seedance2_asset=?, updated_at=? WHERE id=?').run(
      JSON.stringify({ status: 'active', stage: 'active', hub_asset_id: 'asset-active', asset_url: 'asset://asset-active' }),
      new Date().toISOString(), Number(asset.lastInsertRowid),
    );
    closeDb();
    db = getDb({ path: dbPath, type: 'sqlite' });

    const processed = [];
    videoService.processVideoGeneration = (_db, _log, generationId) => { processed.push(Number(generationId)); };
    omni.resumeSd2WaitingGenerations(db, log);
    await new Promise((resolve) => setImmediate(resolve));

    const resumed = db.prepare('SELECT status, billing_authorization_id, error_msg FROM video_generations WHERE id=?').get(waiting.video_generation_id);
    assert.equal(resumed.status, 'processing', JSON.stringify(warnings));
    assert.ok(resumed.billing_authorization_id);
    assert.equal(resumed.error_msg, null);
    assert.deepEqual(processed, [waiting.video_generation_id]);
    const authorization = db.prepare("SELECT idempotency_key FROM billing_transactions WHERE id=? AND type='authorization'").get(resumed.billing_authorization_id);
    assert.equal(authorization.idempotency_key, `omni-video:sd2-resume:${waiting.video_generation_id}`);

    billing.voidAuthorization(db, admin, resumed.billing_authorization_id, 'SD2 recovery retry test');
    const internalTimeout = 'Timeout while downloading url: https://ark-common-storage-prod-cn-beijing.tos-cn-beijing.volces.com/ark-async-gateway/cgt-test/2?x-tos-process=image%2Fformat%2Cjpg Request id: 021788';
    db.prepare("UPDATE video_generations SET status='failed', error_msg=? WHERE id=?").run(internalTimeout, waiting.video_generation_id);
    const retrySnapshot = JSON.parse(db.prepare('SELECT request_snapshot_json FROM omni_video_jobs WHERE id=?').get(storedJob.id).request_snapshot_json);
    retrySnapshot.original_prompt = '真人参考镜头';
    retrySnapshot.prompt = 'processed-prompt-must-not-be-reused';
    db.prepare('UPDATE omni_video_jobs SET request_snapshot_json=? WHERE id=?').run(JSON.stringify(retrySnapshot), storedJob.id);
    assert.equal(omni.get(db, storedJob.id).can_retry_generation, true);
    assert.equal(omni.list(db, { owner_user_id: admin.id }).find((item) => item.id === storedJob.id)?.can_retry_generation, true);
    const retried = omni.retry(db, log, storedJob.id, admin);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(retried.status, 'processing');
    assert.notEqual(retried.video_generation_id, waiting.video_generation_id);
    const retriedSnapshot = JSON.parse(db.prepare('SELECT request_snapshot_json FROM omni_video_jobs WHERE id=?').get(retried.omni_job_id).request_snapshot_json);
    assert.equal(retriedSnapshot.original_prompt, '真人参考镜头');
    assert.doesNotMatch(retriedSnapshot.prompt, /processed-prompt-must-not-be-reused/);
    const retryGeneration = db.prepare('SELECT billing_authorization_id FROM video_generations WHERE id=?').get(retried.video_generation_id);
    const retryAuthorization = db.prepare("SELECT idempotency_key FROM billing_transactions WHERE id=? AND type='authorization'").get(retryGeneration.billing_authorization_id);
    assert.equal(retryAuthorization.idempotency_key, `omni-video:retry:${storedJob.id}`);
    assert.deepEqual(processed, [waiting.video_generation_id, retried.video_generation_id]);
  } finally {
    videoService.processVideoGeneration = originalProcess;
    closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
