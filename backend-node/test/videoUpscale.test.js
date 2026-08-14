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
const upscale = require('../src/services/videoUpscaleService');
const upscaleClient = require('../src/services/videoUpscaleClient');
const { getFfmpegPath } = require('../src/utils/ffmpegPath');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'local-mini-drama-upscale-'));
  const db = getDb({ path: path.join(root, 'test.db'), type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const admin = auth.ensureBootstrapAdmin(db, { warn() {}, info() {} });
  const user = auth.createUser(db, { username: `upscale-${Date.now()}`, password: '1' }, admin.id);
  billing.adjustBalance(db, admin.id, user.id, 10000, 'upscale test balance');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO ai_service_configs
    (service_type, provider, name, base_url, api_key, model, default_model, billing_key, is_default, is_active, settings, created_at, updated_at)
    VALUES ('video_postprocess', 'volcengine_mediakit', 'MediaKit', 'https://mediakit.cn-beijing.volces.com', 'test-key', ?, ?, ?, 1, 1, ?, ?, ?)`)
    .run(JSON.stringify(['volcengine-video-generative-enhancement']), 'volcengine-video-generative-enhancement', 'volcengine-video-generative-enhancement', JSON.stringify({ upscale_resolution: '720p', upscale_reserve_fps: 60 }), now, now);
  return { db, root, user };
}

function teardown(root) { closeDb(); fs.rmSync(root, { recursive: true, force: true }); }

test('generative enhancement reservation persists before provider submission', () => {
  const context = setup();
  try {
    const now = new Date().toISOString();
    const info = context.db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, duration, resolution, upscale_resolution, status, created_at, updated_at)
      VALUES (?, 'volces', 'seedance', 10, '480p', '720p', 'processing', ?, ?)`)
      .run(context.user.id, now, now);
    const job = upscale.reserveForGeneration(context.db, info.lastInsertRowid, '720p');
    assert.equal(job.status, 'awaiting_source');
    assert.equal(job.target_resolution, '720p');
    const authorization = context.db.prepare("SELECT * FROM billing_transactions WHERE id=? AND type='authorization'").get(job.billing_authorization_id);
    // 720p / <=60fps enhancement is 500 points/minute; reserve 11 seconds.
    assert.equal(authorization.amount_micro, 916667);
  } finally { teardown(context.root); }
});

test('upscale retry releases the failed authorization before reserving the retry stage', () => {
  const context = setup();
  try {
    const now = new Date().toISOString();
    const source = 'projects/retry/videos/source.mp4';
    const info = context.db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, duration, resolution, upscale_resolution, source_local_path, status, created_at, updated_at)
      VALUES (?, 'volces', 'seedance', 10, '480p', '720p', ?, 'failed', ?, ?)`)
      .run(context.user.id, source, now, now);
    const first = upscale.reserveForGeneration(context.db, info.lastInsertRowid, '720p');
    context.db.prepare("UPDATE video_upscale_jobs SET status='cancelled' WHERE id=?").run(first.id);
    context.db.prepare("UPDATE video_generations SET upscale_status='failed' WHERE id=?").run(info.lastInsertRowid);
    const retried = upscale.retryFromSource(context.db, info.lastInsertRowid);
    assert.notEqual(retried.billing_authorization_id, first.billing_authorization_id);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS total FROM billing_transactions WHERE authorization_id=? AND type='void'").get(first.billing_authorization_id).total, 1);
    // The first frozen reservation is released before the retry reservation is
    // made, so only one post-process amount remains frozen.
    assert.equal(billing.account(context.db, context.user.id).frozen_micro, 916667);
  } finally { teardown(context.root); }
});

test('enhancement submit preserves fps by omitting it and uses client_token', async () => {
  const context = setup();
  const originalFetch = global.fetch;
  try {
    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ task_id: 'upscale-task', request_id: 'upscale-request' }) };
    };
    await upscaleClient.submit(context.db, { video_url: 'mediakit://source', resolution: '720p', client_token: 'vg-up-1' });
    assert.equal(requestBody.client_token, 'vg-up-1');
    assert.equal(requestBody.resolution, '720p');
    assert.equal(Object.hasOwn(requestBody, 'fps'), false);
  } finally { global.fetch = originalFetch; teardown(context.root); }
});

test('enhancement persists local output, exact billing and idempotent replay', async () => {
  const context = setup();
  const original = { upload: upscaleClient.uploadLocalVideo, submit: upscaleClient.submit, retrieve: upscaleClient.retrieve, fetch: global.fetch };
  let submitCount = 0;
  try {
    const sourceRelative = 'projects/closure/videos/source.mp4';
    const sourceAbsolute = path.join(context.root, sourceRelative);
    fs.mkdirSync(path.dirname(sourceAbsolute), { recursive: true });
    let generated = spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=360x640:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourceAbsolute], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const outputAbsolute = path.join(context.root, 'upscaled-fixture.mp4');
    generated = spawnSync(getFfmpegPath(), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=720x1280:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputAbsolute], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const now = new Date().toISOString();
    const info = context.db.prepare(`INSERT INTO video_generations
      (owner_user_id, provider, model, duration, resolution, upscale_resolution, source_local_path, status, created_at, updated_at)
      VALUES (?, 'volces', 'seedance', 1, '480p', '720p', ?, 'upscale_pending', ?, ?)`)
      .run(context.user.id, sourceRelative, now, now);
    upscale.reserveForGeneration(context.db, info.lastInsertRowid, '720p');
    upscaleClient.uploadLocalVideo = async () => ({ file_id: 'mediakit://source', request_id: 'upload-request' });
    upscaleClient.submit = async () => { submitCount += 1; return { task_id: 'enhance-task', request_id: 'submit-request' }; };
    upscaleClient.retrieve = async () => ({ status: 'completed', request_id: 'result-request', result: { video_url: 'https://temporary.example/upscaled.mp4' } });
    global.fetch = async () => ({ ok: true, arrayBuffer: async () => fs.readFileSync(outputAbsolute) });
    const errors = [];
    const result = await upscale.process(context.db, { error(message, detail) { errors.push({ message, detail }); } }, info.lastInsertRowid, context.root);
    assert.ok(result, JSON.stringify(errors));
    assert.equal(result.width, 720);
    assert.equal(result.height, 1280);
    assert.equal(result.fps, 24);
    assert.equal(fs.existsSync(path.join(context.root, result.local_path)), true);
    const job = context.db.prepare('SELECT * FROM video_upscale_jobs WHERE video_generation_id=?').get(info.lastInsertRowid);
    assert.equal(job.status, 'completed');
    assert.equal(context.db.prepare('SELECT COUNT(*) total FROM billing_usage_logs WHERE authorization_id=?').get(job.billing_authorization_id).total, 1);
    const replay = await upscale.process(context.db, { error() {} }, info.lastInsertRowid, context.root);
    assert.equal(replay.reused, true);
    assert.equal(submitCount, 1);
  } finally {
    upscaleClient.uploadLocalVideo = original.upload;
    upscaleClient.submit = original.submit;
    upscaleClient.retrieve = original.retrieve;
    global.fetch = original.fetch;
    teardown(context.root);
  }
});
