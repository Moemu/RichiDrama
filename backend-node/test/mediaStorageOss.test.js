'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { archiveLocalFile, migrateLocalTree, staticHandler, readMediaBuffer, startArchiveScheduler } = require('../src/services/mediaStorageService');

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

test('automatic archive sweep skips fresh files and archives settled generated media', async (t) => {
  const received = [];
  const server = http.createServer((req, res) => { received.push(req.url); req.resume(); req.on('end', () => { res.writeHead(200); res.end(); }); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-sweep-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const fresh = path.join(root, 'images', 'fresh.png'); const settled = path.join(root, 'images', 'settled.png');
  fs.writeFileSync(fresh, 'fresh'); fs.writeFileSync(settled, 'settled');
  const old = new Date(Date.now() - 10_000); fs.utimesSync(settled, old, old);
  const out = await migrateLocalTree(ossConfig(`http://127.0.0.1:${server.address().port}`), root, null, { remove_local: true, min_age_ms: 1_000 });
  assert.equal(out.migrated, 1); assert.equal(out.skipped, 1);
  assert.equal(fs.existsSync(fresh), true); assert.equal(fs.existsSync(settled), false);
  assert.deepEqual(received, ['/test-bucket/drama/images/settled.png']);
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

test('missing local legacy file redirects the unchanged static path to the CDN', () => {
  let redirected = null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-static-'));
  const handler = staticHandler(ossConfig('http://127.0.0.1:1'), root);
  handler({ path: '/images/legacy.png' }, { redirect: (status, url) => { redirected = { status, url }; } }, () => assert.fail('should redirect'));
  assert.deepEqual(redirected, { status: 302, url: 'https://cdn.example.test/drama/images/legacy.png' });
  fs.rmSync(root, { recursive: true, force: true });
});

test('a Lens-style bare CDN domain is normalized to HTTPS', () => {
  const cfg = ossConfig('http://127.0.0.1:1'); cfg.storage.oss.public_base_url = 'media.example.test';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmd-oss-domain-'));
  const handler = staticHandler(cfg, root); let location = null;
  handler({ path: '/images/legacy.png' }, { redirect: (_status, url) => { location = url; } }, () => assert.fail('should redirect'));
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(location, 'https://media.example.test/drama/images/legacy.png');
});
