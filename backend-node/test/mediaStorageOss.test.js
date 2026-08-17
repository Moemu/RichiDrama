'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { archiveLocalFile, mirrorAndTrack, migrateLocalTree, staticHandler, readMediaBuffer, pruneVerifiedLocalCopies, startArchiveScheduler } = require('../src/services/mediaStorageService');
const Database = require('better-sqlite3');

function ossConfig(endpoint) {
  return { storage: { type: 'oss', oss: { endpoint, bucket: 'test-bucket', access_key_id: 'test-id', access_key_secret: 'test-secret', prefix: 'drama', public_base_url: 'https://cdn.example.test', auto_archive_enabled: true, force_path_style: true } } };
}

test('OSS archive keeps the old local_path key and removes local only after a successful upload', async (t) => {
  const received = [];
  const server = http.createServer((req, res) => { const chunks = []; req.on('data', (chunk) => chunks.push(chunk)); req.on('end', () => { received.push({ url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() }); res.writeHead(200, { ETag: 'ok' }); res.end(); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'videos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'videos', 'old.mp4'), 'video-bytes');
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const out = await archiveLocalFile(ossConfig(endpoint), root, 'videos/old.mp4', null, { removeLocal: true });
  assert.equal(out.key, 'drama/videos/old.mp4');
  assert.equal(out.url, 'https://cdn.example.test/drama/videos/old.mp4');
  assert.equal(fs.existsSync(path.join(root, 'videos', 'old.mp4')), false);
  assert.deepEqual(received[0].url, '/test-bucket/drama/videos/old.mp4');
  assert.match(received[0].auth, /^OSS test-id:/);
  assert.equal(received[0].body, 'video-bytes');
});

test('migration dry-run does not upload or delete legacy media', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-dry-'));
  try {
    fs.mkdirSync(path.join(root, 'images'), { recursive: true });
    fs.writeFileSync(path.join(root, 'images', 'legacy.png'), 'abc');
    const out = await migrateLocalTree(ossConfig('http://127.0.0.1:1'), root, null, { dry_run: true, remove_local: true });
    assert.deepEqual({ scanned: out.scanned, migrated: out.migrated, failed: out.failed, bytes: out.bytes }, { scanned: 1, migrated: 0, failed: 0, bytes: 3 });
    assert.equal(fs.existsSync(path.join(root, 'images', 'legacy.png')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('tracked OSS mirroring preserves the local hot copy after upload', async (t) => {
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { ETag: 'mirror-ok' }); res.end(); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-mirror-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'videos'), { recursive: true }); fs.writeFileSync(path.join(root, 'videos', 'hot.mp4'), 'hot-copy');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE media_archive_records (local_path TEXT PRIMARY KEY, source_type TEXT, source_id INTEGER, oss_key TEXT, oss_etag TEXT, archive_status TEXT, archive_attempts INTEGER, archive_error TEXT, verified_at TEXT, local_delete_after TEXT, created_at TEXT, updated_at TEXT)');
  const out = await mirrorAndTrack(db, ossConfig(`http://127.0.0.1:${server.address().port}`), root, 'videos/hot.mp4', 'video_generation', 7, null);
  assert.equal(out.status, 'oss_synced');
  assert.equal(fs.existsSync(path.join(root, 'videos', 'hot.mp4')), true);
  assert.deepEqual(db.prepare('SELECT archive_status, oss_key FROM media_archive_records').get(), { archive_status: 'oss_synced', oss_key: 'drama/videos/hot.mp4' });
});

test('concurrent archive requests for one stable path share one OSS upload', async (t) => {
  let uploads = 0;
  const server = http.createServer((req, res) => {
    uploads += 1;
    req.resume();
    req.on('end', () => setTimeout(() => { res.writeHead(200, { ETag: 'one-upload' }); res.end(); }, 20));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-dedupe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'videos'), { recursive: true }); fs.writeFileSync(path.join(root, 'videos', 'same.mp4'), 'same-copy');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE media_archive_records (local_path TEXT PRIMARY KEY, source_type TEXT, source_id INTEGER, oss_key TEXT, oss_etag TEXT, archive_status TEXT, archive_attempts INTEGER, archive_error TEXT, verified_at TEXT, local_delete_after TEXT, created_at TEXT, updated_at TEXT)');
  const cfg = ossConfig(`http://127.0.0.1:${server.address().port}`);
  await Promise.all([
    mirrorAndTrack(db, cfg, root, 'videos/same.mp4', 'video_generation', 10, null),
    mirrorAndTrack(db, cfg, root, 'videos/same.mp4', 'video_generation', 10, null),
  ]);
  assert.equal(uploads, 1);
});

test('retention prunes a local hot copy only after OSS HEAD verification succeeds', async (t) => {
  const methods = [];
  const server = http.createServer((req, res) => {
    methods.push(req.method);
    if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Length': '8', ETag: 'verified' }); res.end(); return; }
    req.resume(); req.on('end', () => { res.writeHead(200, { ETag: 'uploaded' }); res.end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-retention-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = 'videos/stale.mp4'; const local = path.join(root, relative);
  fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, 'hot-copy');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE media_archive_records (local_path TEXT PRIMARY KEY, source_type TEXT, source_id INTEGER, oss_key TEXT, oss_etag TEXT, archive_status TEXT, archive_attempts INTEGER, archive_error TEXT, verified_at TEXT, local_delete_after TEXT, created_at TEXT, updated_at TEXT)');
  const cfg = ossConfig(`http://127.0.0.1:${server.address().port}`);
  await mirrorAndTrack(db, cfg, root, relative, 'video_generation', 8, null);
  db.prepare("UPDATE media_archive_records SET local_delete_after = ? WHERE local_path = ?").run('2000-01-01T00:00:00.000Z', relative);
  assert.deepEqual(await pruneVerifiedLocalCopies(db, cfg, root, { info() {} }), { scanned: 1, pruned: 1, retained: 0, failed: 0 });
  assert.equal(fs.existsSync(local), false);
  assert.equal(db.prepare('SELECT archive_status, local_delete_after FROM media_archive_records WHERE local_path = ?').get(relative).archive_status, 'local_pruned');
  assert.ok(methods.includes('HEAD'));
});

test('retention keeps the local copy when OSS can no longer be read', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.method === 'HEAD') { res.writeHead(404); res.end(); return; }
    req.resume(); req.on('end', () => { res.writeHead(200, { ETag: 'uploaded' }); res.end(); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-retention-miss-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const relative = 'videos/keep.mp4'; const local = path.join(root, relative);
  fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, 'hot-copy');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE media_archive_records (local_path TEXT PRIMARY KEY, source_type TEXT, source_id INTEGER, oss_key TEXT, oss_etag TEXT, archive_status TEXT, archive_attempts INTEGER, archive_error TEXT, verified_at TEXT, local_delete_after TEXT, created_at TEXT, updated_at TEXT)');
  const cfg = ossConfig(`http://127.0.0.1:${server.address().port}`);
  await mirrorAndTrack(db, cfg, root, relative, 'video_generation', 9, null);
  db.prepare("UPDATE media_archive_records SET local_delete_after = ? WHERE local_path = ?").run('2000-01-01T00:00:00.000Z', relative);
  assert.deepEqual(await pruneVerifiedLocalCopies(db, cfg, root, { info() {} }), { scanned: 1, pruned: 0, retained: 1, failed: 0 });
  assert.equal(fs.existsSync(local), true);
  const record = db.prepare('SELECT archive_status, archive_error, local_delete_after FROM media_archive_records WHERE local_path = ?').get(relative);
  assert.equal(record.archive_status, 'oss_synced');
  assert.match(record.archive_error, /Retention check failed/);
  assert.notEqual(record.local_delete_after, '2000-01-01T00:00:00.000Z');
});

test('database scheduler never scans or deletes untracked local files', async (t) => {
  const received = [];
  const server = http.createServer((req, res) => { received.push(req.url); req.resume(); req.on('end', () => { res.writeHead(200); res.end(); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-sweep-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const fresh = path.join(root, 'images', 'fresh.png'); const settled = path.join(root, 'images', 'settled.png');
  fs.writeFileSync(fresh, 'fresh'); fs.writeFileSync(settled, 'settled');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE media_archive_records (local_path TEXT PRIMARY KEY, source_type TEXT, source_id INTEGER, oss_key TEXT, oss_etag TEXT, archive_status TEXT, archive_attempts INTEGER, archive_error TEXT, verified_at TEXT, local_delete_after TEXT, created_at TEXT, updated_at TEXT)');
  const runner = startArchiveScheduler(ossConfig(`http://127.0.0.1:${server.address().port}`), root, { info() {}, error() {} }, { db });
  const out = await runner.runNow(); runner.stop();
  assert.deepEqual(out, { mirror: { synced: 0, failed: 0 }, retention: { scanned: 0, pruned: 0, retained: 0, failed: 0 } });
  assert.equal(fs.existsSync(fresh), true); assert.equal(fs.existsSync(settled), true);
  assert.deepEqual(received, []);
});

test('a fresh OSS deployment does not archive historical files until explicitly enabled', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-disabled-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cfg = ossConfig('http://127.0.0.1:1'); cfg.storage.oss.auto_archive_enabled = false;
  const runner = startArchiveScheduler(cfg, root, { info() {}, error() {} });
  assert.deepEqual(await runner.runNow(), { skipped: 'auto_archive_disabled' });
});

test('migration refuses to delete local media without a CDN delivery address', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-no-cdn-'));
  try {
    const cfg = ossConfig('http://127.0.0.1:1'); delete cfg.storage.oss.public_base_url;
    await assert.rejects(() => migrateLocalTree(cfg, root, null, { remove_local: true }), /public_base_url/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('export/read fallback fetches an OSS object after the legacy local copy is removed', async (t) => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/test-bucket/drama/images/legacy.png');
    assert.match(req.headers.authorization, /^OSS test-id:/);
    res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('restored-from-oss');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = await readMediaBuffer(ossConfig(`http://127.0.0.1:${server.address().port}`), root, 'images/legacy.png');
  assert.equal(out.toString(), 'restored-from-oss');
});

test('missing local media is read through the protected static route from OSS', async (t) => {
  const server = http.createServer((req, res) => { assert.equal(req.method, 'GET'); res.writeHead(200); res.end('proxied'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-static-'));
  const handler = staticHandler(ossConfig(`http://127.0.0.1:${server.address().port}`), root);
  let sent = null; let type = null;
  await handler({ path: '/images/legacy.png' }, { type: (value) => { type = value; return { send: (value2) => { sent = value2; } }; } }, () => assert.fail('should proxy'));
  assert.equal(type, 'image/png'); assert.equal(sent.toString(), 'proxied');
  fs.rmSync(root, { recursive: true, force: true });
});

test('OSS static fallback preserves video byte-range responses', async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('0123456789'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-range-'));
  const handler = staticHandler(ossConfig(`http://127.0.0.1:${server.address().port}`), root);
  const calls = { headers: {}, status: null, type: null, body: null, ended: false };
  const res = {
    status(value) { calls.status = value; return this; },
    set(value, next) { if (typeof value === 'string') calls.headers[value] = next; else Object.assign(calls.headers, value); return this; },
    type(value) { calls.type = value; return this; },
    send(value) { calls.body = value; return this; },
    end() { calls.ended = true; return this; },
  };
  await handler({ path: '/videos/legacy.mp4', headers: { range: 'bytes=2-5' } }, res, () => assert.fail('should proxy'));
  assert.equal(calls.status, 206);
  assert.equal(calls.type, 'video/mp4');
  assert.equal(calls.headers['Content-Range'], 'bytes 2-5/10');
  assert.equal(calls.body.toString(), '2345');
  await handler({ path: '/videos/legacy.mp4', headers: { range: 'bytes=999-' } }, res, () => assert.fail('should proxy'));
  assert.equal(calls.status, 416);
  assert.equal(calls.headers['Content-Range'], 'bytes */10');
  assert.equal(calls.ended, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a Lens-style bare CDN domain is normalized to HTTPS for optional object URLs', () => {
  const cfg = ossConfig('http://127.0.0.1:1'); cfg.storage.oss.public_base_url = 'media.example.test';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-domain-'));
  fs.rmSync(root, { recursive: true, force: true });
  const { objectUrl } = require('../src/services/mediaStorageService');
  assert.equal(objectUrl(cfg, 'images/legacy.png'), 'https://media.example.test/drama/images/legacy.png');
});
