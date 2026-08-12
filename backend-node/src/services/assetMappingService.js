const assetService = require('./assetService');

const ENTITY_CONFIG = {
  character: { table: 'characters', name: (row) => row.name || `角色 ${row.id}` },
  scene: { table: 'scenes', name: (row) => [row.location, row.time].filter(Boolean).join(' · ') || `场景 ${row.id}` },
  prop: { table: 'props', name: (row) => row.name || `道具 ${row.id}` },
};

function findMappedAsset(db, dramaId, entityType, entityId) {
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

module.exports = { findMappedAsset, ensureAsset, syncEntities, syncDramaAssets, linkProjectResource };
