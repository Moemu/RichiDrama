'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const service = require('../src/services/richbestAssetRebindService');

const log = { info() {}, warn() {}, error() {} };

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (id INTEGER PRIMARY KEY, name TEXT, local_path TEXT, url TEXT, type TEXT, mime_type TEXT, seedance2_asset TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT, local_path TEXT, image_url TEXT, seedance2_asset TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE external_asset_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER DEFAULT 0, owner_user_id INTEGER, local_asset_id INTEGER,
      resource_type TEXT, resource_id INTEGER, ai_config_id INTEGER, provider TEXT, remote_group_id TEXT,
      remote_asset_id TEXT, upload_id TEXT, object_key TEXT, asset_type TEXT, source_fingerprint TEXT,
      source_image_url TEXT, source_local_path TEXT, attempt_no INTEGER, source_name TEXT, status TEXT, stage TEXT,
      error_code TEXT, error_message TEXT, provider_request_id TEXT, upload_duration_ms INTEGER, create_duration_ms INTEGER,
      settlement_duration_ms INTEGER, payload_json TEXT, created_at TEXT, updated_at TEXT, active_at TEXT, stale_at TEXT
    );
  `);
  db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'migrations', '77_richbest_asset_rebind_runs.sql'), 'utf8'));
  db.prepare("INSERT INTO assets (id,name,local_path,type,mime_type,updated_at) VALUES (1,'参考图','media/ref.png','image','image/png',?)").run('2026-08-31T00:00:00.000Z');
  db.prepare("INSERT INTO assets (id,name,local_path,type,mime_type,updated_at,deleted_at) VALUES (2,'已删除','media/deleted.png','image','image/png',?,?)").run('2026-08-31T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
  const insert = db.prepare(`INSERT INTO external_asset_bindings
    (owner_user_id,resource_type,resource_id,ai_config_id,provider,remote_group_id,remote_asset_id,asset_type,source_fingerprint,source_local_path,attempt_no,source_name,status,stage,created_at,updated_at,active_at)
    VALUES (7,'asset',?,31,'richbest_asset_v3','group-1',?,'Image',?, ?,1,?,'active','active',?,?,?)`);
  insert.run(1, 'asset-old', 'fingerprint-1', 'media/ref.png', 'rb-asset-1-a1', '2026-08-31T01:00:00.000Z', '2026-08-31T01:00:00.000Z', '2026-08-31T01:00:00.000Z');
  insert.run(2, 'asset-deleted', 'fingerprint-2', 'media/deleted.png', 'rb-asset-2-a1', '2026-08-31T02:00:00.000Z', '2026-08-31T02:00:00.000Z', '2026-08-31T02:00:00.000Z');
  return db;
}

test('Richbest rebind is explicit, idempotent, and preserves the old binding', async () => {
  const db = setup();
  try {
    const preview = service.listCandidates(db, { cutoff_at: '2026-09-01T00:00:00.000Z' });
    assert.equal(preview.total, 2);
    assert.equal(preview.eligible, 1);
    assert.equal(preview.blocked, 1);
    assert.equal(preview.items.find((item) => item.resource_id === 2).blocked_reason, '本地素材已删除');

    const body = { idempotency_key: 'rebind-1', cutoff_at: preview.cutoff_at, reason: '修复远端项目绑定', binding_ids: [1] };
    const created = service.create(db, 9, body);
    assert.equal(created.status, 'queued');
    assert.equal(created.total, 1);
    assert.equal(service.create(db, 9, body).reused, true);

    const registerAsset = async (database) => {
      const old = database.prepare('SELECT * FROM external_asset_bindings WHERE id=1').get();
      const now = new Date().toISOString();
      database.prepare(`INSERT INTO external_asset_bindings
        (tenant_id,owner_user_id,resource_type,resource_id,ai_config_id,provider,remote_group_id,remote_asset_id,asset_type,source_fingerprint,source_local_path,attempt_no,source_name,status,stage,created_at,updated_at,active_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active','active',?,?,?)`).run(
        old.tenant_id, old.owner_user_id, old.resource_type, old.resource_id, 32, old.provider,
        old.remote_group_id, 'asset-new', old.asset_type, old.source_fingerprint, old.source_local_path,
        1, 'rb-asset-1-a1', now, now, now
      );
      return { ok: true };
    };
    const completed = await service.process(db, log, {}, created.id, { registerAsset });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.succeeded, 1);
    assert.equal(completed.items[0].new_remote_asset_id, 'asset-new');
    const old = db.prepare('SELECT status,error_code,remote_asset_id FROM external_asset_bindings WHERE id=1').get();
    assert.deepEqual(old, { status: 'stale', error_code: 'admin_rebind_requested', remote_asset_id: 'asset-old' });
    assert.equal(service.listCandidates(db, { cutoff_at: preview.cutoff_at }).eligible, 0);
  } finally { db.close(); }
});

test('Richbest rebind resumes a persisted queued run after restart', async () => {
  const db = setup();
  try {
    const run = service.create(db, 9, { idempotency_key: 'rebind-recovery', cutoff_at: '2026-09-01T00:00:00.000Z', reason: '恢复测试', binding_ids: [1] });
    const registerAsset = async (database) => {
      const old = database.prepare('SELECT * FROM external_asset_bindings WHERE id=1').get();
      const now = new Date().toISOString();
      database.prepare(`INSERT INTO external_asset_bindings
        (tenant_id,owner_user_id,resource_type,resource_id,ai_config_id,provider,remote_asset_id,asset_type,source_fingerprint,attempt_no,source_name,status,stage,created_at,updated_at,active_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'active','active',?,?,?)`).run(old.tenant_id, old.owner_user_id, old.resource_type, old.resource_id, old.ai_config_id, old.provider, 'asset-recovered', old.asset_type, old.source_fingerprint, 2, 'recovered', now, now, now);
      return { ok: true };
    };
    const recovery = service.startRecovery(db, log, {}, { immediate: false, interval_ms: 60_000, registerAsset });
    recovery.runNow();
    for (let count = 0; count < 40 && service.view(db, run.id).status !== 'completed'; count += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    recovery.stop();
    assert.equal(service.view(db, run.id).status, 'completed');
  } finally { db.close(); }
});
