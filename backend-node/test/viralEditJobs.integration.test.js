const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const express = require('express');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const { setupRouter } = require('../src/routes');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const drama = require('../src/services/dramaService');
const assets = require('../src/services/assetService');
const jobs = require('../src/services/viralEditJobService');
const las = require('../src/services/lasOperatorClient');
const tos = require('../src/services/lasTosBridge');

const log = { info() {}, warn() {}, error() {}, debug() {}, infow() {}, warnw() {}, errorw() {} };

function makeVideo(file, duration = 10) {
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=blue:s=640x360:r=24:d=${duration}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${duration}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr);
}

function viralResult(jobId) {
  const prefix = `tos://example-bucket/richidrama/las/${jobId}/viral/`;
  return {
    total_clips: 2,
    storyboard_json_path: `${prefix}storyboard.json`,
    videos: [{ episode: 1, duration: 10 }, { episode: 2, duration: 11 }],
    storyboard: [
      { id: 'ep1_seg1', episode: 1, rating: 'S', highlight_score: 95, function_tags: ['钩子-强冲突'], content_desc: '开场冲突', start_sec: 1, end_sec: 5 },
      { id: 'ep2_seg3', episode: 2, rating: 'B', highlight_score: 60, function_tags: ['爽点-直球出击'], content_desc: '反转', start_sec: 2, end_sec: 6 },
    ],
    clips: [
      { id: 'clip_001', url: `${prefix}clip_001.mp4`, preview_url: 'https://signed.example/clip_001.mp4?token=x', duration: 10.0, segment_count: 2, timeline: [{ ref: 'ep1_seg1', clip_start_sec: 0, clip_end_sec: 4 }, { ref: 'ep2_seg3', clip_start_sec: 4, clip_end_sec: 8, is_intro_dup: true }] },
      { id: 'clip_002', url: `${prefix}clip_002.mp4`, duration: 10.0, segment_count: 1, timeline: [{ ref: 'ep2_seg3', clip_start_sec: 0, clip_end_sec: 4 }] },
    ],
  };
}

test('viral clip MVP: quote, submit, multi-clip finalize, settle by measured usage, cleanup, save-as-asset, reconciliation, restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-viral-int-'));
  const storage = path.join(root, 'storage');
  const dbPath = path.join(root, 'test.db');
  fs.mkdirSync(path.join(storage, 'input'), { recursive: true });
  makeVideo(path.join(storage, 'input', 'ep1.mp4'), 10);
  makeVideo(path.join(storage, 'input', 'ep2.mp4'), 11);
  const original = { upload: tos.upload, download: tos.download, request: las.request, remove: tos.remove };
  let submits = 0;
  let polls = 0;
  let submitHook = null;
  let lastSubmittedJobId = null;
  const uploaded = [];
  const removed = [];
  tos.upload = async (_config, key) => { uploaded.push(key); return `tos://example-bucket/${key}`; };
  tos.remove = async (_config, objectPath) => { removed.push(objectPath); return { deleted: true }; };
  tos.download = async (_config, objectPath, target) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (objectPath.endsWith('.json')) fs.writeFileSync(target, JSON.stringify({ segments: [] }));
    else fs.copyFileSync(path.join(storage, 'input', 'ep1.mp4'), target);
    return { bytes: fs.statSync(target).size };
  };
  las.request = async (_config, action, payload) => {
    if (action === 'submit') {
      submits += 1;
      if (submitHook) return submitHook();
      lastSubmittedJobId = /richidrama\/las\/([\w-]+)\/input/.exec(payload.data.video_urls[0])?.[1] || null;
      return { task_id: `viral-task-${submits}`, status: 'PENDING' };
    }
    polls += 1;
    return { task_id: payload.task_id, status: 'COMPLETED', business_code: '0', data: viralResult(lastSubmittedJobId) };
  };
  let db = new Database(dbPath);
  const oldLog = console.log;
  const oldWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try { runMigrationsAndEnsure(db); } finally { console.log = oldLog; console.warn = oldWarn; }
  const admin = auth.ensureBootstrapAdmin(db, log);
  const user = auth.createUser(db, { username: `viral-user-${Date.now()}`, password: 'test-password' }, admin.id);
  billing.adjustBalance(db, admin.id, user.id, 1000, 'test balance');
  billing.savePriceBook(db, admin.id, { name: 'Viral fixture prices', status: 'published', items: [
    { service_type: 'video_postprocess', model: 'las-viral-clip-gen', meter: 'millisecond', unit_price: 150, conditions_json: { unit_size: 60000, provider: 'las' } },
    { service_type: 'video_postprocess', model: 'las-viral-clip-gen', meter: 'second', unit_price: 6, conditions_json: { unit_size: 60, provider: 'las' } },
  ] });
  require('../src/services/aiConfigService').createConfig(db, log, {
    service_type: 'video_localization', provider: 'las', name: 'LAS 投流剪辑共用配置',
    base_url: 'https://operator.las.cn-beijing.volces.com', api_key: 'test-only', is_default: true,
    settings: JSON.stringify({ region: 'cn-beijing', tos_bucket: 'example-bucket', tos_access_key_id: 'test-access', tos_secret_access_key: 'test-secret' }),
  });
  const project = drama.createDrama(db, log, { title: '投流测试项目', owner_user_id: user.id });
  const episodeAssetIds = [];
  for (const [index, name] of ['第1集', '第2集'].entries()) {
    const created = assets.create(db, log, { owner_user_id: user.id, drama_id: project.id, name, type: 'video', local_path: `input/ep${index + 1}.mp4`, duration: 10 + index, mime_type: 'video/mp4' });
    episodeAssetIds.push(created.id);
  }
  const cfg = { storage: { type: 'local', local_path: storage }, server: {}, payments: { enabled: false }, vendor_lock: { enabled: false } };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', setupRouter(cfg, db, log));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
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
  const token = login.body.data.token;
  assert.equal((await call('POST', '/viral-edit-jobs', { drama_id: project.id, asset_ids: episodeAssetIds, mode: 'jump_cut', min_clip_duration: 5, max_clip_duration: 10, max_clip_count: 2, idempotency_key: 'no-auth' })).status, 401);
  const quoteBody = { drama_id: project.id, asset_ids: episodeAssetIds, mode: 'jump_cut', min_clip_duration: 5, max_clip_duration: 10, max_clip_count: 2 };

  // 报价：输入 ~21 秒 × 1.5 积分/分 + 预留 2×10 秒 × 0.06 积分/分 ≈ 52.5+2 积分（实测毫秒级取整有 ±0.1 浮动）。
  const quoted = await call('POST', '/viral-edit-jobs/quote', quoteBody, token);
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  assert.ok(quoted.body.data.quote.amount >= 53 && quoted.body.data.quote.amount <= 56, `amount=${quoted.body.data.quote.amount}`);
  assert.equal(quoted.body.data.totals.video_bitrate_kbps, 650, '360 短边映射官方 360p 分档中值');
  assert.equal((await call('POST', '/viral-edit-jobs/quote', { ...quoteBody, max_clip_count: 11 }, token)).status, 400);

  const created = await call('POST', '/viral-edit-jobs', { ...quoteBody, idempotency_key: 'happy-check' }, token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const jobId = created.body.data.id;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (['completed', 'failed', 'reconciliation'].includes(jobs.get(db, user.id, jobId).status)) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const completed = jobs.get(db, user.id, jobId);
  assert.equal(completed.status, 'completed', completed.error_msg);
  assert.equal(completed.billing.state, 'settled');
  assert.ok(completed.billing.charged_credits >= 53 && completed.billing.charged_credits <= 56, `charged=${completed.billing.charged_credits}`);
  assert.equal(completed.episodes.length, 2);
  assert.equal(completed.episodes[0].asset_name, '第1集');
  assert.equal(completed.outputs.length, 2);
  assert.equal(completed.outputs[0].url, `/static/viral/${jobId}/clips/clip_001.mp4`);
  assert.ok(fs.existsSync(path.join(storage, `viral/${jobId}/clips/clip_001.mp4`)));
  assert.ok(fs.existsSync(path.join(storage, `viral/${jobId}/storyboard.json`)));
  assert.equal(completed.storyboard_url, `/static/viral/${jobId}/storyboard.json`);
  assert.equal(completed.outputs[0].rating_summary.rating_counts.S, 1);
  assert.deepEqual(completed.outputs[0].rating_summary.top_tags, ['钩子-强冲突', '爽点-直球出击']);
  assert.equal(completed.outputs[1].timeline.length, 1);
  assert.equal(completed.outputs[0].timeline[0].rating, 'S', '分镜评级随时间线落库供人工判断');
  assert.equal(completed.outputs[0].timeline[1].is_intro_dup, true);
  // preview_url 的 3 天签名链接不允许进入任何结果字段
  assert.ok(!JSON.stringify(completed).includes('signed.example'));
  assert.equal(submits, 1);
  assert.equal(polls >= 1, true);

  // 幂等：同键同参返回同任务不重提；同键不同参拒绝。
  const repeated = await call('POST', '/viral-edit-jobs', { ...quoteBody, idempotency_key: 'happy-check' }, token);
  assert.equal(repeated.body.data.id, jobId);
  assert.equal(submits, 1);
  const conflict = await call('POST', '/viral-edit-jobs', { ...quoteBody, max_clip_count: 1, idempotency_key: 'happy-check' }, token);
  assert.equal(conflict.status, 400);
  assert.match(conflict.body.error.message, /幂等键/);

  // 保存为素材：完成时不自动入库，勾选后才写 assets，且幂等。
  const saved = await call('POST', `/viral-edit-jobs/${jobId}/outputs/1/save-asset`, {}, token);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const assetId = saved.body.data.output.asset_id;
  const asset = assets.getByIdForOwner(db, assetId, user.id);
  assert.equal(asset.source_type, 'las');
  assert.equal(asset.drama_id, project.id);
  assert.equal(saved.body.data.output.status, 'saved');
  const savedAgain = await call('POST', `/viral-edit-jobs/${jobId}/outputs/1/save-asset`, {}, token);
  assert.equal(savedAgain.body.data.output.asset_id, assetId);

  // 中转治理：输入 2 + 成片 2 + storyboard 1 精确登记并删除。
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (db.prepare('SELECT tos_cleanup_at FROM viral_edit_jobs WHERE id=?').get(jobId).tos_cleanup_at) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const governance = db.prepare('SELECT tos_cleanup_at, tos_objects_json, submitted_at, completed_at FROM viral_edit_jobs WHERE id=?').get(jobId);
  assert.ok(governance.tos_cleanup_at, '完成任务应清完中转对象');
  assert.ok(governance.submitted_at && governance.completed_at);
  const objects = JSON.parse(governance.tos_objects_json);
  assert.equal(objects.inputs.length, 2);
  assert.equal(objects.outputs.length, 2);
  assert.ok(objects.storyboard.path.endsWith('/viral/storyboard.json'));
  assert.equal(removed.filter((item) => item.includes(`/richidrama/las/${jobId}/`)).length, 5);
  assert.deepEqual(uploaded.sort(), [
    `richidrama/las/${jobId}/input/ep1.mp4`, `richidrama/las/${jobId}/input/ep2.mp4`,
  ].sort());

  // 提交不确定 → 待对账（不自动重提）；管理端豁免后任务同步落 failed。
  submitHook = () => Promise.reject(Object.assign(new Error('LAS submit 请求失败：HTTP 502'), { providerRequestId: 'req-viral-1' }));
  const uncertainCreate = await call('POST', '/viral-edit-jobs', { ...quoteBody, idempotency_key: 'uncertain-check' }, token);
  const uncertainId = uncertainCreate.body.data.id;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (jobs.get(db, user.id, uncertainId).status === 'reconciliation') break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  submitHook = null;
  const uncertain = jobs.get(db, user.id, uncertainId);
  assert.equal(uncertain.status, 'reconciliation', JSON.stringify(uncertain));
  assert.equal(uncertain.billing.state, 'reconciling');
  const cases = billing.pagedReconciliationCases(db, { status: 'pending' }).items.filter((item) => item.source_task?.kind === 'viral_edit_job');
  assert.equal(cases.length, 1);
  assert.equal(cases[0].source_task.episode_count, 2);
  assert.equal(cases[0].source_task.supplier_billing_unit, '视频智能剪辑');
  assert.equal(cases[0].provider_request_id, 'req-viral-1');
  const beforeWaive = submits;
  billing.waiveReconciliationCase(db, { id: admin.id, role: 'admin' }, cases[0].id, '测试豁免');
  assert.equal(jobs.get(db, user.id, uncertainId).status, 'failed');
  assert.match(jobs.get(db, user.id, uncertainId).error_msg, /不自动重提/);
  assert.equal(submits, beforeWaive, '对账处置不能重提供应商');

  // 重启恢复：已完成任务与成片仍可读取，处置过的任务不会被再次提交。
  db.close();
  db = new Database(dbPath);
  const recovery = jobs.resume(db, log, cfg);
  assert.equal(jobs.get(db, user.id, jobId).status, 'completed');
  assert.equal(assets.getByIdForOwner(db, assetId, user.id).local_path, `viral/${jobId}/clips/clip_001.mp4`);
  recovery.stop();
  assert.equal(submits, beforeWaive);
});

test('viral result parsing tolerates both storyboard locations and rejects foreign paths', () => {
  const prefix = 'tos://example-bucket/richidrama/las/j1/viral/';
  const base = { clips: [{ id: 'clip_001', url: `${prefix}clip_001.mp4`, duration: 8, timeline: [] }] };
  assert.equal(jobs.parseViralResult({ ...base, script: { storyboard_json_path: `${prefix}storyboard.json` } }, prefix).storyboard_path, `${prefix}storyboard.json`);
  assert.equal(jobs.parseViralResult({ ...base, storyboard_json_path: `${prefix}storyboard.json` }, prefix).storyboard_path, `${prefix}storyboard.json`);
  assert.equal(jobs.parseViralResult(base, prefix).storyboard_path, null);
  assert.throws(() => jobs.parseViralResult({ clips: [{ url: 'https://foreign/x.mp4' }] }, prefix), /不在本任务的 TOS 前缀内/);
  assert.throws(() => jobs.parseViralResult({ clips: [{ url: `${prefix}a.mp4?sig=1` }] }, prefix), /不在本任务的 TOS 前缀内/);
});

test('viral input validation enforces operator limits and MVP caps', async () => {
  const episode = (overrides = {}) => ({ seq: 1, asset_id: 1, durationMs: 60_000, width: 640, height: 360, bytes: 1024, ...overrides });
  assert.doesNotThrow(() => jobs.validateInputs([episode(), episode({ seq: 2, asset_id: 2 })]));
  assert.throws(() => jobs.validateInputs([]), /1–10/);
  assert.throws(() => jobs.validateInputs(Array.from({ length: 11 }, (_, i) => episode({ seq: i + 1, asset_id: i + 1 }))), /1–10/);
  assert.throws(() => jobs.validateInputs([episode(), episode({ asset_id: 1 })]), /重复/);
  assert.throws(() => jobs.validateInputs([episode({ durationMs: 500 })]), /第 1 集时长/);
  assert.throws(() => jobs.validateInputs([episode({ durationMs: 601_000 })]), /第 1 集时长/);
  assert.throws(() => jobs.validateInputs([episode({ width: 320, height: 640 })]), /分辨率/);
  assert.throws(() => jobs.validateInputs([episode(), episode({ asset_id: 2, width: 1280, height: 720 })]), /完全一致/);
  assert.throws(() => jobs.validateInputs([episode({ durationMs: 600_000 }), episode({ asset_id: 2, durationMs: 600_000 }), episode({ asset_id: 3, durationMs: 600_000 }), episode({ asset_id: 4, durationMs: 600_000 })]), /总时长/);
  const params = jobs.validateParams({ mode: 'sequential', min_clip_duration: 5, max_clip_duration: 300, max_clip_count: 10 });
  assert.equal(params.preset_intro, false);
  assert.throws(() => jobs.validateParams({ mode: 'preset_intro', min_clip_duration: 5, max_clip_duration: 10, max_clip_count: 1 }), /模式/);
  assert.throws(() => jobs.validateParams({ mode: 'jump_cut', min_clip_duration: 10, max_clip_duration: 5, max_clip_count: 1 }), /上限不能小于下限/);
  assert.throws(() => jobs.validateParams({ mode: 'jump_cut', min_clip_duration: 5, max_clip_duration: 300, max_clip_count: 11 }), /目标素材条数/);
  assert.throws(() => jobs.validateParams({ mode: 'jump_cut', min_clip_duration: 5, max_clip_duration: 300, max_clip_count: 1, aspect_ratio: '16:9' }), /9:16/);
});
