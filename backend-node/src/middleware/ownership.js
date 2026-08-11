const response = require('../response');

const SQL_BY_KIND = {
  dramas: 'SELECT owner_user_id FROM dramas WHERE id = ? AND deleted_at IS NULL',
  characters: 'SELECT d.owner_user_id FROM characters c JOIN dramas d ON d.id = c.drama_id WHERE c.id = ? AND c.deleted_at IS NULL',
  props: 'SELECT d.owner_user_id FROM props p JOIN dramas d ON d.id = p.drama_id WHERE p.id = ? AND p.deleted_at IS NULL',
  scenes: 'SELECT d.owner_user_id FROM scenes s JOIN dramas d ON d.id = s.drama_id WHERE s.id = ? AND s.deleted_at IS NULL',
  storyboards: 'SELECT d.owner_user_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id JOIN dramas d ON d.id = e.drama_id WHERE s.id = ? AND s.deleted_at IS NULL',
  episodes: 'SELECT d.owner_user_id FROM episodes e JOIN dramas d ON d.id = e.drama_id WHERE e.id = ? AND e.deleted_at IS NULL',
  images: 'SELECT owner_user_id FROM image_generations WHERE id = ? AND deleted_at IS NULL',
  videos: 'SELECT owner_user_id FROM video_generations WHERE id = ? AND deleted_at IS NULL',
  'video-generations': 'SELECT owner_user_id FROM video_generations WHERE id = ? AND deleted_at IS NULL',
  tasks: 'SELECT owner_user_id FROM async_tasks WHERE id = ? AND deleted_at IS NULL',
  // Assets inside a project belong to that project's owner. Legacy rows can
  // retain a stale direct owner_user_id, which must not override the project
  // relationship and make a visible material impossible to edit or delete.
  assets: 'SELECT COALESCE(d.owner_user_id, a.owner_user_id) AS owner_user_id FROM assets a LEFT JOIN dramas d ON d.id = a.drama_id WHERE a.id = ? AND a.deleted_at IS NULL',
  'omni-video-sequences': 'SELECT owner_user_id FROM omni_video_sequences WHERE id = ?',
  'omni-video-jobs': 'SELECT owner_user_id FROM omni_video_jobs WHERE id = ?',
  'tool-runs': 'SELECT owner_user_id FROM tool_runs WHERE id = ?',
};

function ownershipGuard(db) {
  return (req, res, next) => {
    // 管理员只拥有后台管理权限，不自动获得其他用户创作资源的使用权。
    // 这样既保证项目隔离，也避免管理员能够提交一个子账号资源导致
    // 生成任务归属、扣费账号与素材归属不一致。
    // Collection routes carry a parent reference in the body/query. Check it before
    // handlers can create, generate, or enumerate data under another user's project.
    const refs = { ...(req.query || {}), ...(req.body || {}) };
    const parentChecks = [
      ['drama_id', 'SELECT owner_user_id FROM dramas WHERE id = ? AND deleted_at IS NULL'],
      ['episode_id', 'SELECT d.owner_user_id FROM episodes e JOIN dramas d ON d.id = e.drama_id WHERE e.id = ? AND e.deleted_at IS NULL'],
      ['storyboard_id', 'SELECT d.owner_user_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id JOIN dramas d ON d.id = e.drama_id WHERE s.id = ? AND s.deleted_at IS NULL'],
      ['scene_id', 'SELECT d.owner_user_id FROM scenes s JOIN dramas d ON d.id = s.drama_id WHERE s.id = ? AND s.deleted_at IS NULL'],
      ['character_id', 'SELECT d.owner_user_id FROM characters c JOIN dramas d ON d.id = c.drama_id WHERE c.id = ? AND c.deleted_at IS NULL'],
      ['prop_id', 'SELECT d.owner_user_id FROM props p JOIN dramas d ON d.id = p.drama_id WHERE p.id = ? AND p.deleted_at IS NULL'],
      ['sequence_id', 'SELECT owner_user_id FROM omni_video_sequences WHERE id = ? AND deleted_at IS NULL'],
    ];
    try {
      for (const [key, sql] of parentChecks) {
        const value = refs[key];
        if (value == null || value === '' || Number(value) <= 0) continue;
        const row = db.prepare(sql).get(Number(value));
        if (!row || Number(row.owner_user_id) !== Number(req.auth.id)) return response.notFound(res, '资源不存在');
      }
    } catch (err) { return next(err); }
    const parts = req.path.split('/').filter(Boolean);
    const kind = parts[0]; const id = parts[1];
    if (!SQL_BY_KIND[kind] || !id || !/^\d+$/.test(id) && kind !== 'tasks') return next();
    try {
      const row = db.prepare(SQL_BY_KIND[kind]).get(id);
      if (!row || Number(row.owner_user_id) !== Number(req.auth.id)) return response.notFound(res, '资源不存在');
      next();
    } catch (err) { return next(err); }
  };
}

module.exports = { ownershipGuard };
