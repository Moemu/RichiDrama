const taskService = require('../services/taskService');
const response = require('../response');

function ownedTask(db, taskId, user) {
  const task = db.prepare('SELECT * FROM async_tasks WHERE id = ? AND deleted_at IS NULL').get(taskId);
  if (!task) return null;
  if (user.role !== 'admin' && Number(task.owner_user_id) !== Number(user.id)) return false;
  return task;
}

function getTaskStatus(db, log) {
  return (req, res) => {
    const task = ownedTask(db, req.params.task_id, req.auth);
    if (!task) return response.notFound(res, '任务不存在');
    if (task === false) return response.notFound(res, '任务不存在');
    response.success(res, taskService.getTask(db, req.params.task_id));
  };
}

function getResourceTasks(db, log) {
  return (req, res) => {
    const resourceId = req.query.resource_id;
    if (!resourceId) return response.badRequest(res, '缺少resource_id参数');
    try {
      const tasks = taskService.getTasksByResource(db, resourceId, req.auth.id);
      response.success(res, tasks);
    } catch (err) {
      log.errorw('Get resource tasks failed', { error: err.message });
      response.internalError(res, err.message);
    }
  };
}

function cancelTaskStatus(db, log) {
  return (req, res) => {
    try {
      const task = ownedTask(db, req.params.task_id, req.auth);
      if (!task || task === false) return response.notFound(res, '任务不存在');
      // 全能视频有独立的账本和厂商提交边界；不能由通用 task 路由伪取消。
      const omni = db.prepare(`SELECT j.id FROM omni_video_jobs j
        JOIN video_generations v ON v.id = j.video_generation_id
        WHERE v.task_id = ?`).get(req.params.task_id);
      if (omni) {
        const result = require('../services/omniVideoService').cancelJob(db, log, omni.id, req.auth);
        return response.success(res, result);
      }
      const submitted = db.prepare(`SELECT provider_task_id FROM video_generations
        WHERE task_id = ? AND deleted_at IS NULL`).get(req.params.task_id);
      if (submitted?.provider_task_id && String(submitted.provider_task_id).trim()) {
        return response.badRequest(res, '任务已提交供应商，当前供应商不支持取消；将继续查询并按真实用量结算');
      }
      const result = taskService.cancelTask(db, log, req.params.task_id, req.body?.reason);
      if (!result.ok && result.reason === 'not_found') {
        return response.notFound(res, '任务不存在');
      }
      response.success(res, result.task || { id: req.params.task_id });
    } catch (err) {
      log.errorw('Cancel task failed', { error: err.message, task_id: req.params.task_id });
      response.badRequest(res, err.message);
    }
  };
}

module.exports = function taskRoutes(db, log) {
  return {
    getTaskStatus: getTaskStatus(db, log),
    getResourceTasks: getResourceTasks(db, log),
    cancelTaskStatus: cancelTaskStatus(db, log),
  };
};
