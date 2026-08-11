const assetService = require('./assetService');

const ENTITY_CONFIG = {
  character: { table: 'characters', name: (row) => row.name || `角色 ${row.id}` },
  scene: { table: 'scenes', name: (row) => [row.location, row.time].filter(Boolean).join(' · ') || `场景 ${row.id}` },
  prop: { table: 'props', name: (row) => row.name || `道具 ${row.id}` },
};

function findMappedAsset(db, dramaId, entityType, entityId) {
  try {
    return db.prepare("SELECT * FROM assets WHERE drama_id = ? AND source_type = 'project_resource' AND deleted_at IS NULL AND json_extract(metadata_json, '$.resource_type') = ? AND json_extract(metadata_json, '$.resource_id') = ? ORDER BY id DESC LIMIT 1")
      .get(Number(dramaId), entityType, Number(entityId));
  } catch (_) {
    return db.prepare("SELECT * FROM assets WHERE drama_id = ? AND source_type = 'project_resource' AND deleted_at IS NULL AND metadata_json LIKE ? AND metadata_json LIKE ? ORDER BY id DESC LIMIT 1")
      .get(Number(dramaId), '%"resource_type":"' + entityType + '"%', '%"resource_id":' + Number(entityId) + '%');
  }
}

function ensureAsset(db, log, entityType, entity) {
  const config = ENTITY_CONFIG[entityType];
  if (!config || !entity?.id || !entity?.drama_id) return null;
  const localPath = entity.local_path || null;
  const url = entity.image_url || null;
  const existing = findMappedAsset(db, entity.drama_id, entityType, entity.id);
  if (!localPath && !url) {
    if (existing) assetService.deleteById(db, log, existing.id);
    return null;
  }
  const payload = { drama_id: Number(entity.drama_id), name: config.name(entity), type: 'image', url: url || '', local_path: localPath, source_type: 'project_resource', processing_status: 'ready', metadata: { resource_type: entityType, resource_id: Number(entity.id) } };
  const mapped = existing ? assetService.update(db, log, existing.id, payload) : assetService.create(db, log, payload);
  // A mapped media item is only a projection of its project resource. Copy the
  // resource certification so the material pool cannot display a second,
  // contradictory SD2 state for the same image.
  try {
    db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = ?').run(
      entity.seedance2_asset || null,
      new Date().toISOString(),
      Number(mapped.id)
    );
    return assetService.getById(db, mapped.id);
  } catch (_) {
    return mapped;
  }
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

module.exports = { ensureAsset, syncEntities, syncDramaAssets };
