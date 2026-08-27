'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createMediaProxyServer, validateProxyConfig } = require('../tools/media-proxy-server');

const MEDIA_BYTES = Buffer.from('0123456789', 'utf8'); // 10 bytes, easy range math

// Mirrors the config shape used by mediaStorageOss.test.js — notably
// force_path_style=true so object URLs carry /<bucket>/ in the path.
function proxyConfig(endpoint) {
  return { storage: { type: 'oss', oss: { endpoint, bucket: 'test-bucket', access_key_id: 'test-id', access_key_secret: 'test-secret', prefix: 'drama', public_base_url: 'https://cdn.example.test', auto_archive_enabled: true, force_path_style: true } } };
}

// Minimal OSS stub honouring the path shape the proxy signs/requests:
// /<bucket>/<prefix>/<relative key>. Range slicing mirrors simple byte ranges.
function startOssStub(t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const matched = req.url.match(/^\/test-bucket\/drama\/(.+)$/);
    if (!matched) { seen.push({ url: req.url, note: 'unmatched' }); res.writeHead(404); return res.end(); }
    const key = decodeURIComponent(matched[1]);
    seen.push({ url: req.url, key, auth: req.headers.authorization || null, cookie: req.headers.cookie || null, range: req.headers.range || null });
    if (key === 'library/videos/carousel.mp4') {
      const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
      if (range) {
        const chunk = MEDIA_BYTES.subarray(Number(range[1]), Number(range[2]) + 1);
        res.writeHead(206, {
          'Content-Range': `bytes ${range[1]}-${range[2]}/${MEDIA_BYTES.length}`,
          'Content-Length': String(chunk.length),
          ETag: '"carousel-etag"',
        });
        return res.end(chunk);
      }
      res.writeHead(200, { 'Content-Length': String(MEDIA_BYTES.length), ETag: '"carousel-etag"' });
      return res.end(MEDIA_BYTES);
    }
    res.writeHead(404);
    return res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, endpoint: `http://127.0.0.1:${server.address().port}`, seen })));
}

function startProxy(t, cfg) {
  const server = createMediaProxyServer({ cfg }).listen(0, '127.0.0.1');
  return new Promise((resolve) => server.once('listening', () => resolve({ server, port: server.address().port })));
}

async function get(port, urlPath, headers = {}) {
  // The inbound Cookie marker exists to prove outbound calls never carry it.
  return fetch(`http://127.0.0.1:${port}${urlPath}`, { headers: { Cookie: 'session=attacker-marker', ...headers } });
}

test('validateProxyConfig rejects local storage and incomplete credentials', () => {
  assert.match(String(validateProxyConfig({ storage: { type: 'local' } })), /type=oss/);
  assert.match(String(validateProxyConfig({ storage: { type: 'oss', oss: {} } })), /requires storage\.oss\./);
});

test('healthz answers without touching the bucket', async (t) => {
  const oss = await startOssStub(t);
  const proxy = await startProxy(t, proxyConfig(oss.endpoint));
  t.after(() => { proxy.server.close(); oss.server.close(); });
  const response = await get(proxy.port, '/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('full and ranged reads pass through with cache headers and no cookies leaked', async (t) => {
  const oss = await startOssStub(t);
  const proxy = await startProxy(t, proxyConfig(oss.endpoint));
  t.after(() => { proxy.server.close(); oss.server.close(); });

  const full = await get(proxy.port, '/media/library/videos/carousel.mp4');
  assert.equal(full.status, 200);
  assert.equal(await full.text(), MEDIA_BYTES.toString());
  assert.equal(full.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('etag'), '"carousel-etag"');

  const ranged = await get(proxy.port, '/media/library/videos/carousel.mp4', { Range: 'bytes=2-5' });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await ranged.text(), '2345');

  // Credentials must never travel toward untrusted code paths: the stub sees
  // only our signed Authorization, never the inbound marker cookie.
  for (const entry of oss.seen) {
    assert.equal(entry.cookie, null);
    assert.match(entry.auth, /^OSS test-id:/);
  }
});

test('cold objects map to clean 404s and non-media extensions are refused pre-OSS', async (t) => {
  const oss = await startOssStub(t);
  const proxy = await startProxy(t, proxyConfig(oss.endpoint));
  t.after(() => { proxy.server.close(); oss.server.close(); });

  const missing = await get(proxy.port, '/media/library/videos/gone.mp4');
  assert.equal(missing.status, 404);

  const traversal = await get(proxy.port, '/media/%252e%252e%252fsecret.txt');
  assert.ok([400, 404].includes(traversal.status));

  const textFile = await get(proxy.port, '/media/docs/readme.txt');
  assert.equal(textFile.status, 404);
});

test('POST is rejected outright', async (t) => {
  const oss = await startOssStub(t);
  const proxy = await startProxy(t, proxyConfig(oss.endpoint));
  t.after(() => { proxy.server.close(); oss.server.close(); });
  const response = await fetch(`http://127.0.0.1:${proxy.port}/media/library/videos/carousel.mp4`, { method: 'POST' });
  assert.equal(response.status, 405);
});
