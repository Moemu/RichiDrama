'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const access = require('./projectAccessService');
const libraryOwnership = require('./libraryOwnership');
const mediaStorage = require('./mediaStorageService');
const { normalizeMediaReference } = require('./mediaAuthorizationService');
const { resolveStorageFile } = require('../utils/storagePath');

const TYPES = {
  character: {
    library: 'character_libraries', table: 'characters', name: 'name', label: '角色',
    fields: ['name', 'description', 'appearance', 'identity_anchors', 'style_tokens', 'color_palette'],
  },
  scene: {
    library: 'scene_libraries', table: 'scenes', name: 'location', label: '场景',
    fields: ['location', 'time', 'description', 'prompt'],
  },
  prop: {
    library: 'prop_libraries', table: 'props', name: 'name', label: '道具',
    fields: ['name', 'description', 'prompt'],
  },
};

function fail(status, message) { return Object.assign(new Error(message), { status }); }

function assertAvailable(db, type, dramaId, source) {
  const row = db.prepare(`SELECT id FROM ${type.table} WHERE drama_id=? AND ${type.name}=? AND deleted_at IS NULL`)
    .get(dramaId, source[type.name]);
  if (row) throw fail(409, `项目中已有同名${type.label}，请编辑现有条目，不会覆盖其内容`);
}

async function readImage(cfg, reference) {
  const key = normalizeMediaReference(reference, cfg.storage.local_path);
  if (!key) throw fail(409, '素材图片尚未持久化，请先在素材库补充图片');
  const absolute = path.resolve(cfg.storage.local_path, key);
  // Validate real paths before the storage adapter reads a local file.
  if (fs.existsSync(absolute)) resolveStorageFile(cfg.storage.local_path, key);
  const bytes = await mediaStorage.readMediaBuffer(cfg, cfg.storage.local_path, key);
  if (!bytes?.length) throw fail(409, '素材图片文件不可用，请先在素材库补充图片');
  return { bytes, extension: path.extname(key) || '.png' };
}

async function importResource(db, cfg, log, dramaId, actor, body) {
  const id = Number(dramaId);
  access.requireAccess(db, id, actor.id, 'edit');
  const type = Object.hasOwn(TYPES, body.type) ? TYPES[body.type] : null;
  if (!type || !Number.isSafeInteger(Number(body.library_id)) || Number(body.library_id) <= 0) {
    throw fail(400, '资源类型或素材 ID 无效');
  }
  const source = libraryOwnership.read(db, type.library, body.library_id, actor);
  if (!source || source.drama_id != null) throw fail(404, '全局素材不存在或无权限');
  if (!String(source[type.name] || '').trim()) throw fail(400, `请先为素材设置${type.label === '场景' ? '地点' : '名称'}`);
  assertAvailable(db, type, id, source);

  const mainReference = source.local_path || source.image_url;
  const main = mainReference ? await readImage(cfg, mainReference) : null;
  const fourView = body.type === 'character' && source.four_view_image_url ? await readImage(cfg, source.four_view_image_url) : null;
  const prefix = require('./storageLayout').getProjectStorageSubdir(db, id);
  const directory = path.join(cfg.storage.local_path, prefix, 'materials', randomUUID());
  const written = [];
  const saveImage = (image, name) => {
    if (!image) return null;
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(directory, name + image.extension);
    fs.writeFileSync(target, image.bytes, { flag: 'wx' });
    written.push(target);
    return path.relative(cfg.storage.local_path, target).replace(/\\/g, '/');
  };
  try {
    // Only newly imported records receive copies; existing resources and libraries stay unchanged.
    const localPath = saveImage(main, 'image');
    const fourViewPath = saveImage(fourView, 'four-view');
    return db.transaction(() => {
      access.requireAccess(db, id, actor.id, 'edit');
      const current = libraryOwnership.read(db, type.library, source.id, actor);
      if (!current || current.drama_id != null) throw fail(404, '素材已移除，请刷新素材库');
      assertAvailable(db, type, id, source);
      const values = Object.fromEntries(type.fields.map(field => [field, source[field] ?? null]));
      values.drama_id = id;
      values.local_path = localPath;
      values.image_url = localPath ? `/static/${localPath}` : null;
      if (body.type === 'character') values.four_view_image_url = fourViewPath ? `/static/${fourViewPath}` : null;
      values.created_at = values.updated_at = new Date().toISOString();
      const columns = Object.keys(values);
      const result = db.prepare(`INSERT INTO ${type.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(values));
      const resourceId = Number(result.lastInsertRowid);
      require('./assetMappingService').syncEntities(db, log, body.type, [resourceId]);
      db.prepare('UPDATE dramas SET updated_at=? WHERE id=?').run(values.updated_at, id);
      return { resource_type: body.type, resource_id: resourceId };
    })();
  } catch (error) {
    for (const file of written) { try { fs.unlinkSync(file); } catch (_) {} }
    try { fs.rmdirSync(directory); } catch (_) {}
    throw error;
  }
}

module.exports = { importResource };
