const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { scheduleResourceSettlement, resumePendingCertifications } = require('../src/services/assetSd2Service');

test('SD2 settlement is scheduled after the request-visible processing state is saved', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE assets (id INTEGER PRIMARY KEY, seedance2_asset TEXT, updated_at TEXT)');
  db.prepare('INSERT INTO assets (id) VALUES (1)').run();
  const initial = { hub_asset_id: 'asset-1', asset_url: 'asset://asset-1', status: 'processing', updated_at: new Date().toISOString() };
  db.prepare('UPDATE assets SET seedance2_asset = ?, updated_at = ? WHERE id = 1').run(JSON.stringify(initial), initial.updated_at);
  let resolvePoll;
  const polled = new Promise((resolve) => { resolvePoll = resolve; });
  scheduleResourceSettlement(db, { error() {} }, 'assets', 1, { provider: 'hub', ctx: {} }, { id: 'asset-1' }, initial, () => polled);
  assert.equal(JSON.parse(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 1').get().seedance2_asset).status, 'processing');
  resolvePoll({ ok: true, asset: { asset_url: 'asset://asset-1', status: 'active' } });
  for (let count = 0; count < 40; count += 1) {
    const status = JSON.parse(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 1').get().seedance2_asset).status;
    if (status === 'active') break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(JSON.parse(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 1').get().seedance2_asset).status, 'active');
});

test('SD2 processing certifications resume after a backend restart', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE assets (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE scenes (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE props (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE characters (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.prepare('INSERT INTO assets (id, seedance2_asset) VALUES (1, ?)').run(JSON.stringify({ hub_asset_id: 'asset-1', status: 'processing' }));
  const recovered = [];
  const runner = resumePendingCertifications(db, { warn() {}, error() {} }, {}, {
    immediate: false,
    interval_ms: 0,
    refreshResource: async (_db, _log, _cfg, kind, id) => {
      recovered.push(`${kind}:${id}`);
      _db.prepare('UPDATE assets SET seedance2_asset = ? WHERE id = ?').run(JSON.stringify({ hub_asset_id: 'asset-1', status: 'active' }), id);
    },
  });
  await runner.refreshNow();
  assert.deepEqual(recovered, ['asset:1']);
  assert.equal(JSON.parse(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 1').get().seedance2_asset).status, 'active');
});

test('a queued SD2 certification with a permanent submission error becomes failed instead of retrying forever', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE assets (id INTEGER PRIMARY KEY, deleted_at TEXT, name TEXT, type TEXT, url TEXT, local_path TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.prepare('INSERT INTO assets (id, name, type, seedance2_asset) VALUES (1, ?, ?, ?)')
    .run('unreachable portrait', 'image', JSON.stringify({ status: 'queued' }));
  db.exec('CREATE TABLE scenes (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE props (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  db.exec('CREATE TABLE characters (id INTEGER PRIMARY KEY, deleted_at TEXT, seedance2_asset TEXT, updated_at TEXT)');
  const runner = resumePendingCertifications(db, { warn() {}, error() {} }, {}, { immediate: false, interval_ms: 0 });
  await runner.refreshNow();
  const certification = JSON.parse(db.prepare('SELECT seedance2_asset FROM assets WHERE id = 1').get().seedance2_asset);
  assert.equal(certification.status, 'failed');
  assert.match(certification.error, /图片|图像|URL|SD2/);
});
