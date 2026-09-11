'use strict';

const access = require('./projectAccessService');

function transferOwnership(db, dramaId, actorId, newOwnerId) {
  const id = Number(dramaId);
  const targetId = Number(newOwnerId);
  return db.transaction(() => {
    const permission = access.requireAccess(db, id, actorId, 'manage');
    if (!permission.collaboration_enabled) throw Object.assign(new Error('请先启用共同编辑并添加接任成员'), { status: 409 });
    const member = Number.isSafeInteger(targetId) && targetId !== Number(actorId)
      && db.prepare(`SELECT m.user_id FROM project_members m JOIN users u ON u.id=m.user_id
        WHERE m.drama_id=? AND m.user_id=? AND u.is_active=1`).get(id, targetId);
    if (!member) throw Object.assign(new Error('请选择当前项目中可用的其他成员'), { status: 400 });
    const at = new Date().toISOString();
    db.prepare('UPDATE dramas SET owner_user_id=?,updated_at=? WHERE id=?').run(targetId, at, id);
    db.prepare('DELETE FROM project_members WHERE drama_id=? AND user_id=?').run(id, targetId);
    db.prepare(`INSERT INTO project_members(drama_id,user_id,role,joined_at) VALUES (?,?,'editor',?)
      ON CONFLICT(drama_id,user_id) DO UPDATE SET role='editor'`).run(id, Number(actorId), at);
    // These links express project management rights, not media or billing authorship.
    db.prepare('UPDATE asset_resource_links SET owner_user_id=?,updated_at=? WHERE drama_id=?').run(targetId, at, id);
    return { owner_user_id: targetId, permissions: access.requireAccess(db, id, actorId), members: access.members(db, id) };
  })();
}

module.exports = { transferOwnership };
