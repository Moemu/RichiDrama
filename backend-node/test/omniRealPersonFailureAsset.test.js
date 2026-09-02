const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const omni = require('../src/services/omniVideoService');

const log = { info() {}, warn() {}, error() {} };

function fixture() {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO video_generations (id,drama_id,owner_user_id,status,error_msg,created_at,updated_at)
    VALUES (927,0,7,'failed',?, ?, ?)`)
    .run("Fire failed: input image 'content[5]' may contain real person. Request id: abcdef123456", now, now);
  db.prepare(`INSERT INTO omni_video_jobs (id,video_generation_id,owner_user_id,created_at,updated_at)
    VALUES (92,927,7,?,?)`).run(now, now);
  const insert = db.prepare(`INSERT INTO omni_video_job_assets
    (omni_job_id,ordinal,alias,media_type,role,usage,send_to_model,snapshot_json,created_at)
    VALUES (92,? ,?,'image','reference','reference',1,?,?)`);
  for (let index = 1; index <= 6; index += 1) {
    insert.run(index, `参考图 ${index}`, JSON.stringify({ alias: `参考图 ${index}`, type: 'image', local_path: `projects/demo/ref-${index}.png`, send_to_model: true }), now);
  }
  return db;
}

test('locates content[5] as the fifth image because content[0] is the prompt', () => {
  const db = fixture();
  const target = omni.locateRealPersonFailureAsset(db, 92, { id: 7, role: 'user' });
  assert.equal(omni.realPersonContentIndex("input image 'content[5]' may contain real person"), 5);
  assert.equal(target.alias, '参考图 5');
  assert.equal(target.reference_image_number, 5);
  assert.match(target.preview_url, /projects\/demo\/ref-5\.png$/);
  assert.equal(target.in_asset_library, false);
  assert.equal(target.can_import, true);
  db.close();
});

test('one-click import is owned, marked as real person, and idempotent', () => {
  const db = fixture();
  const first = omni.importRealPersonFailureAsset(db, log, 92, { id: 7, role: 'user' });
  const second = omni.importRealPersonFailureAsset(db, log, 92, { id: 7, role: 'user' });
  assert.equal(first.asset_id, second.asset_id);
  assert.equal(first.in_asset_library, true);
  assert.equal(first.requires_sd2_identity, true);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM assets').get().count, 1);
  assert.equal(db.prepare('SELECT requires_sd2_identity FROM assets WHERE id=?').get(first.asset_id).requires_sd2_identity, 1);
  assert.throws(() => omni.importRealPersonFailureAsset(db, log, 92, { id: 8, role: 'user' }), /无权操作/);
  db.close();
});

test('an explicit library-only import does not declare the image as a real person', () => {
  const db = fixture();
  const imported = omni.importRealPersonFailureAsset(db, log, 92, { id: 7, role: 'user' }, { identity_required: false });
  assert.equal(imported.in_asset_library, true);
  assert.equal(imported.requires_sd2_identity, false);
  assert.equal(db.prepare('SELECT requires_sd2_identity FROM assets WHERE id=?').get(imported.asset_id).requires_sd2_identity, 0);
  db.close();
});

test('copyright restrictions expose all reference images without claiming one caused the failure', () => {
  const db = fixture();
  db.prepare('UPDATE video_generations SET error_msg=? WHERE id=927')
    .run('The request failed because the output video may be related to copyright restrictions. Request id: copyright-123456');
  const targets = omni.locateCopyrightFailureAssets(db, 92, { id: 7, role: 'user' });
  assert.equal(targets.length, 6);
  assert.deepEqual(targets.map((item) => item.reference_image_number), [1, 2, 3, 4, 5, 6]);
  assert.ok(targets.every((item) => item.can_import));
  assert.throws(() => omni.locateCopyrightFailureAssets(db, 92, { id: 8, role: 'user' }), /无权操作/);
  db.close();
});

test('copyright references are imported in one batch without real-person declarations', () => {
  const db = fixture();
  db.prepare('UPDATE video_generations SET error_msg=? WHERE id=927')
    .run('The request failed because the output video may be related to copyright restrictions.');
  const first = omni.importCopyrightFailureAssets(db, log, 92, { id: 7, role: 'user' });
  const second = omni.importCopyrightFailureAssets(db, log, 92, { id: 7, role: 'user' });
  assert.deepEqual(first, { total: 6, in_asset_library: 6, importable: 0, unavailable: 0 });
  assert.deepEqual(second, first);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM assets').get().count, 6);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM assets WHERE requires_sd2_identity=1').get().count, 0);
  db.close();
});
