function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function validateFields(ep) {
  for (const field of ['title', 'script_content', 'description']) {
    if (ep[field] != null && typeof ep[field] !== 'string') fail(400, `分集 ${field} 必须为文字`);
  }
  if (ep.duration != null && (!Number.isFinite(ep.duration) || ep.duration < 0)) fail(400, '分集时长不正确');
}

// Explicit operations never infer deletion from an omitted episode.
function editEpisodes(db, dramaId, req) {
  const { mode, episodes } = req;
  if (!['append', 'update', 'delete'].includes(mode)) fail(400, '不支持的分集保存方式');
  if (!Array.isArray(episodes) || (mode !== 'append' && episodes.length !== 1)) {
    fail(400, '更新或删除必须指定一集');
  }
  return db.transaction(() => {
    const now = new Date().toISOString();
    const saved = [];
    if (mode === 'append') {
      // Include deleted numbers: new imports must not reuse historical identities.
      let number = db.prepare('SELECT COALESCE(MAX(episode_number), 0) AS n FROM episodes WHERE drama_id=?').get(dramaId).n;
      const insert = db.prepare(`INSERT INTO episodes
        (drama_id, episode_number, title, script_content, description, duration, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`);
      for (const ep of episodes) {
        if (!ep || typeof ep !== 'object' || Array.isArray(ep)) fail(400, '分集格式不正确');
        validateFields(ep);
        number++;
        const result = insert.run(dramaId, number, ep.title || `第${number}集`, ep.script_content ?? '',
          ep.description ?? null, ep.duration ?? 0, now, now);
        saved.push({ id: Number(result.lastInsertRowid), episode_number: number });
      }
    } else {
      const ep = episodes[0];
      if (!ep || !Number.isSafeInteger(ep.id)) {
        fail(400, '缺少分集 ID，请刷新页面');
      }
      validateFields(ep);
      const existing = db.prepare('SELECT * FROM episodes WHERE id=? AND drama_id=? AND deleted_at IS NULL').get(ep.id, dramaId);
      if (!existing) fail(409, '分集已删除或不存在，请刷新页面');
      if (mode === 'delete') {
        if (!Object.hasOwn(ep, 'expected_updated_at')) fail(400, '缺少分集版本，请刷新页面');
        if (existing.updated_at !== ep.expected_updated_at) fail(409, '分集已被修改，请刷新后重试');
      } else {
        if (!Object.hasOwn(ep, 'expected_title') || !Object.hasOwn(ep, 'expected_script_content')) {
          fail(400, '缺少原剧本，请刷新页面');
        }
        // Settings and media jobs also update the episode timestamp; compare the edited fields.
        if (existing.title !== ep.expected_title || existing.script_content !== ep.expected_script_content) {
          fail(409, '剧本已被修改，请刷新后重试');
        }
      }
      // Ensure two writes in the same millisecond still have different versions.
      const updatedAt = new Date(Math.max(Date.now(), (Date.parse(existing.updated_at) || 0) + 1)).toISOString();
      if (mode === 'delete') {
        db.prepare('UPDATE episodes SET deleted_at=?, updated_at=? WHERE id=?').run(now, updatedAt, ep.id);
      } else {
        db.prepare('UPDATE episodes SET title=?, script_content=?, updated_at=? WHERE id=?')
          .run(ep.title ?? existing.title, ep.script_content ?? existing.script_content, updatedAt, ep.id);
      }
      saved.push({ id: ep.id, episode_number: existing.episode_number });
    }
    if (saved.length) db.prepare('UPDATE dramas SET updated_at=? WHERE id=?').run(now, dramaId);
    return { episodes: saved };
  }).immediate();
}

module.exports = { editEpisodes };
