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

function elapsedMs(startedAt, updatedAt) {
  const start = Date.parse(startedAt || ''); const end = Date.parse(updatedAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function stageMessage(key, status) {
  const messages = {
    generation: { processing: '供应商正在生成视频', persisting: '正在保存并规范最终成片', completed: '视频已完成', failed: '视频生成失败', retryable: '提交中断，可显式重试' },
    upscale: { awaiting_source: '等待原片归档完成', pending: '等待超分队列', processing: '供应商正在进行 AI 超分', completed: '超分完成', failed: '超分失败，原片仍可用', skipped: '未选择超分' },
    interpolation: { awaiting_source: '等待可用输入视频', pending: '等待插帧队列', processing: '供应商正在进行智能插帧', completed: '插帧完成', failed: '插帧失败，上一阶段视频仍可用', skipped: '未选择插帧' },
    archive: { pending: '正在归档媒体', oss_synced: '媒体已归档', local: '本地媒体已就绪', local_ready: '本地媒体已就绪', failed: '归档失败，但本地媒体仍可播放' },
  };
  return messages[key]?.[status] || null;
}

// 供应商任务 ID 内嵌提交时间戳（北京时间）：cgt-20260818150006-xx 或
// 2026081815015169FA09C11AE1E41E807C（前 14 位 yyyyMMddHHmmss）。
// 阶段真实起点必须用它，而不是 job 登记时刻——三个 job 在任务提交时同毫秒
// 预创建（登记+预授权），串行执行时后置阶段的登记时刻含大量排队等待，
// 用它算"阶段耗时"会把前序阶段时长计入（曾出现插帧显示4分25秒、实际仅1分18秒）。
function providerSubmitTime(id) {
  const s = String(id || '');
  const m = s.match(/^(?:cgt-)?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 8, Number(m[5]), Number(m[6]));
  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

function stages(row) {
  // 优先用供应商任务 ID 解析提交时刻；amk 工具类任务 ID（amk-tool-…）不含时间戳，
  // 回退到 provider_request_id（火山请求 ID 前 14 位即 yyyyMMddHHmmss 北京时间）。
  const upSubmit = providerSubmitTime(row.upscale_provider_task_id) || providerSubmitTime(row.upscale_provider_request_id);
  const ipSubmit = providerSubmitTime(row.interpolation_provider_task_id) || providerSubmitTime(row.interpolation_provider_request_id);
  const raw = [
    { key: 'generation', status: row.status, provider_task_id: row.provider_task_id || row.task_id || null, started_at: row.created_at, updated_at: row.updated_at },
    { key: 'upscale', selected: !!row.upscale_status, status: row.upscale_status || 'not_selected', provider_task_id: row.upscale_provider_task_id || null, started_at: row.upscale_created_at || null, updated_at: row.upscale_updated_at || null },
    { key: 'interpolation', selected: !!row.interpolation_status, status: row.interpolation_status || 'not_selected', provider_task_id: row.interpolation_provider_task_id || null, started_at: row.interpolation_created_at || null, updated_at: row.interpolation_updated_at || null },
    { key: 'archive', status: row.archive_status || 'local_ready', started_at: row.archive_created_at || null, updated_at: row.archive_updated_at || row.updated_at },
  ];
  return raw.map((stage) => {
    let { started_at: start, updated_at: end } = stage;
    if (stage.key === 'generation') {
      // 生成阶段止于首个后处理真实提交（无后处理则到任务完成），
      // 避免把超分/插帧耗时计入"生成"。
      const genEnd = upSubmit || ipSubmit || null;
      if (genEnd) end = genEnd;
    }
    if (stage.key === 'upscale' && upSubmit) start = upSubmit;
    if (stage.key === 'interpolation' && ipSubmit) start = ipSubmit;
    return { ...stage, started_at: start, updated_at: end, elapsed_ms: elapsedMs(start, end), message: stageMessage(stage.key, stage.status) };
  });
}

function listProduction(db, query) {
  const where = productionWhere(query); const meta = page(query);
  const total = Number(db.prepare(`SELECT COUNT(*) total FROM video_generations v WHERE ${where.sql}`).get(...where.args).total || 0);
  const rows = db.prepare(`SELECT v.*, u.username, d.title AS project_title,
      up.status AS upscale_job_status, up.provider_task_id AS upscale_provider_task_id, up.provider_request_id AS upscale_provider_request_id, up.created_at AS upscale_created_at, up.updated_at AS upscale_updated_at, up.attempts AS upscale_attempts, up.error_msg AS upscale_error_msg,
      ip.status AS interpolation_job_status, ip.provider_task_id AS interpolation_provider_task_id, ip.provider_request_id AS interpolation_provider_request_id, ip.created_at AS interpolation_created_at, ip.updated_at AS interpolation_updated_at, ip.attempts AS interpolation_attempts, ip.error_msg AS interpolation_error_msg,
      ar.archive_status AS archive_record_status, ar.oss_key, ar.oss_etag, ar.verified_at, ar.local_delete_after, ar.archive_error AS archive_record_error, ar.archive_attempts AS archive_record_attempts, ar.created_at AS archive_created_at, ar.updated_at AS archive_updated_at, oj.id AS omni_job_id
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
    up.status AS upscale_job_status, up.provider_task_id AS upscale_provider_task_id, up.provider_request_id AS upscale_provider_request_id, up.created_at AS upscale_created_at, up.updated_at AS upscale_updated_at, up.attempts AS upscale_attempts, up.error_msg AS upscale_error_msg,
    ip.status AS interpolation_job_status, ip.provider_task_id AS interpolation_provider_task_id, ip.provider_request_id AS interpolation_provider_request_id, ip.created_at AS interpolation_created_at, ip.updated_at AS interpolation_updated_at, ip.attempts AS interpolation_attempts, ip.error_msg AS interpolation_error_msg,
    ar.archive_status AS archive_record_status, ar.oss_key, ar.oss_etag, ar.verified_at, ar.local_delete_after, ar.archive_error AS archive_record_error, ar.archive_attempts AS archive_record_attempts, ar.created_at AS archive_created_at, ar.updated_at AS archive_updated_at, oj.id AS omni_job_id
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
