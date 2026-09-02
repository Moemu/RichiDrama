'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const richbest = require('../src/services/richbestAssetV3Service');

const log = { info() {}, warn() {}, error() {} };

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': `req-${status}` } });
}

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, owner_user_id INTEGER, deleted_at TEXT);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, name TEXT, image_url TEXT, local_path TEXT, seedance2_asset TEXT, updated_at TEXT, deleted_at TEXT);
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, owner_user_id INTEGER, name TEXT, reference_alias TEXT, type TEXT, category TEXT,
      url TEXT, local_path TEXT, file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, duration REAL,
      image_gen_id INTEGER, video_gen_id INTEGER, source_type TEXT, parent_asset_id INTEGER, thumbnail_local_path TEXT,
      metadata_json TEXT, tags_json TEXT, checksum TEXT, processing_status TEXT, error_msg TEXT, seedance2_asset TEXT,
      requires_sd2_identity INTEGER DEFAULT 0, is_favorite INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT
    );
    CREATE TABLE asset_resource_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT, owner_user_id INTEGER NOT NULL, drama_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL, resource_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'primary_image',
      asset_id INTEGER, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      detached_at TEXT, UNIQUE(drama_id, resource_type, resource_id, role)
    );
    CREATE TABLE external_asset_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL DEFAULT 0, ai_config_id INTEGER NOT NULL,
      provider TEXT NOT NULL, remote_group_id TEXT NOT NULL, name TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(tenant_id, ai_config_id, provider)
    );
    CREATE TABLE external_asset_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL DEFAULT 0, owner_user_id INTEGER, local_asset_id INTEGER,
      resource_type TEXT NOT NULL, resource_id INTEGER NOT NULL, ai_config_id INTEGER NOT NULL, provider TEXT NOT NULL,
      remote_group_id TEXT, remote_asset_id TEXT, upload_id TEXT, object_key TEXT, asset_type TEXT NOT NULL DEFAULT 'Image',
      source_fingerprint TEXT NOT NULL, source_image_url TEXT, source_local_path TEXT, attempt_no INTEGER NOT NULL DEFAULT 1,
      source_name TEXT, status TEXT NOT NULL DEFAULT 'processing', stage TEXT NOT NULL DEFAULT 'queued',
      error_code TEXT, error_message TEXT, provider_request_id TEXT, upload_duration_ms INTEGER, create_duration_ms INTEGER,
      settlement_duration_ms INTEGER, payload_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      active_at TEXT, stale_at TEXT, UNIQUE(ai_config_id, resource_type, resource_id, source_fingerprint, attempt_no)
    );
  `);
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'richbest-v3-'));
  fs.mkdirSync(path.join(storage, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(storage, 'media'), { recursive: true });
  fs.writeFileSync(path.join(storage, 'characters', 'hero.png'), Buffer.from('test-image-bytes'));
  fs.writeFileSync(path.join(storage, 'media', 'hero-side.png'), Buffer.from('second-image-bytes'));
  fs.writeFileSync(path.join(storage, 'media', 'hero-back.png'), Buffer.from('third-image-bytes'));
  fs.writeFileSync(path.join(storage, 'media', 'clip.mp4'), Buffer.from('test-video-bytes'));
  fs.writeFileSync(path.join(storage, 'media', 'voice.mp3'), Buffer.from('test-audio-bytes'));
  db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (1, 7)').run();
  db.prepare('INSERT INTO characters (id, drama_id, name, local_path, updated_at) VALUES (1, 1, ?, ?, ?)')
    .run('主角', 'characters/hero.png', new Date().toISOString());
  const addAsset = db.prepare(`INSERT INTO assets
    (id,owner_user_id,name,type,url,local_path,mime_type,requires_sd2_identity,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const now = new Date().toISOString();
  addAsset.run(2, 7, '主角侧面', 'image', '/static/media/hero-side.png', 'media/hero-side.png', 'image/png', 0, now, now);
  addAsset.run(3, 7, '动作视频', 'video', '/static/media/clip.mp4', 'media/clip.mp4', 'video/mp4', 0, now, now);
  addAsset.run(4, 7, '角色声音', 'audio', '/static/media/voice.mp3', 'media/voice.mp3', 'audio/mpeg', 0, now, now);
  addAsset.run(5, 7, '主角背面', 'image', '/static/media/hero-back.png', 'media/hero-back.png', 'image/png', 0, now, now);
  return { db, storage, close() { db.close(); fs.rmSync(storage, { recursive: true, force: true }); } };
}

function configRow() {
  return { id: 31, tenant_id: 9, provider: richbest.PROVIDER, base_url: 'https://api.richbest.test', api_key: 'vap_live_secret' };
}

test('Richbest response parsing normalizes provider assets', () => {
  const asset = richbest.unwrapAsset({ data: { assetId: 'asset-1', status: 'Active', name: 'hero' } });
  assert.equal(asset.id, 'asset-1');
  assert.equal(asset.status, 'active');
  assert.equal(richbest.assetUrlForVideo(asset.id), 'asset://asset-1');
});

test('asset group creation accepts nested provider response fields', async () => {
  const env = setup();
  const calls = [];
  const row = configRow();
  const ctx = {
    ready: true, tenantId: row.tenant_id, row,
    baseUrl: row.base_url, apiKey: row.api_key,
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      calls.push(pathname);
      if (pathname === '/api/asset-group/list') return response({ data: { assetGroups: [] } });
      if (pathname === '/api/asset-group/create') {
        return response({ Result: { AssetGroup: { AssetGroupId: 'group-nested', GroupName: 'RichiDrama素材库-T9' } } });
      }
      throw new Error(`unexpected ${pathname}`);
    },
  };
  try {
    const group = await richbest.ensureGroup(env.db, ctx);
    assert.equal(group.remote_group_id, 'group-nested');
    assert.deepEqual(calls, ['/api/asset-group/list', '/api/asset-group/create']);
  } finally { env.close(); }
});

test('asset group lookup reuses an earlier remote write before creating again', async () => {
  const env = setup();
  const row = configRow();
  let creates = 0;
  const ctx = {
    ready: true, tenantId: row.tenant_id, row,
    baseUrl: row.base_url, apiKey: row.api_key,
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === '/api/asset-group/list') {
        return response({ data: { assetGroups: [{ assetGroupId: 'group-existing', groupName: 'RichiDrama素材库-T9' }] } });
      }
      if (pathname === '/api/asset-group/create') creates += 1;
      throw new Error(`unexpected ${pathname}`);
    },
  };
  try {
    const group = await richbest.ensureGroup(env.db, ctx);
    assert.equal(group.remote_group_id, 'group-existing');
    assert.equal(creates, 0);
  } finally { env.close(); }
});

test('asset registration replaces a deleted cached group and retries only the definite failed create', async () => {
  const env = setup();
  const now = new Date().toISOString();
  env.db.prepare(`INSERT INTO external_asset_groups
    (tenant_id,ai_config_id,provider,remote_group_id,name,created_at,updated_at)
    VALUES (9,31,?,'group-20260901071716-sm2fl','RichiDrama素材库-T9',?,?)`)
    .run(richbest.PROVIDER, now, now);
  const createGroups = [];
  const createAssets = [];
  let uploads = 0;
  const fakeFetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/auth/me') return response({ authenticated: true });
    if (pathname === '/api/asset/upload-file') {
      uploads += 1;
      return response({ url: 'https://cdn.test/rebind.png', uploadId: 'upload-rebind', assetType: 'Image' });
    }
    if (pathname === '/api/asset-group/list') return response({ items: [] });
    if (pathname === '/api/asset-group/create') {
      createGroups.push(JSON.parse(init.body));
      return response({ groupId: 'group-current-project' });
    }
    if (pathname === '/api/asset/create') {
      const body = JSON.parse(init.body);
      createAssets.push(body);
      if (body.groupId === 'group-20260901071716-sm2fl') {
        return response({ error: { code: 'not_found', message: 'The specified asset_group group-20260901071716-sm2fl is not found.' } }, 404);
      }
      return response({ assetId: 'asset-current-project', status: 'Active', name: body.name });
    }
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    const result = await richbest.registerAsset(
      env.db, log, { storage: { local_path: env.storage } }, 2, 7,
      { row: configRow(), fetchImpl: fakeFetch }
    );
    assert.equal(result.ok, true);
    assert.equal(result.seedance2_asset.asset_url, 'asset://asset-current-project');
    assert.equal(result.seedance2_asset.group_id, 'group-current-project');
    assert.equal(uploads, 1);
    assert.equal(createGroups.length, 1);
    assert.deepEqual(createAssets.map((item) => item.groupId), [
      'group-20260901071716-sm2fl',
      'group-current-project',
    ]);
    assert.equal(env.db.prepare('SELECT remote_group_id FROM external_asset_groups').get().remote_group_id, 'group-current-project');
    assert.equal(env.db.prepare('SELECT remote_group_id FROM external_asset_bindings').get().remote_group_id, 'group-current-project');
  } finally { env.close(); }
});

test('character registration uploads once, becomes active, and is idempotent', async () => {
  const env = setup();
  const calls = [];
  const fakeFetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    calls.push(`${init.method}:${pathname}`);
    assert.equal(init.headers.Authorization, 'Bearer vap_live_secret');
    if (pathname === '/api/auth/me') return response({ authenticated: true });
    if (pathname === '/api/asset-group/list') return response({ items: [] });
    if (pathname === '/api/asset-group/create') return response({ groupId: 'group-1' });
    if (pathname === '/api/asset/upload-file') return response({ url: 'https://cdn.test/hero.png', uploadId: 'upload-1', objectKey: 'hero.png', assetType: 'Image' });
    if (pathname === '/api/asset/create') return response({ assetId: 'asset-1', status: 'Processing', name: 'rb-char-1' });
    if (pathname === '/api/asset/get') return response({ assetId: 'asset-1', status: 'Active', name: 'rb-char-1' });
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    const first = await richbest.registerCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(first.ok, true);
    assert.equal(first.seedance2_asset.status, 'processing');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const saved = JSON.parse(env.db.prepare('SELECT seedance2_asset FROM characters WHERE id=1').get().seedance2_asset);
    assert.equal(saved.status, 'active');
    assert.equal(saved.asset_url, 'asset://asset-1');

    const second = await richbest.registerCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(second.reused, true);
    assert.equal(calls.filter((item) => item === 'POST:/api/asset/upload-file').length, 1);
    assert.equal(calls.filter((item) => item === 'POST:/api/asset/create').length, 1);
  } finally { env.close(); }
});

test('independent image, video, and audio assets upload with separate bindings', async () => {
  const env = setup();
  const createdTypes = [];
  let sequence = 0;
  const fakeFetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/auth/me') return response({ authenticated: true });
    if (pathname === '/api/asset-group/list') return response({ items: [] });
    if (pathname === '/api/asset-group/create') return response({ groupId: 'group-media' });
    if (pathname === '/api/asset/upload-file') {
      sequence += 1;
      const types = { 1: 'Image', 2: 'Image', 3: 'Video', 4: 'Audio' };
      return response({ url: `https://cdn.test/file-${sequence}`, uploadId: `upload-${sequence}`, assetType: types[sequence] });
    }
    if (pathname === '/api/asset/create') {
      const body = JSON.parse(init.body);
      createdTypes.push(body.assetType);
      return response({ assetId: `remote-${createdTypes.length}`, status: 'Active', name: body.name });
    }
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    for (const id of [2, 5, 3, 4]) {
      const out = await richbest.registerAsset(env.db, log, { storage: { local_path: env.storage } }, id, 7, { row: configRow(), fetchImpl: fakeFetch });
      assert.equal(out.ok, true);
      assert.equal(out.seedance2_asset.status, 'active');
    }
    assert.deepEqual(createdTypes, ['Image', 'Image', 'Video', 'Audio']);
    const bindings = env.db.prepare(`SELECT resource_id,asset_type,remote_asset_id FROM external_asset_bindings
      WHERE resource_type='asset' ORDER BY resource_id`).all();
    assert.deepEqual(bindings.map((item) => item.resource_id), [2, 3, 4, 5]);
    assert.equal(new Set(bindings.map((item) => item.remote_asset_id)).size, 4);
    const localAssets = env.db.prepare('SELECT id,requires_sd2_identity,seedance2_asset FROM assets WHERE id IN (2,3,4,5) ORDER BY id').all();
    assert.ok(localAssets.every((item) => item.requires_sd2_identity === 0));
    assert.ok(localAssets.every((item) => JSON.parse(item.seedance2_asset).asset_url.startsWith('asset://remote-')));
  } finally { env.close(); }
});

test('an unknown create result enters reconciling and never permits fallback', async () => {
  const env = setup();
  const fakeFetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/auth/me') return response({ authenticated: true });
    if (pathname === '/api/asset-group/list') return response({ items: [] });
    if (pathname === '/api/asset-group/create') return response({ groupId: 'group-1' });
    if (pathname === '/api/asset/upload-file') return response({ url: 'https://cdn.test/hero.png', uploadId: 'upload-1', assetType: 'Image' });
    if (pathname === '/api/asset/create') return response({ error: { code: 'upstream_error', message: 'unknown' } }, 503);
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    const result = await richbest.registerCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(result.ok, true);
    assert.equal(result.pending, true);
    assert.equal(result.fallback_allowed, undefined);
    assert.equal(result.seedance2_asset.status, 'reconciling');
    const binding = env.db.prepare('SELECT * FROM external_asset_bindings').get();
    assert.equal(binding.stage, 'reconciling');
    assert.equal(binding.upload_id, 'upload-1');
  } finally { env.close(); }
});

test('a failed remote asset can be registered again without reusing the failed attempt', async () => {
  const env = setup();
  let uploads = 0;
  let creates = 0;
  const fakeFetch = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/api/auth/me') return response({ authenticated: true });
    if (pathname === '/api/asset-group/list') return response({ items: [] });
    if (pathname === '/api/asset-group/create') return response({ groupId: 'group-1' });
    if (pathname === '/api/asset/upload-file') {
      uploads += 1;
      return response({ url: `https://cdn.test/hero-${uploads}.png`, uploadId: `upload-${uploads}`, assetType: 'Image' });
    }
    if (pathname === '/api/asset/create') {
      creates += 1;
      return response({ assetId: `asset-${creates}`, status: creates === 1 ? 'Failed' : 'Active' });
    }
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    const first = await richbest.registerCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(first.seedance2_asset.status, 'failed');
    const second = await richbest.registerCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(second.seedance2_asset.status, 'active');
    assert.equal(second.seedance2_asset.asset_url, 'asset://asset-2');
    assert.equal(uploads, 2);
    assert.equal(creates, 2);
    const attempts = env.db.prepare('SELECT attempt_no, status, source_name FROM external_asset_bindings ORDER BY attempt_no').all();
    assert.deepEqual(attempts.map((item) => item.attempt_no), [1, 2]);
    assert.notEqual(attempts[0].source_name, attempts[1].source_name);
  } finally { env.close(); }
});

test('tenant bindings select only the tenant Richbest API key', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE tenants (id INTEGER PRIMARY KEY, name TEXT, status TEXT, uses_legacy_global_configs INTEGER DEFAULT 0);
    CREATE TABLE tenant_memberships (tenant_id INTEGER, user_id INTEGER, role TEXT);
    CREATE TABLE tenant_sd2_config_bindings (tenant_id INTEGER, ai_config_id INTEGER, is_active INTEGER);
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY, name TEXT, base_url TEXT, api_key TEXT, provider TEXT, settings TEXT,
      service_type TEXT, deleted_at TEXT, is_active INTEGER, is_default INTEGER, priority INTEGER
    );
    INSERT INTO tenants VALUES (1, 'tenant-a', 'active', 0), (2, 'tenant-b', 'active', 0);
    INSERT INTO tenant_memberships VALUES (1, 101, 'creator'), (2, 202, 'creator');
    INSERT INTO ai_service_configs VALUES
      (11, 'tenant-a', 'https://a.test', 'key-a', 'richbest_asset_v3', '{}', 'jimeng2_character_auth', NULL, 1, 1, 0),
      (22, 'tenant-b', 'https://b.test', 'key-b', 'richbest_asset_v3', '{}', 'jimeng2_character_auth', NULL, 1, 1, 0);
    INSERT INTO tenant_sd2_config_bindings VALUES (1, 11, 1), (2, 22, 1);
  `);
  try {
    const a = richbest.buildContext(db, 101);
    const b = richbest.buildContext(db, 202);
    assert.equal(a.row.id, 11);
    assert.equal(a.apiKey, 'key-a');
    assert.equal(b.row.id, 22);
    assert.equal(b.apiKey, 'key-b');
  } finally { db.close(); }
});

test('restart recovery reconciles a registering attempt without creating another asset', async () => {
  const env = setup();
  const now = new Date().toISOString();
  env.db.prepare(`INSERT INTO external_asset_bindings
    (tenant_id,owner_user_id,resource_type,resource_id,ai_config_id,provider,remote_group_id,upload_id,asset_type,
      source_fingerprint,attempt_no,source_name,status,stage,created_at,updated_at)
    VALUES (9,7,'character',1,31,?,'group-1','upload-1','Image','fingerprint-1',1,'rb-char-1-restart-a1','registering','registering',?,?)`)
    .run(richbest.PROVIDER, now, now);
  const calls = [];
  const fakeFetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    calls.push(`${init.method}:${pathname}`);
    if (pathname === '/api/asset/list') {
      return response({ items: [{ assetId: 'asset-recovered', status: 'Active', name: 'rb-char-1-restart-a1' }] });
    }
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    const result = await richbest.refreshCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(result.ok, true);
    assert.equal(result.seedance2_asset.status, 'active');
    assert.equal(result.seedance2_asset.asset_url, 'asset://asset-recovered');
    assert.deepEqual(calls, ['GET:/api/asset/list']);
  } finally { env.close(); }
});

test('restart recovery fails an unknown upload instead of falling back or creating an asset', async () => {
  const env = setup();
  const now = new Date().toISOString();
  env.db.prepare(`INSERT INTO external_asset_bindings
    (tenant_id,owner_user_id,resource_type,resource_id,ai_config_id,provider,remote_group_id,asset_type,
      source_fingerprint,attempt_no,source_name,status,stage,created_at,updated_at)
    VALUES (9,7,'character',1,31,?,'group-1','Image','fingerprint-1',1,'rb-char-1-restart-a1','uploading','uploading',?,?)`)
    .run(richbest.PROVIDER, now, now);
  try {
    const result = await richbest.refreshCharacter(env.db, log, { storage: { local_path: env.storage } }, 1, 7, {
      row: configRow(),
      fetchImpl: async () => { throw new Error('must not call remote API'); },
    });
    assert.equal(result.ok, true);
    assert.equal(result.pending, false);
    assert.equal(result.seedance2_asset.status, 'failed');
    assert.equal(result.seedance2_asset.error_code, 'upload_result_unknown');
  } finally { env.close(); }
});

test('generic asset restart recovery reconciles the prior create attempt', async () => {
  const env = setup();
  const now = new Date().toISOString();
  env.db.prepare(`INSERT INTO external_asset_bindings
    (tenant_id,owner_user_id,local_asset_id,resource_type,resource_id,ai_config_id,provider,remote_group_id,upload_id,asset_type,
      source_fingerprint,attempt_no,source_name,status,stage,created_at,updated_at)
    VALUES (9,7,3,'asset',3,31,?,'group-media','upload-video','Video','video-fingerprint',1,'rb-asset-3-restart-a1','registering','registering',?,?)`)
    .run(richbest.PROVIDER, now, now);
  const calls = [];
  const fakeFetch = async (url, init) => {
    const pathname = new URL(url).pathname;
    calls.push(`${init.method}:${pathname}`);
    if (pathname === '/api/asset/list') {
      return response({ items: [{ assetId: 'video-recovered', status: 'Active', name: 'rb-asset-3-restart-a1', assetType: 'Video' }] });
    }
    throw new Error(`unexpected ${pathname}`);
  };
  try {
    const result = await richbest.refreshAsset(env.db, log, { storage: { local_path: env.storage } }, 3, 7, { row: configRow(), fetchImpl: fakeFetch });
    assert.equal(result.ok, true);
    assert.equal(result.seedance2_asset.asset_type, 'Video');
    assert.equal(result.seedance2_asset.asset_url, 'asset://video-recovered');
    assert.deepEqual(calls, ['GET:/api/asset/list']);
  } finally { env.close(); }
});

test('unsupported media format fails before any remote write and does not permit fallback', async () => {
  const env = setup();
  fs.writeFileSync(path.join(env.storage, 'media', 'clip.webm'), Buffer.from('unsupported-video'));
  env.db.prepare('UPDATE assets SET local_path=?,mime_type=? WHERE id=3').run('media/clip.webm', 'video/webm');
  let calls = 0;
  try {
    const result = await richbest.registerAsset(env.db, log, { storage: { local_path: env.storage } }, 3, 7, {
      row: configRow(),
      fetchImpl: async () => { calls += 1; throw new Error('must not call remote API'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.fallback_allowed, undefined);
    assert.match(result.error, /格式/);
    assert.equal(calls, 0);
    assert.equal(env.db.prepare('SELECT COUNT(*) AS count FROM external_asset_bindings').get().count, 0);
  } finally { env.close(); }
});
