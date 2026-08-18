// Read-only operational projections.  These queries deliberately do not mutate
// historical jobs: the existing user-facing retry and billing routes remain the
// only writers for those workflows.
function page(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const page_size = Math.min(100, Math.max(1, Number.parseInt(query.page_size, 10) || 20));
  return { page, page_size, offset: (page - 1) * page_size };
}

const ALERT_DEFAULTS = {
  stale_minutes: 30,
  failed_count: 3,
  failed_window_hours: 24,
  pending_reconciliation_count: 1,
  archive_failed_count: 1,
};

function alertSettings(db) {
  const rows = db.prepare('SELECT key, value, updated_at FROM operations_alert_settings').all();
  const values = { ...ALERT_DEFAULTS };
  for (const row of rows) if (Object.hasOwn(values, row.key)) values[row.key] = Number(row.value) || ALERT_DEFAULTS[row.key];
  return { ...values, updated_at: rows.map((row) => row.updated_at).sort().at(-1) || null };
}

function saveAlertSettings(db, input = {}) {
  const current = alertSettings(db); const at = new Date().toISOString();
  const next = {};
  for (const key of Object.keys(ALERT_DEFAULTS)) {
    const raw = input[key] === undefined ? current[key] : Number(input[key]);
    if (!Number.isFinite(raw) || raw < 1 || raw > 100000) throw new Error(`invalid alert threshold: ${key}`);
    next[key] = Math.floor(raw);
  }
  const stmt = db.prepare(`INSERT INTO operations_alert_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
  db.transaction(() => Object.entries(next).forEach(([key, value]) => stmt.run(key, String(value), at)))();
  return alertSettings(db);
}

function productionWhere(query = {}) {
  const clauses = ['v.deleted_at IS NULL']; const args = [];
  if (query.status) { clauses.push('v.status = ?'); args.push(String(query.status)); }
  if (query.stage) {
    const stage = String(query.stage);
    if (stage === 'generation') clauses.push("v.status NOT IN ('upscale_pending','upscaling','interpolation_pending','interpolating')");
    if (stage === 'upscale') clauses.push('v.upscale_status IS NOT NULL');
    if (stage === 'interpolation') clauses.push('v.interpolation_status IS NOT NULL');
    if (stage === 'archive') clauses.push('v.archive_status IS NOT NULL');
  }
  if (query.user_id) { clauses.push('v.owner_user_id = ?'); args.push(Number(query.user_id)); }
  if (query.project_id) { clauses.push('v.drama_id = ?'); args.push(Number(query.project_id)); }
  if (query.model) { clauses.push('v.model = ?'); args.push(String(query.model)); }
  if (query.from) { clauses.push('v.created_at >= ?'); args.push(String(query.from)); }
  if (query.to) { clauses.push('v.created_at <= ?'); args.push(String(query.to)); }
  return { sql: clauses.join(' AND '), args };
}

function stages(row) {
  return [
    { key: 'generation', status: row.status, provider_task_id: row.provider_task_id || row.task_id || null, updated_at: row.updated_at },
    { key: 'upscale', selected: !!row.upscale_status, status: row.upscale_status || 'not_selected', provider_task_id: row.upscale_provider_task_id || null, updated_at: row.upscale_updated_at || null },
    { key: 'interpolation', selected: !!row.interpolation_status, status: row.interpolation_status || 'not_selected', provider_task_id: row.interpolation_provider_task_id || null, updated_at: row.interpolation_updated_at || null },
    { key: 'archive', status: row.archive_status || 'local_ready', updated_at: row.archive_updated_at || row.updated_at },
  ];
}

function listProduction(db, query) {
  const where = productionWhere(query); const meta = page(query);
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM video_generations v WHERE ${where.sql}`).get(...where.args).total || 0);
  const rows = db.prepare(`SELECT v.*, u.username, d.title AS project_title,
      up.status AS upscale_job_status, up.provider_task_id AS upscale_provider_task_id, up.updated_at AS upscale_updated_at, up.attempts AS upscale_attempts, up.error_msg AS upscale_error_msg,
      ip.status AS interpolation_job_status, ip.provider_task_id AS interpolation_provider_task_id, ip.updated_at AS interpolation_updated_at, ip.attempts AS interpolation_attempts, ip.error_msg AS interpolation_error_msg,
      ar.archive_status AS archive_record_status, ar.oss_key, ar.oss_etag, ar.verified_at, ar.local_delete_after, ar.archive_error AS archive_record_error, ar.archive_attempts AS archive_record_attempts, ar.updated_at AS archive_updated_at, oj.id AS omni_job_id
    FROM video_generations v
    LEFT JOIN users u ON u.id=v.owner_user_id LEFT JOIN dramas d ON d.id=v.drama_id
    LEFT JOIN video_upscale_jobs up ON up.video_generation_id=v.id
    LEFT JOIN video_interpolation_jobs ip ON ip.video_generation_id=v.id
    LEFT JOIN media_archive_records ar ON ar.source_type='video_generation' AND ar.source_id=v.id
    LEFT JOIN omni_video_jobs oj ON oj.video_generation_id=v.id
    WHERE ${where.sql} ORDER BY v.updated_at DESC, v.id DESC LIMIT ? OFFSET ?`).all(...where.args, meta.page_size, meta.offset);
  return { items: rows.map((row) => ({ ...row, stages: stages(row), error_summary: row.error_msg || row.interpolation_error_msg || row.upscale_error_msg || row.archive_record_error || row.archive_error || null })), total, page: meta.page, page_size: meta.page_size };
}

function productionDetail(db, id) {
  // Query explicitly so an ID cannot be confused with a list position.
  const row = db.prepare(`SELECT v.*, u.username, d.title AS project_title,
    up.status AS upscale_job_status, up.provider_task_id AS upscale_provider_task_id, up.updated_at AS upscale_updated_at, up.attempts AS upscale_attempts, up.error_msg AS upscale_error_msg,
    ip.status AS interpolation_job_status, ip.provider_task_id AS interpolation_provider_task_id, ip.updated_at AS interpolation_updated_at, ip.attempts AS interpolation_attempts, ip.error_msg AS interpolation_error_msg,
    ar.archive_status AS archive_record_status, ar.oss_key, ar.oss_etag, ar.verified_at, ar.local_delete_after, ar.archive_error AS archive_record_error, ar.archive_attempts AS archive_record_attempts, ar.updated_at AS archive_updated_at, oj.id AS omni_job_id
    FROM video_generations v LEFT JOIN users u ON u.id=v.owner_user_id LEFT JOIN dramas d ON d.id=v.drama_id
    LEFT JOIN video_upscale_jobs up ON up.video_generation_id=v.id LEFT JOIN video_interpolation_jobs ip ON ip.video_generation_id=v.id
    LEFT JOIN media_archive_records ar ON ar.source_type='video_generation' AND ar.source_id=v.id
    LEFT JOIN omni_video_jobs oj ON oj.video_generation_id=v.id WHERE v.id=? AND v.deleted_at IS NULL`).get(Number(id));
  if (!row) return null;
  const authorizations = db.prepare(`SELECT id, type, amount_micro, reason, created_at FROM billing_transactions WHERE authorization_id IN (?, ?, ?) OR id IN (?, ?, ?)`)
    .all(row.billing_authorization_id, row.upscale_billing_authorization_id, row.interpolation_billing_authorization_id, row.billing_authorization_id, row.upscale_billing_authorization_id, row.interpolation_billing_authorization_id);
  return { ...row, stages: stages(row), authorizations, error_summary: row.error_msg || row.interpolation_error_msg || row.upscale_error_msg || row.archive_record_error || row.archive_error || null };
}

function listArchives(db, query = {}) {
  const meta = page(query); const clauses = ['1=1']; const args=[];
  if (query.status) { clauses.push('archive_status=?'); args.push(String(query.status)); }
  if (query.from) { clauses.push('updated_at>=?'); args.push(String(query.from)); }
  if (query.to) { clauses.push('updated_at<=?'); args.push(String(query.to)); }
  const where=clauses.join(' AND '); const total=Number(db.prepare(`SELECT COUNT(*) total FROM media_archive_records WHERE ${where}`).get(...args).total || 0);
  return { items: db.prepare(`SELECT * FROM media_archive_records WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args,meta.page_size,meta.offset), total, page:meta.page,page_size:meta.page_size };
}

function overview(db, query = {}) {
  const { sql, args } = productionWhere(query);
  const production = db.prepare(`SELECT COUNT(*) total, SUM(status='completed') completed, SUM(status='failed') failed,
    SUM(status IN ('processing','persisting','upscale_pending','upscaling','interpolation_pending','interpolating')) processing,
    SUM(status IN ('retryable','invalid')) retryable FROM video_generations v WHERE ${sql}`).get(...args);
  const postprocess = db.prepare("SELECT SUM(status='completed') completed, SUM(status IN ('failed','cancelled')) failed FROM video_upscale_jobs").get();
  const interpolation = db.prepare("SELECT SUM(status='completed') completed, SUM(status IN ('failed','cancelled')) failed FROM video_interpolation_jobs").get();
  const storage = db.prepare("SELECT archive_status status, COUNT(*) count FROM media_archive_records GROUP BY archive_status").all();
  const billing = db.prepare("SELECT COALESCE(SUM(charged_micro),0) charged_micro FROM billing_usage_logs WHERE (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?)").get(query.from || null, query.from || null, query.to || null, query.to || null);
  const frozen = db.prepare('SELECT COALESCE(SUM(frozen_micro),0) frozen_micro FROM billing_accounts').get();
  const reconciliation = db.prepare("SELECT COUNT(*) count FROM billing_reconciliation_cases WHERE status='pending'").get();
  const settings = alertSettings(db); const now = new Date();
  const staleBefore = new Date(now.getTime() - settings.stale_minutes * 60 * 1000).toISOString();
  const failedSince = new Date(now.getTime() - settings.failed_window_hours * 60 * 60 * 1000).toISOString();
  const stale = db.prepare(`SELECT COUNT(*) count FROM video_generations
    WHERE deleted_at IS NULL AND status IN ('processing','persisting','upscale_pending','upscaling','interpolation_pending','interpolating') AND updated_at < ?`).get(staleBefore).count;
  const failed = db.prepare(`SELECT model, COUNT(*) count FROM video_generations
    WHERE deleted_at IS NULL AND status='failed' AND updated_at >= ? GROUP BY model HAVING COUNT(*) >= ? ORDER BY count DESC`).all(failedSince, settings.failed_count);
  const archiveFailed = db.prepare("SELECT COUNT(*) count FROM media_archive_records WHERE archive_status='failed'").get().count;
  const stageSummary = {
    generation: db.prepare(`SELECT
      SUM(status='completed') completed,
      SUM(status='failed') failed,
      SUM(status IN ('processing','persisting','retryable','invalid')) active
      FROM video_generations WHERE deleted_at IS NULL`).get(),
    upscale: db.prepare("SELECT SUM(status='completed') completed, SUM(status IN ('failed','cancelled')) failed, SUM(status IN ('pending','processing','awaiting_source')) active FROM video_upscale_jobs").get(),
    interpolation: db.prepare("SELECT SUM(status='completed') completed, SUM(status IN ('failed','cancelled')) failed, SUM(status IN ('pending','processing','awaiting_source')) active FROM video_interpolation_jobs").get(),
    archive: db.prepare("SELECT SUM(archive_status='oss_synced') completed, SUM(archive_status='failed') failed, SUM(archive_status IN ('pending','local_ready')) active FROM media_archive_records").get(),
  };
  const trendRows = db.prepare(`SELECT date(datetime(created_at, '+8 hours')) day,
      COUNT(*) total, SUM(status='completed') completed, SUM(status='failed') failed
      FROM video_generations WHERE deleted_at IS NULL AND created_at >= ? GROUP BY day ORDER BY day ASC`)
    .all(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString());
  const trendByDay = new Map(trendRows.map((row) => [row.day, row]));
  const trend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now.getTime() - (6 - index) * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    return trendByDay.get(day) || { day, total: 0, completed: 0, failed: 0 };
  });
  const alerts = [];
  if (stale) alerts.push({ key: 'stale_production', severity: 'warning', count: stale, threshold: settings.stale_minutes, target: { tab: 'production', status: 'processing' } });
  for (const row of failed) alerts.push({ key: 'continuous_failures', severity: 'warning', count: row.count, model: row.model || null, threshold: settings.failed_count, target: { tab: 'production', status: 'failed', model: row.model || undefined } });
  if (reconciliation.count >= settings.pending_reconciliation_count) alerts.push({ key: 'pending_reconciliation', severity: 'warning', count: reconciliation.count, threshold: settings.pending_reconciliation_count, target: { tab: 'reconciliations', status: 'pending' } });
  if (archiveFailed >= settings.archive_failed_count) alerts.push({ key: 'archive_failed', severity: 'warning', count: archiveFailed, threshold: settings.archive_failed_count, target: { tab: 'archives', status: 'failed' } });
  const actionQueue = [
    ...db.prepare(`SELECT v.id, v.status, v.updated_at, v.model, v.error_msg, d.title AS project_title
      FROM video_generations v LEFT JOIN dramas d ON d.id=v.drama_id
      WHERE v.deleted_at IS NULL AND v.status IN ('processing','persisting','upscale_pending','upscaling','interpolation_pending','interpolating') AND v.updated_at < ?
      ORDER BY v.updated_at ASC LIMIT 6`).all(staleBefore).map((row) => ({ ...row, kind: 'stalled', target: { tab: 'production', status: 'processing' } })),
    ...db.prepare(`SELECT v.id, v.status, v.updated_at, v.model, v.error_msg, d.title AS project_title
      FROM video_generations v LEFT JOIN dramas d ON d.id=v.drama_id
      WHERE v.deleted_at IS NULL AND v.status IN ('failed','retryable','invalid')
      ORDER BY v.updated_at DESC LIMIT 6`).all().map((row) => ({ ...row, kind: 'failed', target: { tab: 'production', status: 'failed' } })),
  ].sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at))).slice(0, 8);
  return { generated_at:now.toISOString(), production, postprocess:{ upscale:postprocess, interpolation }, storage, billing:{...billing,...frozen,pending_reconciliations:reconciliation.count}, stage_summary:stageSummary, trend, alerts, action_queue:actionQueue, alert_settings:settings };
}

function csvCell(value) {
  const raw = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function productionCsv(db, query = {}) {
  const where = productionWhere(query);
  const rows = db.prepare(`SELECT v.id, u.username, d.title project_title, v.model, v.status, v.upscale_status, v.interpolation_status, v.archive_status, v.local_path, v.updated_at, v.error_msg
    FROM video_generations v LEFT JOIN users u ON u.id=v.owner_user_id LEFT JOIN dramas d ON d.id=v.drama_id
    WHERE ${where.sql} ORDER BY v.updated_at DESC, v.id DESC LIMIT 10000`).all(...where.args);
  const headers = ['task_id','username','project_title','model','generation_status','upscale_status','interpolation_status','archive_status','local_path','updated_at','error_summary'];
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(','))].map((row) => Array.isArray(row) ? row.join(',') : row).join('\r\n')}\r\n`;
}

module.exports = { overview, listProduction, productionDetail, listArchives, alertSettings, saveAlertSettings, productionCsv };
