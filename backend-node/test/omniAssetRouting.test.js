const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveAssetModelUrl } = require('../src/services/omniVideoService');
const storage = require('../src/services/mediaStorageService');

const cfg = {
  storage: {
    type: 'oss',
    oss: { prefix: 'local-mini-drama', public_base_url: 'https://media.example.test' },
  },
};

function createArchiveTable(db) {
  db.exec(`CREATE TABLE media_archive_records (
    local_path TEXT PRIMARY KEY,
    archive_status TEXT,
    oss_key TEXT
  )`);
}

test('Omni keeps a fresh derived keyframe local until its exact OSS object is synced', () => {
  const db = new Database(':memory:');
  createArchiveTable(db);
  const asset = { local_path: 'library/derived/keyframe_510.jpg', url: '/static/library/derived/keyframe_510.jpg' };

  assert.equal(resolveAssetModelUrl(db, asset, storage, cfg), asset.local_path);
  db.prepare('INSERT INTO media_archive_records (local_path, archive_status, oss_key) VALUES (?, ?, ?)')
    .run(asset.local_path, 'pending', 'local-mini-drama/library/derived/keyframe_510.jpg');
  assert.equal(resolveAssetModelUrl(db, asset, storage, cfg), asset.local_path);

  db.prepare('UPDATE media_archive_records SET archive_status = ?, oss_key = ? WHERE local_path = ?')
    .run('oss_synced', 'local-mini-drama/library/derived/different.jpg', asset.local_path);
  assert.equal(resolveAssetModelUrl(db, asset, storage, cfg), asset.local_path);
  db.close();
});

test('Omni restores a verified OSS reference after database restart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-route-restart-'));
  const filename = path.join(root, 'routing.sqlite');
  const asset = { local_path: 'library/images/reference.jpg' };
  let db = new Database(filename);
  createArchiveTable(db);
  db.prepare('INSERT INTO media_archive_records (local_path, archive_status, oss_key) VALUES (?, ?, ?)')
    .run(asset.local_path, 'oss_synced', 'local-mini-drama/library/images/reference.jpg');
  db.close();

  db = new Database(filename);
  assert.equal(
    resolveAssetModelUrl(db, asset, storage, cfg),
    'https://media.example.test/local-mini-drama/library/images/reference.jpg',
  );
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('Omni accepts matching asset persistence metadata for compatible databases', () => {
  const db = new Database(':memory:');
  const asset = {
    local_path: 'library/images/legacy.jpg',
    metadata_json: JSON.stringify({
      persistence: { oss: { status: 'synced', key: 'local-mini-drama/library/images/legacy.jpg' } },
    }),
  };
  assert.equal(
    resolveAssetModelUrl(db, asset, storage, cfg),
    'https://media.example.test/local-mini-drama/library/images/legacy.jpg',
  );
  db.close();
});
