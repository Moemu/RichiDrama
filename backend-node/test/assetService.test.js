const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const assetService = require('../src/services/assetService');
const { validateShotAssetLimits } = require('../src/services/omniVideoService');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT,
      url TEXT,
      local_path TEXT,
      metadata_json TEXT,
      tags_json TEXT,
      seedance2_asset TEXT,
      requires_sd2_identity INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare('INSERT INTO assets (name, type, updated_at) VALUES (?, ?, ?)')
    .run('portrait.png', 'image', new Date().toISOString());
  return db;
}

test('asset update stores SD2 identity declaration as a SQLite integer and returns a boolean', () => {
  const db = createDb();

  const enabled = assetService.update(db, log, 1, { requires_sd2_identity: true });
  assert.equal(enabled.requires_sd2_identity, true);
  assert.equal(db.prepare('SELECT requires_sd2_identity FROM assets WHERE id = 1').get().requires_sd2_identity, 1);

  const disabled = assetService.update(db, log, 1, { requires_sd2_identity: false });
  assert.equal(disabled.requires_sd2_identity, false);
  assert.equal(db.prepare('SELECT requires_sd2_identity FROM assets WHERE id = 1').get().requires_sd2_identity, 0);
});

test('asset update serializes metadata and tags before binding them to SQLite', () => {
  const db = createDb();
  const updated = assetService.update(db, log, 1, {
    metadata: { source: 'frame-extraction', position: 'first' },
    tags: ['reference', 'continuity'],
  });

  assert.deepEqual(updated.metadata, { source: 'frame-extraction', position: 'first' });
  assert.deepEqual(updated.tags, ['reference', 'continuity']);
  const row = db.prepare('SELECT metadata_json, tags_json FROM assets WHERE id = 1').get();
  assert.equal(row.metadata_json, '{"source":"frame-extraction","position":"first"}');
  assert.equal(row.tags_json, '["reference","continuity"]');
});

test('omni video rejects material counts above the per-shot media limits', () => {
  assert.doesNotThrow(() => validateShotAssetLimits([
    ...Array.from({ length: 9 }, () => ({ type: 'image' })),
    ...Array.from({ length: 3 }, () => ({ type: 'video' })),
  ]));
  assert.throws(
    () => validateShotAssetLimits(Array.from({ length: 10 }, () => ({ type: 'image' }))),
    /per-shot limit of 9/
  );
  assert.throws(
    () => validateShotAssetLimits(Array.from({ length: 4 }, () => ({ type: 'audio' }))),
    /per-shot limit of 3/
  );
});
