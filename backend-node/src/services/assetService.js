function list(db, query) {
  let sql = 'FROM assets WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(query.drama_id);
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
  return {
    id: r.id,
    drama_id: r.drama_id,
    name: r.name,
    type: r.type,
    category: r.category,
    url: r.url,
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
  };
}

function getById(db, id) {
  const r = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
  return r ? rowToItem(r) : null;
}

function findByChecksum(db, checksum, dramaId = null) {
  if (!checksum) return null;
  const row = db.prepare(`SELECT * FROM assets
    WHERE deleted_at IS NULL AND checksum = ?
      AND ((drama_id IS NULL AND ? IS NULL) OR drama_id = ?)
    ORDER BY id DESC LIMIT 1`).get(checksum, dramaId, dramaId);
  return row ? rowToItem(row) : null;
}

function create(db, log, req) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO assets (drama_id, name, type, category, url, local_path, file_size, mime_type, width, height, duration, image_gen_id, video_gen_id, source_type, parent_asset_id, thumbnail_local_path, metadata_json, tags_json, checksum, processing_status, error_msg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.drama_id ?? null,
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

function update(db, log, id, req) {
  const row = db.prepare('SELECT * FROM assets WHERE id = ? AND deleted_at IS NULL').get(Number(id));
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

function deleteById(db, log, id) {
  const now = new Date().toISOString();
  const result = db.prepare('UPDATE assets SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, Number(id));
  return result.changes > 0;
}

function importFromImage(db, log, imageGenId) {
  const img = db.prepare('SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL').get(Number(imageGenId));
  if (!img) return null;
  return create(db, log, {
    drama_id: img.drama_id,
    name: `图片 ${imageGenId}`,
    type: 'image',
    url: img.image_url || '',
    local_path: img.local_path,
    image_gen_id: img.id,
  });
}

function importFromVideo(db, log, videoGenId) {
  const vid = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!vid) return null;
  return create(db, log, {
    drama_id: vid.drama_id,
    name: `视频 ${videoGenId}`,
    type: 'video',
    url: vid.video_url || '',
    local_path: vid.local_path,
    video_gen_id: vid.id,
  });
}

module.exports = {
  list,
  getById,
  findByChecksum,
  create,
  update,
  deleteById,
  importFromImage,
  importFromVideo,
};

function safeParse(value) { try { return value ? JSON.parse(value) : null; } catch (_) { return null; } }
function stringifyJson(value) { return value == null ? null : (typeof value === 'string' ? value : JSON.stringify(value)); }
