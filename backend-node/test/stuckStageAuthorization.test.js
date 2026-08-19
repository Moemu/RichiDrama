const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const billing = require('../src/services/billingService');
const taskService = require('../src/services/taskService');

function setup() {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-stuck-stage-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { warn() {}, info() {} };
  const admin = auth.ensureBootstrapAdmin(db, log);
  return { db, dbPath, admin, log };
}

function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

function seedVideoPipeline(db, adminId, { userId, providerTaskId, vgStatus }) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO video_generations (id, task_id, provider_task_id, status, error_msg, updated_at, created_at, owner_user_id)
              VALUES (?, 'task-1', 'gen-provider-1', ?, 'fetch failed', ?, ?, ?)`)
    .run(101, vgStatus, now, now, userId);
  db.prepare(`INSERT INTO video_interpolation_jobs (video_generation_id, owner_user_id, status, billing_authorization_id, provider_task_id, created_at, updated_at)
              VALUES (101, ?, 'awaiting_source', ?, ?, ?, ?)`)
    .run(userId, null, providerTaskId || null, now, now);
  db.prepare(`INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
              VALUES ('task-1', 'video_generation', 'processing', 50, '', '101', ?, ?)`).run(now, now);
  return adminId;
}

test('recoverStuckStageAuthorizations voids an interpolation authorization never sent to the provider', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'stuck-void', password: 'creator123' }, admin.id);
    const actor = { id: user.id, role: 'user' };
    billing.savePriceBook(db, admin.id, { name: 'default', status: 'published', items: [{ service_type: 'video_postprocess', model: 'interp-model', meter: 'millisecond', unit_price: 64 }] });
    billing.adjustBalance(db, admin.id, user.id, 200, 'test points');
    const authorization = billing.createAuthorization(db, actor, { idempotency_key: 'interp-stuck-1', service_type: 'video_postprocess', model: 'interp-model', usage: { millisecond: 1 } });
    db.prepare('UPDATE video_interpolation_jobs SET billing_authorization_id=? WHERE video_generation_id=101')
      .run(authorization.authorization_id);
    void seedVideoPipeline(db, admin.id, { userId: user.id, providerTaskId: null, vgStatus: 'failed' });
    db.prepare('UPDATE video_interpolation_jobs SET billing_authorization_id=? WHERE video_generation_id=101')
      .run(authorization.authorization_id);

    assert.equal(billing.account(db, user.id).frozen_micro, authorization.amount_micro);

    const result = billing.recoverStuckStageAuthorizations(db);
    assert.equal(result.voided, 1);
    assert.equal(result.reconciled, 0);
    assert.equal(billing.account(db, user.id).frozen_micro, 0);
    const job = db.prepare('SELECT status FROM video_interpolation_jobs WHERE video_generation_id=101').get();
    assert.equal(job.status, 'cancelled');
    // 幂等：再跑一次不会重复处置
    const again = billing.recoverStuckStageAuthorizations(db);
    assert.equal(again.voided, 0);
  } finally { teardown(dbPath); }
});

test('recoverStuckStageAuthorizations routes a provider-called interpolation authorization to reconciliation', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'stuck-reconcile', password: 'creator123' }, admin.id);
    const actor = { id: user.id, role: 'user' };
    billing.savePriceBook(db, admin.id, { name: 'default', status: 'published', items: [{ service_type: 'video_postprocess', model: 'interp-model', meter: 'millisecond', unit_price: 64 }] });
    billing.adjustBalance(db, admin.id, user.id, 200, 'test points');
    const authorization = billing.createAuthorization(db, actor, { idempotency_key: 'interp-stuck-2', service_type: 'video_postprocess', model: 'interp-model', usage: { millisecond: 1 } });
    void seedVideoPipeline(db, admin.id, { userId: user.id, providerTaskId: 'cgt-called-1', vgStatus: 'failed' });
    db.prepare('UPDATE video_interpolation_jobs SET billing_authorization_id=? WHERE video_generation_id=101')
      .run(authorization.authorization_id);

    const result = billing.recoverStuckStageAuthorizations(db);
    assert.equal(result.reconciled, 1);
    assert.equal(result.voided, 0);
    // 授权保持冻结（待人工核验），但生成对账案件
    assert.equal(billing.account(db, user.id).frozen_micro, authorization.amount_micro);
    const caseRow = db.prepare('SELECT status FROM billing_reconciliation_cases WHERE authorization_id=?').get(authorization.authorization_id);
    assert.equal(caseRow.status, 'pending');
  } finally { teardown(dbPath); }
});

test('releaseTaskAuthorization voids the interpolation authorization together with the main one', () => {
  const { db, dbPath, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'chain-release', password: 'creator123' }, admin.id);
    const actor = { id: user.id, role: 'user' };
    billing.savePriceBook(db, admin.id, { name: 'default', status: 'published', items: [{ service_type: 'video_postprocess', model: 'video-model', meter: 'output_token', unit_price: 64 }] });
    billing.adjustBalance(db, admin.id, user.id, 500, 'test points');
    const mainAuth = billing.createAuthorization(db, actor, { idempotency_key: 'chain-main', service_type: 'video_postprocess', model: 'video-model', usage: { output_token: 1 } });
    const interpAuth = billing.createAuthorization(db, actor, { idempotency_key: 'chain-interp', service_type: 'video_postprocess', model: 'video-model', usage: { output_token: 1 } });
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO video_generations (id, task_id, provider_task_id, status, updated_at, created_at, owner_user_id, billing_authorization_id)
                VALUES (202, 'task-2', 'gen-provider-2', 'processing', ?, ?, ?, ?)`)
      .run(now, now, user.id, mainAuth.authorization_id);
    db.prepare(`INSERT INTO video_interpolation_jobs (video_generation_id, owner_user_id, status, billing_authorization_id, created_at, updated_at)
                VALUES (202, ?, 'awaiting_source', ?, ?, ?)`).run(user.id, interpAuth.authorization_id, now, now);
    db.prepare(`INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
                VALUES ('task-2', 'video_generation', 'processing', 60, '', '202', ?, ?)`).run(now, now);

    assert.equal(billing.account(db, user.id).frozen_micro, mainAuth.amount_micro + interpAuth.amount_micro);

    taskService.updateTaskError(db, 'task-2', '异步任务失败，释放预授权');
    assert.equal(billing.account(db, user.id).frozen_micro, 0, '主授权与插帧授权都应被释放');
  } finally { teardown(dbPath); }
});
