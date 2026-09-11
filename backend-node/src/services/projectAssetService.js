'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const access = require('./projectAccessService');
const assets = require('./assetService');
const { normalizeMediaReference } = require('./mediaAuthorizationService');

function localFile(root, reference) {
  const key = normalizeMediaReference(reference, root);
  if (!key) throw Object.assign(new Error('素材尚未持久化到本地'), { status: 409 });
  const absolute = path.resolve(root, key);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Object.assign(new Error('素材路径无效'), { status: 400 });
  const real = fs.realpathSync(absolute);
  const realRelative = path.relative(fs.realpathSync(root), real);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative) || !fs.statSync(real).isFile()) throw Object.assign(new Error('素材路径无效'), { status: 400 });
  return real;
}

function join(db, cfg, log, dramaId, sourceId, userId) {
  const permission = access.requireAccess(db, dramaId, userId, 'edit');
  if (!permission.collaboration_enabled) throw Object.assign(new Error('请先启用项目协作'), { status: 409 });
  const source = db.prepare('SELECT * FROM assets WHERE id=? AND deleted_at IS NULL').get(Number(sourceId));
  if (!source) throw Object.assign(new Error('素材不存在'), { status: 404 });
  if (Number(source.drama_id) === Number(dramaId)) return assets.getById(db, source.id);
  if (source.drama_id || Number(source.owner_user_id) !== Number(userId)) throw Object.assign(new Error('只能加入自己的个人素材'), { status: 403 });
  const root = path.resolve(cfg.storage.local_path);
  const sourceFile = localFile(root, source.local_path);
  const media = fs.readFileSync(sourceFile);
  const thumbnail = source.thumbnail_local_path ? fs.readFileSync(localFile(root, source.thumbnail_local_path)) : null;
  const version = crypto.createHash('sha256').update(media).update(thumbnail || Buffer.alloc(0))
    .update(JSON.stringify([source.name, source.type, source.category, source.width, source.height, source.duration, source.metadata_json, source.tags_json])).digest('hex');
  return db.transaction(() => {
    const existing = db.prepare('SELECT a.id FROM project_asset_copies c JOIN assets a ON a.id=c.asset_id WHERE c.drama_id=? AND c.source_asset_id=? AND c.source_version=? AND a.deleted_at IS NULL').get(Number(dramaId), source.id, version);
    if (existing) return assets.getById(db, existing.id);
    const prefix = require('./storageLayout').getProjectStorageSubdir(db, dramaId);
    const directory = `${prefix}/materials/${crypto.randomUUID()}`;
    const mediaKey = `${directory}/media${path.extname(sourceFile)}`;
    const thumbnailKey = thumbnail ? `${directory}/thumbnail${path.extname(source.thumbnail_local_path)}` : null;
    fs.mkdirSync(path.join(root, directory), { recursive: true });
    try {
      fs.writeFileSync(path.join(root, mediaKey), media, { flag: 'wx' });
      if (thumbnail) fs.writeFileSync(path.join(root, thumbnailKey), thumbnail, { flag: 'wx' });
      const copy = assets.create(db, log, {
        drama_id: Number(dramaId), owner_user_id: Number(userId), name: source.name,
        type: source.type, category: source.category, local_path: mediaKey, thumbnail_local_path: thumbnailKey,
        file_size: media.length, mime_type: source.mime_type, width: source.width, height: source.height,
        duration: source.duration, source_type: 'project_copy', checksum: crypto.createHash('sha256').update(media).digest('hex'),
        metadata: JSON.parse(source.metadata_json || '{}'), tags: JSON.parse(source.tags_json || '[]'),
      });
      db.prepare('UPDATE assets SET requires_sd2_identity=? WHERE id=?').run(source.requires_sd2_identity ? 1 : 0, copy.id);
      db.prepare(`INSERT INTO project_asset_copies (drama_id,source_asset_id,source_version,asset_id,added_by,created_at)
        VALUES (?,?,?,?,?,?) ON CONFLICT(drama_id,source_asset_id,source_version) DO UPDATE SET asset_id=excluded.asset_id,added_by=excluded.added_by,created_at=excluded.created_at`)
        .run(Number(dramaId), source.id, version, copy.id, Number(userId), new Date().toISOString());
      return assets.getById(db, copy.id);
    } catch (error) {
      for (const key of [thumbnailKey, mediaKey].filter(Boolean)) {
        try { fs.unlinkSync(path.join(root, key)); } catch (_) {}
      }
      try { fs.rmdirSync(path.join(root, directory)); } catch (_) {}
      throw error;
    }
  }).immediate();
}

function prepareReferences(db, cfg, log, dramaId, userId, input, previous = null) {
  const permission = access.access(db, dramaId, userId);
  if (!permission?.collaboration_enabled || !input || typeof input !== 'object') return input;
  const cache = new Map();
  const copyId = id => {
    const number = Number(id);
    if (!Number.isSafeInteger(number) || number <= 0) return id;
    if (!cache.has(number)) cache.set(number, join(db, cfg, log, dramaId, number, userId));
    return cache.get(number).id;
  };
  const pathFields = new Set(['local_path', 'image_url', 'url', 'ref_image', 'reference_image', 'reference_image_url', 'first_frame_url', 'last_frame_url', 'last_frame_image_url', 'last_frame_local_path', 'audio_local_path', 'narration_audio_local_path', 'reference_images', 'reference_image_urls', 'extra_images']);
  const idFields = new Set(['asset_id', 'omni_first_frame_asset_id', 'omni_last_frame_asset_id']);
  const idsFields = new Set(['asset_ids', 'omni_asset_ids']);
  let personal;
  const copyPath = value => {
    if (typeof value !== 'string' || !value || value.startsWith('data:')) return value;
    const key = normalizeMediaReference(value, cfg.storage.local_path);
    if (!key) return value;
    personal ||= db.prepare('SELECT id,local_path FROM assets WHERE drama_id IS NULL AND owner_user_id=? AND deleted_at IS NULL').all(Number(userId));
    const source = personal.find(asset => normalizeMediaReference(asset.local_path, cfg.storage.local_path) === key);
    if (!source) return value;
    copyId(source.id);
    const copy = cache.get(source.id);
    return value.startsWith('/static/') || /^https?:/.test(value) ? `/static/${copy.local_path}` : copy.local_path;
  };
  const walk = (value, field = '', oldValue) => {
    if (oldValue !== undefined && JSON.stringify(value) === JSON.stringify(oldValue)) return value;
    if (idFields.has(field)) return value ? copyId(value) : value;
    if (Array.isArray(value)) return value.map(item => idsFields.has(field) && typeof item !== 'object' ? copyId(item) : walk(item, field));
    if (value && typeof value === 'object') {
      if (field === 'omni_asset_usage_json') return Object.fromEntries(Object.entries(value).map(([key, child]) => [copyId(key), child]));
      if (idsFields.has(field) && value.id) return { ...value, id: copyId(value.id) };
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child, key, oldValue?.[key])]));
    }
    if (pathFields.has(field)) return copyPath(value);
    return value;
  };
  return walk(input, '', previous);
}

function usageIndex(db, projectAssets) {
  const result = new Map(projectAssets.map(asset => [asset.id, []]));
  const groups = new Map();
  for (const asset of projectAssets) {
    if (!groups.has(asset.drama_id)) groups.set(asset.drama_id, []);
    groups.get(asset.drama_id).push(asset);
  }
  const referenceFields = ['local_path', 'image_url', 'last_frame_local_path', 'last_frame_image_url', 'audio_local_path', 'narration_audio_local_path'];
  for (const [dramaId, rows] of groups) {
    const ids = new Set(rows.map(asset => asset.id));
    const paths = new Map();
    for (const asset of rows) {
      const key = normalizeMediaReference(asset.local_path);
      if (!key) continue;
      if (!paths.has(key)) paths.set(key, []);
      paths.get(key).push(asset.id);
    }
    const referenced = row => new Set(referenceFields.flatMap(field => paths.get(normalizeMediaReference(row[field])) || []));
    const storyboards = db.prepare('SELECT s.*,e.title episode_title FROM storyboards s JOIN episodes e ON e.id=s.episode_id WHERE e.drama_id=? AND e.deleted_at IS NULL AND s.deleted_at IS NULL').all(dramaId);
    for (const row of storyboards) {
      let references = []; try { references = JSON.parse(row.omni_asset_ids || '[]'); } catch (_) {}
      const matches = referenced(row);
      const referenceIds = (Array.isArray(references) ? references : []).map(value => Number(value?.asset_id ?? value?.id ?? value));
      for (const id of [...referenceIds, Number(row.omni_first_frame_asset_id), Number(row.omni_last_frame_asset_id)]) {
        if (ids.has(id)) matches.add(id);
      }
      for (const id of matches) result.get(id).push({ episode_id: row.episode_id, episode_title: row.episode_title, storyboard_id: row.id });
    }
    for (const kind of ['characters', 'scenes', 'props']) {
      for (const row of db.prepare(`SELECT * FROM ${kind} WHERE drama_id=? AND deleted_at IS NULL`).all(dramaId)) {
        for (const id of referenced(row)) result.get(id).push({ resource_type: kind, resource_id: row.id });
      }
    }
    for (const link of db.prepare("SELECT asset_id,resource_type,resource_id FROM asset_resource_links WHERE drama_id=? AND status='active'").all(dramaId)) {
      if (ids.has(link.asset_id)) result.get(link.asset_id).push({ resource_type: link.resource_type, resource_id: link.resource_id });
    }
  }
  return result;
}

function usages(db, assetId) {
  const asset = db.prepare('SELECT id,drama_id,local_path FROM assets WHERE id=? AND deleted_at IS NULL').get(Number(assetId));
  return asset?.drama_id ? usageIndex(db, [asset]).get(asset.id) : [];
}

function assertRemovable(db, assetId) {
  const asset = db.prepare('SELECT drama_id FROM assets WHERE id=?').get(Number(assetId));
  if (!asset?.drama_id || !access.installed(db) || !db.prepare('SELECT 1 FROM project_collaboration WHERE drama_id=?').get(asset.drama_id)) return;
  if (usages(db, assetId).length) throw Object.assign(new Error('素材仍被项目引用，请先在使用位置移除引用'), { status: 409, code: 'ASSET_IN_USE' });
}

function decorateMany(db, items) {
  if (!access.installed(db)) return items;
  const projectAssets = items.filter(asset => asset?.drama_id);
  if (!projectAssets.length) return items;
  const usageById = usageIndex(db, projectAssets);
  const sources = db.prepare(`SELECT c.asset_id,c.source_asset_id,c.added_by,u.display_name added_by_name FROM project_asset_copies c LEFT JOIN users u ON u.id=c.added_by WHERE c.asset_id IN (${projectAssets.map(() => '?').join(',')})`).all(...projectAssets.map(asset => asset.id));
  const sourceById = new Map(sources.map(({ asset_id, ...source }) => [asset_id, source]));
  return items.map(asset => asset?.drama_id ? { ...asset, project_source: sourceById.get(asset.id) || null, usages: usageById.get(asset.id) } : asset);
}

function decorate(db, asset) {
  return decorateMany(db, [asset])[0];
}

module.exports = { join, prepareReferences, usages, assertRemovable, decorate, decorateMany };
