'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const auth = require('../src/services/authService');
const { requireAuth } = require('../src/middleware/auth');
const { staticHandler } = require('../src/services/mediaStorageService');
const { authorizeMediaPath } = require('../src/services/mediaAuthorizationService');
const assetService = require('../src/services/assetService');

function request(server, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: server.address().port,
      path: pathname,
      method: options.method || 'GET',
      headers: { Connection: 'close', ...(options.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(options.body || undefined);
  });
}

test('static media is owner-scoped, private-cacheable, and keeps local Range support', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-static-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = new Database(path.join(root, 'auth.db'));
  db.exec(`
    CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT,
      display_name TEXT, role TEXT, console_access INTEGER, account_kind TEXT,
      is_active INTEGER, created_at TEXT, updated_at TEXT, last_login_at TEXT
    );
    CREATE TABLE billing_accounts (user_id INTEGER PRIMARY KEY, updated_at TEXT);
    CREATE TABLE dramas (id INTEGER PRIMARY KEY, owner_user_id INTEGER, title TEXT, deleted_at TEXT, thumbnail TEXT);
    CREATE TABLE episodes (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT, video_url TEXT, thumbnail TEXT);
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY, episode_id INTEGER, deleted_at TEXT, image_url TEXT, local_path TEXT,
      composed_image TEXT, video_url TEXT, last_frame_image_url TEXT, last_frame_local_path TEXT,
      audio_local_path TEXT, narration_audio_local_path TEXT, result TEXT
    );
    CREATE TABLE characters (id INTEGER PRIMARY KEY, drama_id INTEGER, deleted_at TEXT);
    CREATE TABLE character_libraries (id INTEGER PRIMARY KEY, drama_id INTEGER, source_type TEXT, source_id TEXT, image_url TEXT, local_path TEXT, four_view_image_url TEXT, created_at TEXT, deleted_at TEXT);
    CREATE TABLE image_generations (id INTEGER PRIMARY KEY, drama_id INTEGER, owner_user_id INTEGER, image_url TEXT, local_path TEXT, reference_images TEXT, deleted_at TEXT);
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, drama_id INTEGER, owner_user_id INTEGER,
      name TEXT, reference_alias TEXT, type TEXT, category TEXT, url TEXT, local_path TEXT,
      file_size INTEGER, mime_type TEXT, width INTEGER, height INTEGER, duration REAL,
      image_gen_id INTEGER, video_gen_id INTEGER, source_type TEXT, parent_asset_id INTEGER,
      thumbnail_local_path TEXT, metadata_json TEXT, tags_json TEXT, checksum TEXT,
      processing_status TEXT, error_msg TEXT, seedance2_asset TEXT,
      requires_sd2_identity INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT,
      archived_at TEXT, deleted_at TEXT
    );
  `);
  const owner = auth.createUser(db, { username: 'media-owner', password: 'test-password' }, null);
  const other = auth.createUser(db, { username: 'media-other', password: 'test-password' }, null);
  const ownerSession = auth.login(db, owner.username, 'test-password').token;
  const otherSession = auth.login(db, other.username, 'test-password').token;
  const homepagePaths = [64, 63, 62].map((id) => `library/videos/vg_${id}.mp4`);
  fs.mkdirSync(path.join(root, 'library/videos'), { recursive: true });
  for (const key of [...homepagePaths, 'library/videos/private.mp4']) fs.writeFileSync(path.join(root, key), '0123456789');
  db.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?)')
    .run('homepage_default_video_paths', JSON.stringify(homepagePaths));
  db.prepare('INSERT INTO dramas (id, owner_user_id, title) VALUES (?,?,?)').run(7, owner.id, 'Owner project');
  db.prepare('INSERT INTO dramas (id, owner_user_id, title) VALUES (?,?,?)').run(8, other.id, 'Other project');
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?,?)').run(80, 8);
  db.prepare('INSERT INTO storyboards (id, episode_id) VALUES (?,?)').run(90, 80);
  const relative = 'projects/owner/videos/clip.mp4';
  db.prepare('INSERT INTO assets (id, drama_id, owner_user_id, local_path) VALUES (?,?,?,?)').run(9, 7, owner.id, relative);
  const local = path.join(root, relative);
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, '0123456789');
  const foreignGlobalKey = 'foreign-only.mp4';
  fs.writeFileSync(path.join(root, foreignGlobalKey), 'foreign-global');
  db.prepare('INSERT INTO assets (id, owner_user_id, local_path) VALUES (?,?,?)').run(10, owner.id, foreignGlobalKey);
  const sharedGlobalKey = 'shared-global.mp4';
  fs.writeFileSync(path.join(root, sharedGlobalKey), 'shared-global');
  db.prepare('INSERT INTO assets (id, owner_user_id, local_path) VALUES (?,?,?)').run(11, owner.id, sharedGlobalKey);
  const legacyUrlKey = 'legacy/url-only.jpg';
  const legacyUrlFile = path.join(root, legacyUrlKey);
  fs.mkdirSync(path.dirname(legacyUrlFile), { recursive: true });
  fs.writeFileSync(legacyUrlFile, 'legacy-url');
  db.prepare('INSERT INTO image_generations (id, owner_user_id, image_url) VALUES (?,?,?)')
    .run(21, owner.id, `https://old.example/static/${legacyUrlKey}`);
  const absoluteKey = 'legacy/absolute.jpg';
  const absoluteFile = path.join(root, absoluteKey);
  fs.writeFileSync(absoluteFile, 'legacy-absolute');
  db.prepare('INSERT INTO image_generations (id, owner_user_id, local_path) VALUES (?,?,?)')
    .run(22, owner.id, absoluteFile);
  db.prepare('INSERT INTO characters (id, drama_id) VALUES (?,?)').run(80, 8);
  db.prepare('INSERT INTO character_libraries (id, source_type, source_id, local_path) VALUES (?,?,?,?)')
    .run(81, 'character', '80', foreignGlobalKey);
  db.prepare('INSERT INTO characters (id, drama_id) VALUES (?,?)').run(70, 7);
  db.prepare('INSERT INTO character_libraries (id, source_type, source_id, local_path) VALUES (?,?,?,?)')
    .run(82, 'character', '70', sharedGlobalKey);
  const invalidGlobalKey = 'invalid-global.jpg';
  fs.writeFileSync(path.join(root, invalidGlobalKey), 'invalid-global');
  db.prepare('INSERT INTO character_libraries (id, source_type, source_id, local_path) VALUES (?,?,?,?)')
    .run(83, 'unknown-source', null, invalidGlobalKey);
  const legacyNullGlobalKey = 'legacy-null-global.jpg';
  fs.writeFileSync(path.join(root, legacyNullGlobalKey), 'legacy-null-global');
  db.prepare('INSERT INTO character_libraries (id, source_type, source_id, local_path) VALUES (?,?,?,?)')
    .run(84, null, null, legacyNullGlobalKey);
  const ambiguousKey = 'legacy/ambiguous.jpg';
  fs.mkdirSync(path.dirname(path.join(root, ambiguousKey)), { recursive: true });
  fs.writeFileSync(path.join(root, ambiguousKey), 'ambiguous');
  db.prepare('INSERT INTO assets (id, owner_user_id, local_path) VALUES (?,?,?)').run(12, owner.id, ambiguousKey);
  db.prepare('INSERT INTO assets (id, owner_user_id, local_path) VALUES (?,?,?)').run(13, other.id, ambiguousKey);

  const app = express();
  app.use(express.json());
  app.post('/assets', requireAuth(db), (req, res) => {
    try { res.json(assetService.create(db, { info() {} }, { ...req.body, owner_user_id: req.auth.id })); }
    catch (error) { if (error.code === 'MEDIA_REFERENCE_FORBIDDEN') return res.status(403).json({ error: error.message }); throw error; }
  });
  app.patch('/assets/:id', requireAuth(db), (req, res) => {
    try {
      const item = assetService.update(db, { info() {} }, req.params.id, req.body || {}, req.auth.id);
      if (!item) return res.status(404).end();
      return res.json(item);
    } catch (error) {
      return res.status(error.code === 'MEDIA_REFERENCE_FORBIDDEN' ? 403 : 400).json({ error: error.message });
    }
  });
  app.patch('/storyboards/:id', requireAuth(db), (req, res) => {
    const row = db.prepare(`SELECT s.id FROM storyboards s JOIN episodes e ON e.id=s.episode_id JOIN dramas d ON d.id=e.drama_id
      WHERE s.id=? AND d.owner_user_id=? AND s.deleted_at IS NULL AND e.deleted_at IS NULL AND d.deleted_at IS NULL`).get(Number(req.params.id), req.auth.id);
    if (!row) return res.status(404).end();
    db.prepare('UPDATE storyboards SET local_path=?, image_url=? WHERE id=?').run(req.body?.local_path || null, req.body?.image_url || null, row.id);
    return res.json({ id: row.id });
  });
  app.use('/static', requireAuth(db), staticHandler({ storage: { type: 'local' } }, root, { db, privateCache: true, storageRoot: root }));
  let server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    for (const key of homepagePaths) {
      assert.equal((await request(server, `/static/${key}`)).status, 401);
      for (const token of [ownerSession, otherSession]) {
        const response = await request(server, `/static/${key}`, { headers: { Authorization: `Bearer ${token}`, Range: 'bytes=2-5' } });
        assert.equal(response.status, 206);
        assert.equal(response.body.toString(), '2345');
      }
    }
    assert.equal((await request(server, '/static/library/videos/private.mp4', { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    const url = `/static/${relative}`;
    const anonymous = await request(server, url);
    assert.equal(anonymous.status, 401);
    const ownerResponse = await request(server, url, { headers: { Authorization: `Bearer ${ownerSession}` } });
    assert.equal(ownerResponse.status, 200);
    assert.equal(ownerResponse.body.toString(), '0123456789');
    assert.match(ownerResponse.headers['cache-control'], /^private,/);
    assert.match(ownerResponse.headers.vary, /Cookie/);
    const range = await request(server, url, { headers: { Authorization: `Bearer ${ownerSession}`, Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers['content-range'], 'bytes 2-5/10');
    assert.equal(range.body.toString(), '2345');
    const foreign = await request(server, url, { headers: { Authorization: `Bearer ${otherSession}` } });
    assert.equal(foreign.status, 404);
    // A user-owned character cannot publish a foreign path through the global
    // library. The source record must belong to the same original owner.
    assert.equal((await request(server, `/static/${foreignGlobalKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    // A source-owned global library row is an explicit shared-media record.
    assert.equal((await request(server, `/static/${sharedGlobalKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 200);
    // Unknown source types never create an unbound shared-media grant.
    assert.equal((await request(server, `/static/${invalidGlobalKey}`, { headers: { Authorization: `Bearer ${ownerSession}` } })).status, 404);
    assert.equal((await request(server, `/static/${invalidGlobalKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    // NULL source_type is the historical representation of an administrator
    // created global row and remains readable after restart/migration.
    assert.equal((await request(server, `/static/${legacyNullGlobalKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 200);
    for (const key of homepagePaths) assert.equal((await request(server, `/static/${key}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 200);
    db.prepare('DELETE FROM global_settings WHERE key=?').run('homepage_default_video_paths');
    assert.equal((await request(server, `/static/${homepagePaths[0]}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    // Conflicting root-level owners fail closed instead of selecting one by
    // update time or row ID.
    assert.equal((await request(server, `/static/${ambiguousKey}`, { headers: { Authorization: `Bearer ${ownerSession}` } })).status, 404);
    assert.equal((await request(server, `/static/${ambiguousKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    const legacyUrl = await request(server, `/static/${legacyUrlKey}`, { headers: { Authorization: `Bearer ${ownerSession}` } });
    assert.equal(legacyUrl.status, 200);
    assert.equal(legacyUrl.body.toString(), 'legacy-url');
    const legacyAbsolute = await request(server, `/static/${absoluteKey}`, { headers: { Authorization: `Bearer ${ownerSession}` } });
    assert.equal(legacyAbsolute.status, 200);
    assert.equal(legacyAbsolute.body.toString(), 'legacy-absolute');
    assert.equal((await request(server, `/static/${legacyUrlKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);

    // A user-controlled asset row is only a reference. It must not launder a
    // key already owned by another row into the attacker's static namespace.
    const forgedCreate = await request(server, '/assets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'forged', type: 'video', local_path: relative }),
    });
    assert.equal(forgedCreate.status, 403);
    const forged = JSON.parse(forgedCreate.body.toString());
    const forgedRead = await request(server, url, { headers: { Authorization: `Bearer ${otherSession}` } });
    assert.equal(forgedRead.status, 404);

    const ownCreate = await request(server, '/assets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'own', type: 'video', local_path: 'other/own.mp4' }),
    });
    assert.equal(ownCreate.status, 200);
    const own = JSON.parse(ownCreate.body.toString());
    const forgedUrlUpdate = await request(server, `/assets/${own.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `/static/${relative}` }),
    });
    assert.equal(forgedUrlUpdate.status, 200);
    assert.equal((await request(server, url, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    const forgedMetadataUpdate = await request(server, `/assets/${own.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ metadata: { source_path: relative } }),
    });
    assert.equal(forgedMetadataUpdate.status, 200);
    assert.equal((await request(server, url, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    const forgedUpdate = await request(server, `/assets/${own.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ local_path: relative }),
    });
    assert.equal(forgedUpdate.status, 403);
    const forgedUpdateRead = await request(server, url, { headers: { Authorization: `Bearer ${otherSession}` } });
    assert.equal(forgedUpdateRead.status, 404);

    const forgedStoryboard = await request(server, '/storyboards/90', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ local_path: foreignGlobalKey, image_url: `/static/${foreignGlobalKey}` }),
    });
    assert.equal(forgedStoryboard.status, 200);
    assert.equal((await request(server, `/static/${foreignGlobalKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 404);
    assert.equal((await request(server, `/static/${foreignGlobalKey}`, { headers: { Authorization: `Bearer ${ownerSession}` } })).status, 200);

    const urlOnly = await request(server, '/assets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${otherSession}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'url-only', type: 'video', url: `/static/${relative}`, metadata: { source: relative } }),
    });
    assert.equal(urlOnly.status, 200);
    const urlOnlyRead = await request(server, url, { headers: { Authorization: `Bearer ${otherSession}` } });
    assert.equal(urlOnlyRead.status, 404);
    // Reopen the same app and database to prove the legacy shared row remains
    // readable after a process restart.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    assert.equal((await request(server, `/static/${legacyNullGlobalKey}`, { headers: { Authorization: `Bearer ${otherSession}` } })).status, 200);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
    db.close();
  }
});

test('canonical project media authorizes from the project owner index before media-table scans', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE dramas (id INTEGER PRIMARY KEY, owner_user_id INTEGER, deleted_at TEXT)');
    db.prepare('INSERT INTO dramas (id, owner_user_id) VALUES (?, ?)').run(7, 42);

    const allowed = authorizeMediaPath(db, 'projects/0007_20260907_demo/images/cover.png', { id: 42 });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.owner_user_id, 42);
    assert.equal(allowed.fast_path, 'project_owner');

    // A non-owner still takes the full historical/global lookup path and is
    // denied when no durable media row grants access.
    const denied = authorizeMediaPath(db, 'projects/0007_20260907_demo/images/cover.png', { id: 43 });
    assert.equal(denied.allowed, false);
    assert.equal(denied.status, 404);
  } finally {
    db.close();
  }
});

test('retained generation history stays readable after project deletion and database restart', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-deleted-project-media-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbFile = path.join(root, 'history.db');
  let db = new Database(dbFile);
  require('../src/db/migrate').runMigrationsAndEnsure(db);
  const owner = auth.createUser(db, { username: 'history-owner', password: 'test-password' }, null);
  const other = auth.createUser(db, { username: 'history-other', password: 'test-password' }, null);
  const ownerToken = auth.login(db, owner.username, 'test-password').token;
  const otherToken = auth.login(db, other.username, 'test-password').token;
  const homepageKey = 'library/videos/homepage.mp4';
  fs.mkdirSync(path.join(root, 'library/videos'), { recursive: true });
  fs.writeFileSync(path.join(root, homepageKey), 'homepage-video');
  require('../src/services/settingsService').setGlobalSetting(db, 'homepage_default_video_paths', [homepageKey]);
  const at = '2026-01-01T00:00:00.000Z';
  db.prepare('INSERT INTO dramas (id, owner_user_id, title, deleted_at) VALUES (?,?,?,?)')
    .run(7, owner.id, 'Deleted historical project', at);
  const rows = [
    ['image_generations', 'image.jpg'],
    ['video_generations', 'video.mp4'],
    ['assets', 'asset.jpg'],
  ].map(([table, file]) => ({ table, key: `projects/0007_20260101_history/${file}` }));
  for (const { table, key } of rows) {
    db.prepare(`INSERT INTO ${table} (id, drama_id, owner_user_id, local_path) VALUES (1,7,?,?)`).run(owner.id, key);
    const file = path.join(root, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'retained-history');
  }
  const log = { info() {}, warn() {}, error() {} };
  const cfg = { storage: { type: 'local', local_path: root } };
  const start = async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', require('../src/routes').setupRouter(cfg, db, log));
    app.use('/static', requireAuth(db), staticHandler(cfg, root, { db, privateCache: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    return server;
  };
  const stop = async server => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  };
  let server;
  try {
    for (let pass = 0; pass < 2; pass++) {
      server = await start();
      const homepage = await request(server, '/api/v1/homepage/default-videos', { headers: { Authorization: `Bearer ${otherToken}` } });
      assert.equal(homepage.status, 200);
      assert.ok(homepage.body.toString().includes(`/static/${homepageKey}`));
      const homepageVideo = await request(server, `/static/${homepageKey}`, { headers: { Authorization: `Bearer ${otherToken}` } });
      assert.equal(homepageVideo.status, 200);
      assert.equal(homepageVideo.body.toString(), 'homepage-video');
      for (const endpoint of ['images/1', 'videos/1']) {
        assert.equal((await request(server, `/api/v1/${endpoint}`, { headers: { Authorization: `Bearer ${ownerToken}` } })).status, 200);
      }
      for (const { key } of rows) {
        const result = await request(server, `/static/${key}`, { headers: { Authorization: `Bearer ${ownerToken}` } });
        assert.equal(result.status, 200);
        assert.equal(result.body.toString(), 'retained-history');
        assert.equal((await request(server, `/static/${key}`, { headers: { Authorization: `Bearer ${otherToken}` } })).status, 404);
      }
      await stop(server);
      server = null;
      db.close();
      db = new Database(dbFile);
    }
    db.prepare('UPDATE image_generations SET deleted_at=? WHERE id=1').run(at);
    server = await start();
    assert.equal((await request(server, `/static/${rows[0].key}`, { headers: { Authorization: `Bearer ${ownerToken}` } })).status, 404);
  } finally {
    if (server) await stop(server);
    db.close();
  }
});
