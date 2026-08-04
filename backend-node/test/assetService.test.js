const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const assetService = require('../src/services/assetService');
const { validateShotAssetLimits, safeSnapshot } = require('../src/services/omniVideoService');
const { normalizeSupports } = require('../src/services/videoModelCapabilities');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      name TEXT,
      type TEXT,
      url TEXT,
      local_path TEXT,
      metadata_json TEXT,
      tags_json TEXT,
      checksum TEXT,
      seedance2_asset TEXT,
      parent_asset_id INTEGER,
      requires_sd2_identity INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
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

test('asset checksum lookup deduplicates only within the same asset scope', () => {
  const db = createDb();
  db.prepare('UPDATE assets SET checksum = ? WHERE id = 1').run('same-content');
  db.prepare('INSERT INTO assets (drama_id, name, type, checksum, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(8, 'project-copy.png', 'image', 'same-content', new Date().toISOString());

  assert.equal(assetService.findByChecksum(db, 'same-content', null).id, 1);
  assert.equal(assetService.findByChecksum(db, 'same-content', 8).id, 2);
  assert.equal(assetService.findByChecksum(db, 'unknown', null), null);
});

test('asset lineage retains ancestors and derived versions, including soft-deleted entries', () => {
  const db = createDb();
  db.prepare('INSERT INTO assets (name, type, parent_asset_id, updated_at) VALUES (?, ?, ?, ?)').run('trim.mp4', 'video', 1, '2026-01-01T00:00:01.000Z');
  db.prepare('INSERT INTO assets (name, type, parent_asset_id, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('keyframe.jpg', 'image', 2, '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z');

  const lineage = assetService.getLineage(db, 2);
  assert.deepEqual(lineage.ancestors.map((item) => item.name), ['portrait.png']);
  assert.deepEqual(lineage.descendants.map((item) => item.name), ['keyframe.jpg']);
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

test('omni job API snapshot masks local and remote source URLs', () => {
  const snapshot = safeSnapshot({
    prompt: 'a tracked shot',
    assets: [{ asset_id: 12, alias: 'lead', type: 'image', local_path: 'C:\\private\\lead.png', url: 'https://signed.example/lead?token=secret', model_url: 'asset://provider-secret', send_to_model: true, strategy: 'native' }],
  });

  assert.deepEqual(snapshot.assets, [{ asset_id: 12, alias: 'lead', type: 'image', role: null, usage: null, ordinal: null, source: 'local', derived_from_asset_id: null, send_to_model: true, strategy: 'native' }]);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
});

test('video capabilities only advertise native media modes with an adapter', () => {
  const generic = normalizeSupports({ api_protocol: 'openai', default_model: 'generic-video' }, {
    audio_reference: true, video_reference: true, video_extend: true, audio_driven: true,
  });
  assert.equal(generic.audio_reference, false);
  assert.equal(generic.video_reference, false);
  assert.equal(generic.video_extend, false);
  assert.equal(generic.audio_driven, false);

  const seedance = normalizeSupports({ api_protocol: 'volcengine_omni', default_model: 'seedance-2.0' }, {});
  assert.equal(seedance.audio_reference, true);
});
