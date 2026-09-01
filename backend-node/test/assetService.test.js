const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const assetService = require('../src/services/assetService');
const { validateShotAssetLimits, assetLimitsForCapability, validateCreationMode, safeSnapshot, enforceSd2IdentityAssets, applySd2CertifiedAssetReferences, sd2IdentityState, selectPromptReferenceInputs } = require('../src/services/omniVideoService');
const { normalizeSupports } = require('../src/services/videoModelCapabilities');

const log = { info() {}, warn() {}, error() {} };

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      owner_user_id INTEGER,
      name TEXT,
      reference_alias TEXT,
      type TEXT,
      category TEXT,
      url TEXT,
      local_path TEXT,
      file_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      image_gen_id INTEGER,
      video_gen_id INTEGER,
      source_type TEXT,
      thumbnail_local_path TEXT,
      metadata_json TEXT,
      tags_json TEXT,
      checksum TEXT,
      processing_status TEXT,
      error_msg TEXT,
      seedance2_asset TEXT,
      parent_asset_id INTEGER,
      requires_sd2_identity INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      archived_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, owner_user_id INTEGER, deleted_at TEXT);
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

test('personal media checksum lookup never returns another user\'s asset', () => {
  const db = createDb();
  db.prepare('UPDATE assets SET checksum = ?, owner_user_id = ? WHERE id = 1').run('same-content', 7);
  db.prepare('INSERT INTO assets (name, type, checksum, owner_user_id, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('other-user.png', 'image', 'same-content', 8, new Date().toISOString());

  assert.equal(assetService.findByChecksum(db, 'same-content', null, 7).id, 1);
  assert.equal(assetService.findByChecksum(db, 'same-content', null, 8).id, 2);
  assert.equal(assetService.findByChecksum(db, 'same-content', null, 9), null);
});

test('asset lineage retains ancestors and derived versions, including soft-deleted entries', () => {
  const db = createDb();
  db.prepare('INSERT INTO assets (name, type, parent_asset_id, updated_at) VALUES (?, ?, ?, ?)').run('trim.mp4', 'video', 1, '2026-01-01T00:00:01.000Z');
  db.prepare('INSERT INTO assets (name, type, parent_asset_id, deleted_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('keyframe.jpg', 'image', 2, '2026-01-01T00:00:02.000Z', '2026-01-01T00:00:02.000Z');

  const lineage = assetService.getLineage(db, 2);
  assert.deepEqual(lineage.ancestors.map((item) => item.name), ['portrait.png']);
  assert.deepEqual(lineage.descendants.map((item) => item.name), ['keyframe.jpg']);
});

test('locally archived media never exposes a supplier signed URL', () => {
  const db = createDb();
  db.prepare('UPDATE assets SET type = ?, url = ?, local_path = ? WHERE id = 1').run(
    'video',
    'https://tos.example/video.mp4?ExpiresSeconds=86400&signature=temporary',
    'projects/demo/videos/archived.mp4'
  );

  const item = assetService.getById(db, 1);
  assert.equal(item.url, '/static/projects/demo/videos/archived.mp4');
  assert.equal(item.url.includes('ExpiresSeconds'), false);
});

test('asset lookup by id uses the same personal/project scope as the library', () => {
  const db = createDb();
  db.prepare('UPDATE assets SET owner_user_id = ? WHERE id = 1').run(7);
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(9, 7);
  db.prepare('INSERT INTO assets (drama_id, name, type, updated_at) VALUES (?, ?, ?, ?)')
    .run(9, 'project-image.png', 'image', new Date().toISOString());

  assert.equal(assetService.getByIdForOwner(db, 1, 7).id, 1);
  assert.equal(assetService.getByIdForOwner(db, 2, 7).id, 2);
  assert.equal(assetService.getByIdForOwner(db, 1, 8), null);
  assert.equal(assetService.getByIdForOwner(db, 2, 8), null);
});

test('project owner retains CRUD access when a legacy asset has a stale direct owner', () => {
  const db = createDb();
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(9, 7);
  db.prepare('UPDATE assets SET drama_id = ?, owner_user_id = ? WHERE id = 1').run(9, 8);

  assert.equal(assetService.getByIdForOwner(db, 1, 7).id, 1);
  assert.equal(assetService.update(db, log, 1, { name: 'recovered-project-asset' }, 7).name, 'recovered-project-asset');
  assert.equal(assetService.deleteById(db, log, 1, 7), true);
});

test('new assets receive a stable type-prefixed reference alias while retaining the original file name', () => {
  const db = createDb();
  const item = assetService.create(db, log, { name: '老师.png', type: 'image', owner_user_id: 1 });

  assert.equal(item.name, '老师.png');
  assert.equal(item.reference_alias, `图片${item.id}`);
  assert.equal(db.prepare('SELECT reference_alias FROM assets WHERE id = ?').get(item.id).reference_alias, `图片${item.id}`);
});

test('deleting an asset automatically removes editable storyboard and free-create references', () => {
  const db = createDb();
  db.exec(`
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, omni_asset_ids TEXT, omni_first_frame_asset_id INTEGER, omni_last_frame_asset_id INTEGER, omni_asset_usage_json TEXT, universal_segment_text TEXT, omni_prompt_document_json TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE omni_video_sequences (id INTEGER PRIMARY KEY, owner_user_id INTEGER, deleted_at TEXT);
    CREATE TABLE omni_video_sequence_shots (id INTEGER PRIMARY KEY, sequence_id INTEGER, assets_json TEXT, prompt TEXT, prompt_document_json TEXT, updated_at TEXT, deleted_at TEXT);
  `);
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(9, 7);
  db.prepare('UPDATE assets SET owner_user_id=?, drama_id=? WHERE id=1').run(7, 9);
  db.prepare('INSERT INTO assets (id, owner_user_id, drama_id, name, type, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(2, 7, 9, 'keep.png', 'image', '2026-08-21T00:00:00.000Z');
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(1, 9);
  db.prepare('INSERT INTO storyboards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, 1, '[1,2]', 1, 2, '{"1":"reference","2":"reference"}', '开头 @图片1 中间 @图片2', null, '2026-08-21T00:00:00.000Z', null);
  db.prepare('INSERT INTO omni_video_sequences VALUES (?, ?, ?)').run(1, 7, null);
  db.prepare('INSERT INTO omni_video_sequence_shots VALUES (?, ?, ?, ?, ?, ?, ?)').run(1, 1, '[{"asset_id":1},{"asset_id":2}]', '前 @被删素材 后 @保留素材', '{"refs":[{"asset_id":1,"alias":"被删素材"},{"asset_id":2,"alias":"保留素材"}]}', '2026-08-21T00:00:00.000Z', null);

  assert.equal(assetService.deleteById(db, log, 1, 7), true);
  const storyboard = db.prepare('SELECT * FROM storyboards WHERE id=1').get();
  assert.equal(storyboard.omni_asset_ids, '[2]');
  assert.equal(storyboard.omni_first_frame_asset_id, null);
  assert.equal(storyboard.omni_last_frame_asset_id, 2);
  assert.equal(storyboard.omni_asset_usage_json, '{"2":"reference"}');
  assert.equal(storyboard.universal_segment_text, '开头  中间 @图片1');
  const shot = db.prepare('SELECT * FROM omni_video_sequence_shots WHERE id=1').get();
  assert.equal(shot.assets_json, '[{"asset_id":2}]');
  assert.equal(shot.prompt, '前  后 @保留素材');
  assert.deepEqual(JSON.parse(shot.prompt_document_json).refs, [{ asset_id: 2, alias: '保留素材' }]);
  assert.ok(db.prepare('SELECT deleted_at FROM assets WHERE id=1').get().deleted_at);
});

test('archiving a project asset hides it from new library selection without changing editable shot references', () => {
  const db = createDb();
  db.exec(`CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE storyboards (id INTEGER PRIMARY KEY, episode_id INTEGER, omni_asset_ids TEXT, universal_segment_text TEXT, updated_at TEXT, deleted_at TEXT);`);
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(9, 7);
  db.prepare('UPDATE assets SET owner_user_id=?, drama_id=? WHERE id=1').run(7, 9);
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(1, 9);
  db.prepare('INSERT INTO storyboards VALUES (?, ?, ?, ?, ?, ?)').run(1, 1, '[1]', '使用 @图片1', '2026-08-21T00:00:00.000Z', null);

  assert.equal(assetService.archiveById(db, log, 1, 7), true);
  assert.equal(assetService.list(db, { owner_user_id: 7, scope: 'project', drama_id: 9 }).total, 0);
  assert.equal(assetService.list(db, { owner_user_id: 7, scope: 'project', drama_id: 9, include_archived: 1 }).items[0].archived_at != null, true);
  assert.equal(db.prepare('SELECT omni_asset_ids, universal_segment_text FROM storyboards WHERE id=1').get().omni_asset_ids, '[1]');
  assert.equal(db.prepare('SELECT universal_segment_text FROM storyboards WHERE id=1').get().universal_segment_text, '使用 @图片1');
});

test('bulk asset deletion is scoped to the current user and includes their project assets', () => {
  const db = createDb();
  db.prepare('UPDATE assets SET owner_user_id = ? WHERE id = 1').run(7);
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(9, 7);
  db.prepare('INSERT INTO assets (drama_id, owner_user_id, name, type, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(9, 8, 'project.png', 'image', new Date().toISOString());
  db.prepare('INSERT INTO assets (owner_user_id, name, type, updated_at) VALUES (?, ?, ?, ?)')
    .run(8, 'other-user.png', 'image', new Date().toISOString());

  assert.equal(assetService.deleteMany(db, log, { owner_user_id: 7 }), 2);
  assert.equal(db.prepare('SELECT COUNT(*) total FROM assets WHERE deleted_at IS NULL').get().total, 1);
  assert.equal(db.prepare('SELECT name FROM assets WHERE deleted_at IS NULL').get().name, 'other-user.png');
});

test('SD2 batch queue only marks the caller-owned image assets', () => {
  const db = createDb();
  db.prepare('UPDATE assets SET owner_user_id = ? WHERE id = 1').run(7);
  db.prepare('INSERT INTO assets (owner_user_id, name, type, updated_at) VALUES (?, ?, ?, ?)')
    .run(8, 'other-user.png', 'image', new Date().toISOString());
  const { queueBatchCertification } = require('../src/services/assetSd2Service');
  const queued = queueBatchCertification(db, log, {}, 7, [1, 2]);
  assert.deepEqual(queued, { queued: 1, skipped: 1 });
  assert.equal(db.prepare('SELECT requires_sd2_identity FROM assets WHERE id = 1').get().requires_sd2_identity, 1);
  assert.equal(JSON.parse(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 1').get().seedance2_asset).status, 'queued');
  assert.equal(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 2').get().seedance2_asset, null);
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
  assert.doesNotThrow(() => validateShotAssetLimits([
    ...Array.from({ length: 9 }, () => ({ type: 'image' })),
    ...Array.from({ length: 3 }, () => ({ type: 'video' })),
    ...Array.from({ length: 3 }, () => ({ type: 'audio' })),
  ]));
});

test('prompt-reference selection permits text-only video and keeps frame inputs', () => {
  const selected = [{ asset_id: 1, usage: 'reference' }];
  assert.deepEqual(selectPromptReferenceInputs(selected, { text: '纯文本生成', refs: [] }, '纯文本生成'), []);
  assert.deepEqual(
    selectPromptReferenceInputs([{ asset_id: 2, usage: 'first_frame' }], { text: '首帧生成', refs: [] }, '首帧生成'),
    [{ asset_id: 2, usage: 'first_frame' }]
  );
});

test('global and project asset scopes are isolated for the same owner', () => {
  const db = createDb();
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(9, 7);
  db.prepare('UPDATE assets SET owner_user_id = ? WHERE id = 1').run(7);
  db.prepare('INSERT INTO assets (drama_id, owner_user_id, name, type, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(9, 7, 'project-only.png', 'image', new Date().toISOString());

  assert.deepEqual(assetService.list(db, { owner_user_id: 7, scope: 'global' }).items.map((item) => item.name), ['portrait.png']);
  assert.deepEqual(assetService.list(db, { owner_user_id: 7, scope: 'project', drama_id: 9 }).items.map((item) => item.name), ['project-only.png']);
  assert.equal(assetService.list(db, { owner_user_id: 7 }).total, 2);
});

test('Seedance 2.5 applies its model-specific reference limits instead of legacy model limits', () => {
  const capability = { model: 'doubao-seedance-2-5-260628', limits: { total_reference: { max: 50 }, image_reference: { max: 30 }, video_reference: { max: 10 }, audio_reference: { max: 10 } } };
  assert.deepEqual(assetLimitsForCapability(capability), { total: 50, image: 30, video: 10, audio: 10 });
  assert.doesNotThrow(() => validateShotAssetLimits(Array.from({ length: 30 }, () => ({ type: 'image' })), capability));
  assert.throws(() => validateShotAssetLimits(Array.from({ length: 31 }, () => ({ type: 'image' })), capability), /per-shot limit of 30/);
});

test('first-last-frame mode accepts a first frame without an optional tail frame', () => {
  const capability = { supports: { first_last_frame: true } };
  assert.doesNotThrow(() => validateCreationMode('first_last_frame', [{ type: 'image', usage: 'first_frame' }], capability));
  assert.throws(() => validateCreationMode('first_last_frame', [{ type: 'image', usage: 'first_frame' }, { type: 'video', usage: 'last_frame' }], capability), /尾帧可选/);
});

test('Seedance rejects declared real-person material without an active certification', () => {
  const capability = { model: 'doubao-seedance-2-0', provider: 'volcengine' };
  const pending = [{ type: 'image', alias: '演员参考', send_to_model: true, requires_sd2_identity: true, seedance2_asset: { status: 'stale', asset_url: 'asset://old' } }];
  assert.throws(() => enforceSd2IdentityAssets(pending, capability, log), /SD2/);

  const active = [{ type: 'image', alias: '演员参考', send_to_model: true, requires_sd2_identity: true, model_url: '/static/a.png', seedance2_asset: { status: 'active', asset_url: 'asset://active-1' } }];
  assert.doesNotThrow(() => enforceSd2IdentityAssets(active, capability, log));
  applySd2CertifiedAssetReferences(active, capability);
  assert.equal(active[0].model_url, 'asset://active-1');
  assert.equal(active[0].strategy, 'sd2_library_asset');
});

test('Seedance treats every Richbest in-progress stage as a wait state', () => {
  for (const status of ['queued', 'uploading', 'registering', 'processing', 'reconciling']) {
    const state = sd2IdentityState([{ type: 'image', alias: '演员参考', send_to_model: true, requires_sd2_identity: true, seedance2_asset: { status } }], { model: 'seedance-2.0', supports: {} });
    assert.equal(state.pending.length, 1, status);
    assert.equal(state.invalid.length, 0, status);
  }
});

test('Seedance uses active remote library references for every supported media type', () => {
  const assets = ['image', 'video', 'audio'].map((type, index) => ({
    type,
    send_to_model: true,
    model_url: `/static/source-${index}`,
    seedance2_asset: { status: 'active', asset_url: `asset://library-${index}` },
  }));
  applySd2CertifiedAssetReferences(assets, { model: 'doubao-seedance-2-0', provider: 'volcengine' });
  assert.deepEqual(assets.map((item) => item.model_url), ['asset://library-0', 'asset://library-1', 'asset://library-2']);
  assert.ok(assets.every((item) => item.strategy === 'sd2_library_asset'));
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
