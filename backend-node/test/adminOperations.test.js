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
