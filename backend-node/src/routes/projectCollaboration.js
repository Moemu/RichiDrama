'use strict';

const express = require('express');
const response = require('../response');
const access = require('../services/projectAccessService');
const collaboration = require('../services/projectCollaborationService');

module.exports = function projectRoutes(db, cfg, log) {
  const router = express.Router({ mergeParams: true });
  const handle = fn => (req, res) => {
    try { response.success(res, fn(req)); }
    catch (error) { response.error(res, error.status || 500, error.code || 'PROJECT_ERROR', error.message); }
  };
  router.post('/enable', handle(req => {
    access.enable(db, req.params.id, req.auth.id);
    return { enabled: true };
  }));
  router.get('/members', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id);
    return access.members(db, req.params.id);
  }));
  router.put('/members', handle(req => {
    const permission = access.requireAccess(db, req.params.id, req.auth.id, 'manage');
    if (!permission.collaboration_enabled) throw Object.assign(new Error('请先启用项目协作'), { status: 409 });
    const role = req.body.role;
    if (!['editor', 'viewer'].includes(role)) throw Object.assign(new Error('成员角色无效'), { status: 400 });
    const user = db.prepare('SELECT id FROM users WHERE username=? AND is_active=1').get(String(req.body.username || '').trim());
    if (!user) throw Object.assign(new Error('该用户名不可添加'), { status: 400 });
    if (user.id === req.auth.id) throw Object.assign(new Error('负责人无需添加自己'), { status: 400 });
    db.prepare(`INSERT INTO project_members (drama_id,user_id,role,joined_at) VALUES (?,?,?,?)
      ON CONFLICT(drama_id,user_id) DO UPDATE SET role=excluded.role`).run(Number(req.params.id), user.id, role, new Date().toISOString());
    return access.members(db, req.params.id);
  }));
  router.delete('/members/:userId', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id, 'manage');
    db.transaction(() => {
      db.prepare('DELETE FROM project_members WHERE drama_id=? AND user_id=?').run(Number(req.params.id), Number(req.params.userId));
      db.prepare('DELETE FROM project_episode_assignments WHERE user_id=? AND episode_id IN (SELECT id FROM episodes WHERE drama_id=?)').run(Number(req.params.userId), Number(req.params.id));
    })();
    return access.members(db, req.params.id);
  }));
  router.put('/episodes/:episodeId/assignee', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id, 'edit');
    if (access.resource(db, 'episodes', req.params.episodeId)?.drama_id !== Number(req.params.id)) throw Object.assign(new Error('分集不存在'), { status: 404 });
    const userId = Number(req.body.user_id);
    if (userId) {
      access.requireAccess(db, req.params.id, userId, 'edit');
      db.prepare('INSERT INTO project_episode_assignments (episode_id,user_id) VALUES (?,?) ON CONFLICT(episode_id) DO UPDATE SET user_id=excluded.user_id').run(Number(req.params.episodeId), userId);
    } else db.prepare('DELETE FROM project_episode_assignments WHERE episode_id=?').run(Number(req.params.episodeId));
    return { assignee_user_id: userId || null };
  }));
  router.get('/text', handle(req => collaboration.readText(db, req.params.id, req.auth.id, req.query)));
  router.patch('/episodes', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id, 'edit');
    const { updates = [], creates = [], remove_ids = [] } = req.body;
    if (![updates, creates, remove_ids].every(Array.isArray)) throw Object.assign(new Error('分集操作格式无效'), { status: 400 });
    const dramaId = Number(req.params.id);
    return db.transaction(() => {
      const at = new Date().toISOString();
      for (const update of updates) {
        const row = db.prepare('SELECT * FROM episodes WHERE id=? AND drama_id=? AND deleted_at IS NULL').get(Number(update.id), dramaId);
        if (!row) throw Object.assign(new Error('分集已被删除，请刷新后检查'), { status: 409 });
        const entries = Object.entries(update.fields || {}).filter(([field]) => ['title', 'script_content', 'description', 'duration'].includes(field));
        if (entries.length) db.prepare(`UPDATE episodes SET ${entries.map(([field]) => `${field}=?`).join(',')},updated_at=? WHERE id=?`).run(...entries.map(([,value]) => value ?? null), at, row.id);
      }
      for (const episode of creates) {
        const number = Number(episode.episode_number);
        if (!Number.isSafeInteger(number) || number < 1) throw Object.assign(new Error('集数无效'), { status: 400 });
        if (db.prepare('SELECT 1 FROM episodes WHERE drama_id=? AND episode_number=?').get(dramaId, number)) throw Object.assign(new Error('该集数已使用，请刷新后新增分集'), { status: 409 });
        db.prepare("INSERT INTO episodes (drama_id,episode_number,title,script_content,description,duration,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'draft',?,?)")
          .run(dramaId, number, episode.title || '', episode.script_content || '', episode.description || '', episode.duration || 0, at, at);
      }
      for (const id of remove_ids) {
        if (!db.prepare('SELECT 1 FROM episodes WHERE drama_id=? AND id=? AND deleted_at IS NULL').get(dramaId, Number(id))) throw Object.assign(new Error('分集已删除，请刷新后检查'), { status: 409 });
        db.prepare('UPDATE episodes SET deleted_at=?,updated_at=? WHERE id=?').run(at, at, Number(id));
      }
      return access.decorate(db, require('../services/dramaService').getDrama(db, dramaId), req.auth.id);
    })();
  }));
  router.post('/text', handle(req => collaboration.updateText(db, req.params.id, req.auth.id, req.body)));
  router.get('/suggestions', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id);
    return db.prepare('SELECT * FROM project_generated_suggestions WHERE drama_id=? AND applied_at IS NULL ORDER BY id DESC LIMIT 100').all(Number(req.params.id));
  }));
  router.get('/suggestions/:suggestionId', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id);
    const suggestion = db.prepare('SELECT * FROM project_generated_suggestions WHERE drama_id=? AND id=? AND applied_at IS NULL').get(Number(req.params.id), Number(req.params.suggestionId));
    if (!suggestion) throw Object.assign(new Error('待应用内容不存在'), { status: 404 });
    const currentText = suggestion.field === 'storyboard_generation'
      ? JSON.stringify(require('../services/episodeStoryboardService').getStoryboardsForEpisode(db, suggestion.entity_id))
      : collaboration.readText(db, req.params.id, req.auth.id, { kind: suggestion.entity_kind, id: suggestion.entity_id, field: suggestion.field }).text;
    return { ...suggestion, current_text: currentText };
  }));
  router.post('/suggestions/:suggestionId/apply', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id, 'edit');
    return db.transaction(() => {
      const suggestion = db.prepare('SELECT * FROM project_generated_suggestions WHERE drama_id=? AND id=? AND applied_at IS NULL').get(Number(req.params.id), Number(req.params.suggestionId));
      if (!suggestion) throw Object.assign(new Error('待应用内容不存在'), { status: 404 });
      if (suggestion.field === 'storyboard_generation' && suggestion.entity_kind === 'episodes') {
        const service = require('../services/episodeStoryboardService');
        if (access.resource(db, 'episodes', suggestion.entity_id)?.drama_id !== Number(req.params.id)) throw Object.assign(new Error('分集已删除'), { status: 409 });
        if (JSON.stringify(service.getStoryboardsForEpisode(db, suggestion.entity_id)) !== req.body.expected_text) throw Object.assign(new Error('分镜已更新，请重新比较'), { status: 409 });
        const generated = JSON.parse(suggestion.proposed_text);
        const saved = service.replaceStoryboardsAtomically(db, log, suggestion.entity_id, generated.storyboards, cfg, generated.style, service.getActiveStoryboardSnapshot(db, suggestion.entity_id), generated.derive_options);
        db.prepare('UPDATE project_generated_suggestions SET applied_at=? WHERE id=?').run(new Date().toISOString(), suggestion.id);
        return { storyboards: saved };
      }
      const input = { kind: suggestion.entity_kind, id: suggestion.entity_id, field: suggestion.field };
      const current = collaboration.readText(db, req.params.id, req.auth.id, input);
      if (current.text !== req.body.expected_text) throw Object.assign(new Error('内容已更新，请重新比较后应用'), { status: 409 });
      db.prepare(`UPDATE "${input.kind}" SET "${input.field}"=?,updated_at=? WHERE id=? AND deleted_at IS NULL`).run(suggestion.proposed_text, new Date().toISOString(), input.id);
      db.prepare('UPDATE project_generated_suggestions SET applied_at=? WHERE id=?').run(new Date().toISOString(), suggestion.id);
      return collaboration.readText(db, req.params.id, req.auth.id, input);
    })();
  }));
  router.post('/assets', handle(req => require('../services/projectAssetService').join(db, cfg, log, req.params.id, req.body.asset_id, req.auth.id)));
  router.get('/state', handle(req => {
    const permissions = access.requireAccess(db, req.params.id, req.auth.id);
    return { permissions, revision: db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(Number(req.params.id))?.revision || 0 };
  }));
  router.get('/results', handle(req => {
    access.requireAccess(db, req.params.id, req.auth.id);
    const dramaId = Number(req.params.id);
    const results = [];
    for (const [table, type] of [['image_generations', 'image'], ['video_generations', 'video']]) {
      results.push(...db.prepare(`SELECT g.id, g.storyboard_id, s.episode_id, g.status, g.local_path, g.created_at,
        u.display_name creator_name FROM ${table} g LEFT JOIN storyboards s ON s.id=g.storyboard_id
        LEFT JOIN users u ON u.id=g.owner_user_id WHERE g.drama_id=? AND g.deleted_at IS NULL
        ORDER BY g.created_at DESC LIMIT 200`).all(dramaId).map(row => ({ ...row, type })));
    }
    const episodes = db.prepare('SELECT id, title, video_url FROM episodes WHERE drama_id=? AND deleted_at IS NULL AND video_url IS NOT NULL').all(dramaId);
    for (const episode of episodes) {
      const local = require('../services/mediaAuthorizationService').normalizeMediaReference(episode.video_url, cfg.storage.local_path);
      if (local) results.push({ id: episode.id, episode_id: episode.id, type: 'final', status: 'completed', local_path: local, title: episode.title });
    }
    return results;
  }));
  return router;
};
