const assetService = require('./assetService');

const ENTITY_CONFIG = {
  character: { table: 'characters', name: (row) => row.name || `角色 ${row.id}` },
  scene: { table: 'scenes', name: (row) => [row.location, row.time].filter(Boolean).join(' · ') || `场景 ${row.id}` },
  prop: { table: 'props', name: (row) => row.name || `道具 ${row.id}` },
};

function findMappedAsset(db, dramaId, entityType, entityId) {
  try {
    const link = db.prepare(`SELECT l.*, a.deleted_at AS asset_deleted_at
      FROM asset_resource_links l LEFT JOIN assets a ON a.id = l.asset_id
      WHERE l.drama_id = ? AND l.resource_type = ? AND l.resource_id = ? AND l.role = 'primary_image'`)
      .get(Number(dramaId), entityType, Number(entityId));
    if (link) {
      if (link.status === 'detached') return { id: link.asset_id, deleted_at: link.detached_at || link.updated_at, link_id: link.id };
      if (link.asset_id) return db.prepare('SELECT *, ? AS link_id FROM assets WHERE id = ?').get(link.id, link.asset_id) || null;
    }
  } catch (_) {}
  try {
    // A soft-deleted mapping is a durable user decision. Prefer it over any
    // legacy duplicate so neither list-sync nor storyboard selection can
    // silently recreate the resource after the user removed it.
    return db.prepare("SELECT * FROM assets WHERE drama_id = ? AND source_type = 'project_resource' AND json_extract(metadata_json, '$.resource_type') = ? AND json_extract(metadata_json, '$.resource_id') = ? ORDER BY (deleted_at IS NOT NULL) DESC, id DESC LIMIT 1")
      .get(Number(dramaId), entityType, Number(entityId));
  } catch (_) {
    return db.prepare("SELECT * FROM assets WHERE drama_id = ? AND source_type = 'project_resource' AND metadata_json LIKE ? AND metadata_json LIKE ? ORDER BY (deleted_at IS NOT NULL) DESC, id DESC LIMIT 1")
      .get(Number(dramaId), '%"resource_type":"' + entityType + '"%', '%"resource_id":' + Number(entityId) + '%');
  }
}

function parseCertification(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
}

function ensureAsset(db, log, entityType, entity) {
  const config = ENTITY_CONFIG[entityType];
  if (!config || !entity?.id || !entity?.drama_id) return null;
  const localPath = entity.local_path || null;
  const url = entity.image_url || null;
  const existing = findMappedAsset(db, entity.drama_id, entityType, entity.id);
  // A user-deleted mapping is a deliberate detach. Do not recreate it during
  // a routine list/sync; otherwise the media library appears impossible to
  // delete and the same stale asset ID keeps returning.
  if (existing?.deleted_at) return null;
  if (!localPath && !url) {
    // A missing project-resource image must not delete the mapped asset: old
    // storyboards still reference its stable ID and may need it for replay,
    // rebinding, or manual cleanup.
    return existing ? assetService.getById(db, existing.id) : null;
  }
  const payload = { drama_id: Number(entity.drama_id), name: config.name(entity), type: 'image', url: url || '', local_path: localPath, source_type: 'project_resource', processing_status: 'ready', metadata: { resource_type: entityType, resource_id: Number(entity.id) } };
  const mapped = existing ? assetService.update(db, log, existing.id, payload) : assetService.create(db, log, payload);
  try {
    const owner = db.prepare('SELECT owner_user_id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(Number(entity.drama_id));
    if (owner?.owner_user_id) db.prepare(`INSERT INTO asset_resource_links
      (owner_user_id, drama_id, resource_type, resource_id, role, asset_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'primary_image', ?, 'active', ?, ?)
      ON CONFLICT(drama_id, resource_type, resource_id, role) DO UPDATE SET
        asset_id=excluded.asset_id, status='active', detached_at=NULL, updated_at=excluded.updated_at`)
      .run(owner.owner_user_id, Number(entity.drama_id), entityType, Number(entity.id), Number(mapped.id), new Date().toISOString(), new Date().toISOString());
  } catch (_) {}
  // Never let an empty legacy project-resource state erase a valid material
  // certification. When a resource does have a state, it remains authoritative
  // because its certification routes update that canonical resource first.
  try {
    const resourceCert = parseCertification(entity.seedance2_asset);
    if (resourceCert) {
      db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(resourceCert), new Date().toISOString(), Number(mapped.id));
    }
  } catch (_) {
    // The mapped asset remains usable even on old SQLite schemas.
  }
  return assetService.getById(db, mapped.id) || mapped;
}

function syncEntities(db, log, entityType, ids) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) return [];
  const uniqueIds = [...new Set((ids || []).map(Number).filter(Number.isFinite))];
  const find = db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND deleted_at IS NULL`);
  return uniqueIds.map((id) => ensureAsset(db, log, entityType, find.get(id))).filter(Boolean);
}

function syncDramaAssets(db, log, dramaId) {
  const result = [];
  for (const [type, config] of Object.entries(ENTITY_CONFIG)) {
    const rows = db.prepare(`SELECT * FROM ${config.table} WHERE drama_id = ? AND deleted_at IS NULL`).all(Number(dramaId));
    for (const row of rows) { const asset = ensureAsset(db, log, type, row); if (asset) result.push(asset); }
  }
  return result;
}

function linkProjectResource(db, log, dramaId, entityType, entityId) {
  const config = ENTITY_CONFIG[entityType];
  if (!config) throw new Error('不支持的项目资源类型');
  const entity = db.prepare(`SELECT * FROM ${config.table} WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`)
    .get(Number(entityId), Number(dramaId));
  if (!entity) return { status: 'not_found', asset: null };
  const existing = findMappedAsset(db, dramaId, entityType, entityId);
  if (existing?.deleted_at) return { status: 'detached', asset: null };
  return { status: 'linked', asset: ensureAsset(db, log, entityType, entity) };
}

function detachProjectResource(db, assetId, ownerUserId) {
  const now = new Date().toISOString();
  try {
    const result = db.prepare(`UPDATE asset_resource_links SET status='detached', detached_at=?, updated_at=?
      WHERE asset_id=? AND owner_user_id=? AND status!='detached'`).run(now, now, Number(assetId), Number(ownerUserId));
    if (result.changes) {
      db.prepare('UPDATE assets SET deleted_at=?, updated_at=? WHERE id=? AND deleted_at IS NULL').run(now, now, Number(assetId));
      return true;
    }
  } catch (_) {}
  return false;
}

function restoreProjectResource(db, log, linkId, ownerUserId) {
  const link = db.prepare('SELECT * FROM asset_resource_links WHERE id=? AND owner_user_id=?').get(Number(linkId), Number(ownerUserId));
  if (!link) return null;
  const now = new Date().toISOString();
  db.prepare("UPDATE asset_resource_links SET status='active', detached_at=NULL, updated_at=? WHERE id=?").run(now, link.id);
  if (link.asset_id) db.prepare('UPDATE assets SET deleted_at=NULL, updated_at=? WHERE id=?').run(now, link.asset_id);
  return assetService.getById(db, link.asset_id) || linkProjectResource(db, log, link.drama_id, link.resource_type, link.resource_id).asset;
}

function listResourceLinks(db, ownerUserId, dramaId, status) {
  const params = [Number(ownerUserId)];
  let where = 'l.owner_user_id=?';
  if (dramaId != null && String(dramaId).trim() !== '') {
    where += ' AND l.drama_id=?';
    params.push(Number(dramaId));
  }
  if (status) {
    where += ' AND l.status=?';
    params.push(String(status));
  }
  return db.prepare(`SELECT l.*, a.name asset_name, a.type asset_type, a.local_path, a.seedance2_asset
    FROM asset_resource_links l
    LEFT JOIN assets a ON a.id=l.asset_id
    WHERE ${where}
    ORDER BY l.updated_at DESC, l.id DESC`).all(...params).map((row) => ({
      ...row,
      seedance2_asset: parseCertification(row.seedance2_asset),
    }));
}

module.exports = { findMappedAsset, ensureAsset, syncEntities, syncDramaAssets, linkProjectResource, detachProjectResource, restoreProjectResource, listResourceLinks };
