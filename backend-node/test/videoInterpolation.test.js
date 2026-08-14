const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const interpolation = require('../src/services/videoInterpolationService');
const interpolationClient = require('../src/services/videoInterpolationClient');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-interpolation-'));
  const dbPath = path.join(root, 'test.db');
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const admin = auth.ensureBootstrapAdmin(db, { warn() {}, info() {} });
  const user = auth.createUser(db, { username: `interpolation-${Date.now()}`, password: '1' }, admin.id);
  billing.adjustBalance(db, admin.id, user.id, 10000, 'interpolation test balance');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ai_service_configs
    (service_type, provider, name, base_url, api_key, model, default_model, billing_key, is_default, is_active, settings, created_at, updated_at)
    VALUES ('video_postprocess', 'volcengine_mediakit', 'MediaKit', 'https://mediakit.cn-beijing.volces.com', 'test-key', ?, ?, ?, 1, 1, ?, ?, ?)`)
    .run(JSON.stringify(['volcengine-video-frame-interpolation']), 'volcengine-video-frame-interpolation', 'volcengine-video-frame-interpolation', JSON.stringify({ target_fps: 60 }), now, now);
  return { db, root, user };
}

function teardown(root) {
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
}

test('frame interpolation reserves its own conditional duration charge and persists an awaiting-source job', () => {
  let context;
  try {
    context = setup();
    const { db, user } = context;
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, duration, resolution, status, created_at, updated_at)
      VALUES (?, 'volces', 'seedance', 10, '720p', 'processing', ?, ?)`)
      .run(user.id, now, now);

    const job = interpolation.reserveForGeneration(db, info.lastInsertRowid, 60);
    assert.equal(job.status, 'awaiting_source');
    assert.equal(job.target_fps, 60);
    const authorization = db.prepare("SELECT * FROM billing_transactions WHERE id=? AND type='authorization'").get(job.billing_authorization_id);
    // No upscale was selected, so the interpolation quote uses the 720p tier.
    // 720p / <=60fps is 120 points per minute. Reserve 11 seconds.
    assert.equal(authorization.amount_micro, 220000);
    const video = db.prepare('SELECT interpolation_job_id, interpolation_status, target_fps FROM video_generations WHERE id=?').get(info.lastInsertRowid);
    assert.deepEqual(video, { interpolation_job_id: job.id, interpolation_status: 'awaiting_source', target_fps: 60 });
  } catch (error) {
    assert.fail(error?.stack || `${error?.code}: ${error?.message}`);
  } finally {
    if (context) teardown(context.root);
  }
});

test('frame interpolation pricing context normalizes resolution and fps tiers', () => {
  assert.equal(interpolation.resolutionTier('1920x1080'), '1080p');
  assert.equal(interpolation.resolutionTier('3840x2160'), '4k');
  assert.equal(interpolation.fpsTier(30), 'lte30');
  assert.equal(interpolation.fpsTier(60), 'lte60');
  assert.equal(interpolation.fpsTier(120), 'lte120');
  assert.throws(() => interpolation.resolutionTier('7680x4320'), /8K/);
});

test('frame interpolation submit uses the official client_token field', async () => {
  const context = setup();
  const originalFetch = global.fetch;
  try {
    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ task_id: 'official-task', request_id: 'official-request' }) };
    };
    await interpolationClient.submit(context.db, {
      video_url: 'mediakit://source', fps: 60, client_token: 'vg-123', callback_args: '{"video_generation_id":123}',
    });
    assert.equal(requestBody.client_token, 'vg-123');
    assert.equal(Object.hasOwn(requestBody, 'idempotency_key'), false);
  } finally {
    global.fetch = originalFetch;
    teardown(context.root);
  }
});

test('frame interpolation persists provider identity, local output, exact settlement, and idempotent replay', async () => {
  const context = setup();
  const original = {
    uploadLocalVideo: interpolationClient.uploadLocalVideo,
    submit: interpolationClient.submit,
    retrieve: interpolationClient.retrieve,
    fetch: global.fetch,
  };
  let submitCount = 0;
  try {
    const { db, root, user } = context;
    const sourceRelative = 'projects/closure/videos/source.mp4';
    const sourceAbsolute = path.join(root, sourceRelative);
    fs.mkdirSync(path.dirname(sourceAbsolute), { recursive: true });
    const generatedSource = spawnSync(getFfmpegPath(), [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourceAbsolute,
    ], { encoding: 'utf8' });
    assert.equal(generatedSource.status, 0, generatedSource.stderr);
    const outputAbsolute = path.join(root, 'interpolated-fixture.mp4');
    const generatedOutput = spawnSync(getFfmpegPath(), [
      '-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:r=60:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputAbsolute,
    ], { encoding: 'utf8' });
    assert.equal(generatedOutput.status, 0, generatedOutput.stderr);
    const outputBytes = fs.readFileSync(outputAbsolute);
    const now = new Date().toISOString();
    const info = db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, duration, resolution, source_local_path, status, created_at, updated_at)
      VALUES (?, 'volces', 'seedance', 10, '720p', ?, 'interpolation_pending', ?, ?)`)
      .run(user.id, sourceRelative, now, now);
    interpolation.reserveForGeneration(db, info.lastInsertRowid, 60);

    interpolationClient.uploadLocalVideo = async () => ({ file_id: 'mediakit://uploaded-source', request_id: 'upload-request' });
    interpolationClient.submit = async () => {
      submitCount += 1;
      return { task_id: 'mediakit-task-1', request_id: 'submit-request-1' };
    };
    interpolationClient.retrieve = async () => ({
      status: 'completed', request_id: 'result-request-1',
      result: { video_url: 'https://temporary.example/interpolated.mp4', duration: 10, resolution: '720p', fps: 60 },
    });
    global.fetch = async () => ({ ok: true, arrayBuffer: async () => outputBytes });

    const capturedErrors = [];
    const result = await interpolation.process(db, { error(message, detail) { capturedErrors.push({ message, detail }); } }, info.lastInsertRowid, root);
    assert.ok(result, JSON.stringify(capturedErrors));
    assert.equal(result.provider_request_id, 'result-request-1');
    assert.equal(fs.existsSync(path.join(root, result.local_path)), true);
    const job = db.prepare('SELECT * FROM video_interpolation_jobs WHERE video_generation_id=?').get(info.lastInsertRowid);
    assert.equal(job.status, 'completed');
    assert.equal(job.input_video_url, 'mediakit://uploaded-source');
    assert.equal(job.provider_task_id, 'mediakit-task-1');
    assert.equal(job.output_width, 64);
    assert.equal(job.output_height, 64);
    assert.equal(job.output_fps, 60);
    assert.equal(db.prepare('SELECT interpolation_status FROM video_generations WHERE id=?').get(info.lastInsertRowid).interpolation_status, 'completed');
    assert.equal(db.prepare('SELECT COUNT(*) total FROM billing_usage_logs WHERE authorization_id=?').get(job.billing_authorization_id).total, 1);

    const replay = await interpolation.process(db, { error() {} }, info.lastInsertRowid, root);
    assert.equal(replay.reused, true);
    assert.equal(submitCount, 1);
  } finally {
    interpolationClient.uploadLocalVideo = original.uploadLocalVideo;
    interpolationClient.submit = original.submit;
    interpolationClient.retrieve = original.retrieve;
    global.fetch = original.fetch;
    teardown(context.root);
  }
});
