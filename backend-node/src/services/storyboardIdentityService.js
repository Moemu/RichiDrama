const { v4: uuidv4 } = require('uuid');

function tableColumns(db, table) {
  try { return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)); } catch (_) { return new Set(); }
}

function supportsIdentity(db) {
  const columns = tableColumns(db, 'storyboards');
  return columns.has('storyboard_uid') && columns.has('position');
}

function orderSql(db, prefix = '') {
  const columns = tableColumns(db, 'storyboards');
  const p = prefix ? `${prefix}.` : '';
  if (columns.has('position')) return `COALESCE(${p}position, ${p}sort_order, ${p}storyboard_number - 1, ${p}id), ${p}id`;
  if (columns.has('sort_order')) return `${p}sort_order, ${p}storyboard_number, ${p}id`;
  return `${p}storyboard_number, ${p}id`;
}

function ensureIdentity(db, storyboardId, position = null) {
  if (!supportsIdentity(db)) return null;
  const row = db.prepare('SELECT storyboard_uid, position FROM storyboards WHERE id = ?').get(Number(storyboardId));
  if (!row) return null;
  const uid = String(row.storyboard_uid || '').trim() || uuidv4();
  const nextPosition = position == null ? row.position : Number(position);
  db.prepare('UPDATE storyboards SET storyboard_uid = ?, position = COALESCE(?, position) WHERE id = ?')
    .run(uid, Number.isFinite(nextPosition) ? nextPosition : null, Number(storyboardId));
  return uid;
}

function historyStoryboardIds(db, storyboardId) {
  const id = Number(storyboardId);
  if (!Number.isFinite(id) || id <= 0) return [];
  if (!supportsIdentity(db)) return [id];
  const row = db.prepare('SELECT storyboard_uid FROM storyboards WHERE id = ?').get(id);
  const uid = String(row?.storyboard_uid || '').trim();
  if (!uid) return [id];
  return db.prepare('SELECT id FROM storyboards WHERE storyboard_uid = ? ORDER BY id DESC').all(uid).map((item) => Number(item.id));
}

function orderedActiveRows(db, episodeId) {
  const columns = tableColumns(db, 'storyboards');
  const order = columns.has('position')
    ? 'COALESCE(position, sort_order, storyboard_number - 1, id) ASC, id ASC'
    : columns.has('sort_order')
      ? 'sort_order ASC, storyboard_number ASC, id ASC'
      : 'storyboard_number ASC, id ASC';
  return db.prepare(`SELECT id FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY ${order}`)
    .all(Number(episodeId)).map((row) => Number(row.id));
}

function reindexEpisode(db, episodeId, orderedIds = null, now = new Date().toISOString()) {
  const ids = Array.isArray(orderedIds) ? orderedIds.map(Number).filter(Number.isFinite) : orderedActiveRows(db, episodeId);
  const columns = tableColumns(db, 'storyboards');
  const hasPosition = columns.has('position');
  const hasSortOrder = columns.has('sort_order');
  const assignments = [];
  if (hasPosition) assignments.push('position = ?');
  if (hasSortOrder) assignments.push('sort_order = ?');
  assignments.push('storyboard_number = ?', 'updated_at = ?');
  const update = db.prepare(`UPDATE storyboards SET ${assignments.join(', ')} WHERE id = ? AND episode_id = ? AND deleted_at IS NULL`);
  ids.forEach((id, index) => {
    const values = [];
    if (hasPosition) values.push(index);
    if (hasSortOrder) values.push(index);
    values.push(index + 1, now, id, Number(episodeId));
    update.run(...values);
    ensureIdentity(db, id, index);
  });
  return ids;
}

module.exports = { ensureIdentity, historyStoryboardIds, orderSql, orderedActiveRows, reindexEpisode, supportsIdentity };
