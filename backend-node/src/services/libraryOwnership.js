// Library rows are project scoped when drama_id is present.  Rows without a
// drama are shared material and can be read by every authenticated user, but
// direct edits are reserved for console administrators.
const TABLES = new Set(['character_libraries', 'scene_libraries', 'prop_libraries']);

function actorInfo(actor) {
  if (actor == null) return null;
  if (typeof actor === 'object') {
    return {
      id: Number(actor.id),
      role: actor.role || null,
      console_access: actor.console_access === true,
    };
  }
  return { id: Number(actor), role: null, console_access: false };
}

function actorId(actor) {
  const info = actorInfo(actor);
  return info ? info.id : null;
}

function activeDramaPredicate(alias = 'd') {
  return ` AND ${alias}.deleted_at IS NULL`;
}

function itemRow(db, table, id) {
  if (!TABLES.has(table)) throw new Error(`Unsupported library table: ${table}`);
  return db.prepare(`SELECT l.*, d.owner_user_id AS drama_owner_user_id
    FROM ${table} l
    LEFT JOIN dramas d ON d.id = l.drama_id${activeDramaPredicate('d')}
    WHERE l.id = ? AND l.deleted_at IS NULL`).get(Number(id));
}

function canRead(db, row, actor) {
  if (!row) return false;
  const info = actorInfo(actor);
  if (!info) return true;
  if (row.drama_id == null) return true;
  return !!require('./projectAccessService').access(db, row.drama_id, info.id);
}

function canWrite(db, row, actor) {
  if (!row) return false;
  const info = actorInfo(actor);
  if (!info) return true;
  if (row.drama_id == null) return info.role === 'admin' && info.console_access;
  return !!require('./projectAccessService').access(db, row.drama_id, info.id)?.can_edit;
}

function canCreate(db, dramaId, actor) {
  const info = actorInfo(actor);
  if (!info) return true;
  if (dramaId == null || dramaId === '') return info.role === 'admin' && info.console_access;
  return !!require('./projectAccessService').access(db, dramaId, info.id)?.can_edit;
}

function assertCreate(db, dramaId, actor) {
  if (!canCreate(db, dramaId, actor)) {
    const error = new Error('无权限写入素材库');
    error.code = 'FORBIDDEN';
    throw error;
  }
}

function read(db, table, id, actor) {
  const row = itemRow(db, table, id);
  return canRead(db, row, actor) ? row : null;
}

function writable(db, table, id, actor) {
  const row = itemRow(db, table, id);
  return canWrite(db, row, actor) ? row : null;
}

module.exports = { activeDramaPredicate, actorId, assertCreate, read, writable };
