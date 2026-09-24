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
const jobs = require('../src/services/lasMediaJobService');
const las = require('../src/services/lasOperatorClient');
const tos = require('../src/services/lasTosBridge');

const log = { info() {}, warn() {}, error() {}, debug() {} };

async function waitFor(check, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return false;
}

test('LAS reconciliation cases locate the job and settle/waive/expire syncs the user-visible task status', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'richidrama-las-reconcile-'));
  const storage = path.join(root, 'storage');
  const dbPath = path.join(root, 'test.db');
  fs.mkdirSync(path.join(storage, 'input'), { recursive: true });
  const sourceFile = path.join(storage, 'input', 'source.mp4');
  const generated = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=24:d=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourceFile], { encoding: 'utf8' });
  if (generated.status !== 0) throw new Error(generated.stderr);
  const original = { upload: tos.upload, request: las.request };
  let submits = 0;
  tos.upload = async (_config, key) => `tos://example-bucket/${key}`;
  las.request = async (_config, action) => {
    if (action !== 'submit') throw new Error('对账测试不应轮询供应商');
    submits += 1;
    const error = new Error('LAS submit 请求失败：HTTP 500（request_id=mock-req-77）');
    error.providerRequestId = 'mock-req-77';
    throw error;
  };
  let db = new Database(dbPath);
  const oldLog = console.log; const oldWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  try { runMigrationsAndEnsure(db); } finally { console.log = oldLog; console.warn = oldWarn; }
  auth.ensureBootstrapAdmin(db, log);
  const admin = auth.createUser(db, { username: `las-admin-${Date.now()}`, password: 'admin-password', account_kind: 'platform_admin' }, 1);
  const user = auth.createUser(db, { username: 'las-reconcile-user', password: 'test-password' }, admin.id);
  billing.adjustBalance(db, admin.id, user.id, 100, 'test balance');
  billing.savePriceBook(db, admin.id, { name: 'LAS fixture prices', status: 'published', items: [
    { service_type: 'video_postprocess', model: 'las-video-inpaint-lite', meter: 'millisecond', unit_price: 1, conditions_json: { unit_size: 60000 } },
  ] });
  require('../src/services/aiConfigService').createConfig(db, log, {
    service_type: 'video_localization', provider: 'las', name: 'LAS 视频本地化',
    base_url: 'https://operator.las.cn-beijing.volces.com', api_key: 'test-only', is_default: true,
    settings: JSON.stringify({ region: 'cn-beijing', tos_bucket: 'example-bucket', tos_access_key_id: 'test-access', tos_secret_access_key: 'test-secret' }),
  });
  const project = drama.createDrama(db, log, { title: '对账测试项目', owner_user_id: user.id });
  const source = assets.create(db, log, { owner_user_id: user.id, drama_id: project.id, name: '原片', type: 'video', local_path: 'input/source.mp4', duration: 10, mime_type: 'video/mp4' });
  const cfg = { storage: { type: 'local', local_path: storage }, server: {}, payments: { enabled: false }, vendor_lock: { enabled: false } };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', setupRouter(cfg, db, log));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    tos.upload = original.upload; las.request = original.request;
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  async function call(method, route, body, token) {
    const res = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-lmd-session': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  }
  const userToken = (await call('POST', '/auth/login', { username: user.username, password: 'test-password' })).body.data.token;
  const adminToken = (await call('POST', '/auth/login', { username: admin.username, password: 'admin-password' })).body.data.token;
  async function submitUncertainJob(key) {
    const created = await call('POST', '/las-media-jobs', { drama_id: project.id, asset_id: source.id, stage: 'inpaint', model_level: 'lite', idempotency_key: key }, userToken);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.data.id;
    assert.ok(await waitFor(() => jobs.get(db, user.id, id).status === 'reconciliation'), '提交失败应转待对账');
    return id;
  }
  // 同模型待对账上限为 3，先建三笔、处置两笔后再建剩余两笔。
  const settledId = await submitUncertainJob('settle-job');
  const waivedId = await submitUncertainJob('waive-job');
  const pendingId = await submitUncertainJob('keep-pending-job');
  const authorizationId = (jobId) => db.prepare('SELECT authorization_id FROM las_media_jobs WHERE id=?').get(jobId).authorization_id;
  const caseOf = (jobId) => db.prepare('SELECT * FROM billing_reconciliation_cases WHERE authorization_id=?').get(authorizationId(jobId));
  assert.match(caseOf(settledId).reason, /提交结果不确定/);
  assert.match(caseOf(settledId).reason, /request_id=mock-req-77/, '案件原因里要能定位供应商请求 ID');
  assert.equal(caseOf(settledId).provider_request_id, 'mock-req-77', '供应商请求 ID 必须结构化落库');

  // 运营台案件定位：任务、供应商请求 ID、预授权、项目与中转/归档文件。
  const queue = await call('GET', '/admin/billing-reconciliations?status=pending&page_size=50', null, adminToken);
  assert.equal(queue.status, 200);
  const located = queue.body.data.items.find((item) => item.id === caseOf(settledId).id);
  assert.ok(located, '待对账队列应包含 LAS 案件');
  assert.equal(located.source_task.kind, 'las_media_job');
  assert.equal(located.source_task.id, settledId);
  assert.equal(located.source_task.stage, 'inpaint');
  assert.equal(located.source_task.model_level, 'lite');
  assert.equal(located.source_task.status, 'reconciliation');
  assert.equal(located.source_task.project_title, '对账测试项目');
  assert.equal(located.source_task.input_tos_path, `tos://example-bucket/richidrama/las/${settledId}/input/source.mp4`);
  assert.equal(located.source_task.output_local_path, null);
  assert.equal(located.authorization_id, authorizationId(settledId));
  assert.equal(located.reference_type, 'las_media_job');
  assert.equal(located.reference_id, settledId);
  assert.equal(located.provider_request_id, 'mock-req-77');
  assert.equal(located.frozen_amount > 0, true);

  db.prepare('UPDATE billing_reconciliation_cases SET provider_request_id=NULL WHERE id=?').run(caseOf(pendingId).id);
  const legacyQueue = await call('GET', '/admin/billing-reconciliations?status=pending&page_size=50', null, adminToken);
  assert.equal(legacyQueue.body.data.items.find((item) => item.id === caseOf(pendingId).id).provider_request_id, 'mock-req-77', '旧案件从原因文本只读恢复请求 ID');

  // 人工结算 → 用户可见任务状态同步，消耗计入计费流水。
  const settled = await call('POST', `/admin/billing-reconciliations/${caseOf(settledId).id}/settle`, { usage: { millisecond: 10000 }, reason: '按供应商账单补录用量' }, adminToken);
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.equal(settled.body.data.status, 'resolved');
  const settledJob = jobs.get(db, user.id, settledId);
  assert.equal(settledJob.status, 'failed');
  assert.match(settledJob.error_msg, /提交结果不确定/);
  assert.match(settledJob.error_msg, /已按供应商实测用量人工结算/);
  assert.equal(settledJob.billing.state, 'settled');
  assert.ok(settledJob.billing.charged_credits > 0, '结算后用户要能看到实际扣费');
  const usageLog = db.prepare('SELECT charged_micro FROM billing_usage_logs WHERE authorization_id=?').get(authorizationId(settledId));
  assert.ok(usageLog && usageLog.charged_micro > 0, '结算后消耗控制台必须能查到该笔 LAS 用量');

  // 重复处置：案件已 resolved 时再次结算不再改写任务。
  const again = await call('POST', `/admin/billing-reconciliations/${caseOf(settledId).id}/settle`, { usage: { millisecond: 10000 }, reason: '重复点击' }, adminToken);
  assert.equal(again.status, 200);
  assert.equal(again.body.data.status, 'resolved');
  assert.equal(jobs.get(db, user.id, settledId).error_msg, settledJob.error_msg);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM billing_transactions WHERE authorization_id=? AND type='settlement'").get(authorizationId(settledId)).count, 1, '不得重复扣费');

  // 豁免 → 释放冻结并同步任务状态。
  const frozenBefore = db.prepare('SELECT frozen_micro FROM billing_accounts WHERE user_id=?').get(user.id).frozen_micro;
  const waivedAuthAmount = db.prepare('SELECT amount_micro FROM billing_transactions WHERE id=?').get(authorizationId(waivedId)).amount_micro;
  const waived = await call('POST', `/admin/billing-reconciliations/${caseOf(waivedId).id}/waive`, { reason: '供应商未受理' }, adminToken);
  assert.equal(waived.body.data.status, 'waived');
  assert.equal(jobs.get(db, user.id, waivedId).status, 'failed');
  assert.match(jobs.get(db, user.id, waivedId).error_msg, /人工豁免/);
  assert.equal(jobs.get(db, user.id, waivedId).billing.state, 'released');
  assert.equal(db.prepare('SELECT frozen_micro FROM billing_accounts WHERE user_id=?').get(user.id).frozen_micro, frozenBefore - waivedAuthAmount);

  // 超时释放同样同步任务状态。
  const expiredId = await submitUncertainJob('expire-job');
  db.prepare("UPDATE billing_reconciliation_cases SET due_at=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), caseOf(expiredId).id);
  assert.equal(billing.expireReconciliationCases(db, admin.id).expired >= 1, true);
  assert.equal(jobs.get(db, user.id, expiredId).status, 'failed');
  assert.match(jobs.get(db, user.id, expiredId).error_msg, /超时自动释放/);

  // 刷新读取：列表端点返回处置后的终态（HTTP 绑定的是重启前打开的连接）。
  const list = await call('GET', `/las-media-jobs?drama_id=${project.id}`, null, userToken);
  assert.equal(list.status, 200);
  const byId = new Map(list.body.data.map((job) => [job.id, job]));
  for (const id of [settledId, waivedId, expiredId]) assert.equal(byId.get(id).status, 'failed');
  for (const id of [pendingId]) assert.equal(byId.get(id).status, 'reconciliation');

  // 崩溃补偿：案件已处置但任务未同步时，恢复扫描对齐状态；未处置案件保持不动。
  const crashId = await submitUncertainJob('crash-job');
  db.prepare("UPDATE billing_reconciliation_cases SET status='resolved' WHERE id=?").run(caseOf(crashId).id);
  db.close();
  db = new Database(dbPath);
  const recovery = jobs.resume(db, log, cfg);
  assert.equal(recovery.case_synced, 1);
  assert.equal(jobs.get(db, user.id, crashId).status, 'failed');
  assert.match(jobs.get(db, user.id, crashId).error_msg, /人工结算/);
  assert.equal(jobs.get(db, user.id, pendingId).status, 'reconciliation', '未处置案件的任务不能被改动');
  assert.equal(submits, 5, '恢复与对账流程绝不能自动重提供应商任务');
  recovery.stop();
  // 重启后历史任务读取：状态终态保持，不因恢复轮询回退。
  assert.equal(jobs.get(db, user.id, settledId).status, 'failed');
  assert.equal(jobs.get(db, user.id, crashId).status, 'failed');
  assert.equal(jobs.get(db, user.id, pendingId).status, 'reconciliation');
});
