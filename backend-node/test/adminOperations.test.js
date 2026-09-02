const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const operations = require('../src/services/adminOperationsService');
const billing = require('../src/services/billingService');
const reports = require('../src/services/operationsReportService');
const adminRoutes = require('../src/routes/admin');

function responseRecorder() {
  return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
}

test('admin high-impact production actions reject requests without confirmation metadata before querying a job', async () => {
  const routes = adminRoutes({ prepare() { throw new Error('database must not be read before confirmation'); } });
  const res = responseRecorder();
  await routes.retryArchive({ body: {}, params: { id: '1' }, auth: { id: 1, role: 'admin' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error.message, /确认/);
});

test('operations projections paginate video production and keep optional stages distinct from failures', () => {
  const dbPath = path.join(os.tmpdir(), `lmd-operations-${Date.now()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    const now = '2026-08-17T01:00:00.000Z';
    db.prepare("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at) VALUES ('op-admin','x','admin',1,?,?)").run(now, now);
    const userId = db.prepare("SELECT id FROM users WHERE username='op-admin'").get().id;
    db.prepare("INSERT INTO video_generations (owner_user_id,model,status,provider_task_id,local_path,archive_status,error_msg,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(userId, 'seedance', 'completed', 'provider-1', 'videos/one.mp4', 'pending', null, now, now);
    const videoId = db.prepare('SELECT id FROM video_generations').get().id;
    db.prepare("INSERT INTO media_archive_records (local_path,source_type,source_id,archive_status,archive_attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run('videos/one.mp4', 'video_generation', videoId, 'pending', 2, now, now);
    const list = operations.listProduction(db, { page: 1, page_size: 20, status: 'completed' });
    assert.equal(list.total, 1);
    assert.equal(list.items[0].stages.find((stage) => stage.key === 'upscale').status, 'not_selected');
    assert.equal(list.items[0].error_summary, null);
    const detail = operations.productionDetail(db, videoId);
    assert.equal(detail.provider_task_id, 'provider-1');
    assert.equal(detail.archive_record_status, 'pending');
    assert.equal(operations.listArchives(db, { status: 'pending' }).total, 1);
    const overview = operations.overview(db, {});
    assert.equal(overview.production.completed, 1);
    assert.equal(overview.storage.find((item) => item.status === 'pending').count, 1);
    const settings = operations.saveAlertSettings(db, { archive_failed_count: 2 });
    assert.equal(settings.archive_failed_count, 2);
    db.prepare("UPDATE media_archive_records SET archive_status='failed', archive_error=? WHERE id=1").run('archive, retry required');
    assert.equal(operations.overview(db, {}).alerts.some((alert) => alert.key === 'archive_failed'), false);
    operations.saveAlertSettings(db, { archive_failed_count: 1 });
    assert.equal(operations.overview(db, {}).alerts.some((alert) => alert.key === 'archive_failed'), true);
    const csv = operations.productionCsv(db, { status: 'completed' });
    assert.match(csv, /^\uFEFFtask_id,username,project_title/);
    assert.match(csv, /videos\/one\.mp4/);
    const report = reports.recordDailyReport(db, new Date('2026-08-17T00:00:00.000Z'));
    assert.equal(report.report_date, '2026-08-17');
    assert.equal(reports.listReports(db, {}).total, 1);
    reports.recordDailyReport(db, new Date('2026-08-17T03:00:00.000Z'));
    assert.equal(reports.listReports(db, {}).total, 1);

    db.prepare(`INSERT INTO billing_transactions
      (id,user_id,type,amount_micro,balance_after_micro,frozen_after_micro,created_at)
      VALUES (?,?,?,?,?,?,?)`).run('authorization-1', userId, 'authorization', 500000, 0, 500000, now);
    db.prepare(`INSERT INTO billing_reconciliation_cases
      (id,authorization_id,user_id,service_type,model,status,due_at,created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run('reconciliation-1', 'authorization-1', userId, 'video', 'seedance', 'pending', now, now);
    const reconciliations = billing.pagedReconciliationCases(db, { page: 1, page_size: 10, status: 'pending', model: 'seedance' });
    assert.equal(reconciliations.total, 1);
    assert.equal(reconciliations.items[0].frozen_amount, 50);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
});

test('failed production detail returns the immutable prompt and material reproduction snapshot', () => {
  const dbPath = path.join(os.tmpdir(), `lmd-production-reproduction-${Date.now()}.db`);
  let db = getDb({ path: dbPath, type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    const now = '2026-09-02T02:00:00.000Z';
    db.prepare("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at) VALUES ('replay-admin','x','admin',1,?,?)").run(now, now);
    const ownerId = db.prepare("SELECT id FROM users WHERE username='replay-admin'").get().id;
    const dramaId = Number(db.prepare("INSERT INTO dramas (title,owner_user_id,created_at,updated_at) VALUES ('复现项目',?,?,?)").run(ownerId, now, now).lastInsertRowid);
    const episodeId = Number(db.prepare("INSERT INTO episodes (drama_id,episode_number,title,created_at,updated_at) VALUES (?,1,'第一集',?,?)").run(dramaId, now, now).lastInsertRowid);
    const storyboardId = Number(db.prepare("INSERT INTO storyboards (episode_id,storyboard_number,title,status,created_at,updated_at) VALUES (?,1,'失败镜头','failed',?,?)").run(episodeId, now, now).lastInsertRowid);
    const assetId = Number(db.prepare("INSERT INTO assets (drama_id,owner_user_id,name,type,local_path,created_at,updated_at) VALUES (?,?,'角色参考','image','projects/replay/role.png',?,?)").run(dramaId, ownerId, now, now).lastInsertRowid);
    const videoId = Number(db.prepare(`INSERT INTO video_generations
      (drama_id,storyboard_id,owner_user_id,provider,prompt,model,duration,aspect_ratio,resolution,status,error_msg,created_at,updated_at)
      VALUES (?,?,?,'chatfire','实际提交提示词','seedance-replay',8,'16:9','720p','failed','供应商拒绝',?,?)`).run(dramaId, storyboardId, ownerId, now, now).lastInsertRowid);
    const requestSnapshot = {
      original_prompt: '用户完整提示词 @角色参考', prompt: '实际提交提示词',
      prompt_document: { text: '用户完整提示词 @角色参考', refs: [{ asset_id: assetId, alias: '角色参考' }] },
      model: 'seedance-replay', creation_mode: 'multi_reference', duration: 8,
      aspect_ratio: '16:9', resolution: '720p', audio_strategy: 'reference_only',
      post_process: { keep_original_audio: false, audio_volume: 1, audio_fade_seconds: 0 },
    };
    const jobId = Number(db.prepare(`INSERT INTO omni_video_jobs
      (video_generation_id,owner_user_id,prompt,model_requested,model_resolved,request_snapshot_json,storyboard_id,created_at,updated_at)
      VALUES (?,?,?,'seedance-replay','seedance-replay',?,?,?,?)`).run(videoId, ownerId, '实际提交提示词', JSON.stringify(requestSnapshot), storyboardId, now, now).lastInsertRowid);
    db.prepare(`INSERT INTO omni_video_job_assets
      (omni_job_id,asset_id,ordinal,alias,media_type,role,usage,send_to_model,snapshot_json,created_at)
      VALUES (?,?,1,'角色参考','image','reference','reference',1,?,?)`).run(jobId, assetId, JSON.stringify({ asset_id: assetId, alias: '角色参考', type: 'image', local_path: 'projects/replay/role.png', send_to_model: true }), now);
    db.prepare('UPDATE assets SET local_path=? WHERE id=?').run('projects/replay/current-role.png', assetId);
    db.prepare(`INSERT INTO omni_video_job_assets
      (omni_job_id,asset_id,ordinal,alias,media_type,role,usage,send_to_model,snapshot_json,created_at)
      VALUES (?,NULL,2,'远程临时参考','image','reference','reference',1,?,?)`).run(jobId, JSON.stringify({ alias: '远程临时参考', type: 'image', url: 'https://supplier.example/signed.png' }), now);

    const detail = operations.productionDetail(db, videoId);
    assert.equal(detail.reproduction.prompt, '用户完整提示词 @角色参考');
    assert.equal(detail.reproduction.provider_prompt, '实际提交提示词');
    assert.equal(detail.reproduction.settings.model, 'seedance-replay');
    assert.equal(detail.reproduction.materials[0].asset_id, assetId);
    assert.equal(detail.reproduction.materials[0].local_path, 'projects/replay/role.png');
    assert.equal(detail.reproduction.materials[0].send_to_model, true);
    assert.equal(detail.reproduction.materials[1].local_path, null);
    assert.equal(detail.reproduction.materials[1].available, false);
    assert.equal(detail.reproduction.unavailable_material_count, 1);
    assert.equal(detail.reproduction.can_open_workbench, true);
    assert.equal(detail.reproduction.episode_id, episodeId);

    closeDb();
    db = getDb({ path: dbPath, type: 'sqlite' });
    const restored = operations.productionDetail(db, videoId);
    assert.equal(restored.reproduction.prompt, '用户完整提示词 @角色参考');
    assert.equal(restored.reproduction.materials[0].local_path, 'projects/replay/role.png');
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
});

test('billing ledgers filter by Shanghai calendar day and user role without changing user scope', () => {
  const dbPath = path.join(os.tmpdir(), `lmd-billing-ledger-filters-${Date.now()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    const created = '2026-08-17T00:00:00.000Z';
    db.prepare("INSERT INTO users (username,password_hash,role,is_active,created_at,updated_at) VALUES ('ledger-admin','x','admin',1,?,?)").run(created, created);
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,is_active,created_at,updated_at) VALUES ('ledger-user','x','账本用户','user',1,?,?)").run(created, created);
    const adminId = db.prepare("SELECT id FROM users WHERE username='ledger-admin'").get().id;
    const userId = db.prepare("SELECT id FROM users WHERE username='ledger-user'").get().id;
    const insertTransaction = db.prepare('INSERT INTO billing_transactions (id,user_id,type,amount_micro,balance_after_micro,frozen_after_micro,created_at) VALUES (?,?,?,?,?,?,?)');
    insertTransaction.run('ledger-admin-17', adminId, 'adjustment', 100000, 100000, 0, '2026-08-17T00:00:00.000Z');
    insertTransaction.run('ledger-user-17', userId, 'adjustment', 100000, 100000, 0, '2026-08-17T15:59:59.999Z');
    insertTransaction.run('ledger-user-18', userId, 'adjustment', 100000, 200000, 0, '2026-08-17T16:00:00.000Z');
    const insertUsage = db.prepare('INSERT INTO billing_usage_logs (id,user_id,transaction_id,authorization_id,service_type,model,usage_json,charged_micro,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    insertUsage.run('usage-admin-17', adminId, 'ledger-admin-17', 'auth-admin-17', 'video', 'seedance', '{}', 100000, '{}', '2026-08-17T00:00:00.000Z');
    insertUsage.run('usage-user-17', userId, 'ledger-user-17', 'auth-user-17', 'video', 'seedance', '{}', 100000, '{}', '2026-08-17T15:59:59.999Z');
    insertUsage.run('usage-user-18', userId, 'ledger-user-18', 'auth-user-18', 'video', 'seedance', '{}', 100000, '{}', '2026-08-17T16:00:00.000Z');

    const userTransactions = billing.pagedTransactions(db, { page: 1, page_size: 20, role: 'user', date_from: '2026-08-17', date_to: '2026-08-17' });
    assert.equal(userTransactions.total, 1);
    assert.equal(userTransactions.items[0].username, 'ledger-user');
    const adminUsage = billing.pagedUsage(db, { page: 1, page_size: 20, role: 'admin', date_from: '2026-08-17', date_to: '2026-08-17' });
    assert.equal(adminUsage.total, 1);
    assert.equal(adminUsage.items[0].username, 'ledger-admin');
    const userUsage = billing.pagedUsage(db, { page: 1, page_size: 20, role: 'user', date_from: '2026-08-17', date_to: '2026-08-17' });
    assert.equal(userUsage.items[0].display_name, '账本用户');
    assert.equal(billing.listTransactions(db, { user_id: userId, role: 'admin', date_from: '2026-08-17', date_to: '2026-08-17' }).length, 0);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
});

test('historical unassigned usage provides a filter-scoped owner and source overview', () => {
  const dbPath = path.join(os.tmpdir(), `lmd-historical-usage-${Date.now()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  try {
    runMigrationsAndEnsure(db);
    const created = '2026-08-17T00:00:00.000Z';
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,is_active,created_at,updated_at) VALUES ('history-a','x','历史甲','user',1,?,?)").run(created, created);
    db.prepare("INSERT INTO users (username,password_hash,display_name,role,is_active,created_at,updated_at) VALUES ('history-b','x','历史乙','user',1,?,?)").run(created, created);
    const userA = db.prepare("SELECT id FROM users WHERE username='history-a'").get().id;
    const userB = db.prepare("SELECT id FROM users WHERE username='history-b'").get().id;
    const insertUsage = db.prepare('INSERT INTO billing_usage_logs (id,user_id,drama_id,source_kind,service_type,model,usage_json,charged_micro,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
    insertUsage.run('history-a-17', userA, null, 'tool_run', 'image', 'model-a', '{}', 100000, '{}', '2026-08-17T01:00:00.000Z');
    insertUsage.run('history-b-17', userB, null, 'omni_video', 'video', 'model-b', '{}', 300000, '{}', '2026-08-17T02:00:00.000Z');
    insertUsage.run('history-a-18', userA, null, 'tool_run', 'image', 'model-a', '{}', 900000, '{}', '2026-08-18T01:00:00.000Z');

    const overview = billing.unassignedProjectUsage(db, { date_from: '2026-08-17', date_to: '2026-08-17' });
    assert.equal(overview.summary.records, 2);
    assert.equal(overview.summary.users, 2);
    assert.equal(overview.summary.charged, 40);
    assert.equal(overview.by_user[0].display_name, '历史乙');
    assert.equal(overview.by_user[0].charged, 30);
    assert.equal(overview.by_source.find((row) => row.source_kind === 'tool_run').charged, 10);
    assert.equal(overview.items.length, 2);

    const projectPage = billing.projectUsage(db, { date_from: '2026-08-17', date_to: '2026-08-17' });
    assert.equal(projectPage.historical_unassigned.charged, 40);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(dbPath + suffix); } catch (_) {}
  }
});
