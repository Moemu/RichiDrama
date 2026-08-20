const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getDb, closeDb } = require('../src/db');
const { runMigrationsAndEnsure } = require('../src/db/migrate');
const auth = require('../src/services/authService');
const drama = require('../src/services/dramaService');
const assets = require('../src/services/assetService');
const assetRoutes = require('../src/routes/assets');

function setup() {
  const dbPath = path.join(os.tmpdir(), `local-mini-drama-assets-${Date.now()}-${Math.random()}.db`);
  const db = getDb({ path: dbPath, type: 'sqlite' });
  runMigrationsAndEnsure(db);
  const log = { info() {}, warn() {} };
  return { db, dbPath, log, admin: auth.ensureBootstrapAdmin(db, log) };
}

function teardown(dbPath) {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(dbPath + suffix); } catch (_) {} }
}

test('asset batch deletion is scope-bound and never clears project assets from the global library action', () => {
  const { db, dbPath, log, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'asset-owner', password: 'creator123' }, admin.id);
    const project = drama.createDrama(db, log, { title: '项目素材', owner_user_id: user.id });
    const global = assets.create(db, log, { owner_user_id: user.id, name: '全局图', type: 'image' });
    const projectAsset = assets.create(db, log, { owner_user_id: user.id, drama_id: project.id, name: '项目图', type: 'image' });
    assert.equal(assets.deleteMany(db, log, { owner_user_id: user.id, scope: 'global', ids: [], type: 'image' }), 1);
    assert.equal(assets.getByIdForOwner(db, global.id, user.id), null);
    assert.equal(assets.getByIdForOwner(db, projectAsset.id, user.id).name, '项目图');
  } finally { teardown(dbPath); }
});

test('asset lineage is owner-scoped and cannot reveal another user current or descendants', () => {
  const { db, dbPath, log, admin } = setup();
  try {
    const owner = auth.createUser(db, { username: 'asset-lineage-owner', password: 'creator123' }, admin.id);
    const other = auth.createUser(db, { username: 'asset-lineage-other', password: 'creator123' }, admin.id);
    const root = assets.create(db, log, { owner_user_id: owner.id, name: '私有根图', type: 'image' });
    const foreignChild = assets.create(db, log, { owner_user_id: other.id, name: '不应泄露的派生图', type: 'image', parent_asset_id: root.id });
    assert.equal(assets.getLineage(db, root.id, other.id), null);
    const lineage = assets.getLineage(db, root.id, owner.id);
    assert.equal(lineage.current.id, root.id);
    assert.deepEqual(lineage.descendants, []);
    assert.equal(assets.getByIdForOwner(db, foreignChild.id, owner.id), null);
  } finally { teardown(dbPath); }
});

test('legacy unmapped project-resource asset deletion falls back to protected soft deletion instead of 404', () => {
  const { db, dbPath, log, admin } = setup();
  try {
    const user = auth.createUser(db, { username: 'legacy-project-asset-owner', password: 'creator123' }, admin.id);
    const project = drama.createDrama(db, log, { title: '兼容项目素材', owner_user_id: user.id });
    const asset = assets.create(db, log, {
      owner_user_id: user.id, drama_id: project.id, name: '旧版项目资源图', type: 'image', source_type: 'project_resource',
      metadata: { resource_type: 'character', resource_id: 999 },
    });
    const response = { statusCode: null, payload: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
    assetRoutes(db, log, {}).delete({ params: { id: asset.id }, auth: { id: user.id } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(assets.getByIdForOwner(db, asset.id, user.id), null);
  } finally { teardown(dbPath); }
});
