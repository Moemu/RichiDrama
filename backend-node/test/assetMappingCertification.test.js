const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const mapping = require('../src/services/assetMappingService');
const { createdAssetFromResult } = require('../src/services/assetSd2Service');

const log = { info() {}, warn() {}, error() {} };

function dbWithProjectResource() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, image_url TEXT, local_path TEXT, seedance2_asset TEXT, deleted_at TEXT);
    CREATE TABLE scenes (id INTEGER PRIMARY KEY, drama_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE props (id INTEGER PRIMARY KEY, drama_id INTEGER, image_url TEXT, local_path TEXT, deleted_at TEXT);
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, owner_user_id INTEGER, name TEXT, type TEXT, category TEXT,
      url TEXT, local_path TEXT, file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, duration REAL,
      image_gen_id INTEGER, video_gen_id INTEGER, source_type TEXT, parent_asset_id INTEGER, thumbnail_local_path TEXT,
      metadata_json TEXT, tags_json TEXT, checksum TEXT, processing_status TEXT, error_msg TEXT, seedance2_asset TEXT,
      requires_sd2_identity INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, deleted_at TEXT
    );
  `);
  return db;
}

test('mapped project resource exposes the canonical character certification', () => {
  const db = dbWithProjectResource();
  const cert = { status: 'active', asset_url: 'asset://character-asset', hub_asset_id: 'character-asset' };
  db.prepare('INSERT INTO characters (id, drama_id, name, local_path, seedance2_asset) VALUES (1, 8, ?, ?, ?)')
    .run('主角', 'drama_8/characters/hero.png', JSON.stringify(cert));

  const [asset] = mapping.syncEntities(db, log, 'character', [1]);
  assert.deepEqual(asset.seedance2_asset, cert);

  const changed = { ...cert, status: 'stale', stale_reason: 'character_main_image_changed' };
  db.prepare('UPDATE characters SET seedance2_asset = ? WHERE id = 1').run(JSON.stringify(changed));
  const [updated] = mapping.syncEntities(db, log, 'character', [1]);
  assert.deepEqual(updated.seedance2_asset, changed);
});

test('sync never clears a mapped certification when the legacy resource has none', () => {
  const db = dbWithProjectResource();
  const cert = { status: 'active', asset_url: 'asset://preserved', hub_asset_id: 'preserved' };
  db.prepare('INSERT INTO characters (id, drama_id, name, local_path) VALUES (1, 8, ?, ?)')
    .run('主角', 'drama_8/characters/hero.png');
  const [asset] = mapping.syncEntities(db, log, 'character', [1]);
  db.prepare('UPDATE assets SET seedance2_asset = ? WHERE id = ?').run(JSON.stringify(cert), asset.id);

  const [synced] = mapping.syncEntities(db, log, 'character', [1]);
  assert.deepEqual(synced.seedance2_asset, cert);
});

test('sync keeps a mapped asset when its project resource no longer has an image', () => {
  const db = dbWithProjectResource();
  db.prepare('INSERT INTO characters (id, drama_id, name, local_path) VALUES (1, 8, ?, ?)')
    .run('主角', 'drama_8/characters/hero.png');
  const [asset] = mapping.syncEntities(db, log, 'character', [1]);
  db.prepare('UPDATE characters SET local_path = NULL WHERE id = 1').run();

  const [synced] = mapping.syncEntities(db, log, 'character', [1]);
  assert.equal(synced.id, asset.id);
  assert.equal(db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(asset.id).deleted_at, null);
});

test('a deliberately deleted mapped asset is not recreated by later resource sync', () => {
  const db = dbWithProjectResource();
  db.prepare('INSERT INTO characters (id, drama_id, name, local_path) VALUES (1, 8, ?, ?)')
    .run('主角', 'drama_8/characters/hero.png');
  const [asset] = mapping.syncEntities(db, log, 'character', [1]);
  db.prepare('UPDATE assets SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), asset.id);

  assert.deepEqual(mapping.syncEntities(db, log, 'character', [1]), []);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM assets').get().total, 1);
});

test('SD2 certificate creation reports a missing provider asset instead of dereferencing null', () => {
  const result = createdAssetFromResult({ ok: true, data: null }, 'hub');
  assert.equal(result.ok, false);
  assert.match(result.error, /资产 ID/);
});
