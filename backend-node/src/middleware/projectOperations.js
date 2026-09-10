'use strict';

const crypto = require('crypto');
const response = require('../response');

module.exports = function projectOperations(db) {
  return (req, res, next) => {
    if (req.is('multipart/form-data') && !req.file) return next();
    if (!req.projectAccess?.collaboration_enabled || ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || /\/collaboration\/text$/.test(req.path)) return next();
    const dramaId = req.projectAccess.drama_id;
    const operationId = req.headers['x-project-operation'];
    const version = req.headers['x-project-revision'];
    if (operationId && (typeof operationId !== 'string' || operationId.length > 100)) return response.badRequest(res, '操作 ID 无效');
    const hash = crypto.createHash('sha256').update(JSON.stringify([req.method, req.originalUrl, req.body])).update(req.file?.buffer || Buffer.alloc(0)).digest('hex');
    if (operationId) {
      const previous = db.prepare('SELECT * FROM project_operations WHERE drama_id=? AND operation_id=?').get(dramaId, operationId);
      if (previous) {
        if (previous.actor_id !== req.auth.id || previous.request_hash !== hash) return response.error(res, 409, 'OPERATION_CONFLICT', '操作 ID 已用于其他请求');
        const saved = JSON.parse(previous.response_json);
        return res.status(saved.status).json(saved.body);
      }
    }
    const revision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(dramaId)?.revision;
    if (version !== undefined && Number(version) !== revision) return response.error(res, 409, 'PROJECT_CHANGED', '项目内容已更新，请检查最新内容后重试');
    if (operationId) {
      const unresolved = { status: 409, body: { success: false, error: { code: 'OPERATION_PENDING', message: '此操作已受理，结果尚未确认。请刷新查看，勿重复提交生成。' } } };
      db.prepare('INSERT INTO project_operations (drama_id,operation_id,actor_id,request_hash,response_json,created_at) VALUES (?,?,?,?,?,?)')
        .run(dramaId, operationId, req.auth.id, hash, JSON.stringify(unresolved), new Date().toISOString());
      const json = res.json.bind(res);
      res.json = body => {
        db.prepare('UPDATE project_operations SET response_json=? WHERE drama_id=? AND operation_id=?')
          .run(JSON.stringify({ status: res.statusCode, body }), dramaId, operationId);
        return json(body);
      };
    }
    next();
  };
};
