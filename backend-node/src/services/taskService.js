const { v4: uuidv4 } = require('uuid');

function createTask(db, log, taskType, resourceId, ownerUserId = null, tenantId = null) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, owner_user_id, tenant_id, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, '', ?, ?, ?, ?, ?)`
  ).run(id, taskType, resourceId || '', ownerUserId, tenantId || null, now, now);
  log.info('Task created', { task_id: id, type: taskType, resource_id: resourceId });
  const task = getTask(db, id);
  return task || { id, type: taskType, status: 'pending', progress: 0, message: '', resource_id: resourceId || '', created_at: now, updated_at: now, completed_at: null };
}

function getTask(db, taskId) {
  const row = db.prepare('SELECT * FROM async_tasks WHERE id = ? AND deleted_at IS NULL').get(taskId);
  if (!row) return null;
  return rowToTask(row);
}

function getTasksByResource(db, resourceId, ownerUserId) {
  const ownerSql = ownerUserId ? ' AND owner_user_id = ?' : '';
  const rows = db.prepare(
    'SELECT * FROM async_tasks WHERE resource_id = ? AND deleted_at IS NULL' + ownerSql + ' ORDER BY created_at DESC'
  ).all(...(ownerUserId ? [resourceId, ownerUserId] : [resourceId]));
  return rows.map(rowToTask);
}

function updateTaskStatus(db, taskId, status, progress, message) {
  const now = new Date().toISOString();
  let completedAt = null;
  if (status === 'completed' || status === 'failed') completedAt = now;
  db.prepare(
    `UPDATE async_tasks SET status = ?, progress = ?, message = ?, updated_at = ?, completed_at = ?
     WHERE id = ?`
  ).run(status, progress ?? 0, message || '', now, completedAt, taskId);
}

function releaseTaskAuthorization(db, taskId, reason) {
  const billing = require('./billingService');
  const candidates = [
    ['image_generations', 'task_id'],
    ['video_generations', 'task_id'],
  ];
  for (const [table, taskColumn] of candidates) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    if (!columns.has(taskColumn) || !columns.has('owner_user_id') || !columns.has('billing_authorization_id')) continue;
    const row = db.prepare(`SELECT owner_user_id, billing_authorization_id FROM ${table} WHERE ${taskColumn}=?`).get(taskId);
    if (!row?.owner_user_id || !row?.billing_authorization_id) continue;
    try {
      billing.voidAuthorization(db, { id: row.owner_user_id, role: 'admin' }, row.billing_authorization_id, reason || '异步任务失败，释放预授权');
    } catch (_) {
      // The original failure must remain terminal even if a historical billing
      // record is malformed; reconciliation tooling can repair that record.
    }
  }
}

function updateTaskError(db, taskId, errMsg) {
  const now = new Date().toISOString();
  try {
    db.prepare(
      `UPDATE async_tasks SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(errMsg || '', now, now, taskId);
  } catch (e) {
    if ((e.message || '').includes('error')) {
      updateTaskStatus(db, taskId, 'failed', 0, errMsg || '任务失败');
    } else throw e;
  }
  // Image/video workers share async_tasks.  Terminal task failure must always
  // release an unsettled reservation; voidAuthorization itself is idempotent.
  releaseTaskAuthorization(db, taskId, errMsg || '异步任务失败，释放预授权');
}

function updateTaskResult(db, taskId, result) {
  const now = new Date().toISOString();
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result || {});
  db.prepare(
    `UPDATE async_tasks SET status = 'completed', progress = 100, result = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(resultStr, now, now, taskId);
}

function rowToTask(r) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    progress: r.progress ?? 0,
    message: r.message,
    error: r.error,
    result: r.result,
    resource_id: r.resource_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

const ORPHAN_ASYNC_TASK_MSG = '服务重启后任务中断，请重新操作';
const USER_CANCEL_TASK_MSG = '用户已取消';

/**
 * 用户主动取消进行中的异步任务（无法中断已在执行的 AI 调用，但会停止前端轮询并防止恢复）。
 */
function cancelTask(db, log, taskId, reason) {
  const task = getTask(db, taskId);
  if (!task) return { ok: false, reason: 'not_found' };
  if (task.status === 'completed' || task.status === 'failed') {
    return { ok: true, already_done: true, task };
  }
  const msg = (reason || USER_CANCEL_TASK_MSG).toString().trim() || USER_CANCEL_TASK_MSG;
  updateTaskError(db, taskId, msg);
  log.info('Task cancelled by user', { task_id: taskId, type: task.type });
  return { ok: true, task: getTask(db, taskId) };
}

/**
 * 进程内 setImmediate 任务在重启后会丢失；启动时将遗留的 pending/processing 标为失败，避免前端无限轮询。
 */
function failOrphanedAsyncTasksOnStartup(db, log) {
  const hasVideoGenerations = !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'video_generations'").get();
  const rows = db.prepare(
    `SELECT id, type, status, resource_id FROM async_tasks
     WHERE status IN ('pending', 'processing') AND deleted_at IS NULL${hasVideoGenerations
       ? " AND id NOT IN (SELECT task_id FROM video_generations WHERE status IN ('processing', 'sd2_waiting', 'upscale_pending', 'upscaling', 'interpolation_pending', 'interpolating', 'persisting') AND task_id IS NOT NULL)"
       : ''}`
  ).all();
  if (!rows.length) return 0;
  log.warn('Failing orphaned async tasks after startup', { count: rows.length });
  for (const row of rows) {
    updateTaskError(db, row.id, ORPHAN_ASYNC_TASK_MSG);
    log.info('Orphaned async task marked failed', {
      task_id: row.id,
      type: row.type,
      resource_id: row.resource_id,
      previous_status: row.status,
    });
  }
  return rows.length;
}

module.exports = {
  createTask,
  getTask,
  getTasksByResource,
  updateTaskStatus,
  updateTaskError,
  updateTaskResult,
  releaseTaskAuthorization,
  failOrphanedAsyncTasksOnStartup,
  cancelTask,
  ORPHAN_ASYNC_TASK_MSG,
  USER_CANCEL_TASK_MSG,
};
