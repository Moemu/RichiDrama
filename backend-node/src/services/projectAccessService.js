'use strict';

function installed(db) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_collaboration'").get();
}

function access(db, dramaId, userId) {
  const drama = db.prepare('SELECT id, owner_user_id FROM dramas WHERE id=? AND deleted_at IS NULL').get(Number(dramaId));
  if (!drama) return null;
  const enabled = installed(db) && !!db.prepare('SELECT 1 FROM project_collaboration WHERE drama_id=?').get(drama.id);
  const role = Number(drama.owner_user_id) === Number(userId) ? 'owner'
    : enabled ? db.prepare('SELECT role FROM project_members WHERE drama_id=? AND user_id=?').get(drama.id, Number(userId))?.role : null;
  if (!role) return null;
  return { drama_id: drama.id, role, collaboration_enabled: enabled, can_edit: role !== 'viewer', can_manage: role === 'owner' };
}

function requireAccess(db, dramaId, userId, action = 'read') {
  const permission = access(db, dramaId, userId);
  if (!permission) throw Object.assign(new Error('项目不存在'), { status: 404 });
  if ((action === 'edit' && !permission.can_edit) || (action === 'manage' && !permission.can_manage)) {
    throw Object.assign(new Error('没有此项目的操作权限'), { status: 403 });
  }
  return permission;
}

function enable(db, dramaId, userId) {
  requireAccess(db, dramaId, userId, 'manage');
  db.prepare('INSERT OR IGNORE INTO project_collaboration (drama_id, enabled_at) VALUES (?,?)').run(Number(dramaId), new Date().toISOString());
}

function members(db, dramaId) {
  const owner = db.prepare("SELECT u.id, u.username, u.display_name, 'owner' role FROM users u JOIN dramas d ON d.owner_user_id=u.id WHERE d.id=?").get(Number(dramaId));
  const others = db.prepare('SELECT u.id, u.username, u.display_name, m.role FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.drama_id=? ORDER BY m.joined_at, u.id').all(Number(dramaId));
  return [owner, ...others].filter(Boolean);
}

function decorate(db, drama, userId) {
  if (!drama) return drama;
  drama.permissions = access(db, drama.id, userId);
  if (!installed(db)) return drama;
  drama.members = members(db, drama.id);
  drama.revision = db.prepare('SELECT revision FROM project_collaboration WHERE drama_id=?').get(drama.id)?.revision || 0;
  for (const episode of drama.episodes || []) {
    episode.assignee_user_id = db.prepare('SELECT user_id FROM project_episode_assignments WHERE episode_id=?').get(episode.id)?.user_id || null;
  }
  return drama;
}

const RESOURCE_QUERIES = {
  dramas: 'SELECT id drama_id, owner_user_id FROM dramas WHERE id=? AND deleted_at IS NULL',
  episodes: 'SELECT drama_id FROM episodes WHERE id=? AND deleted_at IS NULL',
  characters: 'SELECT drama_id FROM characters WHERE id=? AND deleted_at IS NULL',
  scenes: 'SELECT drama_id FROM scenes WHERE id=? AND deleted_at IS NULL',
  props: 'SELECT drama_id FROM props WHERE id=? AND deleted_at IS NULL',
  storyboards: 'SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id=s.episode_id WHERE s.id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL',
  assets: 'SELECT drama_id, owner_user_id FROM assets WHERE id=? AND deleted_at IS NULL',
  images: 'SELECT drama_id, owner_user_id FROM image_generations WHERE id=? AND deleted_at IS NULL',
  videos: 'SELECT drama_id, owner_user_id FROM video_generations WHERE id=? AND deleted_at IS NULL',
  'video-generations': 'SELECT drama_id, owner_user_id FROM video_generations WHERE id=? AND deleted_at IS NULL',
  'video-merges': 'SELECT COALESCE(e.drama_id,v.drama_id) drama_id FROM video_merges v LEFT JOIN episodes e ON e.id=v.episode_id WHERE v.id=? AND v.deleted_at IS NULL',
  'omni-video-jobs': 'SELECT v.drama_id, j.owner_user_id FROM omni_video_jobs j JOIN video_generations v ON v.id=j.video_generation_id WHERE j.id=? AND v.deleted_at IS NULL',
  tasks: 'SELECT p.drama_id, t.owner_user_id FROM async_tasks t JOIN project_task_links p ON p.task_id=t.id WHERE t.id=? AND t.deleted_at IS NULL',
  'tool-runs': 'SELECT drama_id,owner_user_id FROM tool_runs WHERE id=?',
  character_libraries: 'SELECT drama_id FROM character_libraries WHERE id=? AND deleted_at IS NULL',
  scene_libraries: 'SELECT drama_id FROM scene_libraries WHERE id=? AND deleted_at IS NULL',
  prop_libraries: 'SELECT drama_id FROM prop_libraries WHERE id=? AND deleted_at IS NULL',
};

function resource(db, kind, id) {
  kind = { 'character-library': 'character_libraries', 'scene-library': 'scene_libraries', 'prop-library': 'prop_libraries' }[kind] || kind;
  if (kind === 'tasks' && !installed(db)) return null;
  const sql = RESOURCE_QUERIES[kind];
  const row = sql ? db.prepare(sql).get(id) : null;
  if (row?.drama_id && ['images', 'videos', 'video-generations', 'omni-video-jobs'].includes(kind)
    && !db.prepare('SELECT 1 FROM dramas WHERE id=? AND deleted_at IS NULL').get(row.drama_id)) return { ...row, drama_id: null };
  return row;
}

function projectIdsSql(db, userId, action = 'read') {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return 'SELECT id FROM dramas WHERE 0';
  const member = installed(db) ? ` OR id IN (SELECT m.drama_id FROM project_members m JOIN project_collaboration c ON c.drama_id=m.drama_id WHERE m.user_id=${id}${action === 'edit' ? " AND m.role='editor'" : ''})` : '';
  return `SELECT id FROM dramas WHERE deleted_at IS NULL AND (owner_user_id=${id}${member})`;
}

function assetPredicate(db, userId, action = 'read') {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return '0';
  return `((drama_id IS NULL AND owner_user_id=${id}) OR drama_id IN (${projectIdsSql(db, id, action)}))`;
}

function generationPredicate(db, userId, table) {
  if (!['image_generations', 'video_generations'].includes(table)) throw new Error('Invalid generation table');
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return '0';
  const shared = installed(db) ? ` OR drama_id IN (${projectIdsSql(db, id)})` : '';
  const enabled = installed(db) ? ` AND NOT EXISTS (SELECT 1 FROM project_collaboration c JOIN dramas d ON d.id=c.drama_id WHERE c.drama_id=${table}.drama_id AND d.deleted_at IS NULL)` : '';
  return `((owner_user_id=${id}${enabled})${shared})`;
}

module.exports = { installed, access, requireAccess, enable, members, decorate, resource, projectIdsSql, assetPredicate, generationPredicate };
