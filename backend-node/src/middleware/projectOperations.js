'use strict';

const crypto = require('crypto');
const response = require('../response');
const edits = require('../services/projectEditService');
const recovery = require('../services/projectOperationRecovery');

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
        const prior = JSON.parse(previous.response_json);
        const saved = recovery.recover(prior);
        if (saved !== prior) db.prepare('UPDATE project_operations SET response_json=? WHERE drama_id=? AND operation_id=?').run(JSON.stringify(saved), dramaId, operationId);
        return res.status(saved.status).json(saved.body);
      }
    }
    const contract = req.body?._project_edit;
    if (contract !== undefined && !edits.supports(req)) return response.badRequest(res, '此操作不支持字段编辑校验');
    const json = res.json.bind(res);
    const atomic = contract !== undefined || (operationId && recovery.supportsAtomicResponse(req));
    let pendingResponse;
    const apply = () => {
      if (operationId || contract !== undefined) {
        res.json = body => {
          if (contract !== undefined && res.statusCode < 400 && body?.success !== false) body = { ...body, project_edit: edits.acknowledgement(db, dramaId, contract) };
          if (operationId) {
            db.prepare('UPDATE project_operations SET response_json=? WHERE drama_id=? AND operation_id=?')
              .run(JSON.stringify({ status: res.statusCode, body }), dramaId, operationId);
          }
          if (atomic) { pendingResponse = body; return res; }
          return json(body);
        };
      }
      if (contract !== undefined) {
        edits.validate(db, dramaId, contract);
        const { _project_edit, ...body } = req.body;
        req.body = body;
      } else {
        const revision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(dramaId)?.revision;
        if (version !== undefined && Number(version) !== revision) return response.error(res, 409, 'PROJECT_CHANGED', '项目内容已更新，请检查最新内容后重试');
      }
      if (operationId) {
        const unresolved = recovery.pending(dramaId, operationId);
        db.prepare('INSERT INTO project_operations (drama_id,operation_id,actor_id,request_hash,response_json,created_at) VALUES (?,?,?,?,?,?)')
          .run(dramaId, operationId, req.auth.id, hash, JSON.stringify(unresolved), new Date().toISOString());
        if (!atomic) {
          const completeWithoutJson = () => {
            const saved = db.prepare('SELECT response_json FROM project_operations WHERE drama_id=? AND operation_id=?').get(dramaId, operationId);
            const value = saved && JSON.parse(saved.response_json);
            if (value?.body?.error?.code === 'OPERATION_PENDING') db.prepare('UPDATE project_operations SET response_json=? WHERE drama_id=? AND operation_id=?').run(JSON.stringify(recovery.unconfirmed(value, res.writableFinished ? 'stream' : 'interrupted')), dramaId, operationId);
          };
          res.once('close', completeWithoutJson);
        }
      }
      next();
    };
    if (!atomic) return apply();
    try {
      db.transaction(() => {
        apply();
        if (pendingResponse === undefined) throw new Error('Project edit handler must complete synchronously');
      }).immediate();
      return json(pendingResponse);
    } catch (error) {
      res.json = json;
      return response.error(res, error.status || 500, error.code || 'PROJECT_EDIT_FAILED', error.status ? error.message : '项目保存失败，请重试', error.details);
    }
  };
};
