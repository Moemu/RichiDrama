function list(db, query) {
  let sql = 'FROM assets WHERE deleted_at IS NULL';
  const params = [];
  if (query.owner_user_id) {
    sql += ' AND (owner_user_id = ? OR drama_id IN (SELECT id FROM dramas WHERE owner_user_id = ? AND deleted_at IS NULL))';
    params.push(Number(query.owner_user_id), Number(query.owner_user_id));
  }
  const scope = String(query.scope || '').toLowerCase();
  if (scope === 'project') {
    const dramaId = Number(query.drama_id);
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('项目素材范围必须提供有效 drama_id');
    sql += ' AND drama_id = ?';
    params.push(dramaId);
  } else if (scope === 'global') {
    // Global assets are private to their owner. Never broaden this to all
    // drama_id IS NULL rows, otherwise users can see each other's material.
    sql += ' AND drama_id IS NULL AND owner_user_id = ?';
    params.push(Number(query.owner_user_id));
  } else if (query.drama_id) {
    // Compatibility for existing callers: an explicit project ID remains a
    // strict project filter. New UI callers must pass scope explicitly.
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.type) {
    sql += ' AND type = ?';
    params.push(query.type);
  }
  if (query.keyword) {
    sql += ' AND (name LIKE ? OR tags_json LIKE ?)';
    const keyword = `%${String(query.keyword).trim()}%`;
    params.push(keyword, keyword);
  }
  if (String(query.favorite || '') === '1' || String(query.favorite || '').toLowerCase() === 'true') {
    sql += ' AND is_favorite = 1';
  }
  const countRow = db.prepare('SELECT COUNT(*) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare('SELECT * ' + sql + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, pageSize, offset);
  return { items: rows.map(rowToItem), total, page, pageSize };
}

function rowToItem(r) {
  // Supplier URLs (especially TOS signed URLs) are deliberately short-lived.
  // A locally archived file is the durable application resource and must win
  // even if an older record still retains the original supplier URL.
  const local = r.local_path && String(r.local_path).trim();
  const publicUrl = local ? `/static/${local.replace(/^\/+/, '')}` : r.url;
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    category: r.category,
    url: publicUrl,
    local_path: r.local_path,
    file_size: r.file_size,
    mime_type: r.mime_type,
    width: r.width,
    height: r.height,
    duration: r.duration,
    source_type: r.source_type || 'upload',
    parent_asset_id: r.parent_asset_id,
    thumbnail_local_path: r.thumbnail_local_path,
    metadata: safeParse(r.metadata_json),
    tags: safeParse(r.tags_json),
    is_favorite: !!r.is_favorite,
    processing_status: r.processing_status || 'ready',
    error_msg: r.error_msg,
    seedance2_asset: safeParse(r.seedance2_asset),
    requires_sd2_identity: !!r.requires_sd2_identity,
    image_gen_id: r.image_gen_id,
    video_gen_id: r.video_gen_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at || null,
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

// Assets may belong directly to a user or to one of that user's projects.
// Keep this lookup aligned with list() so numeric IDs cannot bypass scope.
function getByIdForOwner(db, id, ownerUserId) {
  const r = db.prepare(`SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL
    AND (owner_user_id = ? OR drama_id IN (
      SELECT id FROM dramas WHERE owner_user_id = ? AND deleted_at IS NULL
    ))`).get(Number(id), Number(ownerUserId), Number(ownerUserId));
  return r ? rowToItem(r) : null;
}

function getLineage(db, id, ownerUserId = null) {
  const ownedClause = ownerUserId == null ? '' : ` AND (owner_user_id = ${Number(ownerUserId)} OR drama_id IN (SELECT id FROM dramas WHERE owner_user_id = ${Number(ownerUserId)} AND deleted_at IS NULL))`;
  // Unscoped service callers are retained for maintenance/history tools and
  // may inspect tombstones. Authenticated HTTP callers always provide owner
  // scope and therefore cannot use lineage to discover another user's data.
  const visibleClause = ownerUserId == null ? '' : ' AND deleted_at IS NULL';
  const current = db.prepare(`SELECT * FROM assets WHERE id = ?${visibleClause}${ownedClause}`).get(Number(id));
  if (!current) return null;
  const visited = new Set([Number(current.id)]);
  const ancestors = [];
  let parentId = current.parent_asset_id;
  while (parentId && !visited.has(Number(parentId)) && ancestors.length < 20) {
    const parent = db.prepare(`SELECT * FROM assets WHERE id = ?${visibleClause}${ownedClause}`).get(Number(parentId));
    if (!parent) break;
    visited.add(Number(parent.id));
    ancestors.unshift(rowToItem(parent));
    parentId = parent.parent_asset_id;
  }

  const descendants = [];
  const queue = [Number(current.id)];
  while (queue.length && descendants.length < 100) {
    const sourceId = queue.shift();
    const children = db.prepare(`SELECT * FROM assets WHERE parent_asset_id = ?${visibleClause}${ownedClause} ORDER BY created_at ASC, id ASC`).all(sourceId);
    for (const child of children) {
      if (visited.has(Number(child.id))) continue;
      visited.add(Number(child.id));
      descendants.push(rowToItem(child));
      queue.push(Number(child.id));
      if (descendants.length >= 100) break;
    }
  }
  return { current: rowToItem(current), ancestors, descendants };
}

function findByChecksum(db, checksum, dramaId = null, ownerUserId = null) {
  if (!checksum) return null;
  // Project material is shared only within its project. Personal/global media
  // is shared only within its owner account: otherwise a duplicate upload can
  // return an asset that the uploader cannot list, edit, or delete.
  const row = dramaId
    ? db.prepare(`SELECT * FROM assets WHERE deleted_at IS NULL AND checksum = ? AND drama_id = ? ORDER BY id DESC LIMIT 1`)
      .get(checksum, Number(dramaId))
    : ownerUserId != null
      ? db.prepare(`SELECT * FROM assets WHERE deleted_at IS NULL AND checksum = ? AND drama_id IS NULL AND owner_user_id = ? ORDER BY id DESC LIMIT 1`)
        .get(checksum, Number(ownerUserId))
      // Kept for internal callers that have no authenticated scope.
      : db.prepare(`SELECT * FROM assets WHERE deleted_at IS NULL AND checksum = ? AND drama_id IS NULL ORDER BY id DESC LIMIT 1`)
        .get(checksum);
  return row ? rowToItem(row) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO assets (drama_id, owner_user_id, name, type, category, url, local_path, file_size, mime_type, width, height, duration, image_gen_id, video_gen_id, source_type, parent_asset_id, thumbnail_local_path, metadata_json, tags_json, checksum, processing_status, error_msg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.drama_id ?? null,
    req.owner_user_id ?? null,
    req.name || '未命名',
    req.type || 'image',
    req.category ?? null,
    req.url || '',
    req.local_path ?? null,
    req.file_size ?? null,
    req.mime_type ?? null,
    req.width ?? null,
    req.height ?? null,
    req.duration ?? null,
    req.image_gen_id ?? null,
    req.video_gen_id ?? null,
    req.source_type || 'upload', req.parent_asset_id ?? null, req.thumbnail_local_path ?? null,
    stringifyJson(req.metadata), stringifyJson(req.tags), req.checksum ?? null,
    req.processing_status || 'ready', req.error_msg ?? null,
    now,
    now
  );
  return getById(db, info.lastInsertRowid);
}

function update(db, log, id, req, ownerUserId = null) {
  const row = ownerUserId == null
    ? db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id))
    : db.prepare(`SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL
      AND (owner_user_id = ? OR drama_id IN (
        SELECT id FROM dramas WHERE owner_user_id = ? AND deleted_at IS NULL
      ))`).get(Number(id), Number(ownerUserId), Number(ownerUserId));
  if (!row) return null;
  const updates = [];
  const params = [];
  ['name', 'description', 'type', 'category', 'url', 'local_path', 'thumbnail_url', 'thumbnail_local_path', 'file_size', 'mime_type', 'width', 'height', 'duration', 'is_favorite', 'source_type', 'parent_asset_id', 'checksum', 'processing_status', 'error_msg', 'requires_sd2_identity'].forEach((key) => {
    if (req[key] !== undefined) {
      updates.push(key + ' = ?');
      // better-sqlite3 does not accept booleans as bound values. Keep the API
      // boolean-shaped while storing the SQLite INTEGER flag explicitly.
      params.push(key === 'requires_sd2_identity' ? (req[key] ? 1 : 0) : req[key]);
    }
  });
  [['metadata', 'metadata_json'], ['tags', 'tags_json']].forEach(([input, column]) => {
    if (req[input] !== undefined) { updates.push(column + ' = ?'); params.push(stringifyJson(req[input])); }
  });
  if (updates.length === 0) return getById(db, id);
  require('./assetSd2Service').markStale(db, row, req);
  params.push(new Date().toISOString(), id);
  db.prepare('UPDATE assets SET ' + updates.join(', ') + ', updated_at = ? WHERE id = ?').run(...params);
  return getById(db, id);
}

function deleteById(db, log, id, ownerUserId = null) {
  assertNotReferencedByEditableShot(db, id, ownerUserId);
  const now = new Date().toISOString();
  const sql = ownerUserId == null
    ? 'UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    : `UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL
      AND (owner_user_id = ? OR drama_id IN (
        SELECT id FROM dramas WHERE owner_user_id = ? AND deleted_at IS NULL
      ))`;
  const result = ownerUserId == null
    ? db.prepare(sql).run(now, Number(id))
    : db.prepare(sql).run(now, Number(id), Number(ownerUserId), Number(ownerUserId));
  return result.changes > 0;
}

// Generation history deliberately keeps snapshots, but an asset selected in
// an editable shot is a live dependency.  Allowing its deletion made the next
// storyboard save silently drop that selection.
function assertNotReferencedByEditableShot(db, assetId, ownerUserId = null) {
  const target = Number(assetId);
  if (!Number.isInteger(target) || target <= 0) return;
  const refs = [];
  const contains = (raw) => { try { return JSON.parse(raw || '[]').map(Number).includes(target); } catch (_) { return false; } };
  try {
    const owned = ownerUserId == null ? '' : ' AND e.drama_id IN (SELECT id FROM dramas WHERE owner_user_id=? AND deleted_at IS NULL)';
    const args = ownerUserId == null ? [] : [Number(ownerUserId)];
    for (const row of db.prepare(`SELECT s.id, s.storyboard_number, s.omni_asset_ids, s.omni_first_frame_asset_id, s.omni_last_frame_asset_id FROM storyboards s JOIN episodes e ON e.id=s.episode_id WHERE s.deleted_at IS NULL${owned}`).all(...args)) {
      if (contains(row.omni_asset_ids) || Number(row.omni_first_frame_asset_id) === target || Number(row.omni_last_frame_asset_id) === target) refs.push(`分镜 #${row.storyboard_number || row.id}`);
    }
  } catch (_) {}
  try {
    const owned = ownerUserId == null ? '' : ' AND q.owner_user_id=?';
    const args = ownerUserId == null ? [] : [Number(ownerUserId)];
    for (const row of db.prepare(`SELECT s.id, s.title, s.assets_json FROM omni_video_sequence_shots s JOIN omni_video_sequences q ON q.id=s.sequence_id WHERE s.deleted_at IS NULL AND q.deleted_at IS NULL${owned}`).all(...args)) {
      if (contains(row.assets_json)) refs.push(`自由创作镜头「${row.title || row.id}」`);
    }
  } catch (_) {}
  if (refs.length) throw new Error(`素材正在被${refs.slice(0, 3).join('、')}引用；请先在镜头中替换或移除引用后再删除`);
}

// Logical deletion is intentional: an asset can be referenced by existing
// generation history. Physical local/OSS cleanup is handled separately by the
// retention job, after the record is no longer recoverable from the product.
function deleteMany(db, log, { ids, owner_user_id, scope, drama_id, type, keyword, favorite } = {}) {
  const ownerId = Number(owner_user_id);
  if (!Number.isInteger(ownerId) || ownerId <= 0) throw new Error('缺少素材所有者');
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  let where = `deleted_at IS NULL AND (owner_user_id = ? OR drama_id IN (
    SELECT id FROM dramas WHERE owner_user_id = ? AND deleted_at IS NULL
  ))`;
  const params = [ownerId, ownerId];
  // The HTTP route requires an explicit scope. Keep the old service-level
  // default for trusted internal callers/tests that historically meant
  // "everything the owner can manage".
  if (scope === 'global') where += ' AND drama_id IS NULL';
  else if (scope === 'project') { where += ' AND drama_id = ?'; params.push(Number(drama_id)); }
  else if (scope && scope !== 'all') throw new Error('批量删除范围无效');
  if (normalizedIds.length) {
    where += ` AND id IN (${normalizedIds.map(() => '?').join(', ')})`;
    params.push(...normalizedIds);
  }
  if (type) { where += ' AND type = ?'; params.push(String(type)); }
  if (keyword) {
    where += ' AND (name LIKE ? OR tags_json LIKE ?)';
    const value = `%${String(keyword).trim()}%`;
    params.push(value, value);
  }
  if (String(favorite || '') === '1' || String(favorite || '').toLowerCase() === 'true') where += ' AND is_favorite = 1';
  let candidates;
  try { candidates = db.prepare(`SELECT id, source_type FROM assets WHERE ${where}`).all(...params); }
  catch (_) { candidates = db.prepare(`SELECT id FROM assets WHERE ${where}`).all(...params); }
  candidates.forEach((row) => assertNotReferencedByEditableShot(db, row.id, ownerId));
  const at = new Date().toISOString();
  const remove = db.transaction(() => {
    let count = 0;
    for (const row of candidates) {
      if (row.source_type === 'project_resource') {
        if (require('./assetMappingService').detachProjectResource(db, row.id, ownerId)) count += 1;
      } else {
        count += db.prepare('UPDATE assets SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(at, at, row.id).changes;
      }
    }
    return count;
  });
  const count = remove();
  log.info('Assets soft deleted in bulk', { owner_user_id: ownerId, scope, drama_id: drama_id || null, count, all_matching: normalizedIds.length === 0 });
  return count;
}

function importFromImage(db, log, imageGenId, ownerUserId = null) {
  const img = ownerUserId == null
    ? db.prepare('SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(Number(imageGenId))
    : db.prepare('SELECT * FROM image_generations WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(imageGenId), Number(ownerUserId));
  if (!img) return null;
  return create(db, log, {
    drama_id: img.drama_id,
    owner_user_id: img.owner_user_id,
    name: `图片 ${imageGenId}`,
    type: 'image',
    url: img.image_url || '',
    local_path: img.local_path,
    image_gen_id: img.id,
  });
}

function importFromVideo(db, log, videoGenId, ownerUserId = null) {
  const vid = ownerUserId == null
    ? db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId))
    : db.prepare('SELECT * FROM video_generations WHERE id = ? AND owner_user_id = ? AND deleted_at IS NULL').get(Number(videoGenId), Number(ownerUserId));
  // Do not convert a provider's expiring signed URL into a persistent asset.
  if (!vid || vid.status !== 'completed' || !String(vid.local_path || '').trim()) return null;
  return create(db, log, {
    drama_id: vid.drama_id,
    owner_user_id: vid.owner_user_id,
    name: `视频 ${videoGenId}`,
    type: 'video',
    url: `/static/${String(vid.local_path).replace(/^\/+/, '')}`,
    local_path: vid.local_path,
    video_gen_id: vid.id,
  });
}

module.exports = {
  list,
  getById,
  getByIdForOwner,
  getLineage,
  findByChecksum,
  create,
  update,
  deleteById,
  deleteMany,
  assertNotReferencedByEditableShot,
  importFromImage,
  importFromVideo,
};

function safeParse(value) { try { return value ? JSON.parse(value) : null; } catch (_) { return null; } }
function stringifyJson(value) { return value == null ? null : (typeof value === 'string' ? value : JSON.stringify(value)); }
